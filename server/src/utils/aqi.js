/**
 * Air Quality Index (AQI) Calculation Utility.
 * Implements Indian National AQI (CPCB) piece-wise linear interpolation.
 */

export const CPCB_CATEGORIES = [
  { name: "Good", min: 0, max: 50, color: "#00E400", advisory: "Air quality is good. Minimal health impact." },
  { name: "Satisfactory", min: 51, max: 100, color: "#92D050", advisory: "Minor breathing discomfort to sensitive people." },
  { name: "Moderate", min: 101, max: 200, color: "#FFFF00", advisory: "Breathing discomfort for people with asthma and heart conditions." },
  { name: "Poor", min: 201, max: 300, color: "#FF7E00", advisory: "Breathing discomfort to most people on prolonged exposure." },
  { name: "Very Poor", min: 301, max: 400, color: "#FF0000", advisory: "Respiratory illness on prolonged exposure." },
  { name: "Severe", min: 401, max: 500, color: "#7E0023", advisory: "Affects healthy people and seriously impacts those with existing diseases." },
];

export const CPCB_BREAKPOINTS = {
  pm25: [
    [0.0, 30.0, 0, 50],
    [31.0, 60.0, 51, 100],
    [61.0, 90.0, 101, 200],
    [91.0, 120.0, 201, 300],
    [121.0, 250.0, 301, 400],
    [251.0, 500.0, 401, 500],
  ],
  pm10: [
    [0.0, 50.0, 0, 50],
    [51.0, 100.0, 51, 100],
    [101.0, 250.0, 101, 200],
    [251.0, 350.0, 201, 300],
    [351.0, 430.0, 301, 400],
    [431.0, 600.0, 401, 500],
  ],
  no2: [
    [0.0, 40.0, 0, 50],
    [41.0, 80.0, 51, 100],
    [81.0, 180.0, 101, 200],
    [181.0, 280.0, 201, 300],
    [281.0, 400.0, 301, 400],
    [401.0, 500.0, 401, 500],
  ],
  so2: [
    [0.0, 40.0, 0, 50],
    [41.0, 80.0, 51, 100],
    [81.0, 380.0, 101, 200],
    [381.0, 800.0, 201, 300],
    [801.0, 1600.0, 301, 400],
    [1601.0, 2000.0, 401, 500],
  ],
  co: [
    [0.0, 1.0, 0, 50],
    [1.1, 2.0, 51, 100],
    [2.1, 10.0, 101, 200],
    [10.1, 17.0, 201, 300],
    [17.1, 34.0, 301, 400],
    [34.1, 50.0, 401, 500],
  ],
  o3: [
    [0.0, 50.0, 0, 50],
    [51.0, 100.0, 51, 100],
    [101.0, 168.0, 101, 200],
    [169.0, 208.0, 201, 300],
    [209.0, 748.0, 301, 400],
    [749.0, 1000.0, 401, 500],
  ],
};

/**
 * Standardize units for AQI calculation.
 */
export function normalizeUnit(pollutant, value, unit = "") {
  const p = pollutant.toLowerCase().trim();
  const u = unit.toLowerCase().trim();

  if (p === "no2") {
    if (u === "ppb") return value * 1.88;
    if (u === "ppm") return value * 1880.0;
    return value;
  }
  if (p === "so2") {
    if (u === "ppb") return value * 2.62;
    if (u === "ppm") return value * 2620.0;
    return value;
  }
  if (p === "o3") {
    if (u === "ppb") return value * 1.96;
    if (u === "ppm") return value * 1960.0;
    return value;
  }
  if (p === "co") {
    if (u === "µg/m³" || u === "ug/m3") return value / 1000.0;
    if (u === "ppb") return (value * 1.15) / 1000.0;
    if (u === "ppm") return value * 1.15;
    return value;
  }

  return value;
}

/**
 * Compute sub-index for a single pollutant.
 */
export function calculateSubIndex(pollutant, value, unit = "") {
  const p = pollutant.toLowerCase().trim();
  const breakpoints = CPCB_BREAKPOINTS[p];
  if (!breakpoints || value === null || value === undefined || value < 0) {
    return null;
  }

  const normalized = normalizeUnit(p, Number(value), unit);

  for (const [bLo, bHi, iLo, iHi] of breakpoints) {
    if (normalized >= bLo && normalized <= bHi) {
      return Math.round(((iHi - iLo) / (bHi - bLo)) * (normalized - bLo) + iLo);
    }
  }

  const maxBp = breakpoints[breakpoints.length - 1];
  if (normalized > maxBp[1]) {
    return 500;
  }

  return null;
}

/**
 * Get category, color, and advisory from an AQI score.
 */
export function getAQICategory(aqi) {
  for (const cat of CPCB_CATEGORIES) {
    if (aqi >= cat.min && aqi <= cat.max) {
      return cat;
    }
  }
  return aqi > 500 ? CPCB_CATEGORIES[CPCB_CATEGORIES.length - 1] : CPCB_CATEGORIES[0];
}

/**
 * Calculate station AQI from a list of readings: [{ pollutant, value, unit }]
 */
export function calculateStationAQI(readings = []) {
  const subIndices = {};
  const rawValues = {};

  for (const r of readings) {
    const p = (r.pollutant || "").toLowerCase().trim();
    if (!CPCB_BREAKPOINTS[p] || r.value === null || r.value === undefined) continue;

    const sub = calculateSubIndex(p, r.value, r.unit);
    if (sub !== null) {
      subIndices[p] = sub;
      rawValues[p] = { value: Number(r.value), unit: r.unit };
    }
  }

  const pollutants = Object.keys(subIndices);
  if (pollutants.length === 0) return null;

  let dominant = pollutants[0];
  let maxAQI = subIndices[dominant];

  for (const p of pollutants) {
    if (subIndices[p] > maxAQI) {
      maxAQI = subIndices[p];
      dominant = p;
    }
  }

  const category = getAQICategory(maxAQI);

  return {
    aqi: maxAQI,
    dominantPollutant: dominant,
    category: category.name,
    color: category.color,
    healthAdvisory: category.advisory,
    subIndices,
    rawValues,
  };
}
