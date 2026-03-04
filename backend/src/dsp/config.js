const path = require("path");

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const dspConfig = {
  operatorApiKey: process.env.OPERATOR_API_KEY || "",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  pilotTenantId: process.env.PILOT_TENANT_ID || "tenant_nissan_wichita_falls",
  pilotTenantName: process.env.PILOT_TENANT_NAME || "Nissan Wichita Falls Pilot",
  pilotDealershipId: process.env.PILOT_DEALERSHIP_ID || "dealership_nissan_wichita_falls",
  pilotDealershipName: process.env.PILOT_DEALERSHIP_NAME || "Nissan of Wichita Falls",
  pilotDealershipAddress:
    process.env.PILOT_DEALERSHIP_ADDRESS || "4000 Kell West Blvd, Wichita Falls, TX 76309",
  pilotDealershipLat: numberEnv("PILOT_DEALERSHIP_LAT", 33.8806084),
  pilotDealershipLng: numberEnv("PILOT_DEALERSHIP_LNG", -98.5460791),
  partnerSourceId: process.env.PILOT_PARTNER_SOURCE_ID || "partner_nissan_feed",
  partnerSourceName: process.env.PILOT_PARTNER_SOURCE_NAME || "Nissan Partner Feed",
  partnerSecretRef: process.env.PILOT_PARTNER_SOURCE_SECRET || "replace-me",
  signatureRequired: boolEnv("INGEST_SIGNATURE_REQUIRED", true),
  deviceHashSalt: process.env.DEVICE_HASH_SALT || "trd-geofence-default-salt",
  defaultAccuracyMaxM: numberEnv("QUALIFY_MAX_ACCURACY_M", 100),
  defaultCooldownHours: numberEnv("QUALIFY_COOLDOWN_HOURS", 24),
  defaultSessionBoundaryMin: numberEnv("QUALIFY_SESSION_BOUNDARY_MIN", 20),
  defaultLateGraceMin: numberEnv("QUALIFY_LATE_EVENT_GRACE_MIN", 30),
  defaultRetargetDays: numberEnv("QUALIFY_RETARGET_DAYS", 21),
  exportsDir: process.env.EXPORTS_DIR || path.resolve(process.cwd(), "exports"),
  queuePrefix: process.env.QUEUE_PREFIX || "trd_dsp",
  enableQueueWorkers: boolEnv("ENABLE_QUEUE_WORKERS", true)
};

module.exports = {
  boolEnv,
  numberEnv,
  dspConfig
};
