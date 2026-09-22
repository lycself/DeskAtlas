from fastapi.testclient import TestClient

from backend.app.main import app
from backend.tests.test_workflows import login, create_published_room


def test_map_context_is_private_and_tracks_profile_assignment_and_release():
    with TestClient(app) as client:
        assert client.get('/api/admin/seats/unknown/context').status_code == 401
        login(client)
        room, seats = create_published_room(client, '图上操作测试', ['1', '2'])
        response = client.post('/api/admin/students', json={'name': '图上学生', 'student_no': 'map-001', 'seat_id': seats[0]})
        assert response.status_code == 201
        student = response.json()
        context = client.get(f'/api/admin/seats/{seats[0]}/context').json()
        assert context['student']['id'] == student['id']
        assert context['student']['email'] == 'map-001@stu.xmu.edu.cn'
        client.patch(f"/api/admin/students/{student['id']}", json={'adviser': '修改后的导师'})
        assert client.get(f'/api/admin/seats/{seats[0]}/context').json()['student']['adviser'] == '修改后的导师'
        moved = client.post(f"/api/admin/students/{student['id']}/move", json={'seat_id': seats[1]})
        assert moved.status_code == 200
        assert client.get(f'/api/admin/seats/{seats[0]}/context').json()['student'] is None
        assert client.get(f'/api/admin/seats/{seats[1]}/context').json()['student']['id'] == student['id']
        public = client.get(f"/api/public/rooms/{room['id']}").json()
        occupant = next(i['seat']['occupant'] for i in public['items'] if i['id'] == seats[1])
        assert 'id' not in occupant and 'student_no' not in occupant and 'email' not in occupant
        assert client.post(f"/api/admin/students/{student['id']}/release").status_code == 200
        assert client.get(f'/api/admin/seats/{seats[1]}/context').json()['student'] is None
