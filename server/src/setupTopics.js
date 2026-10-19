import "dotenv/config";
import { Kafka } from "kafkajs";

const kafka = new Kafka({
    clientId: "topic-init",
    brokers: [process.env.KAFKA_BROKER || "localhost:9092"]
});

async function init() {
    const admin = kafka.admin();
    await admin.connect();
    
    await admin.createTopics({
        topics: [
            { topic: "air-quality.raw", numPartitions: 1 },
            { topic: "air-quality.validated", numPartitions: 1 },
            { topic: "air-quality.invalid", numPartitions: 1 }
        ],
        waitForLeaders: true
    });

    console.log("Kafka topics created/ready: air-quality.raw, air-quality.validated, air-quality.invalid");
    await admin.disconnect();
}

init().catch((err) => {
    console.error("Failed to initialize topics:", err);
    process.exit(1);
});
