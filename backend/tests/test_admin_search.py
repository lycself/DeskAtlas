from fastapi.testclient import TestClient

from backend.app.main import app, seat_code_query
from backend.app.schemas import allowed_years
from backend.tests.test_workflows import create_published_room, login


def test_seat_queries_need_a_separator_after_the_room_name():
    assert seat_code_query("301", "301 12") == "12"
    assert seat_code_query("301", "301-12") == "12"
    assert seat_code_query("301", "301号12号") == "12"
    assert seat_code_query("301", "301 12号工位") == "12"
    assert seat_code_query("442-1", "442-1-3") == "3"
    assert seat_code_query("301", "3011") is None
    assert seat_code_query("301", "301") is None
    assert seat_code_query("442-1", "442-12") is None


def test_search_groups_students_rooms_seats_and_pending_applications():
    with TestClient(app) as client:
        assert client.get("/api/admin/search?q=x").status_code == 401
        login(client)
        room, seats = create_published_room(client, "检索801", ["1", "2", "12"])
        client.patch(f"/api/admin/rooms/{room['id']}", json={"major_names": ["检索教研组"]})
        seated = client.post("/api/admin/students", json={"name": "检索甲", "student_no": "search-001", "adviser": "检索导师", "seat_id": seats[2]}).json()
        client.post("/api/admin/students", json={"name": "另一检索甲", "student_no": "search-002", "adviser": "检索导师"})
        major_id = client.get("/api/public/bootstrap").json()["majors"][0]["id"]
        applied = client.post("/api/public/applications", json={
            "seat_id": seats[0], "name": "检索申请人", "student_no": "search-003", "adviser": "检索导师",
            "email": "search-003@stu.xmu.edu", "enrollment_year": allowed_years()[-1], "program_level": "硕士", "major_id": major_id,
        })
        assert applied.status_code == 201, applied.text

        found = client.get("/api/admin/search", params={"q": "检索甲"}).json()
        assert found["student_total"] == 2
        assert [row["name"] for row in found["students"]] == ["检索甲", "另一检索甲"]
        assert found["students"][0]["current_assignment"]["seat_id"] == seats[2]
        assert found["students"][1]["current_assignment"]["room_name"] == "未被分配"

        adviser = client.get("/api/admin/search", params={"q": "检索导师"}).json()
        assert adviser["advisers"] == [{"name": "检索导师", "count": 2}]
        assert [row["name"] for row in adviser["applications"]] == ["检索申请人"]
        assert adviser["applications"][0]["seat_code"] == "1"

        by_major = client.get("/api/admin/search", params={"q": "检索教研组"}).json()
        assert [row["id"] for row in by_major["rooms"]] == [room["id"]]
        assert by_major["rooms"][0]["seat_counts"] == {"available": 1, "occupied": 1, "pending": 1}

        seat = client.get("/api/admin/search", params={"q": "检索801 1"}).json()
        assert [(row["code"], row["display_state"]) for row in seat["seats"]] == [("1", "pending"), ("12", "occupied")]
        assert seat["seats"][1]["occupant"] == "检索甲"
        assert seat["rooms"] == []

        assert client.get("/api/admin/search", params={"q": "  "}).json()["students"] == []
        assert client.get("/api/admin/search", params={"q": "%"}).json()["student_total"] == 0
        assert client.get("/api/admin/search", params={"q": "x" * 81}).status_code == 422
