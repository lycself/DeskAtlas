import io
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from desktop import hostos, updater as updater_module
from desktop.updater import Updater, UpdateError
from installer.build_deb import stage_package


def linux_host(monkeypatch):
    monkeypatch.setattr(hostos, "IS_WINDOWS", False)
    monkeypatch.setattr(hostos, "IS_MAC", False)
    monkeypatch.setattr(hostos, "IS_LINUX", True)


def test_linux_autostart_uses_user_desktop_entry(tmp_path, monkeypatch):
    linux_host(monkeypatch)
    monkeypatch.setattr(hostos, "is_frozen", lambda: True)
    monkeypatch.setattr(hostos.sys, "executable", "/opt/Desk Atlas/DeskAtlas")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    assert hostos.autostart_supported() and not hostos.autostart_enabled()
    hostos.set_autostart(True)
    entry = tmp_path / "autostart/deskatlas.desktop"
    assert 'Exec="/opt/Desk Atlas/DeskAtlas"' in entry.read_text()
    assert hostos.autostart_enabled()
    entry.write_text(entry.read_text() + "Hidden=true\n")
    assert not hostos.autostart_enabled()
    hostos.set_autostart(True)
    assert hostos.autostart_enabled()
    hostos.set_autostart(False)
    hostos.set_autostart(False)
    assert not entry.exists()


def test_linux_system_dialog_cancel_and_host_library_environment(monkeypatch):
    linux_host(monkeypatch)
    monkeypatch.setenv("LD_LIBRARY_PATH", "/bundled/libraries")
    monkeypatch.setenv("LD_LIBRARY_PATH_ORIG", "/system/libraries")
    calls = []

    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        return SimpleNamespace(returncode=1)

    monkeypatch.setattr(hostos.subprocess, "run", run)
    assert hostos.confirm("退出", "确定退出？") is False
    assert calls[0][0][:2] == ["zenity", "--question"]
    assert calls[0][1]["env"]["LD_LIBRARY_PATH"] == "/system/libraries"


def test_linux_update_verifies_deb_and_opens_system_installer_without_quitting(tmp_path, monkeypatch):
    monkeypatch.setattr(updater_module, "IS_WINDOWS", False)
    monkeypatch.setattr(updater_module, "IS_LINUX", True)
    payload = b"deb-package"
    monkeypatch.setattr(updater_module, "urlopen", lambda *args, **kwargs: io.BytesIO(payload))
    opened = []
    monkeypatch.setattr(updater_module, "run_installer", opened.append)
    updater = Updater(tmp_path, lambda: "", lambda: pytest.fail("Linux updates must keep the running service available"))
    manifest = {"version": "1.4.0", "url": "https://github.com/lycself/DeskAtlas/releases/download/v1.4.0/DeskAtlas-1.4.0-Ubuntu-amd64.deb",
                "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)}
    updater._manifest = manifest
    updater.info["status"] = "available"
    monkeypatch.setattr(updater_module.threading, "Thread", lambda target, **kwargs: SimpleNamespace(start=target))
    assert updater.apply()["status"] == "ready"
    assert opened[0].suffix == ".deb" and opened[0].read_bytes() == payload
    with pytest.raises(UpdateError, match="操作系统不匹配"):
        updater._download({**manifest, "url": "https://example.com/windows.exe"})
    with pytest.raises(UpdateError, match="校验失败"):
        updater._download({**manifest, "sha256": "0" * 64})
    assert not list(updater.downloads.glob("*.part"))


def test_deb_staging_has_launcher_icon_dependencies_and_static_site(tmp_path):
    bundle = tmp_path / "bundle"
    static = bundle / "_internal/static"
    static.mkdir(parents=True)
    (static / "index.html").write_text("DeskAtlas")
    executable = bundle / "DeskAtlas"
    executable.write_text("binary")
    executable.chmod(0o755)
    root = tmp_path / "package"
    stage_package(bundle, root, "1.4.0")
    assert (root / "usr/bin/deskatlas").readlink() == Path("/opt/deskatlas/DeskAtlas")
    assert (root / "usr/share/icons/hicolor/256x256/apps/deskatlas.png").is_file()
    assert "Exec=/usr/bin/deskatlas" in (root / "usr/share/applications/deskatlas.desktop").read_text()
    assert "libwebkit2gtk-4.1-0" in (root / "DEBIAN/control").read_text()
    assert (root / "opt/deskatlas/_internal/static/index.html").is_file()
    assert not list(root.rglob("*.env")) and not list(root.rglob("*.db"))


def test_linux_settings_use_own_update_manifest(tmp_path):
    import subprocess
    import sys

    result = subprocess.run([sys.executable, "-c", "import sys; sys.platform = 'linux'; from desktop.settings import DesktopSettings; print(DesktopSettings().update_url)"],
                            check=True, capture_output=True, text=True)
    assert result.stdout.strip().endswith("latest/download/latest-linux.json")
