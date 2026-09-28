"""Check a signed release manifest, download the installer, verify it, and hand off to Inno Setup."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.error import URLError
from urllib.request import Request, urlopen

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from packaging.version import InvalidVersion, Version

from backend.app.version import VERSION
from .hostos import IS_WINDOWS, run_installer
from .settings import OFFICIAL_RELEASES
from .update_key import PUBLIC_KEY


log = logging.getLogger(__name__)
USER_AGENT = f"DeskAtlas/{VERSION}"


class UpdateError(Exception):
    pass


def canonical_bytes(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def is_official_source(url: str) -> bool:
    """True for HTTPS URLs under the project's own GitHub releases."""
    return str(url or "").startswith(OFFICIAL_RELEASES)


def verify_manifest(manifest: dict, source_url: str = "") -> None:
    """Accept a manifest when it is signed with the embedded key, or unsigned but served by GitHub.

    The official releases page is reached over HTTPS to github.com, which already guarantees the
    manifest and installer were not tampered with. Any other source (an intranet mirror, for
    example) must carry an Ed25519 signature, and the installer URL must then be signed too.
    """
    signature = manifest.get("signature")
    if not signature:
        if is_official_source(source_url) and is_official_source(manifest.get("url", "")):
            return
        raise UpdateError("unsigned")
    if not PUBLIC_KEY:
        raise UpdateError("此版本没有内置更新公钥，无法校验签名")
    payload = {key: value for key, value in manifest.items() if key != "signature"}
    try:
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(PUBLIC_KEY))
        key.verify(base64.b64decode(signature), canonical_bytes(payload))
    except (InvalidSignature, ValueError) as exc:
        raise UpdateError("更新清单签名无效") from exc


def parse_version(text: str) -> Version:
    try:
        return Version(str(text).lstrip("vV"))
    except InvalidVersion as exc:
        raise UpdateError(f"无法识别的版本号：{text}") from exc


class Updater:
    def __init__(self, data_dir: Path, url_getter: Callable[[], str], on_installing: Callable[[], None]) -> None:
        self.downloads = data_dir / "updates"
        self.url_getter = url_getter
        self.on_installing = on_installing
        self.info: dict = {"status": "idle", "latest": None, "notes": None, "error": None, "checked_at": None}
        self._manifest: dict | None = None
        self._lock = threading.Lock()

    def _set(self, **fields) -> dict:
        self.info.update(fields)
        return dict(self.info)

    def check(self) -> dict:
        url = self.url_getter().strip()
        if not url:
            return self._set(status="idle", error="没有配置更新源地址", checked_at=None)
        if not self._lock.acquire(blocking=False):
            return dict(self.info)
        try:
            self._set(status="checking", error=None)
            request = Request(url, headers={"User-Agent": USER_AGENT, "Cache-Control": "no-cache"})
            with urlopen(request, timeout=15) as response:
                manifest = json.loads(response.read().decode("utf-8"))
            verify_manifest(manifest, url)
            latest = parse_version(manifest["version"])
            checked_at = datetime.now(timezone.utc).isoformat()
            if latest > parse_version(VERSION):
                self._manifest = manifest
                return self._set(status="available", latest=str(latest), notes=manifest.get("notes"), checked_at=checked_at)
            self._manifest = None
            return self._set(status="latest", latest=str(latest), notes=None, checked_at=checked_at)
        except UpdateError as exc:
            status = "unsigned" if str(exc) == "unsigned" else "error"
            return self._set(status=status, error=None if status == "unsigned" else str(exc))
        except (URLError, OSError, ValueError, KeyError) as exc:
            log.warning("update check failed: %s", exc)
            return self._set(status="error", error=f"无法获取更新信息：{exc}")
        finally:
            self._lock.release()

    def apply(self) -> dict:
        if self.info["status"] not in {"available", "ready"} or not self._manifest:
            raise ValueError("当前没有可安装的更新")
        if not IS_WINDOWS:
            raise ValueError("自动安装更新只支持 Windows，请手动下载安装包")
        thread = threading.Thread(target=self._download_and_install, name="updater", daemon=True)
        thread.start()
        return self._set(status="downloading", error=None)

    def _download_and_install(self) -> None:
        manifest = self._manifest or {}
        try:
            with self._lock:
                package = self._download(manifest)
            self._set(status="ready")
            log.info("installing update %s from %s", manifest.get("version"), package)
            run_installer(package)
            self.on_installing()
        except (UpdateError, URLError, OSError, ValueError) as exc:
            log.exception("update failed")
            self._set(status="error", error=f"更新失败：{exc}")

    def _download(self, manifest: dict) -> Path:
        url = manifest.get("url")
        expected_hash = str(manifest.get("sha256", "")).lower()
        if not url or not expected_hash:
            raise UpdateError("更新清单缺少下载地址或校验值")
        self.downloads.mkdir(parents=True, exist_ok=True)
        target = self.downloads / f"DeskAtlas-Setup-{manifest.get('version', 'latest')}.exe"
        if target.exists() and _sha256(target) == expected_hash:
            return target
        digest = hashlib.sha256()
        request = Request(url, headers={"User-Agent": USER_AGENT})
        partial = target.with_suffix(".part")
        with urlopen(request, timeout=60) as response, partial.open("wb") as handle:
            while chunk := response.read(1024 * 256):
                digest.update(chunk)
                handle.write(chunk)
        if digest.hexdigest() != expected_hash:
            partial.unlink(missing_ok=True)
            raise UpdateError("安装包校验失败，已放弃更新")
        expected_size = manifest.get("size")
        if expected_size and partial.stat().st_size != int(expected_size):
            partial.unlink(missing_ok=True)
            raise UpdateError("安装包大小不符，已放弃更新")
        partial.replace(target)
        for stale in self.downloads.glob("*.exe"):
            if stale != target:
                stale.unlink(missing_ok=True)
        return target


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 256):
            digest.update(chunk)
    return digest.hexdigest()
