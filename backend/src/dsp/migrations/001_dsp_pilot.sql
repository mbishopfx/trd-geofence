CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dealerships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  retarget_days INTEGER NOT NULL DEFAULT 21,
  daily_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS geofences (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  shape_type TEXT NOT NULL DEFAULT 'radius',
  radius_miles DOUBLE PRECISION,
  polygon_geojson JSONB,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  dwell_min INTEGER NOT NULL DEFAULT 12,
  velocity_max_mph DOUBLE PRECISION NOT NULL DEFAULT 6,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'hmac_sha256',
  secret_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS location_events_raw (
  id BIGSERIAL PRIMARY KEY,
  partner_source_id TEXT NOT NULL REFERENCES partner_sources(id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  device_id_hash TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed_mph DOUBLE PRECISION,
  accuracy_m DOUBLE PRECISION,
  payload_json JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_location_raw_source_event UNIQUE (partner_source_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS location_events_norm (
  id BIGSERIAL PRIMARY KEY,
  raw_id BIGINT NOT NULL REFERENCES location_events_raw(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed_mph DOUBLE PRECISION,
  accuracy_m DOUBLE PRECISION,
  geo_h3 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_sessions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  last_speed_mph DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qualification_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  geofence_id TEXT NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  inside BOOLEAN NOT NULL,
  dwell_minutes DOUBLE PRECISION NOT NULL,
  velocity_mph DOUBLE PRECISION,
  qualified BOOLEAN NOT NULL,
  reason_code TEXT NOT NULL,
  trace_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audience_memberships (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  qualified_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_event_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_membership_campaign_device UNIQUE (tenant_id, campaign_id, device_id_hash)
);

CREATE TABLE IF NOT EXISTS activation_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  artifact_path TEXT,
  input_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activation_job_items (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES activation_jobs(id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  mapped_identifier TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dead_letter_events (
  id BIGSERIAL PRIMARY KEY,
  partner_source_id TEXT REFERENCES partner_sources(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppressed_devices (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_suppressed_device UNIQUE (tenant_id, device_id_hash)
);

CREATE INDEX IF NOT EXISTS idx_location_norm_tenant_event_time
  ON location_events_norm (tenant_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_qualification_campaign_event_time
  ON qualification_events (campaign_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_membership_campaign_status_expires
  ON audience_memberships (campaign_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_activation_jobs_campaign_created
  ON activation_jobs (campaign_id, created_at DESC);
