import "dotenv/config";
import { pool } from "../src/db/pool.js";

const COORDINATES = {
  // Demo Stations
  "SIM-DEL-01": { lat: 28.6139, lon: 77.2090 },
  "SIM-MUM-01": { lat: 19.0760, lon: 72.8777 },
  "SIM-PUN-01": { lat: 18.5204, lon: 73.8567 },
  // OpenAQ Pune / PCMC Stations
  "2585": { lat: 18.4988, lon: 73.8188 },
  "12042": { lat: 18.6775, lon: 73.8967 },
  "11608": { lat: 18.6401, lon: 73.8490 },
  "3409331": { lat: 18.640051, lon: 73.848956 },
  "3409523": { lat: 18.60577, lon: 73.749976 },
  "3410005": { lat: 18.459883, lon: 73.852193 },
  "3409435": { lat: 18.63673, lon: 73.82487 },
  "60658": { lat: 18.5089, lon: 73.9259 },
  "5661": { lat: 18.5018, lon: 73.8286 },
  "3409438": { lat: 18.45445, lon: 73.854155 },
  "60660": { lat: 18.517754, lon: 73.8214883 },
  "11609": { lat: 18.5362, lon: 73.8798 },
  "3409526": { lat: 18.536457, lon: 73.805454 },
  "3409436": { lat: 18.59051, lon: 73.77946 },
  "11613": { lat: 18.5314, lon: 73.8446 },
  "3409439": { lat: 18.547056, lon: 73.826908 },
  "3409528": { lat: 18.614767, lon: 73.799516 },
  "3409437": { lat: 18.616318, lon: 73.765797 },
  "11610": { lat: 18.6521, lon: 73.7812 },
};

async function main() {
  console.log("Updating station coordinates in PostgreSQL...");
  let updated = 0;

  for (const [extId, coords] of Object.entries(COORDINATES)) {
    const res = await pool.query(
      `UPDATE locations 
       SET latitude = $1, longitude = $2 
       WHERE external_location_id = $3`,
      [coords.lat, coords.lon, extId]
    );
    if (res.rowCount > 0) {
      updated += res.rowCount;
    }
  }

  console.log(` Successfully updated coordinates for ${updated} stations!`);
  await pool.end();
}

main().catch(console.error);
