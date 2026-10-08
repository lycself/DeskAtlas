"""Tray-level settings stored as JSON next to the database."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


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
    update_token_encrypted: str = field(default="", repr=False)
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
            "update_token_configured": bool(self.update_token_encrypted),
        }

    def set_update_token(self, token: str) -> None:
        token = token.strip()
        if not token:
            self.update_token_encrypted = ""
            return
        if not token.isascii() or any(character.isspace() for character in token):
            raise ValueError("GitHub token 不能包含空格或换行")
        if self.path is None:
            raise ValueError("无法确定 token 保存目录")
        key_path = self.path.parent / "update-token.key"
        key_path.parent.mkdir(parents=True, exist_ok=True)
        if not key_path.exists():
            with key_path.open("xb") as handle:
                key_path.chmod(0o600)
                handle.write(Fernet.generate_key())
        self.update_token_encrypted = Fernet(key_path.read_bytes()).encrypt(token.encode()).decode()

    def update_token(self) -> str:
        if not self.update_token_encrypted:
            return ""
        try:
            if self.path is None:
                raise ValueError("没有设置路径")
            key = (self.path.parent / "update-token.key").read_bytes()
            return Fernet(key).decrypt(self.update_token_encrypted.encode()).decode()
        except (OSError, InvalidToken, ValueError) as exc:
            raise ValueError("无法读取 GitHub token，请在运行设置中重新填写并保存") from exc
