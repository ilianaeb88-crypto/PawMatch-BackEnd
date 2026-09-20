# PawMatch Backend

Standalone REST API for the PawMatch frontend. It uses a JSON file store so the service can be moved to its own repository without requiring a database server.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

The API listens on `http://localhost:4000` by default. CORS allows the deployed frontend at `https://findpawmatch.netlify.app` and local Vite development. Set `CORS_ORIGIN` to a comma-separated list of origins when deploying the API. The first start creates `storage/data.json` and seeds the pet catalog.

## API

- `GET /api/health`
- `POST /api/auth/register` with `{ name, email, password }`
- `POST /api/auth/login` with `{ email, password }`
- `POST /api/auth/google` with `{ credential }` from Google Identity Services
- `GET /api/me` (auth)
- `PATCH /api/me` with `{ name, email, phone }` (auth)
- `PATCH /api/me/password` with `{ currentPassword, newPassword }` (auth)
- `GET /api/pets` with `search`, `path`, `animal`, `breed`, `center`, and `gender` filters
- `GET /api/pets/:id`
- `GET /api/pets/:id/compatibility` (auth, optional `answers` query parameter)
- `GET /api/matches` (auth)
- `GET /api/likes` (auth)
- `PUT /api/likes/:petId` and `DELETE /api/likes/:petId` (auth)
- `GET /api/questionnaire` (auth)
- `PUT /api/questionnaire` with `{ answers, ranks }` (auth)
- `POST /api/questionnaire/submit` (auth)

Every protected response expects `Authorization: Bearer <token>`.

Google login requires `GOOGLE_CLIENT_ID` to match the frontend Google Identity Services client ID.
