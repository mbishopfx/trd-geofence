function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const earthRadiusMiles = 3958.8;
  const latDistance = toRadians(lat2 - lat1);
  const lngDistance = toRadians(lng2 - lng1);
  const a =
    Math.sin(latDistance / 2) * Math.sin(latDistance / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(lngDistance / 2) *
      Math.sin(lngDistance / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  const x = Number(point.lng);
  const y = Number(point.lat);
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i].lng);
    const yi = Number(polygon[i].lat);
    const xj = Number(polygon[j].lng);
    const yj = Number(polygon[j].lat);

    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

module.exports = {
  haversineMiles,
  pointInPolygon,
  median
};
