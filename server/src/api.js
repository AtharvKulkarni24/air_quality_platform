import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./db/pool.js";
import { calculateStationAQI, getAQICategory } from "./utils/aqi.js";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, "../../web");

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json());
app.use(express.static(webDir));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[API] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// --------------------------------------------------------------------------
// 1. Root & System Health Endpoints
// --------------------------------------------------------------------------

app.get("/api", (req, res) => {
  res.json({
    name: "Air Quality Streaming & Analytics API",
    version: "1.0.0",
    status: "online",
    documentation: "/api/status",
    endpoints: [
      "/api/health",
      "/api/status",
      "/api/stations",
      "/api/stations/:id",
      "/api/stations/:id/aqi",
      "/api/stations/:id/trend-and-forecast",
      "/api/aqi/summary",
      "/api/readings/latest",
      "/api/readings/history",
      "/api/readings/forecast",
      "/api/checkpoints",
    ],
  });
});

app.get("/api/health", async (req, res) => {
  try {
    const dbCheck = await pool.query("SELECT NOW() AS current_time");
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        serverTime: dbCheck.rows[0].current_time,
      },
    });
  } catch (err) {
    res.status(503).json({
      status: "error",
      database: {
        connected: false,
        error: err.message,
      },
    });
  }
});

app.get("/api/status", async (req, res, next) => {
  try {
    const [countsRes, checkpointsRes, parametersRes] = await Promise.all([
      pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM locations) AS total_locations,
          (SELECT COUNT(*) FROM sensors) AS total_sensors,
          (SELECT COUNT(*) FROM air_quality_readings) AS total_readings,
          (SELECT COUNT(*) FROM air_quality_readings WHERE measurement_type = 'forecast') AS total_forecasts
      `),
      pool.query(`SELECT * FROM ingestion_checkpoints`),
      pool.query(`
        SELECT s.parameter, s.unit, COUNT(r.id) AS count
        FROM sensors s
        JOIN air_quality_readings r ON r.sensor_id = s.id
        GROUP BY s.parameter, s.unit
        ORDER BY count DESC
      `),
    ]);

    res.json({
      metrics: countsRes.rows[0],
      checkpoints: checkpointsRes.rows,
      parameters: parametersRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 2. Monitoring Stations / Locations Endpoints
// --------------------------------------------------------------------------

app.get("/api/stations", async (req, res, next) => {
  try {
    const { city } = req.query;
    let query = `
      SELECT 
        l.id,
        l.source,
        l.external_location_id,
        l.name,
        l.city,
        l.state,
        l.country_code,
        l.latitude,
        l.longitude,
        l.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', s.id,
              'parameter', s.parameter,
              'unit', s.unit,
              'external_sensor_id', s.external_sensor_id
            )
          ) FILTER (WHERE s.id IS NOT NULL), '[]'
        ) AS sensors
      FROM locations l
      LEFT JOIN sensors s ON s.location_id = l.id
    `;

    const values = [];
    if (city) {
      query += ` WHERE l.city ILIKE $1`;
      values.push(`%${city}%`);
    }

    query += ` GROUP BY l.id ORDER BY l.name ASC`;

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/stations/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      SELECT 
        l.id,
        l.source,
        l.external_location_id,
        l.name,
        l.city,
        l.state,
        l.country_code,
        l.latitude,
        l.longitude,
        l.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', s.id,
              'parameter', s.parameter,
              'unit', s.unit,
              'external_sensor_id', s.external_sensor_id
            )
          ) FILTER (WHERE s.id IS NOT NULL), '[]'
        ) AS sensors
      FROM locations l
      LEFT JOIN sensors s ON s.location_id = l.id
      WHERE l.id = $1
      GROUP BY l.id
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Station not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 3. Real-Time Air Quality Index (AQI) Endpoints
// --------------------------------------------------------------------------

app.get("/api/aqi/summary", async (req, res, next) => {
  try {
    const rawCity = typeof req.query.city === "string" ? req.query.city.trim() : "";
    const isAllRegions = !rawCity || rawCity.toLowerCase() === "all" || rawCity.toLowerCase() === "all regions";
    const selectedCity = isAllRegions ? "All Regions" : rawCity;

    // Query latest observed reading per sensor (optionally filtered by city)
    let readingsQuery = `
      SELECT DISTINCT ON (s.id)
        l.id AS station_id,
        l.name AS station_name,
        l.city,
        l.latitude,
        l.longitude,
        s.parameter AS pollutant,
        s.unit,
        r.value,
        r.observed_at
      FROM locations l
      JOIN sensors s ON s.location_id = l.id
      JOIN air_quality_readings r ON r.sensor_id = s.id
      WHERE r.measurement_type = 'observed'
    `;

    const values = [];
    if (!isAllRegions) {
      readingsQuery += ` AND l.city ILIKE $1`;
      values.push(`%${rawCity}%`);
    }

    readingsQuery += ` ORDER BY s.id, r.observed_at DESC`;

    const result = await pool.query(readingsQuery, values);

    if (result.rows.length === 0) {
      return res.json({
        city: selectedCity,
        status: "No active station data found",
        stationsCount: 0,
        stations: [],
      });
    }

    // Group by station
    const stationsMap = new Map();
    for (const row of result.rows) {
      if (!stationsMap.has(row.station_id)) {
        stationsMap.set(row.station_id, {
          id: row.station_id,
          name: row.station_name,
          city: row.city,
          latitude: row.latitude,
          longitude: row.longitude,
          readings: [],
        });
      }
      stationsMap.get(row.station_id).readings.push({
        pollutant: row.pollutant,
        value: row.value,
        unit: row.unit,
      });
    }

    const stationsAQI = [];
    for (const st of stationsMap.values()) {
      const aqiData = calculateStationAQI(st.readings);
      if (aqiData) {
        stationsAQI.push({
          id: st.id,
          name: st.name,
          city: st.city,
          latitude: st.latitude,
          longitude: st.longitude,
          ...aqiData,
        });
      }
    }

    stationsAQI.sort((a, b) => b.aqi - a.aqi);

    if (stationsAQI.length === 0) {
      return res.json({ city, stationsCount: 0, stations: [] });
    }

    const aqiValues = stationsAQI.map((s) => s.aqi);
    const avgAQI = Math.round(aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length);
    const maxAQI = Math.max(...aqiValues);
    const cityCategory = getAQICategory(avgAQI);

    // Dominant cause
    const causeCounts = {};
    for (const s of stationsAQI) {
      causeCounts[s.dominantPollutant] = (causeCounts[s.dominantPollutant] || 0) + 1;
    }
    const primaryDominant = Object.keys(causeCounts).reduce((a, b) =>
      causeCounts[a] > causeCounts[b] ? a : b
    );

    res.json({
      city: selectedCity,
      stationsCount: stationsAQI.length,
      averageAQI: avgAQI,
      peakAQI: maxAQI,
      category: cityCategory.name,
      color: cityCategory.color,
      healthAdvisory: cityCategory.advisory,
      primaryDominantPollutant: primaryDominant,
      stations: stationsAQI,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/stations/:id/aqi", async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT DISTINCT ON (s.id)
        l.id AS station_id,
        l.name AS station_name,
        l.city,
        l.latitude,
        l.longitude,
        s.parameter AS pollutant,
        s.unit,
        r.value,
        r.observed_at
      FROM locations l
      JOIN sensors s ON s.location_id = l.id
      JOIN air_quality_readings r ON r.sensor_id = s.id
      WHERE l.id = $1
        AND r.measurement_type = 'observed'
      ORDER BY s.id, r.observed_at DESC
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Station has no observed readings" });
    }

    const st = result.rows[0];
    const readings = result.rows.map((r) => ({
      pollutant: r.pollutant,
      value: r.value,
      unit: r.unit,
    }));

    const aqiData = calculateStationAQI(readings);
    if (!aqiData) {
      return res.status(422).json({ error: "Insufficient pollutant data to compute AQI" });
    }

    res.json({
      stationId: st.station_id,
      stationName: st.station_name,
      city: st.city,
      latitude: st.latitude,
      longitude: st.longitude,
      ...aqiData,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 4. Telemetry & Time-Series History Endpoints
// --------------------------------------------------------------------------

app.get("/api/readings/latest", async (req, res, next) => {
  try {
    const { stationId, city } = req.query;

    let query = `
      SELECT DISTINCT ON (s.id)
        l.id AS station_id,
        l.name AS station_name,
        l.city,
        l.latitude,
        l.longitude,
        s.id AS sensor_id,
        s.parameter AS pollutant,
        s.unit,
        r.value,
        r.observed_at,
        r.measurement_type
      FROM locations l
      JOIN sensors s ON s.location_id = l.id
      JOIN air_quality_readings r ON r.sensor_id = s.id
      WHERE 1=1
    `;

    const values = [];
    if (stationId) {
      values.push(stationId);
      query += ` AND l.id = $${values.length}`;
    }
    if (city) {
      values.push(`%${city}%`);
      query += ` AND l.city ILIKE $${values.length}`;
    }

    query += ` ORDER BY s.id, r.observed_at DESC`;

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/readings/history", async (req, res, next) => {
  try {
    const stationId = req.query.stationId;
    const pollutant = (req.query.pollutant || "pm25").toLowerCase().trim();
    const limit = Math.min(Number(req.query.limit || 50), 200);

    if (!stationId) {
      return res.status(400).json({ error: "Query parameter 'stationId' is required" });
    }

    const result = await pool.query(
      `
      SELECT 
        r.id,
        r.observed_at,
        r.value,
        r.unit,
        s.parameter AS pollutant
      FROM air_quality_readings r
      JOIN sensors s ON r.sensor_id = s.id
      WHERE s.location_id = $1
        AND s.parameter = $2
        AND r.measurement_type = 'observed'
      ORDER BY r.observed_at DESC
      LIMIT $3
    `,
      [stationId, pollutant, limit]
    );

    // Return in chronological order for charting
    const points = result.rows.reverse();

    res.json({
      stationId: Number(stationId),
      pollutant,
      count: points.length,
      points,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 5. Machine Learning Forecasts & Trends Endpoints
// --------------------------------------------------------------------------

app.get("/api/readings/forecast", async (req, res, next) => {
  try {
    const stationId = req.query.stationId;
    const pollutant = (req.query.pollutant || "pm25").toLowerCase().trim();
    const limit = Math.min(Number(req.query.limit || 24), 48);

    if (!stationId) {
      return res.status(400).json({ error: "Query parameter 'stationId' is required" });
    }

    const result = await pool.query(
      `
      SELECT 
        r.id,
        r.observed_at AS forecast_at,
        r.value AS predicted_value,
        r.unit,
        s.parameter AS pollutant,
        r.data_mode
      FROM air_quality_readings r
      JOIN sensors s ON r.sensor_id = s.id
      WHERE s.location_id = $1
        AND s.parameter = $2
        AND r.measurement_type = 'forecast'
      ORDER BY r.observed_at ASC
      LIMIT $3
    `,
      [stationId, pollutant, limit]
    );

    res.json({
      stationId: Number(stationId),
      pollutant,
      count: result.rows.length,
      forecasts: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Unified endpoint for frontend visualization charts:
 * Returns the recent actual observations AND the ML forecasts.
 */
app.get("/api/stations/:id/trend-and-forecast", async (req, res, next) => {
  try {
    const { id } = req.params;
    const pollutant = (req.query.pollutant || "pm25").toLowerCase().trim();

    const [stationRes, historyRes, forecastRes] = await Promise.all([
      pool.query(`SELECT id, name, city, latitude, longitude FROM locations WHERE id = $1`, [id]),
      pool.query(
        `
        SELECT 
          r.observed_at,
          r.value,
          r.unit
        FROM air_quality_readings r
        JOIN sensors s ON r.sensor_id = s.id
        WHERE s.location_id = $1
          AND s.parameter = $2
          AND r.measurement_type = 'observed'
        ORDER BY r.observed_at DESC
        LIMIT 24
      `,
        [id, pollutant]
      ),
      pool.query(
        `
        SELECT 
          r.observed_at AS forecast_at,
          r.value AS predicted_value,
          r.unit
        FROM air_quality_readings r
        JOIN sensors s ON r.sensor_id = s.id
        WHERE s.location_id = $1
          AND s.parameter = $2
          AND r.measurement_type = 'forecast'
        ORDER BY r.observed_at ASC
        LIMIT 24
      `,
        [id, pollutant]
      ),
    ]);

    if (stationRes.rows.length === 0) {
      return res.status(404).json({ error: "Station not found" });
    }

    const observedPoints = historyRes.rows.reverse();

    res.json({
      station: stationRes.rows[0],
      pollutant,
      observed: {
        count: observedPoints.length,
        points: observedPoints,
      },
      forecast: {
        count: forecastRes.rows.length,
        points: forecastRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 6. Advanced Analytics & Environmental Intelligence Endpoints
// --------------------------------------------------------------------------

app.get("/api/analytics/insights", async (req, res, next) => {
  try {
    const rawCity = typeof req.query.city === "string" ? req.query.city.trim() : "";
    const isAllRegions = !rawCity || rawCity.toLowerCase() === "all" || rawCity.toLowerCase() === "all regions";
    const selectedCity = isAllRegions ? "All Regions" : rawCity;

    let cityClause = "";
    const params = [];
    if (!isAllRegions) {
      cityClause = " AND l.city ILIKE $1";
      params.push(`%${rawCity}%`);
    }

    const criteriaQuery = `
      SELECT 
        s.parameter,
        s.unit,
        AVG(r.value)::numeric(10,2) AS average_value,
        MAX(r.value)::numeric(10,2) AS peak_value
      FROM locations l
      JOIN sensors s ON s.location_id = l.id
      JOIN air_quality_readings r ON r.sensor_id = s.id
      WHERE r.measurement_type = 'observed'
        AND r.observed_at >= NOW() - INTERVAL '24 hours'
        ${cityClause}
      GROUP BY s.parameter, s.unit
    `;

    const stationStatsQuery = `
      SELECT 
        COUNT(DISTINCT l.id) AS station_count,
        COUNT(DISTINCT s.id) AS sensor_count,
        COUNT(r.id) FILTER (WHERE r.measurement_type = 'forecast') AS forecast_count
      FROM locations l
      JOIN sensors s ON s.location_id = l.id
      LEFT JOIN air_quality_readings r ON r.sensor_id = s.id
      WHERE 1=1 ${cityClause}
    `;

    const [criteriaRes, statsRes] = await Promise.all([
      pool.query(criteriaQuery, params),
      pool.query(stationStatsQuery, params),
    ]);

    const CPCB_STANDARDS = {
      pm25: { limit: 60, unit: "µg/m³", name: "Fine Particulate (PM2.5)" },
      pm10: { limit: 100, unit: "µg/m³", name: "Inhalable Coarse (PM10)" },
      no2: { limit: 80, unit: "µg/m³", name: "Nitrogen Dioxide (NO2)" },
      so2: { limit: 80, unit: "µg/m³", name: "Sulfur Dioxide (SO2)" },
      co: { limit: 2.0, unit: "mg/m³", name: "Carbon Monoxide (CO)" },
      o3: { limit: 100, unit: "µg/m³", name: "Surface Ozone (O3)" },
    };

    const criteriaBreakdown = [];
    let windSpeed = 3.0;
    let temperature = 27.0;

    for (const row of criteriaRes.rows) {
      const p = row.parameter.toLowerCase();
      const avgVal = parseFloat(row.average_value);
      const peakVal = parseFloat(row.peak_value);

      if (p === "wind_speed") windSpeed = avgVal;
      if (p === "temperature") temperature = avgVal;

      if (CPCB_STANDARDS[p]) {
        const std = CPCB_STANDARDS[p].limit;
        const ratio = parseFloat((avgVal / std).toFixed(2));
        let status = "Safe";
        let statusColor = "#10b981";

        if (ratio > 2.0) {
          status = "Severe Exceedance";
          statusColor = "#ef4444";
        } else if (ratio > 1.0) {
          status = "Exceeds Standard";
          statusColor = "#f97316";
        } else if (ratio > 0.75) {
          status = "Moderate";
          statusColor = "#f59e0b";
        }

        criteriaBreakdown.push({
          pollutant: p,
          name: CPCB_STANDARDS[p].name,
          currentAverage: avgVal,
          peakValue: peakVal,
          unit: row.unit,
          cpcbLimit: std,
          ratioToLimit: ratio,
          percentOfLimit: Math.round(ratio * 100),
          status,
          statusColor,
        });
      }
    }

    let dispersionCategory = "Moderate Clearance";
    let dispersionDesc = "Moderate winds allowing steady atmospheric pollutant mixing.";
    let dispersionColor = "#f59e0b";

    if (windSpeed >= 4.0) {
      dispersionCategory = "High Marine Flushing";
      dispersionDesc = "Strong atmospheric boundary ventilation dispersing surface particulates rapidly.";
      dispersionColor = "#10b981";
    } else if (windSpeed < 2.0) {
      dispersionCategory = "Thermal Stagnation";
      dispersionDesc = "Low wind velocity causing ground-level thermal entrapment of emissions.";
      dispersionColor = "#ef4444";
    }

    res.json({
      city: selectedCity,
      stationCount: Number(statsRes.rows[0]?.station_count || 0),
      sensorCount: Number(statsRes.rows[0]?.sensor_count || 0),
      forecastCount: Number(statsRes.rows[0]?.forecast_count || 0),
      criteriaPollutants: criteriaBreakdown,
      meteorology: {
        windSpeed,
        temperature,
        dispersionCategory,
        dispersionDesc,
        dispersionColor,
      },
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/analytics/cross-city", async (req, res, next) => {
  try {
    const cities = ["Pune", "Mumbai", "Delhi"];
    const results = [];

    for (const city of cities) {
      const summaryRes = await pool.query(
        `
        SELECT 
          l.city,
          COUNT(DISTINCT l.id) AS station_count,
          AVG(CASE WHEN s.parameter = 'pm25' THEN r.value END)::numeric(10,1) AS avg_pm25,
          AVG(CASE WHEN s.parameter = 'pm10' THEN r.value END)::numeric(10,1) AS avg_pm10,
          AVG(CASE WHEN s.parameter = 'wind_speed' THEN r.value END)::numeric(10,1) AS avg_wind,
          AVG(CASE WHEN s.parameter = 'temperature' THEN r.value END)::numeric(10,1) AS avg_temp,
          AVG(CASE WHEN s.parameter = 'relativehumidity' THEN r.value END)::numeric(10,1) AS avg_humidity
        FROM locations l
        JOIN sensors s ON s.location_id = l.id
        JOIN air_quality_readings r ON r.sensor_id = s.id
        WHERE l.city = $1
          AND r.measurement_type = 'observed'
          AND r.observed_at >= NOW() - INTERVAL '24 hours'
        GROUP BY l.city
      `,
        [city]
      );

      if (summaryRes.rows.length > 0) {
        const row = summaryRes.rows[0];
        results.push({
          city: row.city,
          stations: Number(row.station_count),
          avgPm25: parseFloat(row.avg_pm25 || 0),
          avgPm10: parseFloat(row.avg_pm10 || 0),
          windSpeed: parseFloat(row.avg_wind || 0),
          temperature: parseFloat(row.avg_temp || 0),
          humidity: parseFloat(row.avg_humidity || 0),
        });
      }
    }

    res.json(results);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 7. Ingestion Checkpoints
// --------------------------------------------------------------------------

app.get("/api/checkpoints", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT source, stream_key, status, last_success_at, last_cursor, error_message, updated_at FROM ingestion_checkpoints`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 7. Sensor Anomaly Detection Endpoint
// --------------------------------------------------------------------------

app.get("/api/anomalies", async (req, res, next) => {
  try {
    const hours = Number(req.query.hours || 48);
    const query = `
      SELECT 
        s.id AS sensor_id,
        s.external_sensor_id,
        s.parameter AS pollutant,
        s.unit,
        l.name AS station_name,
        l.city,
        r.value,
        r.observed_at
      FROM air_quality_readings r
      JOIN sensors s ON r.sensor_id = s.id
      JOIN locations l ON s.location_id = l.id
      WHERE r.measurement_type = 'observed'
        AND r.observed_at >= NOW() - ($1 || ' hours')::interval
      ORDER BY s.id, r.observed_at ASC
    `;
    const result = await pool.query(query, [hours]);

    const sensorMap = new Map();
    for (const row of result.rows) {
      if (!sensorMap.has(row.sensor_id)) {
        sensorMap.set(row.sensor_id, []);
      }
      sensorMap.get(row.sensor_id).push(row);
    }

    const alerts = [];
    const extremeLimits = { pm25: 1200, pm10: 2000, o3: 800, no2: 600, temperature: 55 };

    for (const [sensorId, readings] of sensorMap.entries()) {
      if (readings.length < 3) continue;
      const latest = readings[readings.length - 1];
      const pollutant = (latest.pollutant || "").toLowerCase();
      const val = parseFloat(latest.value);

      if (extremeLimits[pollutant] && val > extremeLimits[pollutant]) {
        alerts.push({
          sensor_id: sensorId,
          external_sensor_id: latest.external_sensor_id,
          station_name: latest.station_name,
          pollutant,
          anomaly_type: "OUT_OF_BOUNDS",
          severity: "CRITICAL",
          value: val,
          message: `Value ${val} exceeds physical limit of ${extremeLimits[pollutant]}`,
          timestamp: latest.observed_at,
        });
      }

      if (readings.length >= 5) {
        const last5 = readings.slice(-5).map((r) => parseFloat(r.value));
        if (last5.every((v) => v === last5[0] && v > 0)) {
          alerts.push({
            sensor_id: sensorId,
            external_sensor_id: latest.external_sensor_id,
            station_name: latest.station_name,
            pollutant,
            anomaly_type: "FLATLINE",
            severity: "WARNING",
            value: val,
            message: `Sensor reported identical value ${val} across 5 consecutive intervals`,
            timestamp: latest.observed_at,
          });
        }
      }
    }

    res.json({
      status: alerts.length === 0 ? "nominal" : "alerts_detected",
      totalMonitoredSensors: sensorMap.size,
      activeAnomalies: alerts.length,
      alerts,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 7. Error Handling & 404
// --------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.use((err, req, res, next) => {
  console.error("[API Error]", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Air Quality REST API is running on http://localhost:${PORT}`);
  console.log(` Health check: http://localhost:${PORT}/api/health`);
  console.log(` AQI Summary : http://localhost:${PORT}/api/aqi/summary`);
  console.log(` Stations    : http://localhost:${PORT}/api/stations`);
  console.log(`=======================================================`);
});

export default app;
