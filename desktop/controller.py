"""Glue between the tray, the panel window, the embedded server, backups, and updates."""

from __future__ import annotations

import logging
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from backend.app.config import Settings
from backend.app.datatransfer import backup_filename, export_backup, list_backups, prune_backups
from backend.app.panel import lan_addresses
from backend.app.version import VERSION

from . import hostos
from .https import HttpsProxy
from .server import ServerThread
from .settings import DesktopSettings
from .updater import Updater


log = logging.getLogger(__name__)
AUTO_BACKUP_INTERVAL = timedelta(hours=24)
UPDATE_CHECK_INTERVAL = timedelta(hours=6)


class DesktopController:
    def __init__(self, app, settings: Settings, desktop: DesktopSettings, engine) -> None:
        self.app = app
        self.settings = settings
        self.desktop = desktop
        self.engine = engine
        self.tray_status: Callable[[str, str | None], None] | None = None
        self.proxy = HttpsProxy(self.data_dir / "caddy", on_change=self._push_tray_status)
        self.server = ServerThread(app, host=self._bind_host())
        self.keep_awake = hostos.KeepAwake()
        self.updater = Updater(self.data_dir, lambda: self.desktop.update_url, self._on_update_installing,
                               token_getter=self.desktop.update_token)
        self.window = None
        self.quit_requested: Callable[[], None] | None = None
        self._stop = threading.Event()
        self._scheduler: threading.Thread | None = None
        self._last_update_check: datetime | None = None
        self._backup_lock = threading.Lock()
        self._network_lock = threading.Lock()

    # --- lifecycle ---------------------------------------------------------

    @property
    def data_dir(self) -> Path:
        assert self.settings.data_dir is not None
        return self.settings.data_dir

    def start(self) -> None:
        self.settings.backup_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.server.start(self.desktop.port)
        except ValueError as exc:
            log.error("server failed to start: %s", exc)
        self._start_proxy()
        self.keep_awake.set(self.desktop.prevent_sleep)
        self._scheduler = threading.Thread(target=self._scheduler_loop, name="scheduler", daemon=True)
        self._scheduler.start()
        self._push_tray_status()

    def shutdown(self) -> None:
        self._stop.set()
        self.keep_awake.close()
        self.proxy.stop()
        self.server.stop()

    def request_quit(self) -> None:
        if self.quit_requested:
            self.quit_requested()

    # --- panel controller protocol ----------------------------------------

    def panel_url(self) -> str:
        return f"http://127.0.0.1:{self.server.port or self.desktop.port}/panel"

    def local_url(self, path: str = "") -> str:
        return f"http://127.0.0.1:{self.server.port or self.desktop.port}{path}"

    def https_active(self) -> bool:
        """HTTPS replaces plain LAN access only when it is switched on, complete, and Caddy is bundled."""
        desktop = self.desktop
        return bool(desktop.https_enabled and desktop.https_domain and desktop.alidns_key_id
                    and desktop.alidns_secret_encrypted and self.proxy.available)

    def display_url(self) -> str:
        if self.https_active():
            return f"https://{self.desktop.https_domain}"
        port = self.server.port or self.desktop.port
        custom = self.desktop.public_address.strip()
        if custom:
            if "://" not in custom:
                custom = f"http://{custom}"
            parts = urlsplit(custom)
            if parts.port is None and parts.hostname:
                custom = f"{parts.scheme}://{parts.hostname}:{port}{parts.path}"
            return custom.rstrip("/")
        addresses = lan_addresses()
        host = addresses[0]["address"] if addresses else "127.0.0.1"
        return f"http://{host}:{port}"

    def last_backup(self) -> str | None:
        entries = list_backups(self.settings.backup_dir)
        return entries[0]["created_at"] if entries else None

    def state(self) -> dict[str, Any]:
        return {
            "version": VERSION,
            "platform": sys.platform,
            "addresses": lan_addresses(),
            "port": self.server.port or self.desktop.port,
            "running": self.server.running,
            "server_error": self.server.error,
            "display_url": self.display_url(),
            "settings": {**self.desktop.public(), "autostart": hostos.autostart_enabled()},
            "supports": {"autostart": hostos.autostart_supported(), "prevent_sleep": self.keep_awake.supported, "open": True},
            "data_dir": str(self.data_dir),
            "backup_dir": str(self.settings.backup_dir),
            "log_file": str(self.settings.log_dir / "deskatlas.log"),
            "last_backup": self.last_backup(),
            "update": dict(self.updater.info),
            "https": {**self.proxy.info(), "supported": self.proxy.available, "active": self.https_active()},
        }

    def update_settings(self, changes: dict[str, Any]) -> dict[str, Any]:
        response: dict[str, Any] = {"message": "设置已保存"}
        if "update_token" in changes:
            self.desktop.set_update_token(str(changes["update_token"]))
        if "autostart" in changes:
            hostos.set_autostart(bool(changes["autostart"]))
        if "prevent_sleep" in changes:
            self.desktop.prevent_sleep = bool(changes["prevent_sleep"])
            self.keep_awake.set(self.desktop.prevent_sleep)
        if "auto_backup" in changes:
            self.desktop.auto_backup = bool(changes["auto_backup"])
        if "backup_keep" in changes:
            self.desktop.backup_keep = int(changes["backup_keep"])
        if "update_url" in changes:
            self.desktop.update_url = str(changes["update_url"]).strip()
        if "public_address" in changes:
            self.desktop.public_address = str(changes["public_address"]).strip()
        https_before = self._https_signature()
        if "https_domain" in changes:
            self.desktop.set_https_domain(str(changes["https_domain"]))
        if "alidns_key_id" in changes:
            self.desktop.set_alidns_key_id(str(changes["alidns_key_id"]))
        if "alidns_secret" in changes:
            self.desktop.set_alidns_secret(str(changes["alidns_secret"]))
        if "https_enabled" in changes:
            enable = bool(changes["https_enabled"])
            if enable and not self.proxy.available:
                raise ValueError("此版本没有附带 HTTPS 组件，请安装官方 Windows 版")
            if enable and not (self.desktop.https_domain and self.desktop.alidns_key_id and self.desktop.alidns_secret_encrypted):
                raise ValueError("请先填写域名、AccessKey ID 和 AccessKey Secret")
            self.desktop.https_enabled = enable
        https_changed = self._https_signature() != https_before
        new_port = int(changes["port"]) if "port" in changes else None
        if new_port is not None and new_port != self.desktop.port:
            from .server import port_available

            if not port_available(new_port):
                raise ValueError(f"端口 {new_port} 已被其他程序占用，请换一个")
            self.desktop.port = new_port
            response = {"restarting": True, "url": f"http://127.0.0.1:{new_port}", "message": "端口已修改，服务正在重启"}
            https_changed = False  # the restart below re-applies the network settings anyway
            threading.Thread(target=self._restart_server, args=(new_port,), name="restart", daemon=True).start()
        if https_changed:
            response["message"] = ("HTTPS 已启用，正在申请证书…" if self.https_active() else
                                   "HTTPS 已关闭，恢复局域网 http 访问" if "https_enabled" in changes else "HTTPS 设置已保存")
            threading.Thread(target=self._apply_network, name="https-apply", daemon=True).start()
        self.desktop.save()
        response["settings"] = {**self.desktop.public(), "autostart": hostos.autostart_enabled()}
        return response

    def backup_now(self, kind: str = "manual") -> dict[str, Any]:
        with self._backup_lock:
            name = backup_filename(kind)
            package = export_backup(self.engine, self.settings, self.settings.backup_dir / name, kind=kind)
        log.info("backup written: %s", package)
        return {"name": name, "size": package.stat().st_size, "path": str(package)}

    def open_target(self, target: str) -> None:
        if target == "data":
            hostos.open_path(self.data_dir)
        elif target == "backups":
            hostos.open_path(self.settings.backup_dir)
        elif target == "logs":
            hostos.open_path(self.settings.log_dir)
        elif target == "admin":
            hostos.open_url(self.local_url("/admin"))
        elif target == "public":
            hostos.open_url(self.display_url())

    def check_update(self) -> dict[str, Any]:
        info = self.updater.check()
        self._last_update_check = datetime.now(timezone.utc)
        self.desktop.last_update_check = self._last_update_check.isoformat()
        self.desktop.save()
        self._push_tray_status()
        return info

    def apply_update(self) -> dict[str, Any]:
        return self.updater.apply()

    def show_window(self) -> None:
        if self.window is not None:
            self.window.show()
        else:
            hostos.open_url(self.panel_url())

    # --- internals ---------------------------------------------------------

    def _bind_host(self) -> str:
        # With HTTPS on, only Caddy may reach the server, so nobody can bypass TLS on the LAN port.
        return "127.0.0.1" if self.https_active() else "0.0.0.0"

    def _https_signature(self) -> tuple:
        desktop = self.desktop
        return (self.https_active(), desktop.https_domain, desktop.alidns_key_id, desktop.alidns_secret_encrypted)

    def _start_proxy(self) -> None:
        if not self.https_active():
            self.proxy.stop()
            return
        if not self.server.running:
            return
        try:
            secret = self.desktop.alidns_secret()
        except ValueError as exc:
            self.proxy.fail(str(exc))
            return
        self.proxy.start(self.desktop.https_domain, self.server.port or self.desktop.port, self.desktop.alidns_key_id, secret)

    def _apply_network(self, port: int | None = None) -> None:
        """Rebind the server if HTTPS changed who may reach it, then (re)start or stop Caddy."""
        with self._network_lock:
            time.sleep(0.6)  # let the HTTP response reach the panel before the listener goes away
            port = port or self.server.port or self.desktop.port
            host = self._bind_host()
            if host != self.server.host or port != self.server.port or not self.server.running:
                self.proxy.stop()
                self.server.host = host
                try:
                    self.server.restart(port)
                except ValueError as exc:
                    log.error("restart on %s:%s failed: %s", host, port, exc)
            self._start_proxy()
            self._push_tray_status()

    def _restart_server(self, port: int) -> None:
        self._apply_network(port)
        if self.window is not None:
            self.window.load(self.panel_url())
        self._push_tray_status()

    def _on_update_installing(self) -> None:
        log.info("installer started; quitting so files can be replaced")
        threading.Timer(1.0, self.request_quit).start()

    def _push_tray_status(self) -> None:
        if not self.tray_status:
            return
        if self.server.error and not self.server.running:
            self.tray_status("error", self.server.error)
        elif self.https_active() and self.proxy.status in {"error", "restarting"}:
            self.tray_status("error", f"HTTPS：{self.proxy.error}")
        elif self.updater.info["status"] in {"available", "ready"}:
            self.tray_status("update", f"有新版本 {self.updater.info.get('latest')}")
        else:
            self.tray_status("ok", None)

    def _scheduler_loop(self) -> None:
        # First pass shortly after launch, then hourly housekeeping.
        if self._stop.wait(45):
            return
        while not self._stop.is_set():
            try:
                self._maybe_auto_backup()
                self._maybe_check_update()
            except Exception:  # noqa: BLE001 - keep the housekeeping thread alive
                log.exception("scheduled task failed")
            if self._stop.wait(1800):
                return

    def _maybe_auto_backup(self) -> None:
        if not self.desktop.auto_backup or not self.server.running:
            return
        newest = None
        for entry in list_backups(self.settings.backup_dir):
            if entry["name"].startswith("auto-"):
                newest = datetime.fromisoformat(entry["created_at"])
                break
        if newest and datetime.now(timezone.utc) - newest < AUTO_BACKUP_INTERVAL:
            return
        self.backup_now("auto")
        for removed in prune_backups(self.settings.backup_dir, "auto-", self.desktop.backup_keep):
            log.info("pruned old backup %s", removed.name)

    def _maybe_check_update(self) -> None:
        if not self.desktop.update_url:
            return
        if self._last_update_check and datetime.now(timezone.utc) - self._last_update_check < UPDATE_CHECK_INTERVAL:
            return
        self.check_update()
