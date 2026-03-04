# trd-geofence

Production MVP for dealership geo-conquesting with:
- Live Google Ads Nissan sync + geofence push
- DSP-style ingest -> qualification -> audience -> activation pipeline
- Frontend operator console for architecting, monitoring, trace debugging, and exports

## Stack
- Frontend: React + Vite + TypeScript + Zustand
- Backend API: Express
- Data: Postgres
- Queueing: Redis + BullMQ
- Deploy: Vercel (frontend), Railway (backend + workers)

## New DSP Pilot Capabilities
- Signed partner webhook ingest (`POST /api/ingest/location-events`)
- Idempotent raw event store + normalized location events
- Polygon/radius fence matching + dwell/velocity/accuracy qualification
- Audience memberships with expiry/cooldown logic
- Activation job lifecycle for Google/Meta export-first flows
- Per-device qualification traces and reason-code analytics
- Dead-letter capture + feed throughput/queue monitoring
- Privacy controls (`delete-by-device`, suppression import)

## Backend Services
- Default API: `npm --prefix backend start` (uses `SERVICE_ROLE=api`)
- Ingest worker: `npm --prefix backend run worker:ingest` or `SERVICE_ROLE=ingest npm --prefix backend start`
- Qualifier worker: `npm --prefix backend run worker:qualifier` or `SERVICE_ROLE=qualifier npm --prefix backend start`
- Activation worker: `npm --prefix backend run worker:activation` or `SERVICE_ROLE=activation npm --prefix backend start`
- Scheduler worker: `npm --prefix backend run worker:scheduler` or `SERVICE_ROLE=scheduler npm --prefix backend start`
- All workers in one process group: `SERVICE_ROLE=all-workers npm --prefix backend start`

## Local Run
```bash
# frontend
npm install
npm run dev

# backend api
cd backend
npm install
npm start
```

## Env Configuration
- Frontend env: [.env.example](/Users/matthewbishop/True Rank Digital/trd-geofence/.env.example)
- Backend env: [backend/.env.example](/Users/matthewbishop/True Rank Digital/trd-geofence/backend/.env.example)

## Railway Deployment Pattern
Use one image/repo and set `SERVICE_ROLE` per Railway service:
- `trd-geofence-api` -> `SERVICE_ROLE=api`
- `trd-geofence-ingest` -> `SERVICE_ROLE=ingest`
- `trd-geofence-qualifier` -> `SERVICE_ROLE=qualifier`
- `trd-geofence-activation` -> `SERVICE_ROLE=activation`
- `trd-geofence-scheduler` -> `SERVICE_ROLE=scheduler`

Shared required vars across those services:
- `DATABASE_URL`
- `REDIS_URL`
- `DEVICE_HASH_SALT`
- `PILOT_PARTNER_SOURCE_SECRET`
- Google Ads vars if using live sync/push endpoints

## Core API Endpoints
- Existing Nissan + dashboard/campaign APIs remain:
  - `/api/integrations/google-ads/nissan/*`
  - `/api/dashboard`
  - `/api/campaigns`
  - `/api/geofence/check`
- New DSP APIs:
  - `POST /api/ingest/location-events`
  - `POST /api/qualify/run`
  - `GET /api/audiences/:campaignId`
  - `POST /api/activation/jobs`
  - `GET /api/activation/jobs/:jobId`
  - `POST /api/activation/jobs/:jobId/retry-failures`
  - `GET /api/analytics/qualification`
  - `GET /api/ingest/monitor`
  - `POST /api/campaigns/:id/rules`
  - `POST /api/privacy/delete-device`
  - `POST /api/privacy/suppressions/import`

## Frontend Tabs
- Command Center
- Campaign Architect
- Audience Matrix
- Activation Console
- Event Trace Inspector
- Partner Feed Monitor
- Creative Vault / Fixed Ops Sniper / ROI Forecaster

## Operator Runbook
See [docs/pilot-operator-playbook.md](/Users/matthewbishop/True Rank Digital/trd-geofence/docs/pilot-operator-playbook.md).

## Deployment Guide
See [docs/deployment-railway-vercel.md](/Users/matthewbishop/True Rank Digital/trd-geofence/docs/deployment-railway-vercel.md).
