import "dotenv/config";
import axios from "axios";
import { createHash } from "node:crypto";
import { Kafka } from "kafkajs";
import { pool } from "../db/pool.js";

const API_BASE_URL = "https://api.openaq.org/v3";
const SOURCE = "openaq";
const STREAM_KEY = process.env.OPENAQ_STREAM_KEY || "pune-region";
const POLL_INTERVAL_SECONDS = Number(process.env.OPENAQ_POLL_INTERVAL_SECONDS || 300);
const REQUEST_DELAY_MS = Number(process.env.OPENAQ_REQUEST_DELAY_MS || 150);
const IS_ONCE = process.argv.includes("--once");

const PARAMETER_CONFIG = {
  // Particulate matter
  pm25: { allowedUnits: new Set(["µg/m³", "ug/m3"]), allowNegative: false },
  pm10: { allowedUnits: new Set(["µg/m³", "ug/m3"]), allowNegative: false },
  bc: { allowedUnits: new Set(["µg/m³", "ug/m3"]), allowNegative: false },

  // Gaseous pollutants
  o3: { allowedUnits: new Set(["µg/m³", "ug/m3", "ppb", "ppm"]), allowNegative: false },
  no2: { allowedUnits: new Set(["µg/m³", "ug/m3", "ppb", "ppm"]), allowNegative: false },
  so2: { allowedUnits: new Set(["µg/m³", "ug/m3", "ppb", "ppm"]), allowNegative: false },
  co: { allowedUnits: new Set(["µg/m³", "ug/m3", "mg/m³", "mg/m3", "ppb", "ppm"]), allowNegative: false },
  no: { allowedUnits: new Set(["µg/m³", "ug/m3", "ppb", "ppm"]), allowNegative: false },
  nox: { allowedUnits: new Set(["µg/m³", "ug/m3", "ppb", "ppm"]), allowNegative: false },

  // Meteorological factors
  temperature: { allowedUnits: new Set(["c", "°c", "f"]), allowNegative: true },
  relativehumidity: { allowedUnits: new Set(["%"]), allowNegative: false },
  wind_speed: { allowedUnits: new Set(["m/s", "km/h", "knots"]), allowNegative: false },
  wind_direction: { allowedUnits: new Set(["deg", "°"]), allowNegative: false },
};

const SUPPORTED_PARAMETERS = new Set(Object.keys(PARAMETER_CONFIG));

const apiKey = process.env.OPENAQ_API_KEY;
if (!apiKey) {
  throw new Error("OPENAQ_API_KEY is not set in the server .env file");
}

const http = axios.create({
  baseURL: API_BASE_URL,
  headers: { "X-API-Key": apiKey },
  timeout: 15000,
});

const kafka = new Kafka({
  clientId: "air-quality-openaq-producer",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In-memory cache of sensorId -> latest observedAt timestamp
const lastSeenBySensor = new Map();

let isRunning = true;

function handleShutdown(signal) {
  if (!isRunning) return;
  console.log(`\n[OpenAQ Poller] Received ${signal}. Gracefully stopping...`);
  isRunning = false;
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

async function interruptibleSleep(seconds) {
  const end = Date.now() + seconds * 1000;
  while (isRunning && Date.now() < end) {
    await sleep(500);
  }
}

function createEventId(sensorId, observedAt) {
  return createHash("sha256")
    .update(`${SOURCE}:${sensorId}:${observedAt}`)
    .digest("hex")
    .slice(0, 32);
}

function toReading(location, sensor, measurement) {
  const pollutant = sensor.parameter?.name?.toLowerCase();
  const config = PARAMETER_CONFIG[pollutant];

  if (!config) {
    return null;
  }

  const rawUnit = sensor.parameter?.units ?? "";
  const normalizedUnit = rawUnit.trim().toLowerCase();
  const isUnitAllowed =
    config.allowedUnits.has(rawUnit) || config.allowedUnits.has(normalizedUnit);

  if (!isUnitAllowed) {
    return null;
  }

  const observedAt = measurement.datetime?.utc;
  const value = measurement.value;

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (!config.allowNegative && value < 0) ||
    !Number.isFinite(Date.parse(observedAt))
  ) {
    return null;
  }

  const locationId = String(location.id);
  const sensorId = String(sensor.id);

  return {
    eventId: createEventId(sensorId, observedAt),
    source: SOURCE,
    locationId,
    sensorId,
    locationName: location.name || `OpenAQ location ${locationId}`,
    city: location.locality || process.env.OPENAQ_CITY || "Pune",
    state: null,
    countryCode: location.country?.code || "IN",
    pollutant,
    value,
    unit: rawUnit,
    observedAt,
    dataMode: "observed",
    measurementType: "observed",
  };
}

/**
 * Pre-populate sensor timestamps from the database to avoid re-publishing known readings on restart.
 */
async function loadCheckpointsFromDb() {
  try {
    const res = await pool.query(
      `SELECT s.external_sensor_id, MAX(r.observed_at) AS last_observed
       FROM air_quality_readings r
       JOIN sensors s ON r.sensor_id = s.id
       WHERE s.source = $1
       GROUP BY s.external_sensor_id`,
      [SOURCE]
    );

    for (const row of res.rows) {
      if (row.last_observed) {
        lastSeenBySensor.set(row.external_sensor_id, new Date(row.last_observed).toISOString());
      }
    }

    console.log(`[Checkpoint] Pre-loaded ${lastSeenBySensor.size} sensor timestamps from database.`);
  } catch (err) {
    console.warn(`[Checkpoint] Could not load prior readings from DB: ${err.message}`);
  }
}

/**
 * Update the ingestion_checkpoints table status in PostgreSQL.
 */
async function updateCheckpoint(status, { lastCursor = null, errorMessage = null } = {}) {
  try {
    if (status === "running") {
      await pool.query(
        `INSERT INTO ingestion_checkpoints (source, stream_key, status, error_message, updated_at)
         VALUES ($1, $2, 'running', NULL, NOW())
         ON CONFLICT (source, stream_key) DO UPDATE SET
           status = 'running',
           error_message = NULL,
           updated_at = NOW()`,
        [SOURCE, STREAM_KEY]
      );
    } else if (status === "idle") {
      await pool.query(
        `INSERT INTO ingestion_checkpoints (source, stream_key, last_success_at, last_cursor, status, error_message, updated_at)
         VALUES ($1, $2, NOW(), $3, 'idle', NULL, NOW())
         ON CONFLICT (source, stream_key) DO UPDATE SET
           last_success_at = NOW(),
           last_cursor = COALESCE($3, ingestion_checkpoints.last_cursor),
           status = 'idle',
           error_message = NULL,
           updated_at = NOW()`,
        [SOURCE, STREAM_KEY, lastCursor]
      );
    } else if (status === "error") {
      await pool.query(
        `INSERT INTO ingestion_checkpoints (source, stream_key, status, error_message, updated_at)
         VALUES ($1, $2, 'error', $3, NOW())
         ON CONFLICT (source, stream_key) DO UPDATE SET
           status = 'error',
           error_message = $3,
           updated_at = NOW()`,
        [SOURCE, STREAM_KEY, errorMessage]
      );
    }
  } catch (err) {
    console.warn(`[Checkpoint] Failed to update checkpoint table: ${err.message}`);
  }
}

async function fetchOpenAqReadings() {
  const response = await http.get("/locations", {
    params: {
      coordinates: process.env.OPENAQ_COORDINATES || "18.5204,73.8567",
      radius: Number(process.env.OPENAQ_RADIUS_METERS || 25000),
      limit: 100,
    },
  });

  const locations = response.data?.results ?? [];
  const newReadings = [];
  let skippedDuplicates = 0;

  for (const location of locations) {
    if (!isRunning) break;

    const sensors = location.sensors ?? [];
    const supportedSensors = sensors.filter((sensor) =>
      SUPPORTED_PARAMETERS.has(sensor.parameter?.name?.toLowerCase())
    );

    if (supportedSensors.length === 0) {
      continue;
    }

    try {
      const latestResponse = await http.get(`/locations/${location.id}/latest`);
      const measurements = latestResponse.data?.results ?? [];
      const sensorsById = new Map(
        supportedSensors.map((sensor) => [String(sensor.id), sensor])
      );

      for (const measurement of measurements) {
        const sensor = sensorsById.get(String(measurement.sensorsId));
        if (!sensor) continue;

        const reading = toReading(location, sensor, measurement);
        if (!reading) continue;

        // Deduplication check: compare with last known observedAt timestamp
        const lastObserved = lastSeenBySensor.get(reading.sensorId);
        if (lastObserved && new Date(reading.observedAt) <= new Date(lastObserved)) {
          skippedDuplicates++;
          continue;
        }

        newReadings.push(reading);
      }
    } catch (err) {
      if (err.response?.status === 429) {
        const retryAfter = Number(err.response.headers["retry-after"] || 60);
        console.warn(`[OpenAQ Poller] 429 Rate limited on location ${location.id}. Backing off for ${retryAfter}s...`);
        await interruptibleSleep(retryAfter);
      } else {
        console.warn(`[OpenAQ Poller] Error fetching latest for location ${location.id}: ${err.message}`);
      }
    }

    // Gentle throttling to respect API rate limits
    if (REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return { newReadings, skippedDuplicates };
}

async function runPollCycle(producer) {
  const startTime = Date.now();
  console.log(`\n[OpenAQ Poller] [${new Date().toISOString()}] Starting poll cycle...`);

  await updateCheckpoint("running");

  const { newReadings, skippedDuplicates } = await fetchOpenAqReadings();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (newReadings.length === 0) {
    console.log(
      `[OpenAQ Poller] Cycle complete in ${elapsed}s. 0 new readings (${skippedDuplicates} already up-to-date).`
    );
    await updateCheckpoint("idle");
    return;
  }

  // Publish new readings to Kafka
  const result = await producer.send({
    topic: "air-quality.raw",
    messages: newReadings.map((reading) => ({
      key: `${reading.locationId}:${reading.sensorId}`,
      value: JSON.stringify(reading),
    })),
  });

  // Update in-memory last seen timestamps
  let maxObservedAt = null;
  for (const reading of newReadings) {
    lastSeenBySensor.set(reading.sensorId, reading.observedAt);
    if (!maxObservedAt || new Date(reading.observedAt) > new Date(maxObservedAt)) {
      maxObservedAt = reading.observedAt;
    }
  }

  await updateCheckpoint("idle", { lastCursor: maxObservedAt });

  console.log(
    `[OpenAQ Poller] Published ${newReadings.length} new readings (${skippedDuplicates} duplicates skipped) in ${elapsed}s.`
  );
}

async function main() {
  console.log(`====================================================`);
  console.log(`OpenAQ Continuous Ingestion Poller`);
  console.log(`Poll interval: ${POLL_INTERVAL_SECONDS}s | Stream key: ${STREAM_KEY}`);
  console.log(`Mode: ${IS_ONCE ? "Single-shot (--once)" : "Continuous daemon"}`);
  console.log(`====================================================`);

  await loadCheckpointsFromDb();

  const producer = kafka.producer();
  await producer.connect();
  console.log(`[OpenAQ Poller] Connected to Kafka broker.`);

  try {
    while (isRunning) {
      try {
        await runPollCycle(producer);
      } catch (err) {
        console.error(`[OpenAQ Poller] Error during poll cycle:`, err.message);
        await updateCheckpoint("error", { errorMessage: err.message });
      }

      if (IS_ONCE || !isRunning) {
        break;
      }

      console.log(`[OpenAQ Poller] Sleeping for ${POLL_INTERVAL_SECONDS} seconds until next poll...`);
      await interruptibleSleep(POLL_INTERVAL_SECONDS);
    }
  } finally {
    console.log(`[OpenAQ Poller] Disconnecting Kafka producer...`);
    await producer.disconnect();
    console.log(`[OpenAQ Poller] Poller stopped.`);
  }
}

main().catch((error) => {
  console.error("OpenAQ poller fatal error:", error);
  process.exitCode = 1;
});
