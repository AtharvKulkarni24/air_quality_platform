import "dotenv/config";
import { pool } from "../src/db/pool.js";

async function main() {
  console.log("===============================================================");
  console.log("            AIR QUALITY PLATFORM - DATABASE STATUS             ");
  console.log("===============================================================\n");

  try {
    // 1. Overall counts
    const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM locations) AS total_locations,
        (SELECT COUNT(*) FROM sensors) AS total_sensors,
        (SELECT COUNT(*) FROM air_quality_readings) AS total_readings,
        (SELECT COUNT(DISTINCT source) FROM locations) AS total_sources
    `);
    const c = counts.rows[0];
    console.log(`📊 TOTAL METRICS:`);
    console.log(`   • Locations/Stations : ${c.total_locations}`);
    console.log(`   • Active Sensors     : ${c.total_sensors}`);
    console.log(`   • Stored Readings    : ${c.total_readings}`);
    console.log(`   • Data Sources       : ${c.total_sources}\n`);

    // 2. Pollutant Breakdown
    const pollutants = await pool.query(`
      SELECT 
        s.parameter AS parameter,
        s.unit AS unit,
        COUNT(r.id) AS reading_count,
        ROUND(AVG(r.value)::numeric, 2) AS avg_value,
        ROUND(MIN(r.value)::numeric, 2) AS min_value,
        ROUND(MAX(r.value)::numeric, 2) AS max_value
      FROM air_quality_readings r
      JOIN sensors s ON r.sensor_id = s.id
      GROUP BY s.parameter, s.unit
      ORDER BY reading_count DESC
    `);
    console.log(`🔬 STORED PARAMETERS & READINGS BREAKDOWN:`);
    console.table(pollutants.rows);

    // 3. Stations Sample
    const stations = await pool.query(`
      SELECT 
        l.source,
        l.name AS station_name,
        l.city,
        COUNT(DISTINCT s.id) AS sensor_count,
        COUNT(r.id) AS readings_count
      FROM locations l
      LEFT JOIN sensors s ON s.location_id = l.id
      LEFT JOIN air_quality_readings r ON r.sensor_id = s.id
      GROUP BY l.id, l.source, l.name, l.city
      ORDER BY readings_count DESC
      LIMIT 6
    `);
    console.log(`📍 ACTIVE STATIONS SAMPLE:`);
    console.table(stations.rows);

    // 4. Ingestion Checkpoints
    const checkpoints = await pool.query(`
      SELECT source, stream_key, status, last_success_at, updated_at
      FROM ingestion_checkpoints
    `);
    console.log(`⏱️ INGESTION CHECKPOINTS:`);
    console.table(checkpoints.rows);

    console.log("===============================================================");
    console.log("Status: All services and tables operational.");
  } catch (err) {
    console.error("Failed to query database:", err.message);
  } finally {
    await pool.end();
  }
}

main();
