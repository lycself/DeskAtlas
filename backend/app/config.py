from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

from dotenv import set_key
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[2]
CONFIG_KEYS = ("ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "SESSION_SECRET", "SETTINGS_ENCRYPTION_KEY")


def is_frozen() -> bool:
    """True when running from a PyInstaller bundle."""
    return bool(getattr(sys, "frozen", False))


def resource_root() -> Path:
    """Directory holding bundled resources (static site, alembic scripts)."""
    bundled = getattr(sys, "_MEIPASS", None)
    return Path(bundled) if bundled else ROOT


def default_data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "DeskAtlas"


def resolve_data_dir() -> Path | None:
    """Data directory for packaged mode. None means classic .env development mode."""
    configured = os.environ.get("DESKATLAS_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    if is_frozen():
        return default_data_dir()
    return None


def config_file_path() -> Path:
    data_dir = resolve_data_dir()
    return data_dir / "config.env" if data_dir else ROOT / ".env"


def _default_database_url() -> str:
    data_dir = resolve_data_dir()
    if data_dir:
        return f"sqlite:///{(data_dir / 'deskatlas.db').as_posix()}"
    return "postgresql+psycopg://deskatlas:deskatlas@127.0.0.1:5432/deskatlas"


def _default_upload_dir() -> Path:
    data_dir = resolve_data_dir()
    return data_dir / "uploads" if data_dir else ROOT / "uploads"


def _default_static_dir() -> Path | None:
    configured = os.environ.get("DESKATLAS_STATIC_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    for candidate in (resource_root() / "static", ROOT / "out"):
        if (candidate / "index.html").is_file():
            return candidate
    return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file_encoding="utf-8", extra="ignore")

    app_name: str = "DeskAtlas"
    app_env: str = "development"
    database_url: str = Field(default_factory=_default_database_url)
    public_origin: str = "http://localhost:3000"
    admin_username: str = ""
    admin_password_hash: str = ""
    session_secret: str = ""
    session_max_age_seconds: int = 60 * 60 * 12
    settings_encryption_key: str = ""
    secure_cookies: bool | None = None
    upload_dir: Path = Field(default_factory=_default_upload_dir)
    static_dir: Path | None = Field(default_factory=_default_static_dir)
    backups_dir: Path | None = None

    @property
    def production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def cookie_secure(self) -> bool:
        if self.secure_cookies is not None:
            return self.secure_cookies
        # Packaged installs serve plain http on the intranet; secure cookies would break login there.
        return self.production and self.data_dir is None

    @property
    def data_dir(self) -> Path | None:
        return resolve_data_dir()

    @property
    def config_path(self) -> Path:
        return config_file_path()

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def sqlite_path(self) -> Path | None:
        if not self.is_sqlite:
            return None
        raw = self.database_url.split("///", 1)[1] if "///" in self.database_url else ""
        return Path(raw) if raw and raw != ":memory:" else None

    @property
    def backup_dir(self) -> Path:
        if self.backups_dir is not None:
            return self.backups_dir
        return (self.data_dir or ROOT / "outputs") / "backups"

    @property
    def log_dir(self) -> Path:
        return (self.data_dir or ROOT / "outputs") / "logs"

    @property
    def configured(self) -> bool:
        return bool(self.admin_username and self.admin_password_hash)

    def apply(self, values: dict[str, str]) -> None:
        """Update the live settings instance from CONFIG_KEYS-style upper-case keys."""
        for key, value in values.items():
            attribute = key.lower()
            if hasattr(self, attribute):
                setattr(self, attribute, value)

    def write_config(self, values: dict[str, str]) -> None:
        """Persist secrets to the active config file and apply them in memory."""
        path = self.config_path
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.touch(mode=0o600)
        for key, value in values.items():
            set_key(str(path), key, value, quote_mode="always")
        self.apply(values)


@lru_cache
def get_settings() -> Settings:
    data_dir = resolve_data_dir()
    if data_dir:
        data_dir.mkdir(parents=True, exist_ok=True)
    return Settings(_env_file=config_file_path())
