CREATE TABLE IF NOT EXISTS conversion_zones (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  zone_type TEXT NOT NULL DEFAULT 'sales',
  shape_type TEXT NOT NULL DEFAULT 'radius',
  radius_miles DOUBLE PRECISION,
  polygon_geojson JSONB,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversion_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL REFERENCES conversion_zones(id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  source_event_id BIGINT REFERENCES location_events_norm(id) ON DELETE SET NULL,
  event_time TIMESTAMPTZ NOT NULL,
  conversion_date DATE NOT NULL,
  hours_to_convert DOUBLE PRECISION NOT NULL DEFAULT 0,
  attributed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_conversion_event_daily UNIQUE (campaign_id, zone_id, device_id_hash, conversion_date)
);

CREATE INDEX IF NOT EXISTS idx_conversion_zones_campaign_active
  ON conversion_zones (campaign_id, is_active);

CREATE INDEX IF NOT EXISTS idx_conversion_events_campaign_event_time
  ON conversion_events (campaign_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_conversion_events_campaign_zone
  ON conversion_events (campaign_id, zone_id);
