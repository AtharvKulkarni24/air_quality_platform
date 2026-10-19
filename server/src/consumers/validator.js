import "dotenv/config";
import {Kafka} from "kafkajs";

const kafka=new Kafka({
    clientId:"air-quality-validator",
    brokers:[process.env.KAFKA_BROKER || "localhost:9092"]
});

const consumer=kafka.consumer({
    groupId:"air-quality-validator"
});

const producer=kafka.producer();

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

function validateReading(reading){
    if(!reading || typeof reading!="object"){
        return "Event is not a JSON object";
    }

    const required=[
        "eventId","source","locationId","locationName",
        "city","countryCode","pollutant","unit",
        "observedAt","dataMode"
    ];

    for(const field of required){
        if(reading[field]===undefined || reading[field]===null || reading[field]===""){
            return `Missing required field: ${field}`;
        }
    }

    if(typeof reading.locationId!=="string"){
        return "Location ID must be a string";
    }

    const config = PARAMETER_CONFIG[reading.pollutant];
    if(!config){
        return `Unsupported pollutant or parameter: ${reading.pollutant}`;
    }

    reading.sensorId??=`${reading.locationId}:${reading.pollutant}`;
    reading.measurementType??="observed";

    if(typeof reading.sensorId!=="string"){
        return "Sensor ID must be a string";
    }

    if(typeof reading.value!== "number" || !Number.isFinite(reading.value)){
        return "Value must be a finite number";
    }

    if(!config.allowNegative && reading.value < 0){
        return `Value must be non-negative for ${reading.pollutant}`;
    }

    const rawUnit = reading.unit ?? "";
    const normUnit = rawUnit.trim().toLowerCase();
    if(!config.allowedUnits.has(rawUnit) && !config.allowedUnits.has(normUnit)){
        return `Unexpected unit '${rawUnit}' for parameter '${reading.pollutant}'`;
    }

    if(!/^[A-Z]{2}$/.test(reading.countryCode)){
        return "Invalid country code";
    }

    if(!Number.isFinite(Date.parse(reading.observedAt))){
        return "Invalid observation timestamp";
    }

    if(!["observed","simulated","modelled"].includes(reading.dataMode)){
        return "Invalid data mode"
    }

    if(!["observed","forecast"].includes(reading.measurementType)){
        return "Invalid measurement type";
    }

    if(typeof reading.source!=="string" || reading.source.length>30){
        return "Source must be a string of at most 30 characters";
    }

    return null;
}

async function sendInvalid(reason,rawEvent){
    await producer.send({
        topic:"air-quality.invalid",
        messages:[{
            value:JSON.stringify({
                reason,
                receivedAt: new Date().toISOString(),
                rawEvent
            })
        }]
    });
}

await Promise.all([
    consumer.connect(),
    producer.connect()
]);

await consumer.subscribe({
    topic:"air-quality.raw",
    fromBeginning:true
});

await consumer.run({
    eachMessage:async ({message})=>{
        const raw=message.value?.toString()??"";

        let reading;

        try{
            reading=JSON.parse(raw);
        }catch{
            await sendInvalid("Invalid JSON",raw);
            console.log("Rejected malformed JSON");
            return;
        }

        const reason=validateReading(reading);

        if(reason){
            await sendInvalid(reason,reading);
            console.log(`Rejected event: ${reason}`);
            return;
        }

        await producer.send({
            topic:"air-quality.validated",
            messages:[{
                key:`${reading.locationId}:${reading.pollutant}`,
                value:JSON.stringify(reading)
            }]
        });

        console.log(`Validated ${reading.city}/${reading.pollutant}`);
    }
});