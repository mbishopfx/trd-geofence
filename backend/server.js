const crypto = require("crypto");
const express = require("express");
const cors = require("cors");

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
    "Dealership geo-conquest + home-fencing campaigns focused on real-time impressions/clicks with 14-30 day retargeting.",
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
      id: "nissan-city-red-bank",
      dealershipName: "Nissan City Red Bank NJ",
      address: "120 Newman Springs Rd, Red Bank, NJ 07701",
      coordinates: { lat: 40.355, lng: -74.075 },
      requiredCompetitorCount: 4,
      competitorSuggestions: [
        { name: "Pine Belt Nissan of Toms River", address: "TBD with Jeffrey" },
        { name: "Sansone 66 Nissan", address: "TBD with Jeffrey" },
        { name: "Circle Hyundai", address: "TBD with Jeffrey" },
        { name: "Schwartz Mazda", address: "TBD with Jeffrey" }
      ]
    },
    {
      id: "jeep-city-greenwich",
      dealershipName: "Jeep City / Chrysler Dodge Jeep RAM City Greenwich CT",
      address: "631 W. Putnam Ave, Greenwich, CT 06830",
      coordinates: { lat: 41.017, lng: -73.637 },
      requiredCompetitorCount: 1,
      competitorSuggestions: [{ name: "Competitor TBD", address: "TBD with Jeffrey" }]
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

  return {
    id: createId(`fence${index + 1}`),
    type: fence.type === "competitor" ? "competitor" : "home",
    locationName: String(fence.locationName || "Unnamed Fence"),
    address: String(fence.address || ""),
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
      geofenceCheck: "POST /api/geofence/check"
    }
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "trd-geofence-api",
    timestamp: new Date().toISOString(),
    campaigns: campaigns.length
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

app.get("/api/campaigns", (_req, res) => {
  res.json({
    ok: true,
    campaigns
  });
});

app.post("/api/campaigns", (req, res) => {
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

  res.status(201).json({
    ok: true,
    campaign,
    activationChecklist: buildActivationChecklist(campaign)
  });
});

app.post("/api/campaigns/:id/events", (req, res) => {
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
    dashboard: calculateDashboard()
  });
});

app.post("/api/campaigns/:id/simulate", (req, res) => {
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
    dashboard: calculateDashboard()
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

app.get("/api/dashboard", (_req, res) => {
  res.json({
    ok: true,
    dashboard: calculateDashboard(),
    campaigns
  });
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

app.listen(port, () => {
  console.log(`trd-geofence-api listening on port ${port}`);
});
