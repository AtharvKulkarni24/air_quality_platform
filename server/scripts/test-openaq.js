import "dotenv/config";
import axios from "axios";

const BASE_URL = "https://api.openaq.org/v3";

async function main() {
  if (!process.env.OPENAQ_API_KEY) {
    throw new Error("OPENAQ_API_KEY is not set in the server .env file");
  }

  const response = await axios.get(`${BASE_URL}/locations`, {
    headers: {
      "X-API-Key": process.env.OPENAQ_API_KEY,
    },
    params: {
      coordinates: "18.5204,73.8567",
      radius: 25000,
      limit: 100,
    },
    timeout: 15000,
  });

  const locations = response.data.results || [];

  console.log(`Locations found: ${locations.length}`);

  for (const location of locations) {
    console.log("\n-----------------------------");
    console.log("Location ID:", location.id);
    console.log("Name:", location.name);
    console.log("Area:", location.locality);
    console.log("Coordinates:", location.coordinates);

    for (const sensor of location.sensors || []) {
      console.log(
        "Sensor:",
        sensor.id,
        "| Pollutant:",
        sensor.parameter?.name,
        "| Unit:",
        sensor.parameter?.units
      );
    }
  }
}

main().catch((error) => {
  console.error(
    "OpenAQ request failed:",
    error.response?.status,
    error.response?.data || error.message
  );
  process.exitCode = 1;
});