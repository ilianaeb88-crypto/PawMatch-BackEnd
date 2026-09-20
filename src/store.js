import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dataPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'storage', 'data.json')

const pets = [
  {
    id: 'milo', name: 'Milo', animal: 'Dog', breed: 'Border Collie Mix', age: 3, gender: 'Male', size: 'Medium',
    path: 'Adoption', fixed: true, trained: true, activity: 'very-active', personality: 'social',
    image: '/src/assets/image copy 4.png', description: 'Milo is an energetic, loyal companion who loves an active home.',
    shelter: { name: 'Paws & Paths Rescue', phone: '903-565-8899', email: 'hello@pawsandpaths.org', location: '9854 County Road', hours: '10AM - 5PM' }
  },
  {
    id: 'luna', name: 'Luna', animal: 'Cat', breed: 'Domestic Shorthair', age: 2, gender: 'Female', size: 'Small - 8lb',
    path: 'Adoption', fixed: true, trained: true, activity: 'moderately-active', personality: 'reserved',
    image: '/src/assets/image copy 3.png', description: 'Luna is a gentle, curious cat who enjoys sunny windows and quiet company.',
    shelter: { name: 'SPCA', phone: '903-565-8899', email: 'spca@shelter.org', location: '9854 County Road', hours: '10AM - 5PM' }
  },
  {
    id: 'bear', name: 'Bear', animal: 'Dog', breed: 'Corgi Mix', age: 5, gender: 'Male', size: 'Medium',
    path: 'Foster', fixed: true, trained: true, activity: 'moderately-active', personality: 'social',
    image: '/src/assets/image copy 5.png', description: 'Bear is a friendly, steady dog ready to be part of a loving family.',
    shelter: { name: 'Second Chance Animal Care', phone: '903-565-8899', email: 'adopt@secondchance.org', location: '9854 County Road', hours: '10AM - 5PM' }
  },
  {
    id: 'cleo', name: 'Cleo', animal: 'Cat', breed: 'Calico', age: 4, gender: 'Female', size: 'Small - 9lb',
    path: 'Adoption', fixed: true, trained: true, activity: 'non-active', personality: 'social',
    image: '/src/assets/image copy 2.png', description: 'Cleo is a calm, affectionate cat who would thrive in a patient home.',
    shelter: { name: 'Whiskers Welcome', phone: '903-565-8899', email: 'hello@whiskerswelcome.org', location: '9854 County Road', hours: '10AM - 5PM' }
  }
]

const initialData = { users: [], pets, questionnaires: {}, likes: {} }

export async function loadData() {
  try {
    return JSON.parse(await readFile(dataPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await saveData(initialData)
    return structuredClone(initialData)
  }
}

export async function saveData(data) {
  await mkdir(dirname(dataPath), { recursive: true })
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`)
}

export { dataPath }
