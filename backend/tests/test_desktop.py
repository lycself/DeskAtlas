"""Desktop shell pieces that run headlessly: settings file, update manifests, embedded server, controller."""

import base64
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from desktop import updater as updater_module
from desktop.settings import DesktopSettings
from desktop.updater import UpdateError, Updater, canonical_bytes, verify_manifest


def test_settings_roundtrip_and_clamping(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    settings = DesktopSettings.load(path)
    assert settings.port == 8080 and settings.auto_backup is True
    settings.port = 9000
    settings.public_address = "desk.example.edu"
    settings.save()
    reloaded = DesktopSettings.load(path)
    assert reloaded.port == 9000 and reloaded.public_address == "desk.example.edu"
    path.write_text(json.dumps({"port": 999999, "backup_keep": 0, "prevent_sleep": "yes"}), encoding="utf-8")
    clamped = DesktopSettings.load(path)
    assert clamped.port == 65535 and clamped.backup_keep == 1 and clamped.prevent_sleep is True


def signed_manifest(private: Ed25519PrivateKey, **overrides) -> dict:
    manifest = {"version": "9.9.9", "url": "http://127.0.0.1/none.exe", "sha256": "00", "size": 1, "notes": "n", **overrides}
    manifest["signature"] = base64.b64encode(private.sign(canonical_bytes(manifest))).decode()
    return manifest


OFFICIAL = "https://github.com/lycself/DeskAtlas/releases/"
MIRROR = "http://intranet.example.edu/deskatlas/latest.json"


def test_manifest_signature_verification(monkeypatch) -> None:
    private = Ed25519PrivateKey.generate()
    public = base64.b64encode(private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    monkeypatch.setattr(updater_module, "PUBLIC_KEY", public)
    manifest = signed_manifest(private)
    verify_manifest(manifest, MIRROR)  # signed manifests work from any source
    tampered = {**manifest, "url": "http://evil.example/x.exe"}
    with pytest.raises(UpdateError):
        verify_manifest(tampered, MIRROR)

    unsigned = {key: value for key, value in manifest.items() if key != "signature"}
    with pytest.raises(UpdateError, match="unsigned"):
        verify_manifest(unsigned, MIRROR)  # mirrors must sign
    official_unsigned = {**unsigned, "url": OFFICIAL + "download/v9.9.9/DeskAtlas-Setup-9.9.9.exe"}
    verify_manifest(official_unsigned, OFFICIAL + "latest/download/latest.json")  # HTTPS to GitHub is enough
    with pytest.raises(UpdateError, match="unsigned"):
        verify_manifest(unsigned, OFFICIAL + "latest/download/latest.json")  # official source, but installer elsewhere
    with pytest.raises(UpdateError, match="unsigned"):
        verify_manifest(official_unsigned, "http://github.com/lycself/DeskAtlas/releases/latest/download/latest.json")  # plain http


class ManifestHandler(BaseHTTPRequestHandler):
    payload = b"{}"

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, *_args) -> None:
        return


@pytest.fixture
def manifest_server():
    server = HTTPServer(("127.0.0.1", 0), ManifestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()


def test_updater_check_reports_newer_and_current_versions(tmp_path: Path, monkeypatch, manifest_server) -> None:
    private = Ed25519PrivateKey.generate()
    public = base64.b64encode(private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    monkeypatch.setattr(updater_module, "PUBLIC_KEY", public)
    monkeypatch.setattr(updater_module, "VERSION", "1.2.0")
    url = f"http://127.0.0.1:{manifest_server.server_port}/latest.json"
    updater = Updater(tmp_path, lambda: url, lambda: None)

    ManifestHandler.payload = json.dumps(signed_manifest(private, version="1.3.0")).encode()
    info = updater.check()
    assert info["status"] == "available" and info["latest"] == "1.3.0"

    ManifestHandler.payload = json.dumps(signed_manifest(private, version="1.2.0")).encode()
    assert updater.check()["status"] == "latest"

    ManifestHandler.payload = json.dumps({k: v for k, v in signed_manifest(private, version="2.0.0").items() if k != "signature"}).encode()
    assert updater.check()["status"] == "unsigned"  # the local test server is not the official source

    ManifestHandler.payload = b"garbage"
    assert updater.check()["status"] == "error"

    with pytest.raises(ValueError):
        updater.apply()


def test_controller_serves_and_restarts(tmp_path: Path, monkeypatch) -> None:
    import urllib.request

    from backend.app.config import get_settings
    from backend.app.database import engine
    from backend.app.main import app
    from desktop.controller import DesktopController
    from desktop.server import port_available

    settings = get_settings()
    monkeypatch.setattr(type(settings), "data_dir", property(lambda self: tmp_path))
    desktop = DesktopSettings.load(tmp_path / "settings.json")
    port = next(candidate for candidate in range(18500, 18600) if port_available(candidate))
    desktop.port = port
    controller = DesktopController(app, settings, desktop, engine)
    app.state.panel = controller
    try:
        controller.start()
        assert controller.server.running
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/panel/state", timeout=10) as response:
            state = json.loads(response.read())
        assert state["available"] is True and state["port"] == port
        assert state["display_url"].endswith(f":{port}")
        backup = controller.backup_now("manual")
        assert (settings.backup_dir / backup["name"]).is_file()
        assert "restarting" not in controller.update_settings({"port": port})  # unchanged port: no restart
        busy = socket.socket()
        busy.bind(("0.0.0.0", 0))
        busy.listen(1)
        try:
            with pytest.raises(ValueError):
                controller.update_settings({"port": busy.getsockname()[1]})
        finally:
            busy.close()
        assert controller.update_settings({"public_address": "host.example"})["settings"]["public_address"] == "host.example"
        assert controller.display_url() == f"http://host.example:{port}"
        assert controller.server.port == port and controller.server.running
    finally:
        controller.shutdown()
        app.state.panel = None
    assert not controller.server.running
