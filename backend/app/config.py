from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "DeskAtlas"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://deskatlas:deskatlas@127.0.0.1:5432/deskatlas"
    public_origin: str = "http://localhost:3000"
    admin_username: str = ""
    admin_password_hash: str = ""
    session_secret: str = ""
    session_max_age_seconds: int = 60 * 60 * 12
    settings_encryption_key: str = ""
    upload_dir: Path = Field(default=ROOT / "uploads")

    @property
    def production(self) -> bool:
        return self.app_env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()

