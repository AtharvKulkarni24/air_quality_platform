
import "dotenv/config";
import axios from "axios";

const API_KEY = process.env.OPENAQ_API_KEY;
const BASE_URL = "https://api.openaq.org/v3";

// Replace with an actual location ID from test-openaq.js
const locationId = Number(process.argv[2]);

if (!API_KEY) {
  console.error(
    "Configuration error: OPENAQ_API_KEY is missing from server/.env"
  );
  process.exit(1);
}

if (!Number.isSafeInteger(locationId) || locationId <= 0) {
  console.error(
    "Usage: node scripts/test-latest.js <locationId>"
  );
  process.exit(1);
}

async function main() {
  try {
    const response = await axios.get(
      `${BASE_URL}/locations/${locationId}/latest`,
      {
        headers: {
          "X-API-Key": API_KEY,
        },
        timeout: 15000,
      }
    );

    const readings = response.data?.results ?? [];

    console.log(`\nLocation ID: ${locationId}`);
    console.log(`Latest readings found: ${readings.length}`);

    if (readings.length === 0) {
      console.log("No latest readings available.");
      return;
    }

    for (const reading of readings) {
      console.log("\n--------------------------");
      console.log("Sensor ID:", reading.sensorsId);
      console.log("Value:", reading.value);
      console.log("Coordinates:", reading.coordinates);
      console.log("Timestamp:", reading.datetime?.utc);
    }

    console.log("\nFull API response:");
    console.log(JSON.stringify(readings, null, 2));
  } catch (error) {
    console.error("\nFailed to fetch latest OpenAQ readings.");

    if (error.response) {
      console.error("HTTP status:", error.response.status);
      console.error(
        "API response:",
        JSON.stringify(error.response.data, null, 2)
      );
    } else {
      console.error("Error:", error.message);
    }

    process.exitCode = 1;
  }
}

await main();
