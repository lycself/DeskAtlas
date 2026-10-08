"""Desktop shell pieces that run headlessly: settings file, update manifests, embedded server, controller."""

import base64
import hashlib
import io
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError

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


def test_update_token_is_encrypted_local_and_can_be_cleared(tmp_path: Path) -> None:
    settings = DesktopSettings.load(tmp_path / "settings.json")
    token = "github_pat_test_credential"
    settings.set_update_token(token)
    settings.save()
    assert token not in settings.path.read_text()
    assert token not in repr(settings)
    assert settings.public()["update_token_configured"] is True
    assert "update_token_encrypted" not in settings.public()
    loaded = DesktopSettings.load(settings.path)
    assert loaded.update_token() == token
    with pytest.raises(ValueError, match="空格或换行"):
        loaded.set_update_token("token\r\ninjected")
    (tmp_path / "update-token.key").unlink()
    with pytest.raises(ValueError, match="重新填写"):
        loaded.update_token()
    loaded.set_update_token("")
    loaded.save()
    assert DesktopSettings.load(settings.path).update_token() == ""


def test_private_release_check_and_download_use_authenticated_api(tmp_path: Path, monkeypatch) -> None:
    installer = b"verified installer content"
    installer_url = OFFICIAL + "download/v9.9.9/DeskAtlas-Setup-9.9.9.exe"
    manifest = {"version": "9.9.9", "url": installer_url,
                "sha256": hashlib.sha256(installer).hexdigest(), "size": len(installer)}
    base = "https://api.github.com/repos/lycself/DeskAtlas/releases"
    calls = []

    def fake_open(request, timeout):
        calls.append((request.full_url, request.get_header("Accept"), timeout))
        assert request.unredirected_hdrs["Authorization"] == "Bearer test-token"
        assert "Authorization" not in request.headers
        if request.full_url == base + "/latest":
            return io.BytesIO(json.dumps({"assets": [{"name": "latest.json", "id": 11}]}).encode())
        if request.full_url == base + "/tags/v9.9.9":
            return io.BytesIO(json.dumps({"assets": [{"name": "DeskAtlas-Setup-9.9.9.exe", "id": 12}]}).encode())
        if request.full_url == base + "/assets/11":
            return io.BytesIO(json.dumps(manifest).encode())
        if request.full_url == base + "/assets/12":
            return io.BytesIO(installer)
        pytest.fail(f"unexpected URL: {request.full_url}")

    monkeypatch.setattr(updater_module, "urlopen", fake_open)
    updater = Updater(tmp_path, lambda: OFFICIAL + "latest/download/latest.json", lambda: None,
                      token_getter=lambda: "test-token")
    assert updater.check()["status"] == "available"
    assert updater._download(updater._manifest).read_bytes() == installer
    assert calls == [(base + "/latest", "application/vnd.github+json", 15),
                     (base + "/assets/11", "application/octet-stream", 15),
                     (base + "/tags/v9.9.9", "application/vnd.github+json", 15),
                     (base + "/assets/12", "application/octet-stream", 60)]
    # Authentication must not bypass the installer's hash verification.
    with pytest.raises(UpdateError, match="安装包校验失败"):
        updater._download({**manifest, "sha256": "0" * 64})
    assert not list(updater.downloads.glob("*.part"))


@pytest.mark.parametrize("code, expected", [(401, "无效或已过期"), (403, "Contents"), (404, "仓库访问权限")])
def test_private_release_auth_errors(tmp_path: Path, monkeypatch, code: int, expected: str) -> None:
    def fail(request, timeout):
        raise HTTPError(request.full_url, code, "failure", {}, None)

    monkeypatch.setattr(updater_module, "urlopen", fail)
    updater = Updater(tmp_path, lambda: OFFICIAL + "latest/download/latest.json", lambda: None,
                      token_getter=lambda: "secret-token")
    info = updater.check()
    assert info["status"] == "error" and expected in info["error"]
    assert "secret-token" not in json.dumps(info)


def test_update_mirror_does_not_receive_token(tmp_path: Path, monkeypatch) -> None:
    def fake_open(request, timeout):
        assert request.full_url == MIRROR
        assert request.get_header("Authorization") is None
        return io.BytesIO(b"{}")

    def forbidden_token_read():
        pytest.fail("mirror requests must not even read the official token")

    monkeypatch.setattr(updater_module, "urlopen", fake_open)
    updater = Updater(tmp_path, lambda: MIRROR, lambda: None, token_getter=forbidden_token_read)
    assert updater.check()["status"] == "unsigned"


def test_github_asset_redirect_does_not_forward_token(tmp_path: Path) -> None:
    received = []

    class RedirectHandler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            received.append((self.path, self.headers.get("Authorization")))
            if self.path == "/asset":
                self.send_response(302)
                self.send_header("Location", f"http://localhost:{self.server.server_port}/download")
                self.end_headers()
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"asset content")

        def log_message(self, *_args):
            pass

    server = HTTPServer(("127.0.0.1", 0), RedirectHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        updater = Updater(tmp_path, lambda: "", lambda: None)
        with updater._github_request(f"http://127.0.0.1:{server.server_port}/asset", "test-secret", binary=True) as response:
            assert response.read() == b"asset content"
        assert received == [("/asset", "Bearer test-secret"), ("/download", None)]
    finally:
        server.shutdown()
        server.server_close()


def test_private_release_without_requested_asset(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(updater_module, "urlopen", lambda request, timeout: io.BytesIO(b'{"assets": []}'))
    updater = Updater(tmp_path, lambda: OFFICIAL + "latest/download/latest.json", lambda: None,
                      token_getter=lambda: "token")
    assert "缺少更新附件" in updater.check()["error"]


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
        with urllib.request.urlopen(urllib.request.Request(
            f"http://127.0.0.1:{port}/api/panel/settings",
            data=json.dumps({"update_token": "controller-secret"}).encode(),
            headers={"Content-Type": "application/json"}, method="PUT"), timeout=10) as response:
            result = json.loads(response.read())
        assert result["settings"]["update_token_configured"] is True
        assert "controller-secret" not in json.dumps(controller.state())
        assert "controller-secret" not in json.dumps(result)
        controller.update_settings({"public_address": ""})
        assert desktop.update_token() == "controller-secret"  # unrelated saves preserve credentials
        controller.update_settings({"update_token": ""})
        assert desktop.update_token() == ""
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


class FakeWinreg:
    """Just enough of winreg for desktop.hostos: one hive of {key path: {value name: value}}."""

    HKEY_CURRENT_USER = "HKCU"
    KEY_SET_VALUE = 2
    REG_SZ = 1

    def __init__(self) -> None:
        self.keys: dict[str, dict[str, object]] = {}

    class _Key:
        def __init__(self, values: dict[str, object]) -> None:
            self.values = values

        def __enter__(self):
            return self

        def __exit__(self, *exc) -> None:
            pass

    def OpenKey(self, hive, path, reserved=0, access=0):
        if path not in self.keys:
            raise FileNotFoundError(path)
        return self._Key(self.keys[path])

    def CreateKey(self, hive, path):
        return self._Key(self.keys.setdefault(path, {}))

    def QueryValueEx(self, key, name):
        if name not in key.values:
            raise FileNotFoundError(name)
        return key.values[name], self.REG_SZ

    def SetValueEx(self, key, name, reserved, kind, value) -> None:
        key.values[name] = value

    def DeleteValue(self, key, name) -> None:
        if name not in key.values:
            raise FileNotFoundError(name)
        del key.values[name]


def test_windows_autostart_uses_run_value_and_migrates_legacy_shortcut(tmp_path: Path, monkeypatch) -> None:
    import sys

    from desktop import hostos

    registry = FakeWinreg()
    monkeypatch.setitem(sys.modules, "winreg", registry)
    monkeypatch.setattr(hostos, "IS_WINDOWS", True)
    monkeypatch.setattr(hostos, "IS_MAC", False)
    monkeypatch.setattr(hostos, "is_frozen", lambda: True)
    monkeypatch.setattr(hostos.sys, "executable", r"C:\Users\t\AppData\Local\Programs\DeskAtlas\DeskAtlas.exe")
    monkeypatch.setenv("APPDATA", str(tmp_path))
    legacy = tmp_path / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / "DeskAtlas.lnk"

    assert hostos.autostart_enabled() is False
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"lnk")
    assert hostos.autostart_enabled() is True

    hostos.set_autostart(True)
    assert not legacy.exists()
    assert registry.keys[hostos.RUN_KEY]["DeskAtlas"] == r'"C:\Users\t\AppData\Local\Programs\DeskAtlas\DeskAtlas.exe"'
    assert hostos.autostart_enabled() is True

    # Disabled from Task Manager: the Run value stays but no longer counts; enabling again clears the switch.
    registry.keys[hostos.STARTUP_APPROVED_KEY] = {"DeskAtlas": bytes([3]) + bytes(11)}
    assert hostos.autostart_enabled() is False
    hostos.set_autostart(True)
    assert "DeskAtlas" not in registry.keys[hostos.STARTUP_APPROVED_KEY]
    assert hostos.autostart_enabled() is True

    hostos.set_autostart(False)
    assert "DeskAtlas" not in registry.keys[hostos.RUN_KEY]
    assert hostos.autostart_enabled() is False
    hostos.set_autostart(False)  # idempotent


def test_installer_never_elevates_or_runs_hidden_shells() -> None:
    script = (Path(__file__).resolve().parents[2] / "installer" / "DeskAtlas.iss").read_text(encoding="utf-8").lower()
    for marker in ("runas", "netsh", "{cmd}", "powershell", "privilegesrequired=admin"):
        assert marker not in script, marker
    autostart = next(line for line in script.splitlines() if line.startswith('name: "autostart"'))
    assert "flags: unchecked" in autostart and "check: isfirstinstall" in autostart
