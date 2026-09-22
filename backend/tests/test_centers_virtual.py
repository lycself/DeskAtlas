from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.main import app
from backend.app.models import Assignment
from backend.app.database import SessionLocal
from backend.tests.test_workflows import create_published_room, login


def test_virtual_placement_email_moves_and_application():
    with TestClient(app) as client:
        login(client)
        students = []
        for number in ("virtual-001", "virtual-002"):
            response = client.post("/api/admin/students", json={"name": number, "student_no": number, "email": "ignored"})
            assert response.status_code == 201, response.text
            student = response.json()
            assert student["email"] == f"{number}@stu.xmu.edu.cn"
            assert student["current_assignment"]["room_name"] == "未被分配"
            students.append(student)
        student = students[0]
        sid = student["id"]
        update = client.patch(f"/api/admin/students/{sid}", json={"student_no": "virtual-new", "email": "ignored"})
        assert update.json()["email"] == "virtual-new@stu.xmu.edu.cn"
        for person in students:
            moved = client.post(f"/api/admin/students/{person['id']}/move", json={"seat_id": "virtual:翔安"})
            assert moved.status_code == 200, moved.text
            assert moved.json()["current_assignment"]["room_name"] == "翔安"
        client.post(f"/api/admin/students/{sid}/release")
        current = client.get(f"/api/admin/students/{sid}").json()
        assert current["current_assignment"]["room_name"] == "未被分配"
        room, seats = create_published_room(client, "virtual-test-physical", ["1"])
        major_id = client.get("/api/admin/options").json()["majors"][0]["id"]
        payload = dict(name="新同学", student_no="virtual-new", adviser="导师", enrollment_year=2026,
                       program_level="硕士", major_id=major_id, seat_id=seats[0], email="wrong@example.com")
        response = client.post("/api/public/applications", json=payload)
        assert response.status_code == 201, response.text
        application = next(a for a in client.get("/api/admin/applications").json() if a["student_no"] == "virtual-new")
        assert application["original_data"]["email"] == "virtual-new@stu.xmu.edu.cn"
        response = client.post(f"/api/admin/applications/{application['id']}/review", json={"action": "approve", "data": payload})
        assert response.status_code == 200, response.text
        current = client.get(f"/api/admin/students/{sid}").json()
        assert current["current_assignment"]["room_name"] == room["name"]
        with SessionLocal() as db:
            assert len(db.scalars(select(Assignment).where(Assignment.student_id == sid, Assignment.ended_at.is_(None))).all()) == 1
        virtual = next(r for r in client.get("/api/public/bootstrap").json()["rooms"] if r["name"] == "翔安")
        assert virtual["is_virtual"] and not virtual["seat_counts"].get("available")
        assert client.patch(f"/api/admin/rooms/{virtual['id']}", json={"name": "oops"}).status_code == 422
        assert client.put(f"/api/admin/rooms/{virtual['id']}/layout", json={"items": []}).status_code == 422


def test_teacher_directory_authorization_and_management():
    with TestClient(app) as client:
        assert client.get("/api/admin/teachers").status_code == 401
        assert client.post("/api/admin/teachers", json={"name": "老师", "major_id": 1}).status_code == 401
        login(client)
        centers = client.get("/api/admin/majors").json()
        data = dict(name="新增教师测试", title="教授", role="副主任", major_id=centers[0]["id"])
        response = client.post("/api/admin/teachers", json=data)
        assert response.status_code == 201
        tid = response.json()["id"]
        assert client.post("/api/admin/teachers", json=data).status_code == 409
        data.update(major_id=centers[1]["id"], is_active=False, role="主任")
        updated = client.put(f"/api/admin/teachers/{tid}", json=data)
        assert updated.status_code == 200
        assert updated.json()["major_id"] == centers[1]["id"]
        assert not updated.json()["is_active"]
        assert client.post("/api/admin/teachers", json={"name": " ", "major_id": 1}).status_code == 422
        assert client.post("/api/admin/teachers", json={"name": "老师", "major_id": -1}).status_code == 422
