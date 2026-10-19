import "dotenv/config";
import {Kafka} from "kafkajs";
import {createHash} from "node:crypto";

function generateEventId(source,locationId,pollutant,observedAt){
    const rawKey=`${source}:${locationId}:${pollutant}:${observedAt}`;
    return createHash("sha256").update(rawKey).digest("hex").slice(0,32);
}

const kafka=new Kafka({
    clientId:"air_quality_simulator",
    brokers:[process.env.KAFKA_BROKER || "localhost:9092"]
});

const producer=kafka.producer();

const sites=[
    {
        locationId:"SIM-PUN-01",
        locationName:"Pune Demo Station",
        city:"Pune",
        state:"Maharashtra",
        base:35
    },
    {
        locationId:"SIM-MUM-01",
        locationName:"Mumbai Demo Station",
        city:"Mumbai",
        state:"Maharashtra",
        base:48
    },
    {
        locationId:"SIM-DEL-01",
        locationName:"Delhi Demo Station",
        city:"Delhi",
        state:"National Capital Territory of Delh",
        base:88
    }
];

const sleep=(ms)=> new Promise((resolve)=>setTimeout(resolve,ms));

await producer.connect();

try{
    while(true){
        const observedAt = new Date().toISOString();

        const paramGenerators = [
            { pollutant: "pm25", unit: "µg/m³", calc: (site) => Math.max(1, Number((site.base + Math.random() * 10 - 5).toFixed(1))) },
            { pollutant: "pm10", unit: "µg/m³", calc: (site) => Math.max(1, Number((site.base * 1.7 + Math.random() * 16 - 8).toFixed(1))) },
            { pollutant: "o3", unit: "µg/m³", calc: () => Math.max(1, Number((25 + Math.random() * 30).toFixed(1))) },
            { pollutant: "no2", unit: "µg/m³", calc: () => Math.max(1, Number((18 + Math.random() * 20).toFixed(1))) },
            { pollutant: "temperature", unit: "c", calc: () => Number((27 + Math.random() * 5 - 2.5).toFixed(1)) },
            { pollutant: "relativehumidity", unit: "%", calc: () => Math.max(10, Math.min(100, Number((55 + Math.random() * 20 - 10).toFixed(1)))) }
        ];

        const readings = sites.flatMap((site) =>
            paramGenerators.map((gen) => ({
                eventId: generateEventId("simulator", site.locationId, gen.pollutant, observedAt),
                source: "simulator",
                locationId: site.locationId,
                sensorId: `${site.locationId}:${gen.pollutant}`,
                locationName: site.locationName,
                city: site.city,
                state: site.state,
                countryCode: "IN",
                pollutant: gen.pollutant,
                value: gen.calc(site),
                unit: gen.unit,
                observedAt,
                dataMode: "simulated",
                measurementType: "observed"
            }))
        );

        await producer.send({
            topic:"air-quality.raw",
            messages:readings.map((reading)=>({
                key:`${reading.locationId}.${reading.pollutant}`,
                value:JSON.stringify(reading)
            }))
        });

        console.log(`Published ${readings.length} simulated readings`);
        await sleep(5000);
    }
}finally{
    await producer.disconnect();
}
