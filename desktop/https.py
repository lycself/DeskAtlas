"""Serve DeskAtlas at an HTTPS domain through the bundled Caddy.

Caddy listens on 443, gets a Let's Encrypt certificate through an Alibaba Cloud DNS challenge (so the
machine never has to be reachable from the internet), and forwards everything to the embedded server
on 127.0.0.1. The AccessKey reaches Caddy only through its environment, never through a file.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import URLError
from urllib.request import Request, urlopen

from .server import port_available


log = logging.getLogger(__name__)
HTTPS_PORT = 443
HTTP_PORT = 80
# Caddy's admin endpoint, used only to stop an instance left behind by a crashed tray app.
ADMIN_ADDRESS = "127.0.0.1:20190"
KEY_ID_ENV = "DESKATLAS_ALIDNS_KEY_ID"
SECRET_ENV = "DESKATLAS_ALIDNS_SECRET"
# Paths the HTTPS site never forwards: the status panel is for this machine only.
LOCAL_ONLY_PATHS = ["/api/panel", "/api/panel/*", "/panel", "/panel/*"]
RESTART_DELAYS = (5, 15, 60, 300)


def caddy_binary() -> Path | None:
    """The bundled Caddy (with the alidns module), or one named by DESKATLAS_CADDY for development."""
    override = os.environ.get("DESKATLAS_CADDY")
    if override:
        return Path(override) if Path(override).is_file() else None
    name = "caddy.exe" if sys.platform == "win32" else "caddy"
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        candidate = Path(bundle) / "caddy" / name
        return candidate if candidate.is_file() else None
    found = shutil.which("caddy")
    return Path(found) if found else None


def build_config(domain: str, upstream_port: int, state_dir: Path, *, redirect_http: bool) -> dict[str, Any]:
    storage = state_dir / "storage"
    server: dict[str, Any] = {
        "listen": [f":{HTTPS_PORT}"],
        "routes": [
            {"match": [{"host": [domain], "path": LOCAL_ONLY_PATHS}],
             "handle": [{"handler": "static_response", "status_code": 404}], "terminal": True},
            {"match": [{"host": [domain]}],
             "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": f"127.0.0.1:{upstream_port}"}]}], "terminal": True},
        ],
    }
    if not redirect_http:
        server["automatic_https"] = {"disable_redirects": True}
    return {
        "admin": {"listen": ADMIN_ADDRESS, "config": {"persist": False}},
        "logging": {"logs": {"default": {"level": "INFO", "writer": {
            "output": "file", "filename": (state_dir / "caddy.log").as_posix(), "roll_size_mb": 5, "roll_keep": 3}}}},
        "storage": {"module": "file_system", "root": storage.as_posix()},
        "apps": {
            "http": {"http_port": HTTP_PORT, "https_port": HTTPS_PORT, "servers": {"deskatlas": server}},
            "tls": {"automation": {"policies": [{"subjects": [domain], "issuers": [{
                "module": "acme",
                "challenges": {"dns": {
                    "provider": {"name": "alidns", "access_key_id": f"{{env.{KEY_ID_ENV}}}",
                                 "access_key_secret": f"{{env.{SECRET_ENV}}}"},
                    # Campus networks may block direct queries to Alibaba's name servers; Let's Encrypt
                    # still checks them itself, so waiting briefly is enough.
                    "propagation_delay": "30s",
                    "propagation_timeout": -1,
                }},
            }]}]}},
        },
    }


def certificate_expiry(state_dir: Path, domain: str) -> datetime | None:
    from cryptography import x509

    newest: datetime | None = None
    for path in (state_dir / "storage" / "certificates").glob(f"*/{domain}/{domain}.crt"):
        try:
            expires = x509.load_pem_x509_certificate(path.read_bytes()).not_valid_after_utc
        except (OSError, ValueError):
            continue
        if newest is None or expires > newest:
            newest = expires
    return newest


def last_error(state_dir: Path) -> str | None:
    """The most recent problem Caddy reported: a startup failure on stderr, else an error in its log."""
    stderr = _tail(state_dir / "caddy-stderr.log")
    for line in reversed(stderr):
        if line.startswith("Error:"):
            return line.removeprefix("Error:").strip()[:400]
    for line in reversed(_tail(state_dir / "caddy.log")):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if str(entry.get("level", "")).lower() in {"error", "fatal"}:
            detail = entry.get("error") or ""
            return f"{entry.get('msg', '')}: {detail}".strip(": ")[:400]
    return None


def _tail(path: Path, size: int = 64 * 1024) -> list[str]:
    try:
        with path.open("rb") as handle:
            handle.seek(max(0, path.stat().st_size - size))
            return handle.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return []


class HttpsProxy:
    """Runs and supervises one Caddy process; restarts it with backoff if it dies on its own."""

    def __init__(self, state_dir: Path, binary: Path | None = None,
                 on_change: Callable[[], None] | None = None) -> None:
        self.state_dir = state_dir
        self.binary = binary if binary is not None else caddy_binary()
        self.on_change = on_change
        self.domain = ""
        self.status = "off"  # off | running | restarting | error
        self.error: str | None = None
        self._process: subprocess.Popen | None = None
        self._launch: Callable[[], None] | None = None
        self._lock = threading.RLock()
        self._stopping = threading.Event()
        self._generation = 0  # bumped by every start/stop so an old supervisor never relaunches

    @property
    def available(self) -> bool:
        return self.binary is not None

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def info(self) -> dict[str, Any]:
        expiry = certificate_expiry(self.state_dir, self.domain) if self.domain else None
        valid = expiry is not None and expiry > datetime.now(timezone.utc)
        error = self.error
        if error is None and self.running and not valid:
            error = last_error(self.state_dir)  # e.g. the certificate request keeps failing
        return {"status": self.status, "domain": self.domain, "error": error,
                "certificate_expires": expiry.isoformat() if expiry else None, "certificate_valid": valid}

    def start(self, domain: str, upstream_port: int, key_id: str, secret: str) -> None:
        with self._lock:
            self.stop()
            if self.binary is None:
                return self.fail("此版本没有附带 HTTPS 组件（Caddy），请安装官方 Windows 版")
            self.domain = domain
            self._stopping.clear()
            generation = self._generation
            stop_stale_instance()
            if not _wait_for_port(HTTPS_PORT):
                return self.fail(f"{HTTPS_PORT} 端口已被其他程序占用，HTTPS 无法启动")
            self.state_dir.mkdir(parents=True, exist_ok=True)
            previous_log = self.state_dir / "caddy.log"
            if previous_log.exists():
                # Errors shown in the panel must come from this run, not from an earlier configuration.
                previous_log.replace(self.state_dir / "caddy-previous.log")
            config = build_config(domain, upstream_port, self.state_dir, redirect_http=port_available(HTTP_PORT))
            config_path = self.state_dir / "caddy.json"
            config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
            env = {**os.environ, KEY_ID_ENV: key_id, SECRET_ENV: secret}
            command = [str(self.binary), "run", "--config", str(config_path)]

            def launch() -> None:
                with (self.state_dir / "caddy-stderr.log").open("wb") as stderr:
                    self._process = subprocess.Popen(
                        command, cwd=self.state_dir, env=env, stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL, stderr=stderr,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

            self._launch = launch
            try:
                launch()
            except OSError as exc:
                return self.fail(f"无法启动 HTTPS 组件：{exc}")
            self.status, self.error = "running", None
            log.info("https proxy started for %s -> 127.0.0.1:%s", domain, upstream_port)
            threading.Thread(target=self._supervise, args=(self._process, generation), name="https-proxy", daemon=True).start()
        self._changed()

    def stop(self, timeout: float = 5.0) -> None:
        with self._lock:
            self._stopping.set()
            self._generation += 1
            process, self._process, self._launch = self._process, None, None
            if process is not None and process.poll() is None:
                if not _admin_stop():
                    process.terminate()  # admin endpoint unreachable: no graceful shutdown to wait for
                try:
                    process.wait(timeout)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout)
                log.info("https proxy stopped")
            changed = self.status != "off"
            self.status, self.error = "off", None
        if changed:
            self._changed()

    def _supervise(self, process: subprocess.Popen, generation: int) -> None:
        attempt = 0
        while True:
            started = time.monotonic()
            code = process.wait()
            if self._generation != generation:
                return
            if time.monotonic() - started > 600:
                attempt = 0  # it ran fine for a while: start the backoff over
            delay = RESTART_DELAYS[min(attempt, len(RESTART_DELAYS) - 1)]
            attempt += 1
            with self._lock:
                if self._generation != generation:
                    return
                self.status = "restarting"
                self.error = last_error(self.state_dir) or f"HTTPS 组件意外退出（代码 {code}）"
            log.warning("https proxy exited with %s; restarting in %ss: %s", code, delay, self.error)
            self._changed()
            if self._stopping.wait(delay):
                return
            with self._lock:
                if self._generation != generation or self._launch is None:
                    return
                try:
                    self._launch()
                except OSError as exc:
                    self.fail(f"无法启动 HTTPS 组件：{exc}")
                    return
                process = self._process
                self.status = "running"  # keep the last error visible until a certificate shows up
            self._changed()

    def fail(self, message: str) -> None:
        log.error("https proxy: %s", message)
        self.status, self.error = "error", message
        self._changed()

    def _changed(self) -> None:
        if self.on_change:
            try:
                self.on_change()
            except Exception:  # noqa: BLE001 - a status callback must never break the proxy
                log.exception("https status callback failed")


def _admin_stop() -> bool:
    try:
        with urlopen(Request(f"http://{ADMIN_ADDRESS}/stop", method="POST", data=b""), timeout=3) as response:
            return response.status == 200
    except (URLError, OSError):
        return False


def stop_stale_instance() -> None:
    """A tray app that crashed may have left its Caddy holding 443; ask it to exit."""
    if _admin_stop():
        log.info("stopped a leftover https proxy")


def _wait_for_port(port: int, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while not port_available(port):
        if time.monotonic() > deadline:
            return False
        time.sleep(0.2)
    return True
