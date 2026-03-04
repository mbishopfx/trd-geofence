# Deployment Guide (Vercel + Railway)

## 1) Frontend (Vercel)
1. Import repo into Vercel (or use existing project).
2. Build command: `npm run build`
3. Output directory: `dist`
4. Set env:
- `VITE_API_BASE_URL=https://<railway-api-domain>`
5. Deploy production.

## 2) Backend + Workers (Railway)
Use one codebase/image and set `SERVICE_ROLE` per service.

### 2.1 Create/prepare services
Recommended service names:
- `trd-geofence-api`
- `trd-geofence-ingest`
- `trd-geofence-qualifier`
- `trd-geofence-activation`
- `trd-geofence-scheduler`

If needed, create services from CLI:
```bash
railway add --service trd-geofence-api
railway add --service trd-geofence-ingest
railway add --service trd-geofence-qualifier
railway add --service trd-geofence-activation
railway add --service trd-geofence-scheduler
```

### 2.2 Shared env vars
Set on each service:
- `SERVICE_ROLE` (per service)
- `DATABASE_URL`
- `REDIS_URL`
- `DEVICE_HASH_SALT`
- `PILOT_PARTNER_SOURCE_SECRET`
- Optional operator protection: `OPERATOR_API_KEY`
- Google Ads sync vars if using live sync/push:
  - `GOOGLE_ADS_DEVELOPER_TOKEN`
  - `GOOGLE_ADS_REFRESH_TOKEN`
  - `GOOGLE_ADS_CLIENT_ID`
  - `GOOGLE_ADS_CLIENT_SECRET`
  - `GOOGLE_ADS_NISSAN_CUSTOMER_ID`

Role values:
- API: `SERVICE_ROLE=api`
- Ingest worker: `SERVICE_ROLE=ingest`
- Qualifier worker: `SERVICE_ROLE=qualifier`
- Activation worker: `SERVICE_ROLE=activation`
- Scheduler worker: `SERVICE_ROLE=scheduler`

### 2.3 Deploy each service
From repo root:
```bash
railway up --service trd-geofence-api
railway up --service trd-geofence-ingest
railway up --service trd-geofence-qualifier
railway up --service trd-geofence-activation
railway up --service trd-geofence-scheduler
```

## 3) Health checks
API checks:
- `GET /api/health`
- `GET /api/dashboard`

Pipeline checks:
- `GET /api/ingest/monitor`
- `POST /api/qualify/run`
- `POST /api/activation/jobs`

## 4) Notes
- The API service exposes public routes; workers do not need public domains.
- If you want a lower-cost setup, run all workers in one service with `SERVICE_ROLE=all-workers`.
