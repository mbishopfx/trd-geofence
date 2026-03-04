const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { hasDatabase, query, closeDatabase } = require("./src/dsp/db");
const { hasRedis, closeQueues } = require("./src/dsp/queues");
const { dspConfig } = require("./src/dsp/config");
const {
  ensureInfrastructure,
  upsertCampaignFromMemory,
  ingestLocationEvents,
  runQualificationWindow,
  getAudienceSummary,
  createActivationJob,
  getActivationJob,
  retryActivationJobFailures,
  getQualificationAnalytics,
  getFeedMonitor,
  getDspDashboardMetrics,
  persistGeofencePush,
  saveCampaignQualificationRules,
  hashDeviceId
} = require("./src/dsp/service");

const app = express();
const port = Number(process.env.PORT || 3000);

const rawOrigins = process.env.CORS_ORIGIN || "*";
const allowedOrigins = rawOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions =
  allowedOrigins.includes("*") || allowedOrigins.length === 0
    ? {}
    : {
        origin(origin, callback) {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
          }
          callback(null, false);
        }
      };

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

const CREATIVE_REQUIREMENTS = [
  { id: "cr-300x250", label: "Display Medium Rectangle", size: "300x250", channel: "Display", required: true },
  { id: "cr-728x90", label: "Leaderboard", size: "728x90", channel: "Display", required: true },
  { id: "cr-320x50", label: "Mobile Banner", size: "320x50", channel: "Display", required: true },
  { id: "cr-1080x1080", label: "Square Social", size: "1080x1080", channel: "Meta", required: true },
  { id: "cr-rda", label: "Responsive Display Bundle", size: "1200x628 + logos + headlines", channel: "Google", required: true }
];

const PLATFORM_OPTIONS = [
  {
    id: "specialized-dsp",
    name: "Specialized Geofencing DSP",
    recommendedVendors: ["GroundTruth", "Simpli.fi", "Propellant", "Thumbvista"],
    priority: "highest"
  },
  {
    id: "google",
    name: "Google Ads (Display / PMax / YouTube)",
    recommendedVendors: ["Google Ads"],
    priority: "high"
  },
  {
    id: "meta",
    name: "Meta Ads (Facebook / Instagram)",
    recommendedVendors: ["Meta"],
    priority: "high"
  }
];

const SETUP_TEMPLATE = {
  requestedBy: "Jeffrey Fass (ACC, Inc. / AutoDirect)",
  objective:
    "Dealership geo-conquest + home-fencing campaigns focused on real-time impressions/clicks with 14-30 day retargeting in Wichita Falls.",
  defaultMessage: "NO GAMES - Just Honest Pricing and Extraordinary Service",
  fenceRecommendations: {
    preferredFeetRange: [300, 500],
    maxFeet: 5280,
    defaultFeet: 450,
    dwellTimeMin: 12,
    velocityMaxMph: 6,
    retargetDays: { min: 14, max: 30, default: 21 }
  },
  locations: [
    {
      id: "nissan-wichita-falls",
      dealershipName: "Nissan of Wichita Falls",
      address: "4000 Kell West Blvd, Wichita Falls, TX 76309",
      coordinates: { lat: 33.8806084, lng: -98.5460791 },
      requiredCompetitorCount: 1,
      competitorSuggestions: [{ name: "Patterson Honda", address: "319 Central East Fwy, Wichita Falls, TX 76301" }]
    }
  ],
  trackingGoals: ["impressions", "clicks", "ctr", "store visits/calls/directions where available"]
};

const campaigns = [];
const metricsByCampaignId = new Map();
const liveFeed = [];

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pushLiveEvent(event) {
  liveFeed.unshift(event);
  if (liveFeed.length > 60) {
    liveFeed.length = 60;
  }
}

function getCampaignMetrics(campaignId) {
  if (!metricsByCampaignId.has(campaignId)) {
    metricsByCampaignId.set(campaignId, {
      impressions: 0,
      clicks: 0,
      spend: 0,
      walkIns: 0,
      lastUpdatedAt: new Date().toISOString()
    });
  }
  return metricsByCampaignId.get(campaignId);
}

function calculateDashboard() {
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalSpend = 0;
  let totalWalkIns = 0;
  let activeFences = 0;

  for (const campaign of campaigns) {
    if (campaign.status === "active") {
      activeFences += campaign.fences.length;
    }

    const metrics = getCampaignMetrics(campaign.id);
    totalImpressions += metrics.impressions;
    totalClicks += metrics.clicks;
    totalSpend += metrics.spend;
    totalWalkIns += metrics.walkIns;
  }

  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  const leaderboard = campaigns
    .map((campaign) => {
      const metrics = getCampaignMetrics(campaign.id);
      return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        dealershipName: campaign.dealershipName,
        clicks: metrics.clicks,
        impressions: metrics.impressions,
        ctr: metrics.impressions > 0 ? Number(((metrics.clicks / metrics.impressions) * 100).toFixed(2)) : 0
      };
    })
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 6);

  return {
    activeCampaigns: campaigns.filter((campaign) => campaign.status === "active").length,
    activeFences,
    totalImpressions,
    totalClicks,
    ctr: Number(ctr.toFixed(2)),
    totalSpend: Number(totalSpend.toFixed(2)),
    capturedWalkIns: totalWalkIns,
    leaderboard,
    liveFeed: liveFeed.slice(0, 20)
  };
}

function buildActivationChecklist(campaign) {
  return [
    "Confirm all competitor addresses and lot boundaries.",
    "Upload all required creative sizes (300x250, 728x90, 320x50, 1080x1080, responsive bundle).",
    "Attach destination URLs with UTM tags and click tracking.",
    "Install website pixel + conversion events on dealership site.",
    "Enable retargeting audience window for 14-30 days.",
    `Push campaign ${campaign.name} live in selected platforms: ${campaign.platforms.join(", ")}.`
  ];
}

function normalizeFence(fence, index) {
  const radiusFeet = Math.max(100, safeNumber(fence.radiusFeet, SETUP_TEMPLATE.fenceRecommendations.defaultFeet));
  const dwellTimeMin = Math.max(1, safeNumber(fence.dwellTimeMin, SETUP_TEMPLATE.fenceRecommendations.dwellTimeMin));
  const velocityMax = Math.max(1, safeNumber(fence.velocityMax, SETUP_TEMPLATE.fenceRecommendations.velocityMaxMph));

  const coordinates = Array.isArray(fence.coordinates)
    ? fence.coordinates
        .map((point) => ({ lat: safeNumber(point.lat, 0), lng: safeNumber(point.lng, 0) }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    : [];

  const requestedShapeType = String(fence.shapeType || "").trim().toLowerCase();
  const shapeType =
    requestedShapeType === "polygon" || requestedShapeType === "radius"
      ? requestedShapeType
      : coordinates.length >= 3
        ? "polygon"
        : "radius";

  return {
    id: createId(`fence${index + 1}`),
    type: fence.type === "competitor" ? "competitor" : "home",
    locationName: String(fence.locationName || "Unnamed Fence"),
    address: String(fence.address || ""),
    shapeType,
    radiusFeet,
    dwellTimeMin,
    velocityMax,
    isEVMode: Boolean(fence.isEVMode),
    coordinates
  };
}

function validateCampaignPayload(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Payload must be a JSON object."];
  }

  if (!body.name || !String(body.name).trim()) {
    errors.push("Campaign name is required.");
  }

  if (!body.dealershipName || !String(body.dealershipName).trim()) {
    errors.push("Dealership name is required.");
  }

  if (!body.dealershipAddress || !String(body.dealershipAddress).trim()) {
    errors.push("Dealership address is required.");
  }

  if (!Array.isArray(body.platforms) || body.platforms.length === 0) {
    errors.push("Select at least one platform.");
  }

  if (!Array.isArray(body.fences) || body.fences.length === 0) {
    errors.push("At least one home or competitor fence is required.");
  }

  if (safeNumber(body.dailyBudget, 0) <= 0) {
    errors.push("Daily budget must be greater than 0.");
  }

  return errors;
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const earthRadiusMiles = 3958.8;
  const latDistance = toRad(lat2 - lat1);
  const lngDistance = toRad(lng2 - lng1);
  const a =
    Math.sin(latDistance / 2) * Math.sin(latDistance / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(lngDistance / 2) *
      Math.sin(lngDistance / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

const GOOGLE_TOKEN_URI_FALLBACK = "https://oauth2.googleapis.com/token";
const GOOGLE_API_VERSION_FALLBACK = "v22";
const NISSAN_WICHITA_FALLS_CUSTOMER_ID = "7891399350";
const NISSAN_WICHITA_FALLS_ACCOUNT_NAME = "Nissan Wichita Falls";
const NISSAN_WICHITA_FALLS_ADDRESS = "4000 Kell West Blvd, Wichita Falls, TX 76309";
const NISSAN_WICHITA_FALLS_LAT = 33.8806084;
const NISSAN_WICHITA_FALLS_LNG = -98.5460791;
const WICHITA_DEFAULT_COMPETITOR_NAME = "Patterson Honda";
const WICHITA_DEFAULT_COMPETITOR_ADDRESS = "319 Central East Fwy, Wichita Falls, TX 76301";
const WICHITA_DEFAULT_COMPETITOR_LAT = 33.8884365;
const WICHITA_DEFAULT_COMPETITOR_LNG = -98.4861729;
const WICHITA_DEFAULT_COMPETITOR_RADIUS_MILES = 1;
const GOOGLE_ADS_AUTO_SYNC_DEFAULT_INTERVAL_SEC = 300;
const AUTO_SYNC_SUPPORTED_TRIGGERS = new Set(["startup", "interval", "manual", "activation"]);

const googleAdsTokenCache = {
  accessToken: null,
  expiresAt: 0
};

const googleAdsAutoSyncState = {
  enabled: String(process.env.GOOGLE_ADS_AUTO_SYNC_ENABLED || "true").trim().toLowerCase() !== "false",
  intervalSec: Math.max(60, Math.floor(asPositiveNumber(process.env.GOOGLE_ADS_AUTO_SYNC_INTERVAL_SEC, GOOGLE_ADS_AUTO_SYNC_DEFAULT_INTERVAL_SEC))),
  timerActive: false,
  running: false,
  tickCount: 0,
  nextRunAt: null,
  lastRunStartedAt: null,
  lastRunCompletedAt: null,
  lastSuccessfulSyncAt: null,
  lastError: null,
  lastSummary: null
};
let googleAdsAutoSyncTimer = null;

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function asPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function firstDefined(object, keys, fallback = undefined) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }
  return fallback;
}

function resolveSecretsPath(fileRef) {
  const trimmed = String(fileRef || "").trim();
  if (!trimmed) {
    return null;
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  const candidates = [
    path.resolve(process.cwd(), trimmed),
    path.resolve(__dirname, trimmed),
    path.resolve(process.cwd(), "..", trimmed),
    path.resolve(__dirname, "..", trimmed)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function getGoogleAdsOAuthConfig() {
  const directClientId = process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const directClientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";

  if (directClientId && directClientSecret) {
    return {
      source: "env",
      clientId: directClientId,
      clientSecret: directClientSecret,
      tokenUri: process.env.GOOGLE_ADS_OAUTH_TOKEN_URI || GOOGLE_TOKEN_URI_FALLBACK
    };
  }

  const secretsFileRef = process.env.GOOGLE_OAUTH_CLIENT_SECRETS_FILE || "";
  if (!secretsFileRef) {
    throw new Error(
      "Missing OAuth configuration. Set GOOGLE_ADS_CLIENT_ID/GOOGLE_ADS_CLIENT_SECRET or GOOGLE_OAUTH_CLIENT_SECRETS_FILE."
    );
  }

  const resolvedPath = resolveSecretsPath(secretsFileRef);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    throw new Error(`OAuth client secrets file not found: ${secretsFileRef}`);
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const container = raw.installed || raw.web;
  if (!container || !container.client_id || !container.client_secret) {
    throw new Error("OAuth client secrets file is missing client_id/client_secret.");
  }

  return {
    source: "file",
    filePath: resolvedPath,
    clientId: container.client_id,
    clientSecret: container.client_secret,
    tokenUri: container.token_uri || GOOGLE_TOKEN_URI_FALLBACK
  };
}

function getGoogleAdsIntegrationStatus() {
  const developerTokenReady = Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
  const refreshTokenReady = Boolean(process.env.GOOGLE_ADS_REFRESH_TOKEN);
  const loginCustomerId = digitsOnly(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "");
  const customerId = digitsOnly(
    process.env.GOOGLE_ADS_NISSAN_CUSTOMER_ID || process.env.GOOGLE_ADS_CUSTOMER_ID || NISSAN_WICHITA_FALLS_CUSTOMER_ID
  );

  let oauth = { ready: false, source: "missing", error: "OAuth config missing" };
  try {
    const oauthConfig = getGoogleAdsOAuthConfig();
    oauth = {
      ready: true,
      source: oauthConfig.source,
      filePath: oauthConfig.filePath || null,
      tokenUri: oauthConfig.tokenUri
    };
  } catch (error) {
    oauth = {
      ready: false,
      source: "missing",
      error: error instanceof Error ? error.message : "OAuth configuration error"
    };
  }

  return {
    ready: developerTokenReady && refreshTokenReady && oauth.ready && Boolean(customerId),
    developerTokenReady,
    refreshTokenReady,
    loginCustomerIdSet: Boolean(loginCustomerId),
    nissanCustomerId: customerId || null,
    apiVersion: process.env.GOOGLE_ADS_API_VERSION || GOOGLE_API_VERSION_FALLBACK,
    oauth
  };
}

function getNissanCustomerId() {
  return digitsOnly(
    process.env.GOOGLE_ADS_NISSAN_CUSTOMER_ID || process.env.GOOGLE_ADS_CUSTOMER_ID || NISSAN_WICHITA_FALLS_CUSTOMER_ID
  );
}

function getNissanAccountName() {
  return process.env.GOOGLE_ADS_NISSAN_ACCOUNT_NAME || NISSAN_WICHITA_FALLS_ACCOUNT_NAME;
}

function setGoogleAdsAutoSyncNextRun() {
  if (!googleAdsAutoSyncState.enabled || !googleAdsAutoSyncState.timerActive) {
    googleAdsAutoSyncState.nextRunAt = null;
    return;
  }
  const next = Date.now() + googleAdsAutoSyncState.intervalSec * 1000;
  googleAdsAutoSyncState.nextRunAt = new Date(next).toISOString();
}

function getGoogleAdsAutoSyncStatus() {
  return {
    enabled: googleAdsAutoSyncState.enabled,
    timerActive: googleAdsAutoSyncState.timerActive,
    running: googleAdsAutoSyncState.running,
    intervalSec: googleAdsAutoSyncState.intervalSec,
    intervalMinutes: Number((googleAdsAutoSyncState.intervalSec / 60).toFixed(2)),
    tickCount: googleAdsAutoSyncState.tickCount,
    nextRunAt: googleAdsAutoSyncState.nextRunAt,
    lastRunStartedAt: googleAdsAutoSyncState.lastRunStartedAt,
    lastRunCompletedAt: googleAdsAutoSyncState.lastRunCompletedAt,
    lastSuccessfulSyncAt: googleAdsAutoSyncState.lastSuccessfulSyncAt,
    lastError: googleAdsAutoSyncState.lastError,
    lastSummary: googleAdsAutoSyncState.lastSummary
  };
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function isOperatorAuthorized(req) {
  if (!dspConfig.operatorApiKey) {
    return true;
  }

  const headerKey = String(req.get("x-operator-key") || "").trim();
  const bodyKey = String(req.body?.operatorKey || "").trim();
  const queryKey = String(req.query?.operatorKey || "").trim();
  return [headerKey, bodyKey, queryKey].some((value) => value && value === dspConfig.operatorApiKey);
}

function requireOperatorAccess(req, res) {
  if (isOperatorAuthorized(req)) {
    return true;
  }

  res.status(403).json({
    ok: false,
    error: "Operator authorization required. Provide x-operator-key."
  });
  return false;
}

async function calculateDashboardPayload() {
  const dashboard = calculateDashboard();
  const fallbackDsp = {
    eventsIngested: 0,
    devicesQualified: 0,
    audienceActive: 0,
    activationSuccessRate: 0
  };

  if (!hasDatabase()) {
    return {
      ...dashboard,
      dsp: fallbackDsp
    };
  }

  let dspMetrics = fallbackDsp;
  try {
    dspMetrics = await getDspDashboardMetrics(dspConfig.pilotTenantId);
  } catch (error) {
    console.error("Failed to load DSP dashboard metrics:", error.message || error);
  }

  return {
    ...dashboard,
    dsp: dspMetrics
  };
}

function toMicroDegrees(value) {
  return Math.round(Number(value) * 1_000_000);
}

function campaignResourceName(customerId, campaignId) {
  return `customers/${digitsOnly(customerId)}/campaigns/${digitsOnly(campaignId)}`;
}

async function fetchGoogleAdsAccessToken() {
  if (googleAdsTokenCache.accessToken && Date.now() < googleAdsTokenCache.expiresAt) {
    return googleAdsTokenCache.accessToken;
  }

  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("Missing GOOGLE_ADS_REFRESH_TOKEN.");
  }

  const oauth = getGoogleAdsOAuthConfig();
  const payload = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const tokenResponse = await fetch(oauth.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload.toString()
  });

  const tokenJson = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenJson.access_token) {
    const errorMessage =
      tokenJson.error_description || tokenJson.error || `OAuth token request failed (${tokenResponse.status}).`;
    throw new Error(errorMessage);
  }

  const expiresIn = Math.max(120, asPositiveNumber(tokenJson.expires_in, 3600));
  googleAdsTokenCache.accessToken = tokenJson.access_token;
  googleAdsTokenCache.expiresAt = Date.now() + (expiresIn - 60) * 1000;
  return googleAdsTokenCache.accessToken;
}

function parseGoogleAdsApiError(payload, statusCode) {
  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0];
    if (first?.error?.message) {
      return `${first.error.message} (HTTP ${statusCode})`;
    }
  }
  const firstDetailedError = payload?.error?.details?.[0]?.errors?.[0];
  if (firstDetailedError?.message) {
    const codeContainer = firstDetailedError.errorCode || {};
    const codeKey = Object.keys(codeContainer)[0];
    const codeValue = codeKey ? codeContainer[codeKey] : "";
    const codeSuffix = codeValue ? ` [${codeValue}]` : "";
    return `${firstDetailedError.message}${codeSuffix} (HTTP ${statusCode})`;
  }
  if (payload?.error?.message) {
    return `${payload.error.message} (HTTP ${statusCode})`;
  }
  return `Google Ads API request failed (${statusCode}).`;
}

async function getGoogleAdsRequestHeaders() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    throw new Error("Missing GOOGLE_ADS_DEVELOPER_TOKEN.");
  }

  const accessToken = await fetchGoogleAdsAccessToken();
  const loginCustomerId = digitsOnly(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "");

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "developer-token": developerToken
  };

  if (loginCustomerId) {
    headers["login-customer-id"] = loginCustomerId;
  }

  return headers;
}

async function googleAdsApiPost(customerId, pathSuffix, payload) {
  const customerIdDigits = digitsOnly(customerId);
  if (!customerIdDigits) {
    throw new Error("A Google Ads customer ID is required.");
  }

  const apiVersion = process.env.GOOGLE_ADS_API_VERSION || GOOGLE_API_VERSION_FALLBACK;
  const headers = await getGoogleAdsRequestHeaders();

  const response = await fetch(
    `https://googleads.googleapis.com/${apiVersion}/customers/${customerIdDigits}/${pathSuffix}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    }
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parseGoogleAdsApiError(body, response.status));
  }

  return body;
}

async function googleAdsSearchStream(customerId, query) {
  const payload = await googleAdsApiPost(customerId, "googleAds:searchStream", { query });
  if (Array.isArray(payload)) {
    return payload;
  }
  return [payload];
}

function normalizeGoogleCampaignRow(row) {
  const campaign = row.campaign || {};
  const metrics = row.metrics || {};

  const impressions = asPositiveNumber(firstDefined(metrics, ["impressions"], 0), 0);
  const clicks = asPositiveNumber(firstDefined(metrics, ["clicks"], 0), 0);
  const costMicros = asPositiveNumber(firstDefined(metrics, ["costMicros", "cost_micros"], 0), 0);

  return {
    id: String(campaign.id || ""),
    name: String(campaign.name || "Unnamed Campaign"),
    status: String(campaign.status || "UNKNOWN"),
    channelType: String(firstDefined(campaign, ["advertisingChannelType", "advertising_channel_type"], "UNKNOWN")),
    impressions,
    clicks,
    ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
    costMicros,
    cost: Number((costMicros / 1_000_000).toFixed(2))
  };
}

async function listGoogleAdsCampaignRows(customerId) {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
      AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.clicks DESC
    LIMIT 50
  `;

  const chunks = await googleAdsSearchStream(customerId, query);
  const rows = [];
  for (const chunk of chunks) {
    if (Array.isArray(chunk.results)) {
      for (const row of chunk.results) {
        rows.push(normalizeGoogleCampaignRow(row));
      }
    }
  }

  return rows.filter((row) => row.id);
}

function normalizeProximityCriterionRow(row) {
  const criterion = row.campaignCriterion || row.campaign_criterion || {};
  const proximity = criterion.proximity || {};
  const address = proximity.address || {};
  const geoPoint = proximity.geoPoint || proximity.geo_point || {};

  const latRaw = firstDefined(geoPoint, ["latitudeInMicroDegrees", "latitude_in_micro_degrees"], 0);
  const lngRaw = firstDefined(geoPoint, ["longitudeInMicroDegrees", "longitude_in_micro_degrees"], 0);
  const latMicro = Number.isFinite(Number(latRaw)) ? Number(latRaw) : 0;
  const lngMicro = Number.isFinite(Number(lngRaw)) ? Number(lngRaw) : 0;

  return {
    resourceName: String(firstDefined(criterion, ["resourceName", "resource_name"], "")),
    criterionId: String(firstDefined(criterion, ["criterionId", "criterion_id"], "")),
    radius: asPositiveNumber(proximity.radius, 0),
    radiusUnits: String(firstDefined(proximity, ["radiusUnits", "radius_units"], "UNKNOWN")),
    address: {
      streetAddress: String(firstDefined(address, ["streetAddress", "street_address"], "")),
      cityName: String(firstDefined(address, ["cityName", "city_name"], "")),
      provinceCode: String(firstDefined(address, ["provinceCode", "province_code"], "")),
      postalCode: String(firstDefined(address, ["postalCode", "postal_code"], "")),
      countryCode: String(firstDefined(address, ["countryCode", "country_code"], "US"))
    },
    geoPoint: {
      latitude: latMicro ? latMicro / 1_000_000 : 0,
      longitude: lngMicro ? lngMicro / 1_000_000 : 0
    }
  };
}

async function listGoogleCampaignProximityCriteria(customerId, campaignId) {
  const googleCampaignId = digitsOnly(campaignId);
  if (!googleCampaignId) {
    throw new Error("A Google campaign ID is required.");
  }

  const query = `
    SELECT
      campaign_criterion.resource_name,
      campaign_criterion.criterion_id,
      campaign_criterion.proximity.radius,
      campaign_criterion.proximity.radius_units,
      campaign_criterion.proximity.address.street_address,
      campaign_criterion.proximity.address.city_name,
      campaign_criterion.proximity.address.province_code,
      campaign_criterion.proximity.address.postal_code,
      campaign_criterion.proximity.address.country_code,
      campaign_criterion.proximity.geo_point.latitude_in_micro_degrees,
      campaign_criterion.proximity.geo_point.longitude_in_micro_degrees
    FROM campaign_criterion
    WHERE campaign.id = ${googleCampaignId}
      AND campaign_criterion.type = PROXIMITY
  `;

  const chunks = await googleAdsSearchStream(customerId, query);
  const rows = [];
  for (const chunk of chunks) {
    if (Array.isArray(chunk.results)) {
      for (const row of chunk.results) {
        rows.push(normalizeProximityCriterionRow(row));
      }
    }
  }
  return rows.filter((row) => row.resourceName);
}

async function mutateGoogleCampaignCriteria(customerId, operations, options = {}) {
  if (!Array.isArray(operations) || operations.length === 0) {
    return { results: [] };
  }

  return googleAdsApiPost(customerId, "campaignCriteria:mutate", {
    operations,
    partialFailure: parseBoolean(options.partialFailure, false),
    validateOnly: parseBoolean(options.validateOnly, false)
  });
}

async function declareCampaignNonPoliticalEUAds(customerId, campaignId, options = {}) {
  const payload = {
    operations: [
      {
        update: {
          resourceName: campaignResourceName(customerId, campaignId),
          containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING"
        },
        updateMask: "contains_eu_political_advertising"
      }
    ],
    partialFailure: false,
    validateOnly: parseBoolean(options.validateOnly, false)
  };

  return googleAdsApiPost(customerId, "campaigns:mutate", payload);
}

async function pushNissanCompetitorGeofenceToGoogle(options = {}) {
  const customerId = digitsOnly(options.customerId || getNissanCustomerId());
  if (!customerId) {
    throw new Error("No Nissan customer ID configured.");
  }

  const googleCampaignId = digitsOnly(options.googleCampaignId);
  if (!googleCampaignId) {
    throw new Error("No Google campaign ID provided for geofence push.");
  }

  const centerLat = Number(options.centerLat ?? WICHITA_DEFAULT_COMPETITOR_LAT);
  const centerLng = Number(options.centerLng ?? WICHITA_DEFAULT_COMPETITOR_LNG);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    throw new Error("Valid centerLat and centerLng are required.");
  }

  const radiusMiles = Math.max(0.1, Number(options.radiusMiles ?? WICHITA_DEFAULT_COMPETITOR_RADIUS_MILES));
  const competitorName = String(options.competitorName || WICHITA_DEFAULT_COMPETITOR_NAME);
  const competitorAddress = String(options.competitorAddress || WICHITA_DEFAULT_COMPETITOR_ADDRESS);
  const replaceExisting = parseBoolean(options.replaceExisting, true);
  const validateOnly = parseBoolean(options.validateOnly, false);

  const existing = await listGoogleCampaignProximityCriteria(customerId, googleCampaignId);
  const operations = [];

  if (replaceExisting) {
    for (const criterion of existing) {
      operations.push({ remove: criterion.resourceName });
    }
  }

  operations.push({
    create: {
      campaign: campaignResourceName(customerId, googleCampaignId),
      negative: false,
      proximity: {
        radius: Number(radiusMiles.toFixed(2)),
        radiusUnits: "MILES",
        geoPoint: {
          latitudeInMicroDegrees: toMicroDegrees(centerLat),
          longitudeInMicroDegrees: toMicroDegrees(centerLng)
        },
        address: {
          streetAddress: competitorAddress,
          cityName: "Wichita Falls",
          provinceCode: "TX",
          postalCode: "76301",
          countryCode: "US"
        }
      }
    }
  });

  const mutateResult = await mutateGoogleCampaignCriteria(customerId, operations, { validateOnly });
  const postPush = validateOnly ? existing : await listGoogleCampaignProximityCriteria(customerId, googleCampaignId);

  return {
    customerId,
    googleCampaignId,
    competitorName,
    competitorAddress,
    radiusMiles: Number(radiusMiles.toFixed(2)),
    centerLat,
    centerLng,
    validateOnly,
    replacedTargets: replaceExisting ? existing.length : 0,
    existingTargetsBefore: existing,
    targetsAfter: postPush,
    mutateResult
  };
}

function selectNissanCampaign(rows, requestedCampaignId, campaignNameContains) {
  const requestedId = digitsOnly(requestedCampaignId || "");
  if (requestedId) {
    const byId = rows.find((row) => digitsOnly(row.id) === requestedId);
    if (byId) {
      return byId;
    }
    throw new Error(`Requested Google campaign ID ${requestedId} was not found in this account.`);
  }

  const byName = String(campaignNameContains || "").trim().toLowerCase();
  const filteredByName = byName ? rows.filter((row) => row.name.toLowerCase().includes(byName)) : rows;
  const enabled = filteredByName.filter((row) => row.status === "ENABLED");
  const withClicks = enabled.filter((row) => row.clicks > 0);

  return withClicks[0] || enabled[0] || filteredByName[0] || rows[0] || null;
}

function upsertGoogleAdsCampaign(customerId, accountName, selectedCampaign, options = {}) {
  const customerDigits = digitsOnly(customerId);
  const syncSource = String(options.syncSource || "manual");
  const now = new Date().toISOString();

  let campaign = campaigns.find(
    (item) => item.integration?.source === "google_ads" && item.integration?.customerId === customerDigits
  );

  if (!campaign) {
    campaign = {
      id: createId("campaign"),
      name: `${accountName} Live Feed`,
      status: "active",
      createdAt: now,
      dealershipName: accountName,
      dealershipAddress: NISSAN_WICHITA_FALLS_ADDRESS,
      locationId: "nissan-live-feed",
      platforms: ["google"],
      retargetDays: 21,
      dailyBudget: 100,
      monthlyBudgetEstimate: 3000,
      baseCpm: 8.5,
      cpcEstimate: 2.4,
      ctaUrl: "",
      message: "NO GAMES - Just Honest Pricing and Extraordinary Service",
      qualificationRules: {
        accuracyMaxM: 100,
        cooldownHours: 24,
        sessionBoundaryMin: 20,
        lateGraceMin: 30,
        dwellMin: 12,
        velocityMaxMph: 6
      },
      fences: [
        {
          id: createId("fence"),
          type: "home",
          locationName: accountName,
          address: NISSAN_WICHITA_FALLS_ADDRESS,
          shapeType: "radius",
          radiusFeet: 500,
          dwellTimeMin: 12,
          velocityMax: 6,
          isEVMode: false,
          coordinates: []
        }
      ],
      missingInputs: [],
      integration: {
        source: "google_ads",
        customerId: customerDigits
      }
    };

    campaigns.unshift(campaign);
  }

  campaign.name = `${accountName} Live Feed - ${selectedCampaign.name}`;
  campaign.status = selectedCampaign.status === "ENABLED" ? "active" : "paused";
  campaign.platforms = ["google"];
  campaign.dealershipName = accountName;
  campaign.dealershipAddress = NISSAN_WICHITA_FALLS_ADDRESS;
  const previousIntegration =
    campaign.integration && typeof campaign.integration === "object" ? campaign.integration : {};
  campaign.integration = {
    ...previousIntegration,
    source: "google_ads",
    customerId: customerDigits,
    googleCampaignId: digitsOnly(selectedCampaign.id),
    googleCampaignName: selectedCampaign.name,
    channelType: selectedCampaign.channelType,
    syncedAt: now
  };

  const metrics = getCampaignMetrics(campaign.id);
  const previousMetrics = {
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    spend: metrics.spend
  };
  metrics.impressions = selectedCampaign.impressions;
  metrics.clicks = selectedCampaign.clicks;
  metrics.spend = selectedCampaign.cost;
  metrics.walkIns = Math.floor(selectedCampaign.clicks * 0.12);
  metrics.lastUpdatedAt = now;

  const deltaImpressions = metrics.impressions - previousMetrics.impressions;
  const deltaClicks = metrics.clicks - previousMetrics.clicks;
  const deltaSpend = Number((metrics.spend - previousMetrics.spend).toFixed(2));
  const sourcePrefix =
    syncSource === "auto" ? "Auto-sync" : syncSource === "activation" ? "Activation sync" : "Manual sync";
  const deltaLabel = `${deltaImpressions >= 0 ? "+" : ""}${deltaImpressions} impressions, ${
    deltaClicks >= 0 ? "+" : ""
  }${deltaClicks} clicks, ${deltaSpend >= 0 ? "+" : ""}$${deltaSpend.toFixed(2)} spend`;

  pushLiveEvent({
    id: createId("event"),
    campaignId: campaign.id,
    campaignName: campaign.name,
    timestamp: now,
    type: "google_ads_sync",
    velocityMph: 0,
    dwellTimeMin: 0,
    result: `${sourcePrefix} refreshed ${selectedCampaign.name} (${deltaLabel}).`,
    competitorLot: accountName,
    deviceId: "GADS"
  });

  if (hasDatabase()) {
    upsertCampaignFromMemory(campaign).catch((error) => {
      console.error("Failed to mirror Google synced campaign to Postgres:", error.message || error);
    });
  }

  return { campaign, metrics };
}

async function syncNissanGoogleAdsLiveData(options = {}) {
  const customerId = digitsOnly(options.customerId || getNissanCustomerId());
  const accountName = String(options.accountName || getNissanAccountName());
  const requestedCampaignId = options.requestedCampaignId || "";
  const campaignNameContains = options.campaignNameContains || "";
  const syncSource = options.syncSource || "manual";

  if (!customerId) {
    throw new Error("No Nissan customer ID configured.");
  }

  const rows = await listGoogleAdsCampaignRows(customerId);
  if (rows.length === 0) {
    throw new Error("No Google Ads campaigns returned for this Nissan account.");
  }

  const selected = selectNissanCampaign(rows, requestedCampaignId, campaignNameContains);
  if (!selected) {
    throw new Error("No campaign available to sync.");
  }

  const synced = upsertGoogleAdsCampaign(customerId, accountName, selected, { syncSource });
  return {
    accountName,
    customerId,
    rows,
    selected,
    synced
  };
}

async function runGoogleAdsAutoSyncTick(options = {}) {
  const trigger = AUTO_SYNC_SUPPORTED_TRIGGERS.has(String(options.trigger || "manual"))
    ? String(options.trigger || "manual")
    : "manual";

  const isAutoTrigger = trigger === "startup" || trigger === "interval";
  if (isAutoTrigger && !googleAdsAutoSyncState.enabled) {
    return null;
  }

  if (googleAdsAutoSyncState.running) {
    return null;
  }

  googleAdsAutoSyncState.running = true;
  googleAdsAutoSyncState.lastError = null;
  googleAdsAutoSyncState.lastRunStartedAt = new Date().toISOString();

  try {
    const integrationStatus = getGoogleAdsIntegrationStatus();
    if (!integrationStatus.ready) {
      throw new Error("Google Ads integration is not ready.");
    }

    const customerId = digitsOnly(options.customerId || getNissanCustomerId());
    const linkedCampaign = campaigns.find(
      (item) => item.integration?.source === "google_ads" && digitsOnly(item.integration?.customerId) === customerId
    );

    const requestedCampaignId = options.requestedCampaignId || linkedCampaign?.integration?.googleCampaignId || "";
    const campaignNameContains =
      options.campaignNameContains ||
      process.env.GOOGLE_ADS_AUTO_SYNC_CAMPAIGN_NAME_CONTAINS ||
      linkedCampaign?.integration?.googleCampaignName ||
      "nissan";

    const result = await syncNissanGoogleAdsLiveData({
      customerId,
      accountName: options.accountName || getNissanAccountName(),
      requestedCampaignId,
      campaignNameContains,
      syncSource: trigger === "activation" ? "activation" : isAutoTrigger ? "auto" : "manual"
    });

    const completedAt = new Date().toISOString();
    googleAdsAutoSyncState.tickCount += 1;
    googleAdsAutoSyncState.lastSuccessfulSyncAt = completedAt;
    googleAdsAutoSyncState.lastSummary = `${trigger} sync refreshed ${result.selected.name}.`;

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Ads sync failed.";
    googleAdsAutoSyncState.lastError = message;
    googleAdsAutoSyncState.lastSummary = `${trigger} sync failed: ${message}`;
    throw error;
  } finally {
    googleAdsAutoSyncState.running = false;
    googleAdsAutoSyncState.lastRunCompletedAt = new Date().toISOString();
    setGoogleAdsAutoSyncNextRun();
  }
}

function startGoogleAdsAutoSyncScheduler() {
  if (!googleAdsAutoSyncState.enabled) {
    googleAdsAutoSyncState.timerActive = false;
    googleAdsAutoSyncState.nextRunAt = null;
    console.log("Google Ads auto-sync disabled by GOOGLE_ADS_AUTO_SYNC_ENABLED=false");
    return;
  }

  if (googleAdsAutoSyncTimer) {
    clearInterval(googleAdsAutoSyncTimer);
  }

  const intervalMs = googleAdsAutoSyncState.intervalSec * 1000;
  googleAdsAutoSyncTimer = setInterval(() => {
    runGoogleAdsAutoSyncTick({ trigger: "interval" }).catch((error) => {
      console.error("Google Ads auto-sync interval run failed:", error.message || error);
    });
  }, intervalMs);
  googleAdsAutoSyncState.timerActive = true;
  setGoogleAdsAutoSyncNextRun();

  const runOnStart = String(process.env.GOOGLE_ADS_AUTO_SYNC_RUN_ON_START || "true").trim().toLowerCase() !== "false";
  if (runOnStart) {
    runGoogleAdsAutoSyncTick({ trigger: "startup" }).catch((error) => {
      console.error("Google Ads auto-sync startup run failed:", error.message || error);
    });
  }

  console.log(`Google Ads auto-sync scheduled every ${googleAdsAutoSyncState.intervalSec} seconds.`);
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "trd-geofence-api",
    docs: {
      health: "GET /api/health",
      setupTemplate: "GET /api/setup-template",
      campaigns: "GET/POST /api/campaigns",
      dashboard: "GET /api/dashboard",
      recordEvent: "POST /api/campaigns/:id/events",
      simulate: "POST /api/campaigns/:id/simulate",
      googleAdsStatus: "GET /api/integrations/google-ads/status",
      googleAdsNissanCampaigns: "GET /api/integrations/google-ads/nissan/campaigns",
      googleAdsNissanActivate: "POST /api/integrations/google-ads/nissan/activate",
      googleAdsNissanSyncNow: "POST /api/integrations/google-ads/nissan/sync-now",
      googleAdsNissanDeclareCampaign: "POST /api/integrations/google-ads/nissan/declaration",
      googleAdsNissanPushGeofence: "POST /api/integrations/google-ads/nissan/geofence/push",
      ingestLocationEvents: "POST /api/ingest/location-events",
      runQualification: "POST /api/qualify/run",
      audiences: "GET /api/audiences/:campaignId",
      activationJobs: "POST /api/activation/jobs",
      activationJobStatus: "GET /api/activation/jobs/:jobId",
      activationJobRetry: "POST /api/activation/jobs/:jobId/retry-failures",
      qualificationAnalytics: "GET /api/analytics/qualification",
      partnerFeedMonitor: "GET /api/ingest/monitor",
      saveRuleSet: "POST /api/campaigns/:id/rules",
      privacyDeleteDevice: "POST /api/privacy/delete-device",
      suppressionImport: "POST /api/privacy/suppressions/import",
      geofenceCheck: "POST /api/geofence/check"
    }
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "trd-geofence-api",
    timestamp: new Date().toISOString(),
    campaigns: campaigns.length,
    infrastructure: {
      database: hasDatabase(),
      redis: hasRedis()
    }
  });
});

app.get("/api/setup-template", (_req, res) => {
  res.json({
    ok: true,
    setup: SETUP_TEMPLATE,
    creativeRequirements: CREATIVE_REQUIREMENTS,
    platformOptions: PLATFORM_OPTIONS
  });
});

app.get("/api/integrations/google-ads/status", (_req, res) => {
  const status = getGoogleAdsIntegrationStatus();
  res.json({
    ok: true,
    integration: "google_ads",
    status,
    autoSync: getGoogleAdsAutoSyncStatus()
  });
});

app.get("/api/integrations/google-ads/nissan/campaigns", async (req, res) => {
  try {
    const customerId = digitsOnly(
      req.query.customerId ||
        process.env.GOOGLE_ADS_NISSAN_CUSTOMER_ID ||
        process.env.GOOGLE_ADS_CUSTOMER_ID ||
        NISSAN_WICHITA_FALLS_CUSTOMER_ID
    );
    const accountName = process.env.GOOGLE_ADS_NISSAN_ACCOUNT_NAME || NISSAN_WICHITA_FALLS_ACCOUNT_NAME;

    if (!customerId) {
      res.status(400).json({ ok: false, error: "No Nissan customer ID configured." });
      return;
    }

    const rows = await listGoogleAdsCampaignRows(customerId);
    res.json({
      ok: true,
      accountName,
      customerId,
      campaigns: rows
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Nissan campaigns from Google Ads.";
    const statusCode = message.toLowerCase().includes("missing") ? 400 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.post("/api/integrations/google-ads/nissan/activate", async (req, res) => {
  try {
    const result = await runGoogleAdsAutoSyncTick({
      trigger: "activation",
      customerId: req.body.customerId,
      requestedCampaignId: req.body.googleCampaignId || req.body.campaignId || "",
      campaignNameContains: req.body.campaignNameContains || "",
      accountName: req.body.accountName || getNissanAccountName()
    });

    if (!result) {
      res.status(409).json({ ok: false, error: "Google Ads sync is already running. Try again in a few seconds." });
      return;
    }

    res.json({
      ok: true,
      integration: "google_ads",
      accountName: result.accountName,
      customerId: result.customerId,
      selectedGoogleCampaign: result.selected,
      linkedCampaign: result.synced.campaign,
      linkedMetrics: result.synced.metrics,
      dashboard: await calculateDashboardPayload(),
      availableCampaigns: result.rows.slice(0, 20),
      autoSync: getGoogleAdsAutoSyncStatus()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to activate Nissan live data feed.";
    const statusCode =
      message.toLowerCase().includes("missing") || message.toLowerCase().includes("not found") ? 400 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.post("/api/integrations/google-ads/nissan/sync-now", async (req, res) => {
  try {
    const result = await runGoogleAdsAutoSyncTick({
      trigger: "manual",
      customerId: req.body.customerId,
      requestedCampaignId: req.body.googleCampaignId || req.body.campaignId || "",
      campaignNameContains: req.body.campaignNameContains || "",
      accountName: req.body.accountName || getNissanAccountName()
    });

    if (!result) {
      res.status(409).json({ ok: false, error: "Google Ads sync is already running. Try again in a few seconds." });
      return;
    }

    res.json({
      ok: true,
      integration: "google_ads",
      accountName: result.accountName,
      customerId: result.customerId,
      selectedGoogleCampaign: result.selected,
      linkedCampaign: result.synced.campaign,
      linkedMetrics: result.synced.metrics,
      dashboard: await calculateDashboardPayload(),
      availableCampaigns: result.rows.slice(0, 20),
      autoSync: getGoogleAdsAutoSyncStatus()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run Nissan sync.";
    const statusCode = message.toLowerCase().includes("missing") ? 400 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.post("/api/integrations/google-ads/nissan/declaration", async (req, res) => {
  try {
    if (!requireOperatorAccess(req, res)) {
      return;
    }

    const customerId = digitsOnly(req.body.customerId || getNissanCustomerId());
    const googleCampaignId = digitsOnly(
      req.body.googleCampaignId ||
        campaigns.find((item) => item.integration?.source === "google_ads")?.integration?.googleCampaignId ||
        ""
    );

    if (!customerId) {
      res.status(400).json({ ok: false, error: "No Nissan customer ID configured." });
      return;
    }

    if (!googleCampaignId) {
      res.status(400).json({ ok: false, error: "No Google campaign ID provided for declaration update." });
      return;
    }

    const validateOnly = parseBoolean(req.body.validateOnly, false);
    const result = await declareCampaignNonPoliticalEUAds(customerId, googleCampaignId, { validateOnly });

    res.json({
      ok: true,
      integration: "google_ads",
      customerId,
      googleCampaignId,
      validateOnly,
      declaration: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update EU declaration.";
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/integrations/google-ads/nissan/geofence/push", async (req, res) => {
  try {
    if (!requireOperatorAccess(req, res)) {
      return;
    }

    const customerId = digitsOnly(req.body.customerId || getNissanCustomerId());
    const linkedGoogleCampaignId = campaigns.find((item) => item.integration?.source === "google_ads")?.integration
      ?.googleCampaignId;
    const googleCampaignId = digitsOnly(req.body.googleCampaignId || linkedGoogleCampaignId || "");
    const competitorName = String(req.body.competitorName || WICHITA_DEFAULT_COMPETITOR_NAME);
    const competitorAddress = String(req.body.competitorAddress || WICHITA_DEFAULT_COMPETITOR_ADDRESS);
    const radiusMiles = Number(req.body.radiusMiles ?? WICHITA_DEFAULT_COMPETITOR_RADIUS_MILES);
    const centerLat = Number(req.body.centerLat ?? WICHITA_DEFAULT_COMPETITOR_LAT);
    const centerLng = Number(req.body.centerLng ?? WICHITA_DEFAULT_COMPETITOR_LNG);
    const replaceExisting = parseBoolean(req.body.replaceExisting, true);
    const validateOnly = parseBoolean(req.body.validateOnly, false);
    const confirmNoEUPoliticalAds = parseBoolean(req.body.confirmNoEUPoliticalAds, false);

    if (!customerId) {
      res.status(400).json({ ok: false, error: "No Nissan customer ID configured." });
      return;
    }

    if (!googleCampaignId) {
      res.status(400).json({ ok: false, error: "No Google campaign ID provided. Activate Nissan data first." });
      return;
    }

    let pushResult;
    try {
      pushResult = await pushNissanCompetitorGeofenceToGoogle({
        customerId,
        googleCampaignId,
        competitorName,
        competitorAddress,
        radiusMiles,
        centerLat,
        centerLng,
        replaceExisting,
        validateOnly
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to push geofence.";
      const needsDeclaration = message.includes("MISSING_EU_POLITICAL_ADVERTISING_SELF_DECLARATION");

      if (needsDeclaration && confirmNoEUPoliticalAds) {
        await declareCampaignNonPoliticalEUAds(customerId, googleCampaignId, { validateOnly: false });
        pushResult = await pushNissanCompetitorGeofenceToGoogle({
          customerId,
          googleCampaignId,
          competitorName,
          competitorAddress,
          radiusMiles,
          centerLat,
          centerLng,
          replaceExisting,
          validateOnly
        });
      } else {
        const statusCode = needsDeclaration ? 409 : 500;
        const hint = needsDeclaration
          ? "Set confirmNoEUPoliticalAds=true in this endpoint request, or set the campaign declaration in Google Ads."
          : null;
        res.status(statusCode).json({ ok: false, error: message, hint });
        return;
      }
    }

    let liveLinkedCampaign = campaigns.find(
      (item) =>
        item.integration?.source === "google_ads" &&
        digitsOnly(item.integration?.customerId) === customerId &&
        digitsOnly(item.integration?.googleCampaignId) === googleCampaignId
    );

    if (!liveLinkedCampaign && !validateOnly) {
      liveLinkedCampaign = {
        id: createId("campaign"),
        name: `${getNissanAccountName()} Live Feed - ${googleCampaignId}`,
        status: "active",
        createdAt: new Date().toISOString(),
        dealershipName: getNissanAccountName(),
        dealershipAddress: NISSAN_WICHITA_FALLS_ADDRESS,
        locationId: "nissan-live-feed",
        platforms: ["google"],
        retargetDays: 21,
        dailyBudget: 100,
        monthlyBudgetEstimate: 3000,
        baseCpm: 8.5,
        cpcEstimate: 2.4,
        ctaUrl: "",
        message: SETUP_TEMPLATE.defaultMessage,
        qualificationRules: {
          accuracyMaxM: 100,
          cooldownHours: 24,
          sessionBoundaryMin: 20,
          lateGraceMin: 30,
          dwellMin: 12,
          velocityMaxMph: 6
        },
        fences: [],
        missingInputs: [],
        integration: {
          source: "google_ads",
          customerId,
          googleCampaignId,
          googleCampaignName: `Campaign ${googleCampaignId}`,
          syncedAt: new Date().toISOString()
        }
      };
      campaigns.unshift(liveLinkedCampaign);
      getCampaignMetrics(liveLinkedCampaign.id);
    }

    if (liveLinkedCampaign && !validateOnly) {
      const now = new Date().toISOString();
      liveLinkedCampaign.fences = [
        {
          id: createId("fence"),
          type: "home",
          locationName: "Nissan of Wichita Falls",
          address: NISSAN_WICHITA_FALLS_ADDRESS,
          shapeType: "radius",
          radiusFeet: 500,
          dwellTimeMin: 12,
          velocityMax: 6,
          isEVMode: false,
          coordinates: [{ lat: NISSAN_WICHITA_FALLS_LAT, lng: NISSAN_WICHITA_FALLS_LNG }]
        },
        {
          id: createId("fence"),
          type: "competitor",
          locationName: competitorName,
          address: competitorAddress,
          shapeType: "radius",
          radiusFeet: Math.round(pushResult.radiusMiles * 5280),
          dwellTimeMin: 12,
          velocityMax: 6,
          isEVMode: false,
          coordinates: [{ lat: centerLat, lng: centerLng }]
        }
      ];

      liveLinkedCampaign.integration = {
        ...liveLinkedCampaign.integration,
        geofenceLastPushedAt: now,
        geofenceTarget: {
          competitorName,
          competitorAddress,
          radiusMiles: pushResult.radiusMiles,
          centerLat,
          centerLng
        }
      };

      pushLiveEvent({
        id: createId("event"),
        campaignId: liveLinkedCampaign.id,
        campaignName: liveLinkedCampaign.name,
        timestamp: now,
        type: "google_ads_geofence_push",
        velocityMph: 0,
        dwellTimeMin: 0,
        result: `Pushed ${pushResult.radiusMiles}mi Google proximity fence for ${competitorName}.`,
        competitorLot: competitorName,
        deviceId: "GADS"
      });
    }

    if (liveLinkedCampaign && !validateOnly && hasDatabase()) {
      await persistGeofencePush(
        liveLinkedCampaign,
        {
          customerId,
          googleCampaignId,
          competitorName,
          competitorAddress,
          centerLat,
          centerLng,
          radiusMiles: pushResult.radiusMiles,
          replaceExisting,
          validateOnly
        },
        "operator:google-geofence-push"
      );
    }

    res.json({
      ok: true,
      integration: "google_ads",
      customerId,
      googleCampaignId,
      competitorName,
      competitorAddress,
      center: {
        lat: centerLat,
        lng: centerLng
      },
      radiusMiles: pushResult.radiusMiles,
      replaceExisting,
      validateOnly,
      push: pushResult,
      dashboard: await calculateDashboardPayload()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to push geofence to Google Ads.";
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/campaigns", (_req, res) => {
  res.json({
    ok: true,
    campaigns
  });
});

app.post("/api/campaigns", async (req, res) => {
  const validationErrors = validateCampaignPayload(req.body);
  if (validationErrors.length > 0) {
    res.status(400).json({ ok: false, errors: validationErrors });
    return;
  }

  const missingInputs = [];
  const fences = req.body.fences.map((fence, index) => normalizeFence(fence, index));

  for (const fence of fences) {
    if (fence.type === "competitor" && !fence.address.trim()) {
      missingInputs.push(`Missing competitor address for ${fence.locationName}.`);
    }
  }

  const campaign = {
    id: createId("campaign"),
    name: String(req.body.name).trim(),
    status: missingInputs.length > 0 ? "draft" : "active",
    createdAt: new Date().toISOString(),
    dealershipName: String(req.body.dealershipName).trim(),
    dealershipAddress: String(req.body.dealershipAddress).trim(),
    locationId: String(req.body.locationId || "custom-location"),
    platforms: req.body.platforms.map((platform) => String(platform)),
    retargetDays: Math.min(30, Math.max(7, safeNumber(req.body.retargetDays, 21))),
    dailyBudget: Number(safeNumber(req.body.dailyBudget, 0).toFixed(2)),
    monthlyBudgetEstimate: Number((safeNumber(req.body.dailyBudget, 0) * 30).toFixed(2)),
    baseCpm: Number(safeNumber(req.body.baseCpm, 8.5).toFixed(2)),
    cpcEstimate: Number(safeNumber(req.body.cpcEstimate, 2.4).toFixed(2)),
    ctaUrl: String(req.body.ctaUrl || "").trim(),
    message: String(req.body.message || SETUP_TEMPLATE.defaultMessage).trim(),
    qualificationRules: {
      accuracyMaxM: Math.max(5, safeNumber(req.body?.qualificationRules?.accuracyMaxM, 100)),
      cooldownHours: Math.max(1, safeNumber(req.body?.qualificationRules?.cooldownHours, 24)),
      sessionBoundaryMin: Math.max(5, safeNumber(req.body?.qualificationRules?.sessionBoundaryMin, 20)),
      lateGraceMin: Math.max(0, safeNumber(req.body?.qualificationRules?.lateGraceMin, 30)),
      dwellMin: Math.max(
        1,
        safeNumber(req.body?.qualificationRules?.dwellMin, SETUP_TEMPLATE.fenceRecommendations.dwellTimeMin)
      ),
      velocityMaxMph: Math.max(
        1,
        safeNumber(req.body?.qualificationRules?.velocityMaxMph, SETUP_TEMPLATE.fenceRecommendations.velocityMaxMph)
      )
    },
    fences,
    missingInputs
  };

  campaigns.unshift(campaign);
  getCampaignMetrics(campaign.id);

  pushLiveEvent({
    id: createId("event"),
    campaignId: campaign.id,
    campaignName: campaign.name,
    timestamp: new Date().toISOString(),
    type: "campaign_created",
    velocityMph: 0,
    dwellTimeMin: 0,
    result:
      campaign.status === "active"
        ? `Campaign launched with ${campaign.fences.length} fences.`
        : "Campaign saved as draft until missing competitor addresses are confirmed.",
    competitorLot: campaign.dealershipName,
    deviceId: "SYSTEM"
  });

  if (hasDatabase()) {
    try {
      await upsertCampaignFromMemory(campaign);
    } catch (error) {
      console.error("Failed to mirror campaign to Postgres:", error.message || error);
    }
  }

  res.status(201).json({
    ok: true,
    campaign,
    activationChecklist: buildActivationChecklist(campaign)
  });
});

app.post("/api/campaigns/:id/events", async (req, res) => {
  const campaign = campaigns.find((item) => item.id === req.params.id);
  if (!campaign) {
    res.status(404).json({ ok: false, error: "Campaign not found." });
    return;
  }

  const type = req.body.type === "click" ? "click" : "impression";
  const count = Math.max(1, Math.floor(safeNumber(req.body.count, 1)));
  const platform = String(req.body.platform || campaign.platforms[0] || "unspecified");

  const metrics = getCampaignMetrics(campaign.id);
  const unitCpm = campaign.baseCpm || 8.5;
  const unitCpc = campaign.cpcEstimate || 2.4;

  if (type === "impression") {
    metrics.impressions += count;
    metrics.spend += (count / 1000) * unitCpm;
  } else {
    metrics.clicks += count;
    metrics.spend += count * unitCpc;
    metrics.walkIns += Math.max(0, Math.floor(count * 0.12));
  }

  metrics.lastUpdatedAt = new Date().toISOString();

  pushLiveEvent({
    id: createId("event"),
    campaignId: campaign.id,
    campaignName: campaign.name,
    timestamp: metrics.lastUpdatedAt,
    type,
    velocityMph: Math.floor(Math.random() * 7) + 2,
    dwellTimeMin: Math.floor(Math.random() * 10) + 8,
    result:
      type === "click"
        ? `${count} click(s) captured from ${platform}.`
        : `${count} impression(s) served in active fence.`,
    competitorLot: campaign.fences.find((fence) => fence.type === "competitor")?.locationName || campaign.dealershipName,
    deviceId: Math.random().toString(36).slice(2, 8).toUpperCase()
  });

  res.json({
    ok: true,
    campaignId: campaign.id,
    metrics,
    dashboard: await calculateDashboardPayload()
  });
});

app.post("/api/campaigns/:id/simulate", async (req, res) => {
  const campaign = campaigns.find((item) => item.id === req.params.id);
  if (!campaign) {
    res.status(404).json({ ok: false, error: "Campaign not found." });
    return;
  }

  const cycles = Math.max(1, Math.min(25, Math.floor(safeNumber(req.body.cycles, 8))));
  const metrics = getCampaignMetrics(campaign.id);

  for (let i = 0; i < cycles; i += 1) {
    const impressions = Math.floor(Math.random() * 800) + 200;
    const clicks = Math.max(1, Math.floor(impressions * (Math.random() * 0.018 + 0.004)));

    metrics.impressions += impressions;
    metrics.clicks += clicks;
    metrics.spend += impressions / 1000 * (campaign.baseCpm || 8.5);
    metrics.spend += clicks * (campaign.cpcEstimate || 2.4);
    metrics.walkIns += Math.floor(clicks * 0.12);
    metrics.lastUpdatedAt = new Date().toISOString();

    pushLiveEvent({
      id: createId("event"),
      campaignId: campaign.id,
      campaignName: campaign.name,
      timestamp: metrics.lastUpdatedAt,
      type: "simulation",
      velocityMph: Math.floor(Math.random() * 7) + 2,
      dwellTimeMin: Math.floor(Math.random() * 12) + 6,
      result: `${impressions} impressions / ${clicks} clicks simulated.`,
      competitorLot:
        campaign.fences.find((fence) => fence.type === "competitor")?.locationName || campaign.dealershipName,
      deviceId: Math.random().toString(36).slice(2, 8).toUpperCase()
    });
  }

  res.json({
    ok: true,
    campaignId: campaign.id,
    metrics,
    dashboard: await calculateDashboardPayload()
  });
});

app.get("/api/campaigns/:id/handoff", (req, res) => {
  const campaign = campaigns.find((item) => item.id === req.params.id);
  if (!campaign) {
    res.status(404).json({ ok: false, error: "Campaign not found." });
    return;
  }

  const handoff = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    platforms: campaign.platforms,
    message: campaign.message,
    ctaUrl: campaign.ctaUrl,
    retargetDays: campaign.retargetDays,
    creativeRequirements: CREATIVE_REQUIREMENTS,
    fences: campaign.fences,
    tracking: {
      primary: ["impressions", "clicks", "ctr"],
      secondary: ["store_visit", "call_click", "direction_request"],
      utmTemplate:
        "?utm_source={platform}&utm_medium=display&utm_campaign={campaign_name}&utm_content={creative_id}"
    }
  };

  res.json({ ok: true, handoff });
});

app.post("/api/campaigns/:id/rules", async (req, res) => {
  try {
    if (!requireOperatorAccess(req, res)) {
      return;
    }

    const campaign = campaigns.find((item) => item.id === req.params.id);
    if (!campaign) {
      res.status(404).json({ ok: false, error: "Campaign not found." });
      return;
    }

    const rules = {
      accuracyMaxM: Math.max(5, safeNumber(req.body?.accuracyMaxM, 100)),
      cooldownHours: Math.max(1, safeNumber(req.body?.cooldownHours, 24)),
      sessionBoundaryMin: Math.max(5, safeNumber(req.body?.sessionBoundaryMin, 20)),
      lateGraceMin: Math.max(0, safeNumber(req.body?.lateGraceMin, 30)),
      dwellMin: Math.max(1, safeNumber(req.body?.dwellMin, 12)),
      velocityMaxMph: Math.max(1, safeNumber(req.body?.velocityMaxMph, 6))
    };

    campaign.qualificationRules = rules;

    if (hasDatabase()) {
      await upsertCampaignFromMemory(campaign);
      await saveCampaignQualificationRules(campaign.id, rules, "operator:save-live-rule-set");
    }

    res.json({
      ok: true,
      campaignId: campaign.id,
      rules
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save qualification rules.";
    const statusCode = message.toLowerCase().includes("not found") ? 404 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.post("/api/ingest/location-events", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for ingest endpoint." });
      return;
    }

    const result = await ingestLocationEvents(req.body || {}, "partner:webhook");
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ingest location events.";
    const statusCode = message.toLowerCase().includes("required") || message.toLowerCase().includes("invalid") ? 400 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.post("/api/qualify/run", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for qualification endpoint." });
      return;
    }

    const result = await runQualificationWindow({
      tenantId: req.body?.tenantId || dspConfig.pilotTenantId,
      campaignId: req.body?.campaignId,
      from: req.body?.from,
      to: req.body?.to,
      actor: "operator:manual-qualification"
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run qualification.";
    const statusCode = message.toLowerCase().includes("required") || message.toLowerCase().includes("not found") ? 400 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.get("/api/audiences/:campaignId", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for audiences endpoint." });
      return;
    }

    const summary = await getAudienceSummary(req.params.campaignId);
    res.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch audience summary.";
    const statusCode = message.toLowerCase().includes("not found") ? 404 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.post("/api/activation/jobs", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for activation jobs." });
      return;
    }

    if (!requireOperatorAccess(req, res)) {
      return;
    }

    const result = await createActivationJob(
      {
        tenantId: req.body?.tenantId || dspConfig.pilotTenantId,
        campaignId: req.body?.campaignId,
        platform: req.body?.platform || "google",
        mode: req.body?.mode || "export_only"
      },
      "operator:create-activation-job"
    );

    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create activation job.";
    const statusCode = message.toLowerCase().includes("required") ? 400 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.get("/api/activation/jobs/:jobId", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for activation jobs." });
      return;
    }

    const result = await getActivationJob(req.params.jobId);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch activation job.";
    const statusCode = message.toLowerCase().includes("not found") ? 404 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.post("/api/activation/jobs/:jobId/retry-failures", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for activation jobs." });
      return;
    }

    if (!requireOperatorAccess(req, res)) {
      return;
    }

    const result = await retryActivationJobFailures(req.params.jobId, "operator:retry-activation-failures");
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retry activation job failures.";
    const statusCode = message.toLowerCase().includes("not found") ? 404 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.get("/api/analytics/qualification", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for analytics endpoint." });
      return;
    }

    const result = await getQualificationAnalytics({
      campaignId: req.query.campaignId,
      from: req.query.from,
      to: req.query.to,
      fenceId: req.query.fenceId,
      deviceIdHash: req.query.deviceIdHash,
      limit: req.query.limit
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch qualification analytics.";
    const statusCode = message.toLowerCase().includes("required") ? 400 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.get("/api/ingest/monitor", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for feed monitor endpoint." });
      return;
    }

    const result = await getFeedMonitor(String(req.query.tenantId || dspConfig.pilotTenantId));
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch feed monitor.";
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/privacy/delete-device", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for privacy controls." });
      return;
    }

    if (!requireOperatorAccess(req, res)) {
      return;
    }

    const tenantId = String(req.body?.tenantId || dspConfig.pilotTenantId);
    const rawDeviceId = String(req.body?.deviceId || "").trim();
    const providedHash = String(req.body?.deviceIdHash || "").trim();
    const deviceIdHash = providedHash || (rawDeviceId ? hashDeviceId(tenantId, rawDeviceId) : "");
    if (!deviceIdHash) {
      res.status(400).json({ ok: false, error: "deviceIdHash or deviceId is required." });
      return;
    }

    const memberships = await query(
      `
      DELETE FROM audience_memberships
      WHERE tenant_id = $1
        AND device_id_hash = $2
      RETURNING id
      `,
      [tenantId, deviceIdHash]
    );

    await query(
      `
      INSERT INTO suppressed_devices (tenant_id, device_id_hash, reason)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, device_id_hash)
      DO UPDATE SET reason = EXCLUDED.reason
      `,
      [tenantId, deviceIdHash, "privacy_delete"]
    );

    res.json({
      ok: true,
      tenantId,
      deviceIdHash,
      deletedMemberships: memberships.rowCount
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete device.";
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/privacy/suppressions/import", async (req, res) => {
  try {
    if (!hasDatabase()) {
      res.status(503).json({ ok: false, error: "DATABASE_URL is required for privacy controls." });
      return;
    }

    if (!requireOperatorAccess(req, res)) {
      return;
    }

    const tenantId = String(req.body?.tenantId || dspConfig.pilotTenantId);
    const reason = String(req.body?.reason || "operator_import");
    const hashes = Array.isArray(req.body?.deviceIdHashes)
      ? req.body.deviceIdHashes.map((value) => String(value).trim()).filter(Boolean)
      : [];

    if (hashes.length === 0) {
      res.status(400).json({ ok: false, error: "deviceIdHashes array is required." });
      return;
    }

    let imported = 0;
    for (const deviceIdHash of hashes) {
      await query(
        `
        INSERT INTO suppressed_devices (tenant_id, device_id_hash, reason)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, device_id_hash)
        DO UPDATE SET reason = EXCLUDED.reason
        `,
        [tenantId, deviceIdHash, reason]
      );
      imported += 1;
    }

    res.json({ ok: true, tenantId, imported });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import suppression list.";
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/dashboard", async (_req, res) => {
  try {
    const dashboard = await calculateDashboardPayload();
    res.json({
      ok: true,
      dashboard,
      campaigns
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build dashboard.";
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/geofence/check", (req, res) => {
  const centerLat = parseNumber(req.body.centerLat);
  const centerLng = parseNumber(req.body.centerLng);
  const pointLat = parseNumber(req.body.pointLat);
  const pointLng = parseNumber(req.body.pointLng);
  const radiusMiles = parseNumber(req.body.radiusMiles);

  if (
    centerLat === null ||
    centerLng === null ||
    pointLat === null ||
    pointLng === null ||
    radiusMiles === null
  ) {
    res.status(400).json({
      ok: false,
      error:
        "Invalid input. Expected numeric centerLat, centerLng, pointLat, pointLng, and radiusMiles."
    });
    return;
  }

  if (radiusMiles <= 0) {
    res.status(400).json({
      ok: false,
      error: "radiusMiles must be greater than 0."
    });
    return;
  }

  const distanceMiles = haversineMiles(centerLat, centerLng, pointLat, pointLng);
  const insideGeofence = distanceMiles <= radiusMiles;

  res.json({
    ok: true,
    insideGeofence,
    distanceMiles: Number(distanceMiles.toFixed(6)),
    radiusMiles,
    center: { lat: centerLat, lng: centerLng },
    point: { lat: pointLat, lng: pointLng }
  });
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Route not found." });
});

let server;

async function startServer() {
  if (hasDatabase()) {
    try {
      await ensureInfrastructure();
      console.log("DSP infrastructure ready (Postgres migrations + pilot seed).");
    } catch (error) {
      console.error("Failed to initialize DSP infrastructure:", error.message || error);
    }
  } else {
    console.log("DATABASE_URL not configured; DSP ingest/qualification endpoints are disabled.");
  }

  server = app.listen(port, () => {
    console.log(`trd-geofence-api listening on port ${port}`);
    startGoogleAdsAutoSyncScheduler();
  });
}

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down.`);

  if (googleAdsAutoSyncTimer) {
    clearInterval(googleAdsAutoSyncTimer);
    googleAdsAutoSyncTimer = null;
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await Promise.allSettled([closeQueues(), closeDatabase()]);
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => process.exit(1));
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => process.exit(1));
});

startServer().catch((error) => {
  console.error("Server startup failure:", error.message || error);
  process.exit(1);
});
