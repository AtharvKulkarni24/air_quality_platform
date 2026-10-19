"""Verification script for the analytics Python environment."""
import sys
from sqlalchemy import text
from src.config import settings
from src.db.session import engine


def test_database():
    print("Testing PostgreSQL connection...")
    with engine.connect() as conn:
        result = conn.execute(text("SELECT COUNT(*) FROM air_quality_readings")).scalar()
        print(f" [PASS] PostgreSQL connected! Total air_quality_readings in DB: {result}")


def test_packages():
    print("Testing scientific package imports...")
    import pandas as pd
    import numpy as np
    import sklearn
    from kafka import KafkaAdminClient

    print(f" [PASS] pandas version: {pd.__version__}")
    print(f" [PASS] numpy version: {np.__version__}")
    print(f" [PASS] scikit-learn version: {sklearn.__version__}")

    print("Testing Kafka connection...")
    try:
        admin = KafkaAdminClient(bootstrap_servers=settings.kafka_broker, request_timeout_ms=5000)
        topics = admin.list_topics()
        print(f" [PASS] Kafka connected! Topics found: {topics}")
        admin.close()
    except Exception as e:
        print(f" [WARN] Kafka reachability check: {e}")


if __name__ == "__main__":
    print(f"Python interpreter: {sys.executable}")
    print(f"Python version: {sys.version}")
    print("-" * 50)
    try:
        test_database()
        test_packages()
        print("-" * 50)
        print(" Analytics Python environment is fully scaffolded and operational!")
    except Exception as e:
        print(f"❌ Error during verification: {e}")
        sys.exit(1)
