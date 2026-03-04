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
          callback(new Error("Origin is not allowed by CORS policy"));
        }
      };

app.use(cors(corsOptions));
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "trd-geofence-api",
    docs: {
      health: "/api/health",
      geofenceCheck: "/api/geofence/check"
    }
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "trd-geofence-api",
    timestamp: new Date().toISOString()
  });
});

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

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

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

app.listen(port, () => {
  console.log(`trd-geofence-api listening on port ${port}`);
});
