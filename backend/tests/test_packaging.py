"""Setup wizard, backup packages, static site hosting, panel guard, and UTC datetimes."""

from datetime import timezone
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from cryptography.fernet import Fernet
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.config import get_settings
from backend.app.database import SessionLocal, build_engine
from backend.app.datatransfer import copy_all_tables, export_backup, inspect_backup, restore_backup
from backend.app.database import Base, engine
from backend.app.main import app
from backend.app.migrations import current_revision, head_revision
from backend.app.mailer import decrypt_secret
from backend.app.models import Room, SmtpSetting, Student
from backend.app.security import hash_password, verify_password
from backend.app.static_site import resolve_static
from backend.tests.test_workflows import create_published_room, login


settings = get_settings()


def legacy_backup(contents: bytes) -> bytes:
    result = BytesIO()
    with ZipFile(BytesIO(contents)) as source, ZipFile(result, "w") as target:
        for entry in source.infolist():
            data = source.read(entry.filename)
            if entry.filename == "config.env":
                data += (
                    "ADMIN_USERNAME='source-admin'\n"
                    f"ADMIN_PASSWORD_HASH='{hash_password('source-password-123')}'\n"
                    "SESSION_SECRET='source-session-secret'\n"
                ).encode()
            target.writestr(entry, data)
    return result.getvalue()


def test_datetimes_come_back_timezone_aware() -> None:
    with TestClient(app) as client:
        login(client)
        room, _ = create_published_room(client, "时区房间", ["A1"])
        assert room["published_at"].endswith(("Z", "+00:00"))
    with SessionLocal() as db:
        stored = db.scalar(select(Room).where(Room.id == room["id"]))
        assert stored.published_at.tzinfo is not None
        assert stored.published_at.utcoffset() == timezone.utc.utcoffset(None)


def test_setup_status_reports_configured_and_refuses_reinitialisation() -> None:
    with TestClient(app) as client:
        status = client.get("/api/setup/status").json()
        assert status["configured"] is True
        assert status["database"] == "sqlite"
        blocked = client.post("/api/setup/initialize", json={"username": "someone", "password": "another-password-1"})
        assert blocked.status_code == 409
        blocked = client.post("/api/setup/restore", files={"file": ("x.zip", b"nope", "application/zip")})
        assert blocked.status_code == 409


def test_backup_roundtrip_restores_rows_and_uploads(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(type(settings), "config_path", property(lambda self: tmp_path / "config.env"))
    with TestClient(app) as client:
        login(client)
        room, seats = create_published_room(client, "备份房间", ["B1", "B2"])
        created = client.post("/api/admin/students", json={"name": "备份学生", "student_no": "BACKUP001", "seat_id": seats[0]})
        assert created.status_code == 201, created.text
        student = created.json()
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        marker = settings.upload_dir / "marker.txt"
        marker.write_text("keep me", encoding="utf-8")

        response = client.get("/api/admin/backup/export")
        assert response.status_code == 200
        assert response.headers["content-disposition"].endswith('.zip"')
        package = ZipFile(BytesIO(response.content))
        manifest = inspect_backup(package)
        assert manifest["schema_revision"] == head_revision()
        assert "config.env" in package.namelist()
        assert "uploads/marker.txt" in package.namelist()
        exported_config = package.read("config.env").decode()
        assert "ADMIN_USERNAME" not in exported_config
        assert "ADMIN_PASSWORD_HASH" not in exported_config
        assert "SESSION_SECRET" not in exported_config
        assert settings.settings_encryption_key in exported_config
        local_credentials = (settings.admin_username, settings.admin_password_hash, settings.session_secret)

        # Destroy state, then restore from the download.
        deleted = client.patch(f"/api/admin/rooms/{room['id']}", json={"name": "改名房间"})
        assert deleted.status_code == 200
        assert client.patch(f"/api/admin/students/{student['id']}", json={"name": "改名学生"}).status_code == 200
        marker.unlink()
        restored = client.post("/api/admin/backup/restore", files={"file": ("backup.zip", legacy_backup(response.content), "application/zip")})
        assert restored.status_code == 200, restored.text
        assert restored.json()["relogin"] is True
        assert restored.json()["tables"]["rooms"] >= 1
        assert restored.json()["config_restored"] == ["SETTINGS_ENCRYPTION_KEY"]
        assert (settings.admin_username, settings.admin_password_hash, settings.session_secret) == local_credentials
        assert marker.read_text(encoding="utf-8") == "keep me"

        login(client)
        restored_student = client.get(f"/api/admin/students/{student['id']}").json()
        assert restored_student["name"] == "备份学生"
        assert restored_student["student_no"] == "BACKUP001"
        assert restored_student["current_assignment"]["seat_id"] == seats[0]
        rooms = client.get("/api/admin/rooms").json()
        assert any(item["name"] == "备份房间" for item in rooms)
        assert not any(item["name"] == "改名房间" for item in rooms)
        audit = client.get("/api/admin/audit")
        assert audit.status_code == 200
        assert any(row["action"] == "backup.restored" for row in audit.json())
        listed = client.get("/api/admin/backup").json()
        assert "items" in listed and "directory" in listed
        created = client.post("/api/admin/backup")
        assert created.status_code == 201
        name = created.json()["name"]
        assert any(item["name"] == name for item in client.get("/api/admin/backup").json()["items"])
        downloaded = client.get(f"/api/admin/backup/file/{name}")
        assert downloaded.status_code == 200
        assert client.delete(f"/api/admin/backup/file/{name}").status_code == 204
        assert client.get(f"/api/admin/backup/file/{name}").status_code == 404
        assert client.get("/api/admin/backup/file/../secret.zip").status_code == 404


@pytest.mark.parametrize("legacy", [False, True], ids=["current-backup", "legacy-backup"])
def test_first_run_restore_requires_new_local_admin(tmp_path: Path, monkeypatch, legacy: bool) -> None:
    config_path = tmp_path / "config.env"
    monkeypatch.setattr(type(settings), "config_path", property(lambda self: config_path))
    monkeypatch.setattr(settings, "settings_encryption_key", Fernet.generate_key().decode())
    with TestClient(app) as client:
        login(client)
        variant = "legacy" if legacy else "current"
        room, seats = create_published_room(client, f"初始化导入房间-{variant}", ["I1"])
        student = client.post("/api/admin/students", json={
            "name": "初始化导入学生", "student_no": f"INIT-{variant}", "seat_id": seats[0],
        }).json()
        smtp = client.put("/api/admin/smtp", json={
            "host": "smtp.example.com", "port": 587, "security": "starttls",
            "username": "sender", "password": "mail-secret",
            "sender_name": "DeskAtlas", "sender_email": "sender@example.com",
        })
        assert smtp.status_code == 200, smtp.text
        contents = client.get("/api/admin/backup/export").content
        source_key = settings.settings_encryption_key
        if legacy:
            contents = legacy_backup(contents)

        # Simulate an unconfigured destination with its own configuration file.
        for attribute in ("admin_username", "admin_password_hash", "session_secret", "settings_encryption_key"):
            monkeypatch.setattr(settings, attribute, "")
        client.cookies.clear()
        assert client.get("/api/setup/status").json()["configured"] is False
        restored = client.post("/api/setup/restore", files={"file": ("backup.zip", contents, "application/zip")})
        assert restored.status_code == 200, restored.text
        assert restored.json()["configured"] is False
        assert restored.json()["restore"]["config_restored"] == ["SETTINGS_ENCRYPTION_KEY"]
        assert client.get("/api/setup/status").json()["configured"] is False
        assert settings.admin_username == settings.admin_password_hash == ""
        assert settings.settings_encryption_key == source_key
        assert settings.session_secret and settings.session_secret != "source-session-secret"
        imported_config = dotenv_values(config_path)
        assert "ADMIN_USERNAME" not in imported_config
        assert "ADMIN_PASSWORD_HASH" not in imported_config
        assert client.get("/api/admin/rooms").status_code == 401

        initialized = client.post("/api/setup/initialize", json={"username": "local-admin", "password": "local-password-123"})
        assert initialized.status_code == 200, initialized.text
        assert initialized.json()["configured"] is True
        persisted = dotenv_values(config_path)
        assert persisted["ADMIN_USERNAME"] == "local-admin"
        assert verify_password("local-password-123", persisted["ADMIN_PASSWORD_HASH"])
        assert client.post("/api/admin/login", json={"username": "source-admin", "password": "source-password-123"}).status_code == 401
        assert client.post("/api/admin/login", json={"username": "local-admin", "password": "local-password-123"}).status_code == 200
        restored_student = client.get(f"/api/admin/students/{student['id']}").json()
        assert restored_student["name"] == "初始化导入学生"
        assert restored_student["current_assignment"]["seat_id"] == seats[0]
        assert any(row["id"] == room["id"] for row in client.get("/api/admin/rooms").json())
        with SessionLocal() as db:
            assert decrypt_secret(db.get(SmtpSetting, 1).encrypted_password) == "mail-secret"


def test_restore_rejects_garbage(tmp_path: Path) -> None:
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"not a zip")
    with TestClient(app) as client:
        login(client)
        response = client.post("/api/admin/backup/restore", files={"file": ("bad.zip", bad.read_bytes(), "application/zip")})
        assert response.status_code == 422
        empty = BytesIO()
        with ZipFile(empty, "w") as package:
            package.writestr("manifest.json", "{}")
        response = client.post("/api/admin/backup/restore", files={"file": ("empty.zip", empty.getvalue(), "application/zip")})
        assert response.status_code == 422
        assert "数据库" in response.json()["detail"]


def test_copy_all_tables_between_engines_keeps_ids(tmp_path: Path) -> None:
    with TestClient(app) as client:
        login(client)
        create_published_room(client, "复制房间", ["C1"])
        student = client.post("/api/admin/students", json={"name": "复制学生", "student_no": "COPY001"}).json()
    target_url = f"sqlite:///{(tmp_path / 'copy.db').as_posix()}"
    target = build_engine(target_url)
    try:
        Base.metadata.create_all(target)
        counts = copy_all_tables(engine, target)
        assert counts["students"] >= 1
        with target.connect() as connection:
            copied = connection.execute(select(Student.__table__).where(Student.__table__.c.student_no == "COPY001")).mappings().one()
            assert copied["id"] == student["id"]
    finally:
        target.dispose()


def test_export_and_restore_functions_directly(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(type(settings), "config_path", property(lambda self: tmp_path / "config.env"))
    with TestClient(app):
        package = export_backup(engine, settings, tmp_path / "direct.zip", kind="test")
        assert package.is_file()
        result = restore_backup(package, engine, settings)
        assert result["schema_revision"] == current_revision(engine)


def test_change_admin_password_requires_current(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "config.env"
    monkeypatch.setattr(type(settings), "config_path", property(lambda self: config_path))
    with TestClient(app) as client:
        login(client)
        wrong = client.post("/api/admin/password", json={"current_password": "nope", "new_password": "a-long-new-password-1"})
        assert wrong.status_code == 403
        changed = client.post("/api/admin/password", json={"current_password": "test-password-123", "new_password": "a-long-new-password-1"})
        assert changed.status_code == 200
        assert "ADMIN_PASSWORD_HASH" in config_path.read_text(encoding="utf-8")
        relogin = client.post("/api/admin/login", json={"username": "admin", "password": "a-long-new-password-1"})
        assert relogin.status_code == 200
        # Restore the original test password for the other tests.
        back = client.post("/api/admin/password", json={"current_password": "a-long-new-password-1", "new_password": "test-password-123"})
        assert back.status_code == 200


def test_panel_state_without_desktop_controller() -> None:
    with TestClient(app) as client:
        state = client.get("/api/panel/state").json()
        assert state["available"] is False
        assert "addresses" in state
        assert client.post("/api/panel/backup").status_code == 503
        qr = client.get("/api/panel/qr.svg", params={"text": "http://10.0.0.2:8080"})
        assert qr.status_code == 200
        assert qr.headers["content-type"].startswith("image/svg+xml")


def test_static_resolution_maps_next_export_layout(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("home", encoding="utf-8")
    (tmp_path / "admin").mkdir()
    (tmp_path / "admin.html").write_text("admin", encoding="utf-8")
    (tmp_path / "admin" / "login.html").write_text("login", encoding="utf-8")
    (tmp_path / "404.html").write_text("missing", encoding="utf-8")
    (tmp_path / "_next").mkdir()
    (tmp_path / "_next" / "chunk.js").write_text("js", encoding="utf-8")
    assert resolve_static(tmp_path, "") == (tmp_path / "index.html", 200)
    assert resolve_static(tmp_path, "admin") == (tmp_path / "admin.html", 200)
    assert resolve_static(tmp_path, "admin/login") == (tmp_path / "admin" / "login.html", 200)
    assert resolve_static(tmp_path, "_next/chunk.js") == (tmp_path / "_next" / "chunk.js", 200)
    assert resolve_static(tmp_path, "nothing/here") == (tmp_path / "404.html", 404)
    assert resolve_static(tmp_path, "../etc/passwd") is None
