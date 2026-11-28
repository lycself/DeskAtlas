"""HTTPS through the bundled Caddy: config, stored credentials, proxy supervision, and forwarded-client trust."""

import json
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from backend.app import security
from desktop import https as https_module
from desktop.https import HttpsProxy, build_config, last_error
from desktop.server import ServerThread, port_available
from desktop.settings import DesktopSettings


def free_port(start: int) -> int:
    return next(candidate for candidate in range(start, start + 200) if port_available(candidate))


def wait_until(condition, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("condition not reached in time")
        time.sleep(0.05)


def test_config_proxies_the_domain_and_keeps_secrets_and_panel_out(tmp_path: Path) -> None:
    config = build_config("physdesk.cn", 8080, tmp_path, redirect_http=False)
    text = json.dumps(config)
    server = config["apps"]["http"]["servers"]["deskatlas"]
    blocked, proxied = server["routes"]
    assert blocked["match"][0]["host"] == ["physdesk.cn"]
    assert {"/api/panel/*", "/panel/*"} <= set(blocked["match"][0]["path"])
    assert blocked["handle"][0]["status_code"] == 404
    assert proxied["handle"][0]["upstreams"] == [{"dial": "127.0.0.1:8080"}]
    assert server["automatic_https"] == {"disable_redirects": True}
    provider = config["apps"]["tls"]["automation"]["policies"][0]["issuers"][0]["challenges"]["dns"]["provider"]
    assert provider == {"name": "alidns", "access_key_id": "{env.DESKATLAS_ALIDNS_KEY_ID}",
                        "access_key_secret": "{env.DESKATLAS_ALIDNS_SECRET}"}
    assert config["admin"]["config"]["persist"] is False
    assert "\\" not in text  # Windows paths are written with forward slashes
    assert "automatic_https" not in build_config("physdesk.cn", 8080, tmp_path, redirect_http=True)["apps"]["http"]["servers"]["deskatlas"]


def test_https_settings_validate_and_encrypt_the_secret(tmp_path: Path) -> None:
    settings = DesktopSettings.load(tmp_path / "settings.json")
    settings.set_https_domain(" https://PhysDesk.cn/ ")
    assert settings.https_domain == "physdesk.cn"
    for bad in ("physdesk", "phys desk.cn", "-bad.cn", "物理.cn", "a..cn"):
        with pytest.raises(ValueError, match="域名格式"):
            settings.set_https_domain(bad)
    with pytest.raises(ValueError, match="AccessKey ID"):
        settings.set_alidns_key_id("LTAI 5t")
    settings.set_alidns_key_id("LTAI5tTestKeyId")
    settings.set_alidns_secret("alidns-secret-value")
    settings.https_enabled = True
    settings.save()
    stored = settings.path.read_text()
    assert "alidns-secret-value" not in stored and "alidns-secret-value" not in repr(settings)
    public = settings.public()
    assert public["alidns_secret_configured"] is True and "alidns_secret_encrypted" not in public
    loaded = DesktopSettings.load(settings.path)
    assert loaded.https_enabled and loaded.https_domain == "physdesk.cn"
    assert loaded.alidns_secret() == "alidns-secret-value"
    loaded.set_update_token("github_pat_shared_key")  # both credentials share one local key
    assert loaded.update_token() == "github_pat_shared_key" and loaded.alidns_secret() == "alidns-secret-value"


def test_last_error_prefers_startup_failures_then_log_errors(tmp_path: Path) -> None:
    assert last_error(tmp_path) is None
    (tmp_path / "caddy.log").write_text("\n".join([
        json.dumps({"level": "info", "msg": "serving"}),
        json.dumps({"level": "error", "msg": "could not get certificate from issuer", "error": "InvalidAccessKeyId.NotFound"}),
        "not json",
    ]), encoding="utf-8")
    assert last_error(tmp_path) == "could not get certificate from issuer: InvalidAccessKeyId.NotFound"
    (tmp_path / "caddy-stderr.log").write_text("starting\nError: loading config: listen tcp :443: bind: permission denied\n")
    assert last_error(tmp_path) == "loading config: listen tcp :443: bind: permission denied"


FAKE_CADDY = """#!{python}
import json, os, sys, time
from pathlib import Path
state = Path(sys.argv[sys.argv.index("--config") + 1]).parent
record = {{"argv": sys.argv[1:], "key_id": os.environ.get("DESKATLAS_ALIDNS_KEY_ID"),
          "secret": os.environ.get("DESKATLAS_ALIDNS_SECRET"), "pid": os.getpid()}}
runs = state / "runs.jsonl"
with runs.open("a") as handle:
    handle.write(json.dumps(record) + "\\n")
if (state / "crash").exists():
    print("Error: boom", file=sys.stderr)
    sys.exit(1)
time.sleep(60)
"""


@pytest.fixture
def fake_caddy(tmp_path: Path, monkeypatch) -> Path:
    if sys.platform == "win32":
        pytest.skip("the fake Caddy is a POSIX script")
    binary = tmp_path / "bin" / "caddy"
    binary.parent.mkdir()
    binary.write_text(FAKE_CADDY.format(python=sys.executable))
    binary.chmod(0o755)
    monkeypatch.setattr(https_module, "_wait_for_port", lambda port, timeout=5.0: True)
    monkeypatch.setattr(https_module, "port_available", lambda port, host="0.0.0.0": True)
    monkeypatch.setattr(https_module, "stop_stale_instance", lambda: None)
    monkeypatch.setattr(https_module, "_admin_stop", lambda: False)
    monkeypatch.setattr(https_module, "RESTART_DELAYS", (0.2,))
    return binary


def runs(state: Path) -> list[dict]:
    path = state / "runs.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def test_proxy_passes_credentials_by_environment_and_stops(tmp_path: Path, fake_caddy: Path) -> None:
    state = tmp_path / "caddy"
    proxy = HttpsProxy(state, binary=fake_caddy)
    try:
        proxy.start("physdesk.cn", 18080, "key-id", "very-secret")
        wait_until(lambda: runs(state))
        assert proxy.running and proxy.status == "running"
        record = runs(state)[0]
        assert record["argv"][:2] == ["run", "--config"]
        assert record["key_id"] == "key-id" and record["secret"] == "very-secret"
        assert "very-secret" not in (state / "caddy.json").read_text()
        info = proxy.info()
        assert info["domain"] == "physdesk.cn" and info["certificate_valid"] is False
    finally:
        proxy.stop()
    assert not proxy.running and proxy.status == "off"


def test_proxy_restarts_after_a_crash_and_reports_why(tmp_path: Path, fake_caddy: Path) -> None:
    state = tmp_path / "caddy"
    state.mkdir()
    (state / "crash").touch()
    changes: list[str] = []
    proxy = HttpsProxy(state, binary=fake_caddy, on_change=lambda: changes.append(proxy.status))
    try:
        proxy.start("physdesk.cn", 18080, "key-id", "secret")
        wait_until(lambda: len(runs(state)) >= 2)
        assert proxy.info()["error"] == "boom"
        assert "restarting" in changes
        (state / "crash").unlink()
        wait_until(lambda: proxy.running and len(runs(state)) >= 3)
    finally:
        proxy.stop()
    count = len(runs(state))
    time.sleep(0.5)
    assert len(runs(state)) == count  # a stopped proxy is never relaunched by its old supervisor


def test_proxy_without_bundled_caddy_reports_it(tmp_path: Path) -> None:
    proxy = HttpsProxy(tmp_path, binary=None)
    proxy.binary = None
    proxy.start("physdesk.cn", 18080, "id", "secret")
    assert proxy.status == "error" and "HTTPS 组件" in proxy.error


def test_server_trusts_forwarded_client_only_from_the_local_proxy() -> None:
    """The panel and the login limit judge requests by client address; behind Caddy that is X-Forwarded-For."""
    from backend.app.main import app

    server = ServerThread(app, host="127.0.0.1")
    port = free_port(18700)
    server.start(port)
    base = f"http://127.0.0.1:{port}"

    def call(path: str, headers: dict, body: dict | None = None) -> tuple[int, dict]:
        request = Request(base + path, headers={"Content-Type": "application/json", **headers},
                          data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET")
        try:
            with urlopen(request, timeout=10) as response:
                return response.status, dict(response.headers)
        except HTTPError as exc:
            return exc.code, dict(exc.headers)

    try:
        assert call("/api/panel/state", {})[0] == 200
        assert call("/api/panel/state", {"X-Forwarded-For": "203.0.113.9"})[0] == 403

        wrong = {"username": "admin", "password": "wrong-password"}
        for _ in range(8):
            assert call("/api/admin/login", {"X-Forwarded-For": "203.0.113.10"}, wrong)[0] == 401
        assert call("/api/admin/login", {"X-Forwarded-For": "203.0.113.10"}, wrong)[0] == 429
        assert call("/api/admin/login", {"X-Forwarded-For": "203.0.113.11"}, wrong)[0] == 401  # others are not locked out

        good = {"username": "admin", "password": "test-password-123"}
        status, headers = call("/api/admin/login", {"X-Forwarded-For": "203.0.113.12", "X-Forwarded-Proto": "https"}, good)
        assert status == 200 and "secure" in headers["set-cookie"].lower()
        status, headers = call("/api/admin/login", {}, good)
        assert status == 200 and "secure" not in headers["set-cookie"].lower()
    finally:
        server.stop()
        security.attempts.clear()


def test_controller_binds_locally_while_https_is_on(tmp_path: Path, fake_caddy: Path, monkeypatch) -> None:
    from backend.app.config import get_settings
    from backend.app.database import engine
    from backend.app.main import app
    from desktop.controller import DesktopController

    settings = get_settings()
    monkeypatch.setattr(type(settings), "data_dir", property(lambda self: tmp_path))
    monkeypatch.setattr(https_module, "caddy_binary", lambda: fake_caddy)
    desktop = DesktopSettings.load(tmp_path / "settings.json")
    desktop.port = free_port(18900)
    controller = DesktopController(app, settings, desktop, engine)
    app.state.panel = controller
    try:
        controller.start()
        assert controller.server.host == "0.0.0.0" and not controller.proxy.running
        with pytest.raises(ValueError, match="请先填写"):
            controller.update_settings({"https_enabled": True})

        result = controller.update_settings({"https_domain": "physdesk.cn", "alidns_key_id": "key-id",
                                             "alidns_secret": "secret", "https_enabled": True})
        assert "证书" in result["message"] and "secret" not in json.dumps(result["settings"]).replace("alidns_secret_configured", "")
        wait_until(lambda: controller.server.host == "127.0.0.1" and controller.server.running and controller.proxy.running)
        state = controller.state()
        assert state["https"]["active"] and state["display_url"] == "https://physdesk.cn"
        wait_until(lambda: runs(tmp_path / "caddy"))
        assert runs(tmp_path / "caddy")[-1]["secret"] == "secret"

        controller.update_settings({"https_enabled": False})
        wait_until(lambda: controller.server.host == "0.0.0.0" and controller.server.running and not controller.proxy.running)
        assert controller.display_url().startswith("http://")
    finally:
        controller.shutdown()
        app.state.panel = None
