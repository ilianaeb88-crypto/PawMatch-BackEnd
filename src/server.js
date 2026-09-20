import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { OAuth2Client } from 'google-auth-library'
import jwt from 'jsonwebtoken'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { loadData, saveData } from './store.js'

const app = express()
const port = Number(process.env.PORT || 4000)
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret'
const googleClientId = process.env.GOOGLE_CLIENT_ID || ''
const googleClient = new OAuth2Client(googleClientId)
const corsOrigins = (process.env.CORS_ORIGIN || 'https://findpawmatch.netlify.app,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('Origin is not allowed by CORS.'))
  }
}))
app.use(express.json({ limit: '1mb' }))

const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, phone: user.phone || '' })
const tokenFor = (user) => jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d' })
const hashPassword = (password, salt = randomBytes(16).toString('hex')) => ({ salt, hash: scryptSync(password, salt, 64).toString('hex') })
const passwordMatches = (password, user) => {
  if (!user.passwordSalt || !user.passwordHash) return false
  const candidate = scryptSync(password, user.passwordSalt, 64)
  return timingSafeEqual(candidate, Buffer.from(user.passwordHash, 'hex'))
}
const cleanPet = (pet) => ({ ...pet, matchScore: pet.matchScore ?? null })

function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' })
  try {
    req.userId = jwt.verify(header.slice(7), jwtSecret).sub
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }
}

function parseBody(body) {
  return body && typeof body === 'object' ? body : {}
}

function calculateMatch(pet, questionnaire = {}) {
  const answers = questionnaire.answers || {}
  const ranks = questionnaire.ranks || {}
  const checks = [
    ['selectedPet', pet.animal.toLowerCase()],
    ['selectedGender', pet.gender.toLowerCase()],
    ['selectedPath', pet.path.toLowerCase().replace('adoption', 'adopt')],
    ['selectedDogActivity', pet.animal === 'Dog' ? pet.activity : null],
    ['selectedCatActivity', pet.animal === 'Cat' ? pet.activity : null],
    ['selectedDogPersonality', pet.animal === 'Dog' ? pet.personality : null],
    ['selectedCatPersonality', pet.animal === 'Cat' ? pet.personality : null]
  ]
  let earned = 0
  let possible = 0
  for (const [key, expected] of checks) {
    if (!expected || answers[key] === undefined || answers[key] === 'any' || answers[key] === 'no-preference') continue
    const weight = Math.max(1, 16 - Number(ranks[key] || 15))
    possible += weight
    if (answers[key] === expected) earned += weight
  }
  if (!possible) return 50
  return Math.round(50 + (earned / possible) * 50)
}

function matchesFor(data, userId) {
  const questionnaire = data.questionnaires[userId] || {}
  return data.pets
    .map((pet) => ({ ...cleanPet(pet), matchScore: calculateMatch(pet, questionnaire) }))
    .sort((a, b) => b.matchScore - a.matchScore)
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'pawmatch-backend' }))

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = parseBody(req.body)
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!name || !normalizedEmail || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required.' })
    }
    const data = await loadData()
    if (data.users.some((user) => user.email === normalizedEmail)) return res.status(409).json({ error: 'An account with that email already exists.' })
    const passwordData = hashPassword(password)
    const user = { id: randomUUID(), name: String(name).trim(), email: normalizedEmail, ...passwordData, phone: '', createdAt: new Date().toISOString() }
    data.users.push(user)
    await saveData(data)
    res.status(201).json({ token: tokenFor(user), user: publicUser(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/google', async (req, res, next) => {
  try {
    if (!googleClientId) return res.status(503).json({ error: 'Google authentication is not configured.' })
    const { credential } = parseBody(req.body)
    if (typeof credential !== 'string' || !credential) return res.status(400).json({ error: 'A Google credential is required.' })

    let ticket
    try {
      ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId })
    } catch {
      return res.status(401).json({ error: 'The Google credential is invalid or expired.' })
    }
    const payload = ticket.getPayload()
    const email = String(payload?.email || '').trim().toLowerCase()
    if (!email || payload?.email_verified !== true) return res.status(401).json({ error: 'Google account email verification failed.' })

    const data = await loadData()
    let user = data.users.find((candidate) => candidate.email === email)
    if (!user) {
      user = {
        id: randomUUID(),
        name: String(payload.name || email.split('@')[0]).trim(),
        email,
        phone: '',
        authProvider: 'google',
        googleSubject: payload.sub,
        createdAt: new Date().toISOString()
      }
      data.users.push(user)
      await saveData(data)
    }

    res.json({ token: tokenFor(user), user: publicUser(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = parseBody(req.body)
    const user = (await loadData()).users.find((candidate) => candidate.email === String(email || '').trim().toLowerCase())
    if (!user || typeof password !== 'string' || !passwordMatches(password, user)) return res.status(401).json({ error: 'The email or password does not match our records.' })
    res.json({ token: tokenFor(user), user: publicUser(user) })
  } catch (error) { next(error) }
})

app.get('/api/me', requireAuth, async (req, res, next) => {
  try {
    const user = (await loadData()).users.find((candidate) => candidate.id === req.userId)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    res.json({ user: publicUser(user) })
  } catch (error) { next(error) }
})

app.patch('/api/me', requireAuth, async (req, res, next) => {
  try {
    const data = await loadData()
    const user = data.users.find((candidate) => candidate.id === req.userId)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    const { name, email, phone } = parseBody(req.body)
    const normalizedEmail = email === undefined ? user.email : String(email).trim().toLowerCase()
    if (!name || !normalizedEmail) return res.status(400).json({ error: 'Name and email are required.' })
    if (data.users.some((candidate) => candidate.id !== user.id && candidate.email === normalizedEmail)) return res.status(409).json({ error: 'That email is already in use.' })
    user.name = String(name).trim(); user.email = normalizedEmail; user.phone = String(phone || '').trim()
    await saveData(data)
    res.json({ user: publicUser(user) })
  } catch (error) { next(error) }
})

app.patch('/api/me/password', requireAuth, async (req, res, next) => {
  try {
    const data = await loadData()
    const user = data.users.find((candidate) => candidate.id === req.userId)
    const { currentPassword, newPassword } = parseBody(req.body)
    if (!user || !passwordMatches(String(currentPassword || ''), user)) return res.status(400).json({ error: 'The current password does not match our records.' })
    if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'The new password must be at least 8 characters.' })
    const passwordData = hashPassword(newPassword)
    user.passwordHash = passwordData.hash; user.passwordSalt = passwordData.salt
    await saveData(data)
    res.json({ message: 'Password updated.' })
  } catch (error) { next(error) }
})

app.get('/api/pets', async (req, res, next) => {
  try {
    const data = await loadData()
    const { search = '', path = '', animal = '', breed = '', center = '', gender = '' } = req.query
    const query = String(search).toLowerCase()
    const pets = data.pets.filter((pet) => (!query || pet.name.toLowerCase().includes(query)) && (!path || pet.path.toLowerCase() === String(path).toLowerCase()) && (!animal || pet.animal.toLowerCase() === String(animal).toLowerCase()) && (!breed || pet.breed.toLowerCase() === String(breed).toLowerCase()) && (!center || pet.shelter.name.toLowerCase() === String(center).toLowerCase()) && (!gender || pet.gender.toLowerCase() === String(gender).toLowerCase())).map(cleanPet)
    res.json({ pets })
  } catch (error) { next(error) }
})

app.get('/api/pets/:id', async (req, res, next) => {
  try {
    const pet = (await loadData()).pets.find((candidate) => candidate.id === req.params.id)
    if (!pet) return res.status(404).json({ error: 'Pet not found.' })
    res.json({ pet: cleanPet(pet) })
  } catch (error) { next(error) }
})

app.get('/api/pets/:id/compatibility', requireAuth, async (req, res, next) => {
  try {
    const data = await loadData(); const pet = data.pets.find((candidate) => candidate.id === req.params.id)
    if (!pet) return res.status(404).json({ error: 'Pet not found.' })
    const questionnaire = data.questionnaires[req.userId] || {}
    res.json({ petId: pet.id, score: calculateMatch(pet, req.query.answers ? { answers: JSON.parse(req.query.answers) } : questionnaire) })
  } catch (error) { next(error) }
})

app.get('/api/matches', requireAuth, async (req, res, next) => {
  try { res.json({ matches: matchesFor(await loadData(), req.userId) }) } catch (error) { next(error) }
})

app.get('/api/likes', requireAuth, async (req, res, next) => {
  try {
    const data = await loadData(); const ids = data.likes[req.userId] || []
    res.json({ pets: data.pets.filter((pet) => ids.includes(pet.id)).map(cleanPet) })
  } catch (error) { next(error) }
})

app.put('/api/likes/:petId', requireAuth, async (req, res, next) => {
  try {
    const data = await loadData(); if (!data.pets.some((pet) => pet.id === req.params.petId)) return res.status(404).json({ error: 'Pet not found.' })
    data.likes[req.userId] = [...new Set([...(data.likes[req.userId] || []), req.params.petId])]
    await saveData(data); res.status(201).json({ liked: true, petId: req.params.petId })
  } catch (error) { next(error) }
})

app.delete('/api/likes/:petId', requireAuth, async (req, res, next) => {
  try {
    const data = await loadData(); data.likes[req.userId] = (data.likes[req.userId] || []).filter((id) => id !== req.params.petId)
    await saveData(data); res.json({ liked: false, petId: req.params.petId })
  } catch (error) { next(error) }
})

app.get('/api/questionnaire', requireAuth, async (req, res, next) => {
  try { res.json({ questionnaire: (await loadData()).questionnaires[req.userId] || { answers: {}, ranks: {}, submitted: false } }) } catch (error) { next(error) }
})

app.put('/api/questionnaire', requireAuth, async (req, res, next) => {
  try {
    const data = await loadData(); const body = parseBody(req.body)
    data.questionnaires[req.userId] = { answers: body.answers || {}, ranks: body.ranks || {}, submitted: Boolean(body.submitted), updatedAt: new Date().toISOString() }
    await saveData(data); res.json({ questionnaire: data.questionnaires[req.userId] })
  } catch (error) { next(error) }
})

app.post('/api/questionnaire/submit', requireAuth, async (req, res, next) => {
  try {
    const data = await loadData(); const questionnaire = data.questionnaires[req.userId]
    if (!questionnaire || !questionnaire.answers || Object.keys(questionnaire.answers).length < 4) return res.status(400).json({ error: 'Complete the questionnaire before submitting it.' })
    questionnaire.submitted = true; questionnaire.updatedAt = new Date().toISOString(); await saveData(data)
    res.json({ submitted: true, matches: matchesFor(data, req.userId) })
  } catch (error) { next(error) }
})

app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }))
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Internal server error.' }) })

if (process.env.NODE_ENV !== 'test') app.listen(port, () => console.log(`PawMatch API listening on http://localhost:${port}`))

export default app
