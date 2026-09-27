import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most managed Postgres providers (Render, Supabase, Neon, etc.) require SSL
  // and use a self-signed/intermediate cert chain that Node won't validate by default.
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
});

const seedPets = [
  {
    id: "milo",
    name: "Milo",
    animal: "Dog",
    breed: "Border Collie Mix",
    age: 3,
    gender: "Male",
    size: "Medium",
    path: "Adoption",
    fixed: true,
    trained: true,
    activity: "very-active",
    personality: "social",
    image: "/src/assets/image copy 4.png",
    description:
      "Milo is an energetic, loyal companion who loves an active home.",
    shelter: {
      name: "Paws & Paths Rescue",
      phone: "903-565-8899",
      email: "hello@pawsandpaths.org",
      location: "9854 County Road",
      hours: "10AM - 5PM",
    },
  },
  {
    id: "luna",
    name: "Luna",
    animal: "Cat",
    breed: "Domestic Shorthair",
    age: 2,
    gender: "Female",
    size: "Small - 8lb",
    path: "Adoption",
    fixed: true,
    trained: true,
    activity: "moderately-active",
    personality: "reserved",
    image: "/src/assets/image copy 3.png",
    description:
      "Luna is a gentle, curious cat who enjoys sunny windows and quiet company.",
    shelter: {
      name: "SPCA",
      phone: "903-565-8899",
      email: "spca@shelter.org",
      location: "9854 County Road",
      hours: "10AM - 5PM",
    },
  },
  {
    id: "bear",
    name: "Bear",
    animal: "Dog",
    breed: "Corgi Mix",
    age: 5,
    gender: "Male",
    size: "Medium",
    path: "Foster",
    fixed: true,
    trained: true,
    activity: "moderately-active",
    personality: "social",
    image: "/src/assets/image copy 5.png",
    description:
      "Bear is a friendly, steady dog ready to be part of a loving family.",
    shelter: {
      name: "Second Chance Animal Care",
      phone: "903-565-8899",
      email: "adopt@secondchance.org",
      location: "9854 County Road",
      hours: "10AM - 5PM",
    },
  },
  {
    id: "cleo",
    name: "Cleo",
    animal: "Cat",
    breed: "Calico",
    age: 4,
    gender: "Female",
    size: "Small - 9lb",
    path: "Adoption",
    fixed: true,
    trained: true,
    activity: "non-active",
    personality: "social",
    image: "/src/assets/image copy 2.png",
    description:
      "Cleo is a calm, affectionate cat who would thrive in a patient home.",
    shelter: {
      name: "Whiskers Welcome",
      phone: "903-565-8899",
      email: "hello@whiskerswelcome.org",
      location: "9854 County Road",
      hours: "10AM - 5PM",
    },
  },
];

let initialized = false;

async function ensureInitialized() {
  if (initialized) return;
  const schema = await readFile(join(here, "schema.sql"), "utf8");
  await pool.query(schema);
  const { rows } = await pool.query("SELECT count(*)::int AS count FROM pets");
  if (rows[0].count === 0) {
    for (const pet of seedPets) {
      await pool.query(
        "INSERT INTO pets (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
        [pet.id, pet],
      );
    }
  }
  initialized = true;
}

// Reassembles the same { users, pets, questionnaires, likes } shape that
// server.js expects, so none of the route handlers need to change.
export async function loadData() {
  await ensureInitialized();

  const [usersRes, petsRes, questionnairesRes, likesRes] = await Promise.all([
    pool.query(
      "SELECT id, name, email, phone, password_hash, password_salt, auth_provider, google_subject, created_at FROM users",
    ),
    pool.query("SELECT data FROM pets"),
    pool.query(
      "SELECT user_id, answers, ranks, submitted, updated_at FROM questionnaires",
    ),
    pool.query("SELECT user_id, pet_id FROM likes"),
  ]);

  const users = usersRes.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || "",
    passwordHash: row.password_hash || undefined,
    passwordSalt: row.password_salt || undefined,
    authProvider: row.auth_provider || undefined,
    googleSubject: row.google_subject || undefined,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  }));

  const pets = petsRes.rows.map((row) => row.data);

  const questionnaires = {};
  for (const row of questionnairesRes.rows) {
    questionnaires[row.user_id] = {
      answers: row.answers || {},
      ranks: row.ranks || {},
      submitted: row.submitted,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : row.updated_at,
    };
  }

  const likes = {};
  for (const row of likesRes.rows) {
    if (!likes[row.user_id]) likes[row.user_id] = [];
    likes[row.user_id].push(row.pet_id);
  }

  return { users, pets, questionnaires, likes };
}

// server.js mutates the object returned by loadData() in place and then calls
// saveData(data) with the whole thing. We diff nothing — we just upsert
// everything back. For this app's traffic level that's simple and safe;
// it trades a bit of extra I/O for keeping server.js completely unchanged.
export async function saveData(data) {
  await ensureInitialized();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const user of data.users) {
      await client.query(
        `INSERT INTO users (id, name, email, phone, password_hash, password_salt, auth_provider, google_subject, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           password_hash = EXCLUDED.password_hash,
           password_salt = EXCLUDED.password_salt,
           auth_provider = EXCLUDED.auth_provider,
           google_subject = EXCLUDED.google_subject`,
        [
          user.id,
          user.name,
          user.email,
          user.phone || "",
          user.passwordHash || null,
          user.passwordSalt || null,
          user.authProvider || null,
          user.googleSubject || null,
          user.createdAt || null,
        ],
      );
    }

    for (const pet of data.pets) {
      await client.query(
        `INSERT INTO pets (id, data) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [pet.id, pet],
      );
    }

    for (const [userId, questionnaire] of Object.entries(
      data.questionnaires || {},
    )) {
      await client.query(
        `INSERT INTO questionnaires (user_id, answers, ranks, submitted, updated_at)
         VALUES ($1, $2, $3, $4, COALESCE($5, now()))
         ON CONFLICT (user_id) DO UPDATE SET
           answers = EXCLUDED.answers,
           ranks = EXCLUDED.ranks,
           submitted = EXCLUDED.submitted,
           updated_at = EXCLUDED.updated_at`,
        [
          userId,
          questionnaire.answers || {},
          questionnaire.ranks || {},
          Boolean(questionnaire.submitted),
          questionnaire.updatedAt || null,
        ],
      );
    }

    // Likes are small sets per user; replace each user's set wholesale to
    // mirror the in-memory array-replace semantics server.js relies on.
    for (const [userId, petIds] of Object.entries(data.likes || {})) {
      await client.query("DELETE FROM likes WHERE user_id = $1", [userId]);
      for (const petId of petIds) {
        await client.query(
          "INSERT INTO likes (user_id, pet_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [userId, petId],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
