const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dspConfig } = require("./config");
const { hasDatabase, query, runMigrations, withTransaction } = require("./db");
const { hasRedis, enqueue } = require("./queues");
const { haversineMiles, pointInPolygon, median } = require("./geo");

const REASON_CODES = {
  outside: "OUTSIDE_FENCE",
  lowDwell: "LOW_DWELL",
  highVelocity: "HIGH_VELOCITY",
  lowAccuracy: "LOW_ACCURACY",
  qualified: "QUALIFIED",
  suppressed: "SUPPRESSED"
};

function nowIso() {
  return new Date().toISOString();
}

function parseTimestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function round(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function hashDeviceId(tenantId, rawDeviceId) {
  const h = crypto.createHash("sha256");
  h.update(`${dspConfig.deviceHashSalt}:${tenantId}:${String(rawDeviceId || "")}`);
  return h.digest("hex");
}

function normalizeGeoHash(lat, lng) {
  return `${Number(lat).toFixed(4)}:${Number(lng).toFixed(4)}`;
}

function safeJson(value, fallback = {}) {
  try {
    if (typeof value === "string") {
      return JSON.parse(value);
    }
    if (value && typeof value === "object") {
      return value;
    }
    return fallback;
  } catch (_error) {
    return fallback;
  }
}

function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function buildSignature(sourceId, events, secret) {
  return crypto
    .createHmac("sha256", String(secret || ""))
    .update(`${String(sourceId || "")}.${JSON.stringify(events || [])}`)
    .digest("hex");
}

function defaultRulesFromCampaign(campaignRow, geofences = []) {
  const rules = safeJson(campaignRow?.rules_json, {});
  const dwellFromFence = geofences.length > 0 ? Math.max(...geofences.map((f) => Number(f.dwell_min || 12))) : 12;
  const velocityFromFence = geofences.length > 0 ? Math.min(...geofences.map((f) => Number(f.velocity_max_mph || 6))) : 6;

  return {
    accuracyMaxM: Number(rules.accuracyMaxM) || dspConfig.defaultAccuracyMaxM,
    cooldownHours: Number(rules.cooldownHours) || dspConfig.defaultCooldownHours,
    sessionBoundaryMin: Number(rules.sessionBoundaryMin) || dspConfig.defaultSessionBoundaryMin,
    lateGraceMin: Number(rules.lateGraceMin) || dspConfig.defaultLateGraceMin,
    dwellMin: Number(rules.dwellMin) || dwellFromFence || 12,
    velocityMaxMph: Number(rules.velocityMaxMph) || velocityFromFence || 6
  };
}

function normalizePolygon(polygonGeojson) {
  const parsed = safeJson(polygonGeojson, null);
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  }

  if (parsed.type === "Polygon" && Array.isArray(parsed.coordinates) && Array.isArray(parsed.coordinates[0])) {
    return parsed.coordinates[0]
      .map((coord) => ({ lng: Number(coord[0]), lat: Number(coord[1]) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  }

  return [];
}

function evaluatePointAgainstFence(event, fence) {
  const shapeType = String(fence.shape_type || "radius");

  if (shapeType === "polygon") {
    const polygon = normalizePolygon(fence.polygon_geojson);
    if (polygon.length < 3) {
      return false;
    }
    return pointInPolygon({ lat: event.lat, lng: event.lng }, polygon);
  }

  const radiusMiles = Number(fence.radius_miles || 0);
  const centerLat = Number(fence.center_lat);
  const centerLng = Number(fence.center_lng);
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || !Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    return false;
  }

  const distance = haversineMiles(event.lat, event.lng, centerLat, centerLng);
  return distance <= radiusMiles;
}

function requireDatabaseEnabled() {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL is required for DSP pilot endpoints.");
  }
}

async function ensureInfrastructure() {
  requireDatabaseEnabled();
  await runMigrations();
  await ensurePilotSeedData();
}

async function ensurePilotSeedData() {
  const tenantId = dspConfig.pilotTenantId;
  const dealershipId = dspConfig.pilotDealershipId;

  await withTransaction(async (client) => {
    await client.query(
      `
      INSERT INTO tenants (id, name, status)
      VALUES ($1, $2, 'active')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `,
      [tenantId, dspConfig.pilotTenantName]
    );

    await client.query(
      `
      INSERT INTO dealerships (id, tenant_id, name, address, lat, lng, timezone)
      VALUES ($1, $2, $3, $4, $5, $6, 'America/Chicago')
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          address = EXCLUDED.address,
          lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          timezone = EXCLUDED.timezone
      `,
      [
        dealershipId,
        tenantId,
        dspConfig.pilotDealershipName,
        dspConfig.pilotDealershipAddress,
        dspConfig.pilotDealershipLat,
        dspConfig.pilotDealershipLng
      ]
    );

    await client.query(
      `
      INSERT INTO partner_sources (id, tenant_id, name, auth_mode, secret_ref, status)
      VALUES ($1, $2, $3, 'hmac_sha256', $4, 'active')
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          secret_ref = EXCLUDED.secret_ref,
          status = EXCLUDED.status,
          updated_at = NOW()
      `,
      [dspConfig.partnerSourceId, tenantId, dspConfig.partnerSourceName, dspConfig.partnerSecretRef]
    );
  });
}

async function upsertCampaignFromMemory(campaign) {
  if (!hasDatabase() || !campaign) {
    return;
  }

  await ensureInfrastructure();

  const rules = campaign.qualificationRules || {
    accuracyMaxM: dspConfig.defaultAccuracyMaxM,
    cooldownHours: dspConfig.defaultCooldownHours,
    sessionBoundaryMin: dspConfig.defaultSessionBoundaryMin,
    lateGraceMin: dspConfig.defaultLateGraceMin,
    dwellMin: 12,
    velocityMaxMph: 6
  };

  await withTransaction(async (client) => {
    await client.query(
      `
      INSERT INTO campaigns (id, tenant_id, name, status, platforms, retarget_days, daily_budget, rules_json)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          status = EXCLUDED.status,
          platforms = EXCLUDED.platforms,
          retarget_days = EXCLUDED.retarget_days,
          daily_budget = EXCLUDED.daily_budget,
          rules_json = COALESCE(NULLIF(EXCLUDED.rules_json::text, '{}'), campaigns.rules_json::text)::jsonb,
          updated_at = NOW()
      `,
      [
        campaign.id,
        dspConfig.pilotTenantId,
        campaign.name,
        campaign.status,
        JSON.stringify(campaign.platforms || []),
        Number(campaign.retargetDays || dspConfig.defaultRetargetDays),
        Number(campaign.dailyBudget || 0),
        JSON.stringify(rules)
      ]
    );

    await client.query("DELETE FROM geofences WHERE campaign_id = $1", [campaign.id]);

    for (const fence of campaign.fences || []) {
      const requestedShapeType = String(fence.shapeType || "").trim().toLowerCase();
      const shapeType =
        requestedShapeType === "polygon" || requestedShapeType === "radius"
          ? requestedShapeType
          : Array.isArray(fence.coordinates) && fence.coordinates.length >= 3
            ? "polygon"
            : "radius";
      const radiusMiles = Number(fence.radiusFeet || 0) / 5280;
      const center =
        Array.isArray(fence.coordinates) && fence.coordinates.length > 0
          ? fence.coordinates[0]
          : { lat: dspConfig.pilotDealershipLat, lng: dspConfig.pilotDealershipLng };
      const polygonGeoJson = Array.isArray(fence.coordinates) ? fence.coordinates : [];

      await client.query(
        `
        INSERT INTO geofences (
          id,
          campaign_id,
          type,
          name,
          shape_type,
          radius_miles,
          polygon_geojson,
          center_lat,
          center_lng,
          dwell_min,
          velocity_max_mph,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, TRUE)
        `,
        [
          fence.id || crypto.randomUUID(),
          campaign.id,
          fence.type || "home",
          fence.locationName || "Geofence",
          shapeType,
          round(radiusMiles, 4),
          JSON.stringify(polygonGeoJson),
          Number(center.lat),
          Number(center.lng),
          Number(fence.dwellTimeMin || 12),
          Number(fence.velocityMax || 6)
        ]
      );
    }
  });
}

async function appendAuditLog(tenantId, actor, action, entityType, entityId, metadata = {}) {
  if (!hasDatabase()) {
    return;
  }

  await query(
    `
    INSERT INTO audit_logs (tenant_id, actor, action, entity_type, entity_id, metadata_json)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [tenantId || null, actor || "system", action, entityType, String(entityId), JSON.stringify(metadata || {})]
  );
}

async function verifyPartnerSourceSignature(sourceId, signature, events) {
  await ensureInfrastructure();

  const sourceResult = await query(
    `
    SELECT id, tenant_id, auth_mode, secret_ref, status
    FROM partner_sources
    WHERE id = $1
    LIMIT 1
    `,
    [sourceId]
  );

  if (sourceResult.rowCount === 0) {
    throw new Error(`Unknown partner source: ${sourceId}`);
  }

  const source = sourceResult.rows[0];
  if (source.status !== "active") {
    throw new Error(`Partner source ${sourceId} is not active.`);
  }

  if (dspConfig.signatureRequired) {
    const expected = buildSignature(sourceId, events, source.secret_ref);
    if (!timingSafeEquals(expected, signature)) {
      throw new Error("Invalid webhook signature.");
    }
  }

  return source;
}

async function ingestLocationEvents(payload, actor = "system") {
  await ensureInfrastructure();

  const sourceId = String(payload.sourceId || "").trim();
  const signature = String(payload.signature || "").trim();
  const events = Array.isArray(payload.events) ? payload.events : [];

  if (!sourceId) {
    throw new Error("sourceId is required.");
  }

  if (events.length === 0) {
    return { ok: true, accepted: 0, rejected: 0, idempotent: 0 };
  }

  const source = await verifyPartnerSourceSignature(sourceId, signature, events);

  let accepted = 0;
  let rejected = 0;
  let idempotent = 0;
  const rawIds = [];

  for (const [index, event] of events.entries()) {
    const externalEventId = String(event.externalEventId || event.eventId || event.id || "").trim();
    const eventTime = parseTimestamp(event.timestamp || event.eventTime || event.event_time);
    const lat = Number(event.lat ?? event.latitude);
    const lng = Number(event.lng ?? event.longitude);
    const speedMph = Number(event.speedMph ?? event.speed_mph);
    const accuracyM = Number(event.accuracyM ?? event.accuracy_m);
    const rawDeviceId = String(event.deviceId || event.device_id || "").trim();

    if (!externalEventId || !eventTime || !Number.isFinite(lat) || !Number.isFinite(lng) || !rawDeviceId) {
      rejected += 1;
      await query(
        `
        INSERT INTO dead_letter_events (partner_source_id, reason, payload_json)
        VALUES ($1, $2, $3::jsonb)
        `,
        [source.id, "INVALID_EVENT_SHAPE", JSON.stringify({ index, event })]
      );
      continue;
    }

    const deviceIdHash = hashDeviceId(source.tenant_id, rawDeviceId);

    const insertResult = await query(
      `
      INSERT INTO location_events_raw (
        partner_source_id,
        external_event_id,
        device_id_hash,
        event_time,
        lat,
        lng,
        speed_mph,
        accuracy_m,
        payload_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (partner_source_id, external_event_id) DO NOTHING
      RETURNING id
      `,
      [
        source.id,
        externalEventId,
        deviceIdHash,
        eventTime.toISOString(),
        lat,
        lng,
        Number.isFinite(speedMph) ? speedMph : null,
        Number.isFinite(accuracyM) ? accuracyM : null,
        JSON.stringify(event)
      ]
    );

    if (insertResult.rowCount === 0) {
      idempotent += 1;
      continue;
    }

    accepted += 1;
    rawIds.push(insertResult.rows[0].id);
  }

  if (rawIds.length > 0) {
    if (hasRedis()) {
      await enqueue("ingestQueue", "normalize-location-events", { rawIds, sourceId: source.id }, { attempts: 5 });
    } else {
      await processIngestQueueJob({ rawIds, sourceId: source.id });
    }
  }

  await appendAuditLog(source.tenant_id, actor, "INGEST_EVENTS", "partner_source", source.id, {
    accepted,
    rejected,
    idempotent
  });

  return {
    ok: true,
    accepted,
    rejected,
    idempotent
  };
}

async function processIngestQueueJob(data) {
  await ensureInfrastructure();

  const rawIds = Array.isArray(data.rawIds) ? data.rawIds.filter((id) => Number.isFinite(Number(id))) : [];
  if (rawIds.length === 0) {
    return { ok: true, normalized: 0, queuedQualification: 0 };
  }

  const sourceRows = await query(
    `
    SELECT r.id, r.partner_source_id, r.device_id_hash, r.event_time, r.lat, r.lng, r.speed_mph, r.accuracy_m,
           s.tenant_id
    FROM location_events_raw r
    INNER JOIN partner_sources s ON s.id = r.partner_source_id
    WHERE r.id = ANY($1::bigint[])
    `,
    [rawIds]
  );

  if (sourceRows.rowCount === 0) {
    return { ok: true, normalized: 0, queuedQualification: 0 };
  }

  let normalized = 0;
  let minEventTime = null;
  let maxEventTime = null;
  const tenantId = sourceRows.rows[0].tenant_id;

  for (const row of sourceRows.rows) {
    const eventTimeIso = new Date(row.event_time).toISOString();
    await query(
      `
      INSERT INTO location_events_norm (
        raw_id,
        tenant_id,
        device_id_hash,
        event_time,
        lat,
        lng,
        speed_mph,
        accuracy_m,
        geo_h3
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT DO NOTHING
      `,
      [
        row.id,
        row.tenant_id,
        row.device_id_hash,
        eventTimeIso,
        Number(row.lat),
        Number(row.lng),
        row.speed_mph === null ? null : Number(row.speed_mph),
        row.accuracy_m === null ? null : Number(row.accuracy_m),
        normalizeGeoHash(row.lat, row.lng)
      ]
    );
    normalized += 1;

    if (!minEventTime || new Date(eventTimeIso) < minEventTime) {
      minEventTime = new Date(eventTimeIso);
    }
    if (!maxEventTime || new Date(eventTimeIso) > maxEventTime) {
      maxEventTime = new Date(eventTimeIso);
    }
  }

  const activeCampaigns = await query(
    `
    SELECT id
    FROM campaigns
    WHERE tenant_id = $1 AND status = 'active'
    `,
    [tenantId]
  );

  let queuedQualification = 0;
  for (const campaign of activeCampaigns.rows) {
    const payload = {
      tenantId,
      campaignId: campaign.id,
      from: (minEventTime || new Date()).toISOString(),
      to: (maxEventTime || new Date()).toISOString(),
      actor: "ingest-worker"
    };

    if (hasRedis()) {
      await enqueue("qualifyQueue", "run-qualification", payload, { attempts: 4 });
    } else {
      await runQualificationWindow(payload);
    }

    queuedQualification += 1;
  }

  return {
    ok: true,
    normalized,
    queuedQualification
  };
}

async function getCampaignAndFences(tenantId, campaignId) {
  const campaignResult = await query(
    `
    SELECT *
    FROM campaigns
    WHERE tenant_id = $1 AND id = $2
    LIMIT 1
    `,
    [tenantId, campaignId]
  );

  if (campaignResult.rowCount === 0) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const fenceResult = await query(
    `
    SELECT *
    FROM geofences
    WHERE campaign_id = $1 AND is_active = TRUE
    ORDER BY created_at ASC
    `,
    [campaignId]
  );

  return {
    campaign: campaignResult.rows[0],
    geofences: fenceResult.rows
  };
}

async function getSuppressedDevices(tenantId) {
  const result = await query(
    `
    SELECT device_id_hash
    FROM suppressed_devices
    WHERE tenant_id = $1
    `,
    [tenantId]
  );

  return new Set(result.rows.map((row) => row.device_id_hash));
}

async function getMembershipMap(tenantId, campaignId) {
  const result = await query(
    `
    SELECT device_id_hash, qualified_at, expires_at, status
    FROM audience_memberships
    WHERE tenant_id = $1 AND campaign_id = $2
    `,
    [tenantId, campaignId]
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.device_id_hash, {
      qualifiedAt: row.qualified_at ? new Date(row.qualified_at) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      status: row.status
    });
  }
  return map;
}

function incrementReason(reasons, reason) {
  reasons[reason] = (reasons[reason] || 0) + 1;
}

async function runQualificationWindow(params) {
  await ensureInfrastructure();

  const tenantId = String(params.tenantId || dspConfig.pilotTenantId);
  const campaignId = String(params.campaignId || "");
  const actor = String(params.actor || "system");

  if (!campaignId) {
    throw new Error("campaignId is required.");
  }

  const from = parseTimestamp(params.from) || new Date(Date.now() - 60 * 60 * 1000);
  const to = parseTimestamp(params.to) || new Date();

  const { campaign, geofences } = await getCampaignAndFences(tenantId, campaignId);
  const rules = defaultRulesFromCampaign(campaign, geofences);

  const windowStart = new Date(from.getTime() - rules.lateGraceMin * 60 * 1000);
  const windowEnd = new Date(to.getTime() + rules.lateGraceMin * 60 * 1000);

  const eventsResult = await query(
    `
    SELECT id, device_id_hash, event_time, lat, lng, speed_mph, accuracy_m
    FROM location_events_norm
    WHERE tenant_id = $1
      AND event_time >= $2
      AND event_time <= $3
    ORDER BY device_id_hash ASC, event_time ASC
    `,
    [tenantId, windowStart.toISOString(), windowEnd.toISOString()]
  );

  const suppressedDevices = await getSuppressedDevices(tenantId);
  const membershipMap = await getMembershipMap(tenantId, campaignId);

  const sessionBoundaryMs = rules.sessionBoundaryMin * 60 * 1000;
  const cooldownMs = rules.cooldownHours * 60 * 60 * 1000;
  const reasonCounts = {};

  const states = new Map();
  let processed = 0;
  let qualified = 0;

  for (const row of eventsResult.rows) {
    processed += 1;
    const event = {
      id: row.id,
      deviceIdHash: row.device_id_hash,
      eventTime: new Date(row.event_time),
      lat: Number(row.lat),
      lng: Number(row.lng),
      speedMph: Number.isFinite(Number(row.speed_mph)) ? Number(row.speed_mph) : 0,
      accuracyM: Number.isFinite(Number(row.accuracy_m)) ? Number(row.accuracy_m) : null
    };

    for (const fence of geofences) {
      const key = `${event.deviceIdHash}:${fence.id}`;
      const state =
        states.get(key) || {
          lastInsideAt: null,
          cumulativeInsideSec: 0,
          speedSamples: []
        };

      const tooInaccurate = event.accuracyM !== null && event.accuracyM > rules.accuracyMaxM;
      const inside = !tooInaccurate && evaluatePointAgainstFence(event, fence);

      if (inside) {
        if (state.lastInsideAt) {
          const deltaMs = event.eventTime.getTime() - state.lastInsideAt.getTime();
          if (deltaMs > 0 && deltaMs <= sessionBoundaryMs) {
            state.cumulativeInsideSec += deltaMs / 1000;
          } else if (deltaMs > sessionBoundaryMs) {
            state.cumulativeInsideSec = 0;
            state.speedSamples = [];
          }
        }

        state.lastInsideAt = event.eventTime;
        state.speedSamples.push(event.speedMph);
      }

      const dwellMinutes = round(state.cumulativeInsideSec / 60, 3);
      const medianVelocity = round(median(state.speedSamples), 3);

      let reasonCode = REASON_CODES.outside;
      let isQualified = false;

      if (tooInaccurate) {
        reasonCode = REASON_CODES.lowAccuracy;
      } else if (!inside) {
        reasonCode = REASON_CODES.outside;
      } else if (dwellMinutes < Number(fence.dwell_min || rules.dwellMin)) {
        reasonCode = REASON_CODES.lowDwell;
      } else if (medianVelocity > Number(fence.velocity_max_mph || rules.velocityMaxMph)) {
        reasonCode = REASON_CODES.highVelocity;
      } else {
        reasonCode = REASON_CODES.qualified;
        isQualified = true;
      }

      const isSuppressed = suppressedDevices.has(event.deviceIdHash);
      if (isSuppressed && isQualified) {
        reasonCode = REASON_CODES.suppressed;
        isQualified = false;
      }

      let membershipUpdated = false;
      if (isQualified) {
        const prior = membershipMap.get(event.deviceIdHash);
        const priorQualifiedAt = prior?.qualifiedAt;
        const cooldownPassed =
          !priorQualifiedAt || event.eventTime.getTime() - priorQualifiedAt.getTime() >= cooldownMs;

        if (!cooldownPassed) {
          reasonCode = REASON_CODES.suppressed;
          isQualified = false;
        } else {
          const expiresAt = new Date(
            event.eventTime.getTime() +
              (Number(campaign.retarget_days || dspConfig.defaultRetargetDays) * 24 * 60 * 60 * 1000)
          );

          await query(
            `
            INSERT INTO audience_memberships (
              tenant_id,
              campaign_id,
              device_id_hash,
              qualified_at,
              expires_at,
              status,
              source_event_id,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, 'active', $6, NOW())
            ON CONFLICT (tenant_id, campaign_id, device_id_hash)
            DO UPDATE
            SET qualified_at = EXCLUDED.qualified_at,
                expires_at = GREATEST(audience_memberships.expires_at, EXCLUDED.expires_at),
                status = 'active',
                source_event_id = EXCLUDED.source_event_id,
                updated_at = NOW()
            `,
            [
              tenantId,
              campaignId,
              event.deviceIdHash,
              event.eventTime.toISOString(),
              expiresAt.toISOString(),
              event.id
            ]
          );

          membershipMap.set(event.deviceIdHash, {
            qualifiedAt: event.eventTime,
            expiresAt,
            status: "active"
          });

          membershipUpdated = true;
          qualified += 1;
        }
      }

      incrementReason(reasonCounts, reasonCode);

      await query(
        `
        INSERT INTO qualification_events (
          tenant_id,
          campaign_id,
          geofence_id,
          device_id_hash,
          event_time,
          inside,
          dwell_minutes,
          velocity_mph,
          qualified,
          reason_code,
          trace_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        `,
        [
          tenantId,
          campaignId,
          fence.id,
          event.deviceIdHash,
          event.eventTime.toISOString(),
          inside,
          dwellMinutes,
          medianVelocity,
          membershipUpdated,
          reasonCode,
          JSON.stringify({
            eventId: event.id,
            fenceId: fence.id,
            accuracyM: event.accuracyM,
            rules,
            fenceRules: {
              dwellMin: Number(fence.dwell_min || rules.dwellMin),
              velocityMaxMph: Number(fence.velocity_max_mph || rules.velocityMaxMph)
            },
            state: {
              cumulativeInsideSec: round(state.cumulativeInsideSec, 3),
              speedSamples: state.speedSamples.slice(-10)
            }
          })
        ]
      );

      states.set(key, state);
    }
  }

  await appendAuditLog(tenantId, actor, "RUN_QUALIFICATION", "campaign", campaignId, {
    from: from.toISOString(),
    to: to.toISOString(),
    processed,
    qualified,
    reasonCounts
  });

  return {
    ok: true,
    tenantId,
    campaignId,
    from: from.toISOString(),
    to: to.toISOString(),
    processed,
    qualified,
    reasonsBreakdown: reasonCounts
  };
}

async function getAudienceSummary(campaignId) {
  await ensureInfrastructure();

  const totals = await query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
      COUNT(*)::int AS total_count,
      MAX(qualified_at) AS last_qualified_at
    FROM audience_memberships
    WHERE campaign_id = $1
    `,
    [campaignId]
  );

  const expiryBuckets = await query(
    `
    SELECT
      CASE
        WHEN expires_at < NOW() THEN 'expired'
        WHEN expires_at < NOW() + INTERVAL '7 days' THEN '0_7'
        WHEN expires_at < NOW() + INTERVAL '14 days' THEN '8_14'
        WHEN expires_at < NOW() + INTERVAL '30 days' THEN '15_30'
        ELSE '31_plus'
      END AS bucket,
      COUNT(*)::int AS count
    FROM audience_memberships
    WHERE campaign_id = $1
    GROUP BY 1
    ORDER BY 1
    `,
    [campaignId]
  );

  return {
    ok: true,
    campaignId,
    activeCount: totals.rows[0]?.active_count || 0,
    totalCount: totals.rows[0]?.total_count || 0,
    lastQualifiedAt: totals.rows[0]?.last_qualified_at || null,
    expiryDistribution: expiryBuckets.rows
  };
}

async function writeCsv(filePath, rows) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const lines = ["device_id_hash,mapped_identifier"]; 
  for (const row of rows) {
    lines.push(`${row.deviceIdHash},${row.mappedIdentifier}`);
  }
  await fs.promises.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function processActivationJob(jobData) {
  await ensureInfrastructure();

  const jobId = String(jobData.jobId || "");
  if (!jobId) {
    throw new Error("jobId is required for activation processing.");
  }

  const jobResult = await query("SELECT * FROM activation_jobs WHERE id = $1 LIMIT 1", [jobId]);
  if (jobResult.rowCount === 0) {
    throw new Error(`Activation job not found: ${jobId}`);
  }

  const job = jobResult.rows[0];
  const deviceFilter = Array.isArray(jobData.deviceIds) ? jobData.deviceIds : null;

  await query(
    `
    UPDATE activation_jobs
    SET status = 'running',
        started_at = NOW(),
        updated_at = NOW(),
        error_json = NULL
    WHERE id = $1
    `,
    [jobId]
  );

  try {
    const params = [job.tenant_id, job.campaign_id];
    let membershipSql = `
      SELECT device_id_hash
      FROM audience_memberships
      WHERE tenant_id = $1
        AND campaign_id = $2
        AND status = 'active'
        AND expires_at > NOW()
    `;

    if (deviceFilter && deviceFilter.length > 0) {
      params.push(deviceFilter);
      membershipSql += ` AND device_id_hash = ANY($3::text[])`;
    }

    const memberships = await query(membershipSql, params);
    const mappedRows = memberships.rows.map((row) => ({
      deviceIdHash: row.device_id_hash,
      mappedIdentifier: row.device_id_hash
    }));

    await query("DELETE FROM activation_job_items WHERE job_id = $1", [jobId]);

    for (const row of mappedRows) {
      await query(
        `
        INSERT INTO activation_job_items (job_id, device_id_hash, mapped_identifier, status)
        VALUES ($1, $2, $3, 'success')
        `,
        [jobId, row.deviceIdHash, row.mappedIdentifier]
      );
    }

    const filePath = path.resolve(dspConfig.exportsDir, `${jobId}-${job.platform}.csv`);
    await writeCsv(filePath, mappedRows);

    await query(
      `
      UPDATE activation_jobs
      SET status = 'completed',
          artifact_path = $2,
          input_count = $3,
          success_count = $3,
          failure_count = 0,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      `,
      [jobId, filePath, mappedRows.length]
    );

    await appendAuditLog(job.tenant_id, "activation-worker", "ACTIVATION_EXPORT_COMPLETED", "activation_job", jobId, {
      platform: job.platform,
      campaignId: job.campaign_id,
      inputCount: mappedRows.length,
      artifactPath: filePath
    });

    return {
      ok: true,
      jobId,
      status: "completed",
      inputCount: mappedRows.length,
      successCount: mappedRows.length,
      artifactPath: filePath
    };
  } catch (error) {
    await query(
      `
      UPDATE activation_jobs
      SET status = 'failed',
          completed_at = NOW(),
          updated_at = NOW(),
          error_json = $2::jsonb
      WHERE id = $1
      `,
      [jobId, JSON.stringify({ message: error.message })]
    );

    throw error;
  }
}

async function createActivationJob(params, actor = "system") {
  await ensureInfrastructure();

  const tenantId = String(params.tenantId || dspConfig.pilotTenantId);
  const campaignId = String(params.campaignId || "");
  const platform = String(params.platform || "google").toLowerCase();
  const mode = String(params.mode || "export_only");
  const jobType = String(params.jobType || "audience_export");
  const jobId = crypto.randomUUID();

  if (!campaignId) {
    throw new Error("campaignId is required.");
  }

  await query(
    `
    INSERT INTO activation_jobs (
      id,
      tenant_id,
      campaign_id,
      platform,
      job_type,
      status,
      mode
    )
    VALUES ($1, $2, $3, $4, $5, 'queued', $6)
    `,
    [jobId, tenantId, campaignId, platform, jobType, mode]
  );

  if (hasRedis()) {
    await enqueue("activationQueue", "run-activation-export", {
      jobId,
      deviceIds: Array.isArray(params.deviceIds) ? params.deviceIds : null
    });
  } else {
    await processActivationJob({
      jobId,
      deviceIds: Array.isArray(params.deviceIds) ? params.deviceIds : null
    });
  }

  await appendAuditLog(tenantId, actor, "ACTIVATION_JOB_CREATED", "activation_job", jobId, {
    campaignId,
    platform,
    mode,
    jobType
  });

  return {
    ok: true,
    jobId
  };
}

async function getActivationJob(jobId) {
  await ensureInfrastructure();

  const job = await query("SELECT * FROM activation_jobs WHERE id = $1 LIMIT 1", [jobId]);
  if (job.rowCount === 0) {
    throw new Error(`Activation job not found: ${jobId}`);
  }

  const items = await query(
    `
    SELECT id, device_id_hash, mapped_identifier, status, error, created_at
    FROM activation_job_items
    WHERE job_id = $1
    ORDER BY id DESC
    LIMIT 500
    `,
    [jobId]
  );

  return {
    ok: true,
    job: job.rows[0],
    items: items.rows
  };
}

async function retryActivationJobFailures(jobId, actor = "system") {
  await ensureInfrastructure();

  const failed = await query(
    `
    SELECT device_id_hash
    FROM activation_job_items
    WHERE job_id = $1
      AND status = 'failed'
    `,
    [jobId]
  );

  const existingJob = await query("SELECT * FROM activation_jobs WHERE id = $1 LIMIT 1", [jobId]);
  if (existingJob.rowCount === 0) {
    throw new Error(`Activation job not found: ${jobId}`);
  }

  if (failed.rowCount === 0) {
    return {
      ok: true,
      retried: 0,
      message: "No failed items to retry."
    };
  }

  const retryJob = await createActivationJob(
    {
      tenantId: existingJob.rows[0].tenant_id,
      campaignId: existingJob.rows[0].campaign_id,
      platform: existingJob.rows[0].platform,
      mode: "retry_failures",
      jobType: "audience_export_retry",
      deviceIds: failed.rows.map((row) => row.device_id_hash)
    },
    actor
  );

  return {
    ok: true,
    retried: failed.rowCount,
    retryJobId: retryJob.jobId
  };
}

async function getQualificationAnalytics(filters = {}) {
  await ensureInfrastructure();

  const campaignId = String(filters.campaignId || "").trim();
  if (!campaignId) {
    throw new Error("campaignId is required.");
  }

  const from = parseTimestamp(filters.from) || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to = parseTimestamp(filters.to) || new Date();
  const fenceId = String(filters.fenceId || "").trim();
  const deviceIdHash = String(filters.deviceIdHash || "").trim();
  const limit = Math.max(10, Math.min(500, Number(filters.limit || 100)));

  const params = [campaignId, from.toISOString(), to.toISOString()];
  let whereClause = `campaign_id = $1 AND event_time BETWEEN $2 AND $3`;

  if (fenceId) {
    params.push(fenceId);
    whereClause += ` AND geofence_id = $${params.length}`;
  }

  if (deviceIdHash) {
    params.push(deviceIdHash);
    whereClause += ` AND device_id_hash = $${params.length}`;
  }

  const reasons = await query(
    `
    SELECT reason_code, COUNT(*)::int AS count
    FROM qualification_events
    WHERE ${whereClause}
    GROUP BY reason_code
    ORDER BY count DESC
    `,
    params
  );

  const qualified = await query(
    `
    SELECT COUNT(*)::int AS qualified
    FROM qualification_events
    WHERE ${whereClause}
      AND qualified = TRUE
    `,
    params
  );

  const traces = await query(
    `
    SELECT id, device_id_hash, geofence_id, event_time, inside, dwell_minutes, velocity_mph, qualified, reason_code, trace_json
    FROM qualification_events
    WHERE ${whereClause}
    ORDER BY event_time DESC
    LIMIT $${params.length + 1}
    `,
    [...params, limit]
  );

  return {
    ok: true,
    campaignId,
    from: from.toISOString(),
    to: to.toISOString(),
    deviceIdHash: deviceIdHash || null,
    reasonsBreakdown: reasons.rows,
    qualified: qualified.rows[0]?.qualified || 0,
    traces: traces.rows
  };
}

async function getFeedMonitor(tenantId = dspConfig.pilotTenantId) {
  await ensureInfrastructure();

  const throughput = await query(
    `
    SELECT
      COUNT(*) FILTER (WHERE ingested_at > NOW() - INTERVAL '1 hour')::int AS ingested_last_hour,
      COUNT(*) FILTER (WHERE ingested_at > NOW() - INTERVAL '24 hour')::int AS ingested_last_day,
      COUNT(DISTINCT device_id_hash) FILTER (WHERE ingested_at > NOW() - INTERVAL '24 hour')::int AS unique_devices_day
    FROM location_events_raw r
    INNER JOIN partner_sources s ON s.id = r.partner_source_id
    WHERE s.tenant_id = $1
    `,
    [tenantId]
  );

  const deadLetters = await query(
    `
    SELECT reason, COUNT(*)::int AS count
    FROM dead_letter_events d
    INNER JOIN partner_sources s ON s.id = d.partner_source_id
    WHERE s.tenant_id = $1
      AND d.created_at > NOW() - INTERVAL '24 hour'
    GROUP BY reason
    ORDER BY count DESC
    `,
    [tenantId]
  );

  let queueDepth = {
    ingest: 0,
    qualify: 0,
    activation: 0
  };

  if (hasRedis()) {
    const { getQueues } = require("./queues");
    const queues = getQueues();
    if (queues) {
      queueDepth = {
        ingest: await queues.ingestQueue.count(),
        qualify: await queues.qualifyQueue.count(),
        activation: await queues.activationQueue.count()
      };
    }
  }

  return {
    ok: true,
    tenantId,
    throughput: throughput.rows[0] || {
      ingested_last_hour: 0,
      ingested_last_day: 0,
      unique_devices_day: 0
    },
    deadLetters: deadLetters.rows,
    queueDepth
  };
}

async function expireAudienceMemberships(actor = "scheduler") {
  if (!hasDatabase()) {
    return { ok: true, expired: 0 };
  }

  await ensureInfrastructure();

  const result = await query(
    `
    UPDATE audience_memberships
    SET status = 'expired',
        updated_at = NOW()
    WHERE status = 'active'
      AND expires_at <= NOW()
    RETURNING id
    `
  );

  await appendAuditLog(dspConfig.pilotTenantId, actor, "EXPIRE_MEMBERSHIPS", "audience_membership", "bulk", {
    expired: result.rowCount
  });

  return {
    ok: true,
    expired: result.rowCount
  };
}

async function getDspDashboardMetrics(tenantId = dspConfig.pilotTenantId, campaignId = null) {
  if (!hasDatabase()) {
    return {
      eventsIngested: 0,
      devicesQualified: 0,
      audienceActive: 0,
      activationSuccessRate: 0
    };
  }

  await ensureInfrastructure();

  const baseParams = [tenantId];
  let campaignFilter = "";
  if (campaignId) {
    baseParams.push(campaignId);
    campaignFilter = ` AND campaign_id = $${baseParams.length}`;
  }

  const ingest = await query(
    `
    SELECT COUNT(*)::int AS events_ingested
    FROM location_events_norm
    WHERE tenant_id = $1
      AND event_time > NOW() - INTERVAL '24 hour'
    `,
    [tenantId]
  );

  const audience = await query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'active' AND expires_at > NOW())::int AS audience_active,
      COUNT(DISTINCT device_id_hash) FILTER (WHERE status = 'active' AND expires_at > NOW())::int AS devices_qualified
    FROM audience_memberships
    WHERE tenant_id = $1${campaignFilter}
    `,
    baseParams
  );

  const activation = await query(
    `
    SELECT
      COALESCE(SUM(success_count), 0)::float AS success_total,
      COALESCE(SUM(input_count), 0)::float AS input_total
    FROM activation_jobs
    WHERE tenant_id = $1
      AND created_at > NOW() - INTERVAL '24 hour'${campaignFilter}
    `,
    baseParams
  );

  const successTotal = Number(activation.rows[0]?.success_total || 0);
  const inputTotal = Number(activation.rows[0]?.input_total || 0);

  return {
    eventsIngested: Number(ingest.rows[0]?.events_ingested || 0),
    devicesQualified: Number(audience.rows[0]?.devices_qualified || 0),
    audienceActive: Number(audience.rows[0]?.audience_active || 0),
    activationSuccessRate: inputTotal > 0 ? round((successTotal / inputTotal) * 100, 2) : 0
  };
}

async function persistGeofencePush(campaign, pushPayload, actor = "system") {
  if (!hasDatabase()) {
    return;
  }

  await upsertCampaignFromMemory(campaign);
  await appendAuditLog(dspConfig.pilotTenantId, actor, "PUSH_GEOFENCE", "campaign", campaign.id, pushPayload);
}

async function saveCampaignQualificationRules(campaignId, rules, actor = "system") {
  await ensureInfrastructure();

  const existing = await query("SELECT tenant_id, rules_json FROM campaigns WHERE id = $1 LIMIT 1", [campaignId]);
  if (existing.rowCount === 0) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const merged = {
    ...safeJson(existing.rows[0].rules_json, {}),
    ...rules
  };

  await query(
    `
    UPDATE campaigns
    SET rules_json = $2::jsonb,
        updated_at = NOW()
    WHERE id = $1
    `,
    [campaignId, JSON.stringify(merged)]
  );

  await appendAuditLog(existing.rows[0].tenant_id, actor, "SAVE_QUALIFICATION_RULES", "campaign", campaignId, {
    rules: merged
  });

  return {
    ok: true,
    campaignId,
    rules: merged
  };
}

async function processSchedulerQueueJob(data) {
  const kind = String(data.kind || "");
  if (kind === "expire-memberships") {
    return expireAudienceMemberships("scheduler-worker");
  }

  if (kind === "qualification-replay" && data.tenantId && data.campaignId) {
    return runQualificationWindow({
      tenantId: data.tenantId,
      campaignId: data.campaignId,
      from: data.from,
      to: data.to,
      actor: "scheduler-worker"
    });
  }

  return { ok: true, skipped: true };
}

async function processQualificationQueueJob(data) {
  return runQualificationWindow(data);
}

async function processActivationQueueJob(data) {
  return processActivationJob(data);
}

module.exports = {
  REASON_CODES,
  ensureInfrastructure,
  ensurePilotSeedData,
  hashDeviceId,
  upsertCampaignFromMemory,
  ingestLocationEvents,
  processIngestQueueJob,
  runQualificationWindow,
  processQualificationQueueJob,
  getAudienceSummary,
  createActivationJob,
  getActivationJob,
  retryActivationJobFailures,
  processActivationQueueJob,
  getQualificationAnalytics,
  getFeedMonitor,
  expireAudienceMemberships,
  processSchedulerQueueJob,
  getDspDashboardMetrics,
  persistGeofencePush,
  saveCampaignQualificationRules
};
