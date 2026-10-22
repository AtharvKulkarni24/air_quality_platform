from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Look for .env in analytics/ or project root
ANALYTICS_ENV = Path(__file__).resolve().parent.parent / ".env"
ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    database_url: str
    kafka_broker: str = "localhost:9092"
    kafka_topic_validated: str = "air-quality.validated"
    kafka_topic_predictions: str = "air-quality.predictions"
    kafka_topic_alerts: str = "air-quality.alerts"

    model_config = SettingsConfigDict(
        env_file=(str(ANALYTICS_ENV), str(ROOT_ENV)),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def sqlalchemy_database_url(self) -> str:
        """Ensure the URL uses the psycopg dialect driver."""
        url = self.database_url
        if url.startswith("postgresql://") and not url.startswith("postgresql+psycopg://"):
            return url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url


settings = Settings()
