"""Tray-level settings stored as JSON next to the database."""

from __future__ import annotations

import json
import logging
import re
import sys
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


log = logging.getLogger(__name__)
OFFICIAL_REPOSITORY = "lycself/DeskAtlas"
OFFICIAL_RELEASES = f"https://github.com/{OFFICIAL_REPOSITORY}/releases/"
# One local key encrypts every stored credential; the name predates the HTTPS settings.
SECRET_KEY_FILE = "update-token.key"
DOMAIN_PATTERN = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}")
DEFAULT_UPDATE_URL = OFFICIAL_RELEASES + ("latest/download/latest-linux.json" if sys.platform.startswith("linux") else "latest/download/latest.json")


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
    https_enabled: bool = False
    https_domain: str = ""
    alidns_key_id: str = ""
    alidns_secret_encrypted: str = field(default="", repr=False)
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
            "https_enabled": self.https_enabled,
            "https_domain": self.https_domain,
            "alidns_key_id": self.alidns_key_id,
            "alidns_secret_configured": bool(self.alidns_secret_encrypted),
        }

    def set_update_token(self, token: str) -> None:
        token = token.strip()
        if token and (not token.isascii() or any(character.isspace() for character in token)):
            raise ValueError("GitHub token 不能包含空格或换行")
        self.update_token_encrypted = self._encrypt(token)

    def update_token(self) -> str:
        return self._decrypt(self.update_token_encrypted, "无法读取 GitHub token，请在运行设置中重新填写并保存")

    def set_https_domain(self, value: str) -> None:
        domain = value.strip().lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        if domain and not DOMAIN_PATTERN.fullmatch(domain):
            raise ValueError("域名格式不正确，请填写例如 physdesk.cn 或 desk.example.com")
        self.https_domain = domain

    def set_alidns_key_id(self, value: str) -> None:
        self.alidns_key_id = _access_key(value, "AccessKey ID")

    def set_alidns_secret(self, value: str) -> None:
        self.alidns_secret_encrypted = self._encrypt(_access_key(value, "AccessKey Secret"))

    def alidns_secret(self) -> str:
        return self._decrypt(self.alidns_secret_encrypted, "无法读取 AccessKey Secret，请在 HTTPS 设置中重新填写并保存")

    def _cipher(self) -> Fernet:
        if self.path is None:
            raise ValueError("无法确定密钥保存目录")
        key_path = self.path.parent / SECRET_KEY_FILE
        key_path.parent.mkdir(parents=True, exist_ok=True)
        if not key_path.exists():
            with key_path.open("xb") as handle:
                key_path.chmod(0o600)
                handle.write(Fernet.generate_key())
        return Fernet(key_path.read_bytes())

    def _encrypt(self, value: str) -> str:
        return self._cipher().encrypt(value.encode()).decode() if value else ""

    def _decrypt(self, value: str, failure: str) -> str:
        if not value:
            return ""
        try:
            if self.path is None or not (self.path.parent / SECRET_KEY_FILE).is_file():
                raise ValueError("密钥文件不存在")
            return self._cipher().decrypt(value.encode()).decode()
        except (OSError, InvalidToken, ValueError) as exc:
            raise ValueError(failure) from exc


def _access_key(value: str, label: str) -> str:
    value = value.strip()
    if value and (not value.isascii() or any(character.isspace() for character in value) or len(value) > 128):
        raise ValueError(f"{label} 不能包含空格或中文，请从阿里云复制完整的值")
    return value
