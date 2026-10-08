"""Start the installed GTK desktop in an Xvfb session and verify its window, API and assets."""

from __future__ import annotations

import argparse
import http.cookiejar
import io
import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from zipfile import ZipFile

from PIL import ImageGrab


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    args = parser.parse_args()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="deskatlas-smoke-") as work:
        root = Path(work)
        env = {key: value for key, value in os.environ.items() if key not in {
            "DATABASE_URL", "ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "SESSION_SECRET",
            "SETTINGS_ENCRYPTION_KEY", "UPLOAD_DIR", "BACKUPS_DIR", "DESKATLAS_DATA_DIR", "DESKATLAS_STATIC_DIR",
        }}
        with (root / "output.log").open("w+") as log:
            process = subprocess.Popen([str(args.binary), "--data-dir", str(root / "data"), "--port", str(port)],
                                       env=env, stdout=log, stderr=log)
            opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
            base = f"http://127.0.0.1:{port}"

            def request(path: str, payload: dict | None = None) -> bytes:
                body = json.dumps(payload).encode() if payload is not None else None
                with opener.open(Request(base + path, data=body, headers={"Content-Type": "application/json"}), timeout=10) as response:
                    return response.read()

            try:
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("Desktop exited before startup")
                    try:
                        if json.loads(request("/health"))["status"] == "ok":
                            break
                    except (URLError, OSError):
                        time.sleep(0.25)
                else:
                    raise RuntimeError("Desktop server did not start")
                assert json.loads(request("/api/panel/state"))["platform"] == "linux"
                assert json.loads(request("/api/setup/status"))["configured"] is False
                assert b"DeskAtlas" in request("/panel")
                window = None
                while time.monotonic() < deadline:
                    found = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", "^DeskAtlas$"], capture_output=True, text=True)
                    if found.returncode == 0 and found.stdout.strip():
                        window = found.stdout.splitlines()[0]
                        break
                    time.sleep(0.25)
                assert window, "GTK status window is not visible"
                time.sleep(3)
                image = ImageGrab.grab()
                assert len(image.getcolors(image.width * image.height) or []) > 30, "Desktop screenshot is blank"
                Path("dist").mkdir(exist_ok=True)
                image.save("dist/ubuntu-smoke.png")
                request("/api/setup/initialize", {"username": "smoke-admin", "password": "smoke-password-123"})
                request("/api/admin/login", {"username": "smoke-admin", "password": "smoke-password-123"})
                levels = json.loads(request("/api/admin/options"))["program_levels"]
                assert levels == ["本科", "硕士", "博士", "博士后", "硕转博"]
                for level in levels:
                    student = json.loads(request("/api/admin/students", {"name": "Smoke " + level, "program_level": level}))
                    assert student["program_level"] == level
                with ZipFile(io.BytesIO(request("/api/admin/backup/export"))) as package:
                    config = package.read("config.env").decode()
                    assert "ADMIN_USERNAME" not in config and "ADMIN_PASSWORD_HASH" not in config
                assert process.poll() is None
                print("PASS: installed Ubuntu desktop window, static frontend, SQLite, five stages, credential-free backup")
            except Exception:
                log.seek(0)
                print(log.read())
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
