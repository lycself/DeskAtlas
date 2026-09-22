from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import Workbook

from backend.app.importer import preview_workbook
from backend.app.layout_utils import repair_imported_equipment
from backend.app.main import app
from backend.app.schemas import ApplicationCreate, allowed_years


def login(client: TestClient) -> None:
    response = client.post("/api/admin/login", json={"username": "admin", "password": "test-password-123"})
    assert response.status_code == 200


def create_published_room(client: TestClient, name: str, seat_codes: list[str]) -> tuple[dict, list[str]]:
    room = client.post("/api/admin/rooms", json={"name": name}).json()
    items = [
        {"id": f"draft-{name}-{code}", "type": "seat", "label": code, "x": 50 + index * 100, "y": 50, "width": 76, "height": 48, "rotation": 0}
        for index, code in enumerate(seat_codes)
    ]
    saved = client.put(f"/api/admin/rooms/{room['id']}/layout", json={"items": items})
    assert saved.status_code == 200
    published = client.post(f"/api/admin/rooms/{room['id']}/publish")
    assert published.status_code == 200
    data = published.json()
    return data, [item["id"] for item in data["items"] if item["type"] == "seat"]


def test_dynamic_year_range_and_school_email() -> None:
    years = allowed_years()
    assert years[0] == 2020
    assert years[-1] >= 2027
    payload = ApplicationCreate(
        seat_id="seat",
        name="测试学生",
        student_no="123",
        adviser="测试导师",
        email="student@stu.xmu.edu",
        enrollment_year=years[-1],
        program_level="硕士",
        major_id=1,
    )
    assert str(payload.email) == "123@stu.xmu.edu.cn"


def test_room_affiliations_are_public_and_preserved_by_partial_updates() -> None:
    with TestClient(app) as client:
        login(client)
        room, _ = create_published_room(client, "多专业房间", ["1"])
        endpoint = f"/api/admin/rooms/{room['id']}"
        updated = client.patch(endpoint, json={"major_names": [" 光学 ", "理论物理", "光学"]})
        assert updated.status_code == 200
        assert updated.json()["major_names"] == ["光学", "理论物理"]
        renamed = client.patch(endpoint, json={"name": "共用房间"}).json()
        assert renamed["major_names"] == ["光学", "理论物理"]
        public = client.get("/api/public/bootstrap").json()
        assert next(r for r in public["rooms"] if r["id"] == room["id"])["major_names"] == ["光学", "理论物理"]
        assert client.patch(endpoint, json={"major_names": None}).status_code == 422
        assert client.patch(endpoint, json={"major_names": [" "]}).status_code == 422
        assert client.patch(endpoint, json={"major_names": []}).json()["major_names"] == []


def test_import_preview_flags_legacy_variants_and_equipment() -> None:
    book = Workbook()
    sheet = book.active
    sheet.append(["房间", "座位号", "姓名", "导师", "年级", "培养层次（硕/博）", "教研中心"])
    sheet.append(["444", 1, "甲同学", "甲导师", "2024级", "硕", "理论物理"])
    sheet.append(["444", 2, "打印机", None, None, None, "理论物理"])
    stream = BytesIO()
    book.save(stream)
    preview = preview_workbook(stream.getvalue())
    assert preview["rows"][0]["enrollment_year"] == 2024
    assert preview["rows"][0]["program_level"] == "硕士"
    assert preview["rows"][1]["kind"] == "equipment"


def test_imported_equipment_overlap_is_repaired() -> None:
    layout = [
        {"id": "seat-10", "type": "seat", "label": "10", "x": 48, "y": 130, "width": 76, "height": 48, "rotation": 0},
        {"id": "import-equipment-2-32", "type": "equipment", "label": "打印机", "x": 40, "y": 122, "width": 82, "height": 52, "rotation": 0},
    ]
    repaired, changed = repair_imported_equipment(layout, 960, 620)
    assert changed is True
    assert repaired[1]["y"] > repaired[0]["y"] + repaired[0]["height"]
    assert layout[1]["y"] == 122


def test_application_lock_and_rejection_release() -> None:
    with TestClient(app) as client:
        login(client)
        room = client.post("/api/admin/rooms", json={"name": "测试房间"}).json()
        saved = client.put(
            f"/api/admin/rooms/{room['id']}/layout",
            json={"items": [{"id": "draft-seat", "type": "seat", "label": "1", "x": 50, "y": 50, "width": 76, "height": 48, "rotation": 0}]},
        ).json()
        published = client.post(f"/api/admin/rooms/{room['id']}/publish").json()
        seat_id = next(item["id"] for item in published["items"] if item["type"] == "seat")
        bootstrap = client.get("/api/public/bootstrap").json()
        major_id = bootstrap["majors"][0]["id"]
        application = {
            "seat_id": seat_id,
            "name": "测试学生",
            "student_no": "20260001",
            "adviser": "测试导师",
            "email": "student@stu.xmu.edu",
            "enrollment_year": allowed_years()[-2],
            "program_level": "硕士",
            "major_id": major_id,
        }
        first = client.post("/api/public/applications", json=application)
        assert first.status_code == 201
        application_id = next(row["id"] for row in client.get("/api/admin/applications").json() if row["student_no"] == "20260001")
        assert client.post("/api/public/applications", json={**application, "student_no": "20260002"}).status_code == 409
        pending_room = client.get(f"/api/public/rooms/{room['id']}").json()
        assert next(item["seat"]["display_state"] for item in pending_room["items"] if item["type"] == "seat") == "pending"
        review = client.post(
            f"/api/admin/applications/{application_id}/review",
            json={"action": "reject", "data": {key: value for key, value in application.items() if key != "seat_id"}, "rejection_reason": ""},
        )
        assert review.status_code == 200
        assert review.json()["status"] == "rejected"
        released_room = client.get(f"/api/public/rooms/{room['id']}").json()
        assert next(item["seat"]["display_state"] for item in released_room["items"] if item["type"] == "seat") == "available"


def test_approval_preserves_original_data_and_survives_email_failure() -> None:
    with TestClient(app) as client:
        login(client)
        room, seats = create_published_room(client, "审批流程房间", ["A1"])
        major_id = client.get("/api/public/bootstrap").json()["majors"][0]["id"]
        original = {
            "seat_id": seats[0],
            "name": "审批学生",
            "student_no": "20269991",
            "adviser": "原导师姓名",
            "email": "approval@stu.xmu.edu",
            "enrollment_year": allowed_years()[-2],
            "program_level": "硕士",
            "major_id": major_id,
        }
        application = client.post("/api/public/applications", json=original)
        assert application.status_code == 201
        application_id = next(row["id"] for row in client.get("/api/admin/applications").json() if row["student_no"] == original["student_no"])
        reviewed = {key: value for key, value in original.items() if key != "seat_id"}
        reviewed["adviser"] = "修正后的导师全名"
        decision = client.post(
            f"/api/admin/applications/{application_id}/review",
            json={"action": "approve", "data": reviewed, "rejection_reason": None},
        )
        assert decision.status_code == 200
        assert decision.json() == {
            "application_id": application_id,
            "status": "approved",
            "email_status": "failed",
        }
        stored = next(row for row in client.get("/api/admin/applications?application_status=all").json() if row["id"] == application_id)
        assert stored["original_data"]["adviser"] == "原导师姓名"
        assert stored["reviewed_data"]["adviser"] == "修正后的导师全名"
        public_room = client.get(f"/api/public/rooms/{room['id']}").json()
        seat = next(item["seat"] for item in public_room["items"] if item["type"] == "seat")
        assert seat["display_state"] == "occupied"
        assert seat["occupant"]["adviser"] == "修正后的导师全名"


def test_direct_assignment_move_constraints_and_history() -> None:
    with TestClient(app) as client:
        login(client)
        _, seats = create_published_room(client, "移动流程房间", ["1", "2"])
        major_id = client.get("/api/public/bootstrap").json()["majors"][0]["id"]
        created = client.post(
            "/api/admin/students",
            json={
                "name": "移动学生",
                "student_no": "20269992",
                "adviser": "完整导师姓名",
                "email": "move@stu.xmu.edu",
                "enrollment_year": allowed_years()[-2],
                "program_level": "博士",
                "major_id": major_id,
                "seat_id": seats[0],
            },
        )
        assert created.status_code == 201
        student_id = created.json()["id"]
        assert client.post("/api/admin/students", json={**created.json(), "seat_id": None}).status_code == 409

        disabled = client.patch(f"/api/admin/seats/{seats[1]}/status", json={"status": "maintenance", "note": "设备检修"})
        assert disabled.status_code == 200
        assert client.post(f"/api/admin/students/{student_id}/move", json={"seat_id": seats[1]}).status_code == 409
        assert client.patch(f"/api/admin/seats/{seats[1]}/status", json={"status": "active", "note": None}).status_code == 200

        moved = client.post(f"/api/admin/students/{student_id}/move", json={"seat_id": seats[1]})
        assert moved.status_code == 200
        assert moved.json()["current_assignment"]["seat_id"] == seats[1]
        assert len(moved.json()["history"]) == 2
        assert sum(row["ended_at"] is None for row in moved.json()["history"]) == 1


def test_admin_boundaries_and_smtp_secret_masking() -> None:
    with TestClient(app) as client:
        assert client.get("/api/admin/students").status_code == 401
        login(client)
        saved = client.put(
            "/api/admin/smtp",
            json={
                "host": "smtp.internal.invalid",
                "port": 587,
                "security": "starttls",
                "username": "mailer",
                "password": "not-returned-secret",
                "sender_name": "DeskAtlas",
                "sender_email": "deskatlas@example.edu",
            },
        )
        assert saved.status_code == 200
        body = saved.json()
        assert body["has_password"] is True
        assert "password" not in body
        assert "encrypted_password" not in body


def test_directory_queries_are_bounded_and_match_room_details() -> None:
    from sqlalchemy import event
    from backend.app.database import engine
    with TestClient(app) as client:
        login(client)
        room, seats = create_published_room(client, "查询回归房间", [str(i) for i in range(1, 25)])
        for index in range(4):
            assert client.post("/api/admin/students", json={"name": f"分页回归{index}", "seat_id": seats[index]}).status_code == 201
        calls = []
        def record(*args):
            calls.append(1)
        event.listen(engine, "before_cursor_execute", record)
        try:
            summaries = client.get("/api/admin/rooms?summary_only=true")
            assert summaries.status_code == 200
            assert len(calls) <= 3
            summary = next(row for row in summaries.json() if row["id"] == room["id"])
            assert summary["items"] == []
            assert summary["seat_counts"] == {"available": 20, "occupied": 4}
            calls.clear()
            public = client.get("/api/public/bootstrap").json()
            assert len(calls) <= 4
            public_room = next(row for row in public["rooms"] if row["id"] == room["id"])
            assert public_room["seat_counts"] == summary["seat_counts"]
            assert "email" not in public_room["items"][0]["seat"]["occupant"]
            calls.clear()
            page = client.get("/api/admin/student-directory?q=分页回归&limit=2").json()
            assert len(calls) <= 3
            assert page["total"] == 4 and len(page["items"]) == 2
            assert all(not row["history"] for row in page["items"])
            second = client.get("/api/admin/student-directory?q=分页回归&limit=2&offset=2").json()
            assert not ({row["id"] for row in page["items"]} & {row["id"] for row in second["items"]})
            detail = client.get(f'/api/admin/students/{page["items"][0]["id"]}').json()
            assert len(detail["history"]) == 1
            assert detail["current_assignment"] == page["items"][0]["current_assignment"]
            assert client.get("/api/admin/student-directory?limit=0").status_code == 422
            assert client.get("/api/admin/student-directory?q=%25").json()["total"] == 0
            assert "rooms" not in client.get("/api/admin/options").json()
            available = client.get("/api/admin/available-seats").json()
            ids = {row["id"] for row in available}
            assert set(seats[:4]).isdisjoint(ids)
            assert set(seats[4:]).issubset(ids)
        finally:
            event.remove(engine, "before_cursor_execute", record)


def test_smtp_decryption_failure_is_recorded_and_retry_reports_failure(monkeypatch) -> None:
    import backend.app.mailer as mailer
    with TestClient(app) as client:
        login(client)
        config = {"host": "smtp.test.invalid", "port": 587, "security": "starttls", "username": "test", "password": "secret", "sender_name": "DeskAtlas", "sender_email": "test@example.edu"}
        assert client.put("/api/admin/smtp", json=config).status_code == 200
        def broken_decrypt(_):
            raise RuntimeError("SMTP password cannot be decrypted")
        monkeypatch.setattr(mailer, "decrypt_secret", broken_decrypt)
        result = client.post("/api/admin/smtp/test", json={"recipient": "test@example.edu"})
        assert result.status_code == 200
        assert result.json()["status"] == "failed"
        assert "cannot be decrypted" in result.json()["error"]
        delivery = client.get("/api/admin/email-deliveries").json()[0]
        assert delivery["attempt_count"] == 1 and delivery["status"] == "failed"
        retry = client.post(f'/api/admin/email-deliveries/{delivery["id"]}/retry')
        assert retry.status_code == 200 and retry.json()["status"] == "failed"
        assert client.get("/api/admin/email-deliveries").json()[0]["attempt_count"] == 2
        monkeypatch.setattr(mailer.settings, "settings_encryption_key", "")
        assert client.put("/api/admin/smtp", json=config).status_code == 503
        assert client.get("/api/admin/smtp").json()["has_password"] is True
