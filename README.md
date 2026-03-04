# trd-geofence

TrueRankDigital Geo-Conquest Engine (full-stack):

- Frontend: React + Vite + TypeScript + Tailwind + Zustand
- Backend: Express API for campaign planning, launch payloads, and tracking
- Deploy targets:
  - Vercel (frontend)
  - Railway (backend)

## Local run

```bash
# terminal 1
npm install
npm run dev

# terminal 2
cd backend
npm install
npm start
```

Frontend defaults to `VITE_API_BASE_URL` or the Railway URL.

## Env

See `.env.example`.

## API highlights

- `GET /api/setup-template`
- `GET /api/campaigns`
- `POST /api/campaigns`
- `GET /api/dashboard`
- `POST /api/campaigns/:id/events`
- `POST /api/campaigns/:id/simulate`
- `GET /api/campaigns/:id/handoff`
- `POST /api/geofence/check`
