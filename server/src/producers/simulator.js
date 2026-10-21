import "dotenv/config";
import { Kafka } from "kafkajs";
import { createHash } from "node:crypto";

/**
 * DETERMINISTIC EVENT ID GENERATOR
 * Computes sha256(source:locationId:pollutant:observedAt)
 */
function generateEventId(source, locationId, pollutant, observedAt) {
  const rawKey = `${source}:${locationId}:${pollutant}:${observedAt}`;
  return createHash("sha256").update(rawKey).digest("hex").slice(0, 32);
}

const kafka = new Kafka({
  clientId: "air_quality_simulator",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
});

const producer = kafka.producer();

// --------------------------------------------------------------------------
// 1. Expanded Station Network: 6 Pune, 6 Mumbai, 6 Delhi (18 Total Stations)
// --------------------------------------------------------------------------
const SITES = [
  // --- PUNE & PCMC (Moderate Valley, Industrial & Tech Corridors) ---
  {
    locationId: "SIM-PUN-01",
    locationName: "Pune Central (Shivajinagar)",
    city: "Pune",
    state: "Maharashtra",
    latitude: 18.5314,
    longitude: 73.8446,
    basePm25: 58,
    basePm10: 110,
    baseTemp: 26,
    baseHum: 55,
  },
  {
    locationId: "SIM-PUN-02",
    locationName: "Kothrud Green Corridor",
    city: "Pune",
    state: "Maharashtra",
    latitude: 18.5074,
    longitude: 73.8077,
    basePm25: 38,
    basePm10: 72,
    baseTemp: 25,
    baseHum: 58,
  },
  {
    locationId: "SIM-PUN-03",
    locationName: "Hinjewadi Tech Zone",
    city: "Pune",
    state: "Maharashtra",
    latitude: 18.5913,
    longitude: 73.7389,
    basePm25: 65,
    basePm10: 125,
    baseTemp: 27,
    baseHum: 50,
  },
  {
    locationId: "SIM-PUN-04",
    locationName: "Hadapsar Industrial Complex",
    city: "Pune",
    state: "Maharashtra",
    latitude: 18.5089,
    longitude: 73.926,
    basePm25: 78,
    basePm10: 155,
    baseTemp: 28,
    baseHum: 48,
  },
  {
    locationId: "SIM-PUN-05",
    locationName: "Katraj Biodiversity Park",
    city: "Pune",
    state: "Maharashtra",
    latitude: 18.4575,
    longitude: 73.8677,
    basePm25: 32,
    basePm10: 60,
    baseTemp: 24,
    baseHum: 62,
  },
  {
    locationId: "SIM-PUN-06",
    locationName: "Wakad Suburban Corridor",
    city: "Pune",
    state: "Maharashtra",
    latitude: 18.5987,
    longitude: 73.7634,
    basePm25: 54,
    basePm10: 104,
    baseTemp: 26,
    baseHum: 52,
  },

  // --- MUMBAI (Coastal, High Humidity, Marine Breezes, Moderate Particulates) ---
  {
    locationId: "SIM-MUM-01",
    locationName: "Bandra Kurla Complex (BKC)",
    city: "Mumbai",
    state: "Maharashtra",
    latitude: 19.0657,
    longitude: 72.8687,
    basePm25: 68,
    basePm10: 115,
    baseTemp: 30,
    baseHum: 76,
  },
  {
    locationId: "SIM-MUM-02",
    locationName: "Colaba Coastal Observatory",
    city: "Mumbai",
    state: "Maharashtra",
    latitude: 18.9067,
    longitude: 72.8147,
    basePm25: 32,
    basePm10: 58,
    baseTemp: 29,
    baseHum: 82,
  },
  {
    locationId: "SIM-MUM-03",
    locationName: "Andheri West Commercial",
    city: "Mumbai",
    state: "Maharashtra",
    latitude: 19.1136,
    longitude: 72.8697,
    basePm25: 62,
    basePm10: 108,
    baseTemp: 31,
    baseHum: 74,
  },
  {
    locationId: "SIM-MUM-04",
    locationName: "Worli Sea Face Promenade",
    city: "Mumbai",
    state: "Maharashtra",
    latitude: 19.0178,
    longitude: 72.818,
    basePm25: 36,
    basePm10: 66,
    baseTemp: 29,
    baseHum: 80,
  },
  {
    locationId: "SIM-MUM-05",
    locationName: "Kurla Junction Industrial",
    city: "Mumbai",
    state: "Maharashtra",
    latitude: 19.0688,
    longitude: 72.8804,
    basePm25: 75,
    basePm10: 135,
    baseTemp: 31,
    baseHum: 72,
  },
  {
    locationId: "SIM-MUM-06",
    locationName: "Navi Mumbai Vashi Hub",
    city: "Mumbai",
    state: "Maharashtra",
    latitude: 19.033,
    longitude: 73.0297,
    basePm25: 58,
    basePm10: 102,
    baseTemp: 30,
    baseHum: 75,
  },

  // --- DELHI NCR (Inland Continental, Inversion Layers, Heavy Particulate Load) ---
  {
    locationId: "SIM-DEL-01",
    locationName: "Anand Vihar Traffic Interchange",
    city: "Delhi",
    state: "Delhi",
    latitude: 28.6502,
    longitude: 77.3027,
    basePm25: 165,
    basePm10: 295,
    baseTemp: 23,
    baseHum: 42,
  },
  {
    locationId: "SIM-DEL-02",
    locationName: "Punjabi Bagh Commercial Corridor",
    city: "Delhi",
    state: "Delhi",
    latitude: 28.6692,
    longitude: 77.126,
    basePm25: 140,
    basePm10: 250,
    baseTemp: 23,
    baseHum: 44,
  },
  {
    locationId: "SIM-DEL-03",
    locationName: "ITO Central Secretariat",
    city: "Delhi",
    state: "Delhi",
    latitude: 28.6304,
    longitude: 77.241,
    basePm25: 125,
    basePm10: 220,
    baseTemp: 24,
    baseHum: 45,
  },
  {
    locationId: "SIM-DEL-04",
    locationName: "RK Puram Diplomatic Zone",
    city: "Delhi",
    state: "Delhi",
    latitude: 28.5665,
    longitude: 77.1821,
    basePm25: 98,
    basePm10: 175,
    baseTemp: 23,
    baseHum: 46,
  },
  {
    locationId: "SIM-DEL-05",
    locationName: "Lodhi Road Botanical Zone",
    city: "Delhi",
    state: "Delhi",
    latitude: 28.5914,
    longitude: 77.2273,
    basePm25: 82,
    basePm10: 145,
    baseTemp: 22,
    baseHum: 48,
  },
  {
    locationId: "SIM-DEL-06",
    locationName: "Rohini Sector 16 Urban Hub",
    city: "Delhi",
    state: "Delhi",
    latitude: 28.736,
    longitude: 77.1128,
    basePm25: 115,
    basePm10: 210,
    baseTemp: 23,
    baseHum: 43,
  },
];

// --------------------------------------------------------------------------
// 2. Telemetry Generators for ALL 13 Standard Parameters
// --------------------------------------------------------------------------
const PARAM_GENERATORS = [
  // 1. Particulate Matter PM2.5 (µg/m³)
  {
    pollutant: "pm25",
    unit: "µg/m³",
    calc: (s) => Math.max(2, Number((s.basePm25 + (Math.random() * 14 - 7)).toFixed(1))),
  },
  // 2. Particulate Matter PM10 (µg/m³)
  {
    pollutant: "pm10",
    unit: "µg/m³",
    calc: (s) => Math.max(5, Number((s.basePm10 + (Math.random() * 24 - 12)).toFixed(1))),
  },
  // 3. Black Carbon (µg/m³)
  {
    pollutant: "bc",
    unit: "µg/m³",
    calc: (s) => Math.max(0.2, Number((s.basePm25 * 0.05 + Math.random() * 0.8).toFixed(2))),
  },
  // 4. Ground-Level Ozone O3 (µg/m³)
  {
    pollutant: "o3",
    unit: "µg/m³",
    calc: (s) => Math.max(5, Number((35 + Math.random() * 45).toFixed(1))),
  },
  // 5. Nitrogen Dioxide NO2 (µg/m³)
  {
    pollutant: "no2",
    unit: "µg/m³",
    calc: (s) => Math.max(4, Number((s.basePm25 * 0.45 + Math.random() * 15).toFixed(1))),
  },
  // 6. Sulfur Dioxide SO2 (µg/m³)
  {
    pollutant: "so2",
    unit: "µg/m³",
    calc: () => Math.max(2, Number((12 + Math.random() * 18).toFixed(1))),
  },
  // 7. Carbon Monoxide CO (mg/m³)
  {
    pollutant: "co",
    unit: "mg/m³",
    calc: (s) => Math.max(0.2, Number((s.basePm25 * 0.015 + Math.random() * 0.5).toFixed(2))),
  },
  // 8. Nitric Oxide NO (ppb)
  {
    pollutant: "no",
    unit: "ppb",
    calc: () => Math.max(1, Number((14 + Math.random() * 20).toFixed(1))),
  },
  // 9. Nitrogen Oxides NOx (ppb)
  {
    pollutant: "nox",
    unit: "ppb",
    calc: () => Math.max(3, Number((28 + Math.random() * 35).toFixed(1))),
  },
  // 10. Ambient Temperature (°C)
  {
    pollutant: "temperature",
    unit: "c",
    calc: (s) => Number((s.baseTemp + (Math.random() * 4 - 2)).toFixed(1)),
  },
  // 11. Relative Humidity (%)
  {
    pollutant: "relativehumidity",
    unit: "%",
    calc: (s) => Math.min(98, Math.max(15, Number((s.baseHum + (Math.random() * 10 - 5)).toFixed(1)))),
  },
  // 12. Wind Speed (m/s)
  {
    pollutant: "wind_speed",
    unit: "m/s",
    calc: (s) => Number((s.city === "Mumbai" ? 3.5 + Math.random() * 4 : 1.2 + Math.random() * 3).toFixed(1)),
  },
  // 13. Wind Direction (deg)
  {
    pollutant: "wind_direction",
    unit: "deg",
    calc: () => Math.round(Math.random() * 360),
  },
];

// In-memory cache of recent valid events for controlled duplicate re-injection
const recentEventsPool = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --------------------------------------------------------------------------
// 3. Telemetry Batch Construction with Deliberate Kafka Edge Cases
// --------------------------------------------------------------------------
function generateTelemetryBatch(observedAt) {
  const validBatch = [];
  const edgeCaseBatch = [];

  // Generate valid telemetry for all 18 sites x 13 parameters
  for (const site of SITES) {
    for (const gen of PARAM_GENERATORS) {
      const reading = {
        eventId: generateEventId("simulator", site.locationId, gen.pollutant, observedAt),
        source: "simulator",
        locationId: site.locationId,
        sensorId: `${site.locationId}:${gen.pollutant}`,
        locationName: site.locationName,
        city: site.city,
        state: site.state,
        countryCode: "IN",
        latitude: site.latitude,
        longitude: site.longitude,
        pollutant: gen.pollutant,
        value: gen.calc(site),
        unit: gen.unit,
        observedAt,
        dataMode: "simulated",
        measurementType: "observed",
      };

      validBatch.push(reading);
      recentEventsPool.push(reading);
      if (recentEventsPool.length > 300) recentEventsPool.shift();
    }
  }

  // ------------------------------------------------------------------------
  // EDGE CASE 1: DELIBERATE DUPLICATES (Demonstrating Kafka Consumer Deduplication)
  // Re-emit 2-4 previously transmitted events with the EXACT SAME eventId
  // ------------------------------------------------------------------------
  if (recentEventsPool.length >= 10 && Math.random() < 0.8) {
    const numDups = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < numDups; i++) {
      const randomIdx = Math.floor(Math.random() * (recentEventsPool.length - 5));
      const dup = { ...recentEventsPool[randomIdx] };
      edgeCaseBatch.push(dup);
      console.log(`[Kafka Producer] 🔁 Injected duplicate event for Kafka deduplication: ${dup.locationName} (${dup.pollutant.toUpperCase()})`);
    }
  }

  // ------------------------------------------------------------------------
  // EDGE CASE 2: DELIBERATE MALFORMED / MISSING / OUT-OF-BOUNDS EVENTS
  // (Demonstrating Kafka Stream Validator & Dead-Letter Queue / DLQ Routing)
  // ------------------------------------------------------------------------
  if (Math.random() < 0.6) {
    const site = SITES[Math.floor(Math.random() * SITES.length)];

    // 2a. Missing required field (Missing pollutant & value)
    edgeCaseBatch.push({
      eventId: generateEventId("simulator", site.locationId, "corrupt_missing", observedAt),
      source: "simulator",
      locationId: site.locationId,
      locationName: site.locationName,
      city: site.city,
      countryCode: "IN",
      observedAt,
      dataMode: "simulated",
      // pollutant & value intentionally missing!
    });
    console.log(`[Kafka Producer] ⚠️ Injected deliberate event with MISSING required field (to test validator DLQ)`);

    // 2b. Out-of-bounds negative particulate reading
    edgeCaseBatch.push({
      eventId: generateEventId("simulator", site.locationId, "pm25_negative", observedAt),
      source: "simulator",
      locationId: site.locationId,
      locationName: site.locationName,
      city: site.city,
      countryCode: "IN",
      pollutant: "pm25",
      value: -42.5, // Non-negative constraint violated!
      unit: "µg/m³",
      observedAt,
      dataMode: "simulated",
      measurementType: "observed",
    });
    console.log(`[Kafka Producer] ⚠️ Injected deliberate NEGATIVE value for PM2.5: -42.5 µg/m³ (to test validator DLQ)`);

    // 2c. Unsupported parameter / Invalid pollutant
    edgeCaseBatch.push({
      eventId: generateEventId("simulator", site.locationId, "toxic_waste", observedAt),
      source: "simulator",
      locationId: site.locationId,
      locationName: site.locationName,
      city: site.city,
      countryCode: "IN",
      pollutant: "radiation_gamma", // Unsupported pollutant!
      value: 120.0,
      unit: "µg/m³",
      observedAt,
      dataMode: "simulated",
      measurementType: "observed",
    });
    console.log(`[Kafka Producer] ⚠️ Injected deliberate UNSUPPORTED parameter 'radiation_gamma' (to test validator DLQ)`);

    // 2d. Invalid Unit
    edgeCaseBatch.push({
      eventId: generateEventId("simulator", site.locationId, "bad_unit", observedAt),
      source: "simulator",
      locationId: site.locationId,
      locationName: site.locationName,
      city: site.city,
      countryCode: "IN",
      pollutant: "pm10",
      value: 85.0,
      unit: "kilograms", // Invalid unit for PM10!
      observedAt,
      dataMode: "simulated",
      measurementType: "observed",
    });
    console.log(`[Kafka Producer] ⚠️ Injected deliberate INVALID unit 'kilograms' for PM10 (to test validator DLQ)`);
  }

  return [...validBatch, ...edgeCaseBatch];
}

// --------------------------------------------------------------------------
// 4. Execution Controller (Seed History or Continuous Stream)
// --------------------------------------------------------------------------
async function run() {
  const args = process.argv.slice(2);
  const isSeedMode = args.includes("--seed") || args.includes("--seed-history");
  const hoursToSeed = 24;

  console.log("==============================================================");
  console.log("  AEROPULSE MULTI-CITY TELEMETRY SIMULATOR & KAFKA PRODUCER  ");
  console.log("==============================================================");
  console.log(`Cities Monitored    : Pune (6), Mumbai (6), Delhi (6) -> 18 Stations`);
  console.log(`Parameters Emitted  : 13 Standard Pollutants & Meteorological Factors`);
  console.log(`Kafka Testing Bus   : air-quality.raw (with duplicates & DLQ edge cases)`);
  console.log(`Mode                : ${isSeedMode ? `Historical Seeding (${hoursToSeed} hours)` : "Continuous Real-Time Stream"}`);
  console.log("==============================================================");

  await producer.connect();
  console.log("[Simulator] Connected to Apache Kafka broker.\n");

  try {
    if (isSeedMode) {
      console.log(`[Simulator] Starting historical seed for past ${hoursToSeed} hours...`);
      const now = Date.now();

      for (let h = hoursToSeed; h >= 0; h--) {
        const timePoint = new Date(now - h * 3600 * 1000).toISOString();
        const batch = generateTelemetryBatch(timePoint);

        await producer.send({
          topic: "air-quality.raw",
          messages: batch.map((r) => ({
            key: `${r.locationId || "corrupt"}.${r.pollutant || "unknown"}`,
            value: JSON.stringify(r),
          })),
        });

        console.log(`[Simulator] Hour -${h}h (${timePoint.slice(11, 16)} UTC): Published ${batch.length} events to Kafka topic air-quality.raw`);
        await sleep(150);
      }

      console.log("\n[Simulator] Historical seed completed successfully!");
      return;
    }

    // Continuous Real-Time Streaming Mode
    let cycle = 1;
    while (true) {
      const observedAt = new Date().toISOString();
      const batch = generateTelemetryBatch(observedAt);

      await producer.send({
        topic: "air-quality.raw",
        messages: batch.map((r) => ({
          key: `${r.locationId || "corrupt"}.${r.pollutant || "unknown"}`,
          value: JSON.stringify(r),
        })),
      });

      console.log(`\n[Cycle #${cycle}] [${new Date().toLocaleTimeString()}] Published ${batch.length} readings across Pune, Mumbai & Delhi to 'air-quality.raw'`);
      cycle++;
      await sleep(5000);
    }
  } finally {
    await producer.disconnect();
    console.log("[Simulator] Disconnected from Kafka.");
  }
}

run().catch((err) => {
  console.error("[Simulator Error]", err);
  process.exit(1);
});
