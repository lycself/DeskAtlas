"""Tray-level settings stored as JSON next to the database."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, fields
from pathlib import Path


log = logging.getLogger(__name__)
OFFICIAL_REPOSITORY = "lycself/DeskAtlas"
OFFICIAL_RELEASES = f"https://github.com/{OFFICIAL_REPOSITORY}/releases/"
DEFAULT_UPDATE_URL = OFFICIAL_RELEASES + "latest/download/latest.json"


@dataclass
class DesktopSettings:
    port: int = 8080
    public_address: str = ""
    prevent_sleep: bool = True
    auto_backup: bool = True
    backup_keep: int = 14
    update_url: str = DEFAULT_UPDATE_URL
    last_update_check: str = ""
    path: Path | None = None

    @classmethod
    def load(cls, path: Path) -> "DesktopSettings":
        settings = cls(path=path)
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError) as exc:
                log.warning("settings.json unreadable, using defaults: %s", exc)
                data = {}
            for field in fields(cls):
                if field.name == "path" or field.name not in data:
                    continue
                value = data[field.name]
                if isinstance(value, field.type if isinstance(field.type, type) else type(getattr(settings, field.name))):
                    setattr(settings, field.name, value)
        settings.port = max(1, min(65535, int(settings.port)))
        settings.backup_keep = max(1, min(365, int(settings.backup_keep)))
        return settings

    def save(self) -> None:
        if self.path is None:
            return
        data = {key: value for key, value in asdict(self).items() if key != "path"}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def public(self) -> dict:
        return {
            "port": self.port,
            "public_address": self.public_address,
            "prevent_sleep": self.prevent_sleep,
            "auto_backup": self.auto_backup,
            "backup_keep": self.backup_keep,
            "update_url": self.update_url,
        }
