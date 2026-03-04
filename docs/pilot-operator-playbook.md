# Wichita Falls Pilot Operator Playbook

## 1) One-time setup
1. Deploy frontend to Vercel.
2. Deploy backend API to Railway service with `SERVICE_ROLE=api`.
3. Deploy workers on Railway as separate services with shared image/repo and role env:
- `SERVICE_ROLE=ingest`
- `SERVICE_ROLE=qualifier`
- `SERVICE_ROLE=activation`
- `SERVICE_ROLE=scheduler`
4. Set all backend env values from `backend/.env.example`.
5. Confirm `/api/health` returns `ok: true` and infrastructure flags.

## 2) Daily operator flow
1. Open `Command Center` and verify:
- `Events Ingested (24h)` > 0
- `Devices Qualified` > 0
- `Activation Success` healthy
2. Open `Partner Feed Monitor`:
- Check ingest throughput and queue depth.
- Review dead-letter reasons.
3. Open `Audience Matrix`:
- Confirm audience active count and reason-code distribution.
4. Open `Activation Console`:
- Create export job for Google/Meta as needed.
- Validate item-level failures and retry failures if required.

## 3) Campaign architect workflow
1. Create or load campaign for Wichita Falls.
2. Choose competitor fence type (`radius` or `polygon`) per competitor.
3. Set qualification rules (dwell, velocity, accuracy, cooldown, session boundary, late grace).
4. Save rules with `Save as Live Rule Set`.
5. Push competitor fence to Google when linked campaign is active.

## 4) Verification checklist
1. `POST /api/ingest/location-events` accepts partner payloads.
2. `POST /api/qualify/run` returns non-zero `processed` and expected reason breakdown.
3. `GET /api/audiences/:campaignId` shows active memberships and expiry distribution.
4. `POST /api/activation/jobs` creates job and `GET /api/activation/jobs/:jobId` shows item outcomes.
5. Dashboard cards match SQL-level aggregate expectations.

## 5) Incident response
1. If ingest drops:
- Check webhook signatures and partner source status.
- Check `Partner Feed Monitor` dead letters.
- Verify Redis queue depth and worker health.
2. If qualification stalls:
- Confirm qualifier worker is running.
- Run manual `POST /api/qualify/run` for last 24h.
3. If activation fails:
- Inspect `error_json` and item-level errors in Activation Console.
- Retry failures.
- Fall back to export artifact import path.
4. If stale dashboard data:
- Refresh dashboard and feed monitor.
- Verify backend service and worker logs.

## 6) Privacy and governance
1. Use `POST /api/privacy/delete-device` for delete-by-device requests.
2. Use `POST /api/privacy/suppressions/import` to load suppression lists.
3. Use operator key (`x-operator-key`) when enabled for sensitive actions.
