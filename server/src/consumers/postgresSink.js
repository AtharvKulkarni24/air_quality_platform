import "dotenv/config";
import {Kafka} from "kafkajs";
import {pool} from "../db/pool.js";

const kafka=new Kafka({
    clientId:"air-quality-postgre-sink",
    brokers:[process.env.KAFKA_BROKER || "localhost:9092"]
});

const consumer=kafka.consumer({
    groupId:"air-quality-postgres-sink"
});

await consumer.connect();
await consumer.subscribe({
    topic:"air-quality.validated",
    fromBeginning:true
});

await consumer.run({
    autoCommit:false,
    eachMessage:async ({topic,partition,message})=>{
        const reading=JSON.parse(message.value.toString());
        const sensorId=reading.sensorId??`${reading.locationId}:${reading.pollutant}`;
        const measurementType=reading.measurementType??"observed";
        const client=await pool.connect();

        try{
            await client.query("BEGIN");

            const location=await client.query(
                `INSERT INTO locations(
                    source,external_location_id,name,city,state,country_code,latitude,longitude
                )
                VALUES($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT(source,external_location_id) DO UPDATE SET
                    name=EXCLUDED.name,
                    city=EXCLUDED.city,
                    state=EXCLUDED.state,
                    country_code=EXCLUDED.country_code,
                    latitude=COALESCE(EXCLUDED.latitude, locations.latitude),
                    longitude=COALESCE(EXCLUDED.longitude, locations.longitude),
                    updated_at=NOW()
                RETURNING id`,
                [
                    reading.source,
                    reading.locationId,
                    reading.locationName,
                    reading.city,
                    reading.state??null,
                    reading.countryCode,
                    reading.latitude??null,
                    reading.longitude??null
                ]
            );

            const sensor=await client.query(
                `INSERT INTO sensors(
                    location_id,source,external_sensor_id,parameter,unit
                )
                VALUES($1,$2,$3,$4,$5)
                ON CONFLICT(source,external_sensor_id) DO UPDATE SET
                    location_id=EXCLUDED.location_id,
                    parameter=EXCLUDED.parameter,
                    unit=EXCLUDED.unit
                RETURNING id`,
                [
                    location.rows[0].id,
                    reading.source,
                    sensorId,
                    reading.pollutant,
                    reading.unit
                ]
            );

            await client.query(
                `INSERT INTO air_quality_readings(
                    event_id,sensor_id,observed_at,value,unit,source,
                    measurement_type,data_mode
                )
                VALUES($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT(event_id) DO NOTHING`,
                [
                    reading.eventId,
                    sensor.rows[0].id,
                    reading.observedAt,
                    reading.value,
                    reading.unit,
                    reading.source,
                    measurementType,
                    reading.dataMode
                ]
            );

            await client.query("COMMIT");
        }catch(error){
            await client.query("ROLLBACK");
            throw error;
        }finally{
            client.release();
        }

        const nextOffset=(BigInt(message.offset)+1n).toString();
        await consumer.commitOffsets([
            {topic,partition,offset:nextOffset}
        ]);

        console.log(`Stored & committed ${reading.city}/${reading.pollutant} (offset ${message.offset})`);
    }
});