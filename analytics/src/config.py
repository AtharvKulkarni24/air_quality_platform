from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    database_url: str = "postgresql://aq_user:Atharv24@localhost:5433/air_quality"
    kafka_broker: str = "localhost:9092"
    kafka_topic_validated: str = "air-quality.validated"
    kafka_topic_predictions: str = "air-quality.predictions"
    kafka_topic_alerts: str = "air-quality.alerts"

    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH),
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
