import json
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session

from backend.app import arrangement_routes as routes
from backend.app.database import Base, get_db
from backend.app.importer import preview_workbook, validate_import_row
from backend.app.main import app
from backend.app.models import Student, AuditLog


def xlsx(rows):
    book = Workbook()
    for row in rows:
        book.active.append(row)
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


def files():
    book = Workbook()
    book.active['E2'] = 301
    book.active['B3'], book.active['C3'] = 1, 2
    stream = BytesIO()
    book.save(stream)
    data = {
        'roster': xlsx([['房间', '座位号', '姓名或设备名', '导师', '年级', '培养层次'], [301, 1, '导入测试', '导师', 2026, '硕士'], [301, 2, '导入测试', '导师', 2026, '硕士']]),
        'floorplan': stream.getvalue(),
        'directory': xlsx([['学号', '姓名', '导师姓名', '年级', '培养层次'], ['import-001', '导入测试', '导师', 2026, '硕士']]),
        'teachers': xlsx([['姓名', '职称', '中心职务', '教研中心'], ['导师', '教授', '', '光学']]),
    }
    return {key: (f'{key}.xlsx', value, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') for key, value in data.items()}


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(f'sqlite:///{tmp_path / "test.db"}', connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    def database():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(routes, 'engine', engine)
    with TestClient(app) as client:
        assert client.post('/api/admin/login', json={'username': 'admin', 'password': 'test-password-123'}).status_code == 200
        yield client, engine
    app.dependency_overrides.clear()
    engine.dispose()


def test_documented_template_empty_rows_and_edited_validation(client):
    http, _ = client
    template = http.get('/api/admin/import/template')
    assert template.status_code == 200
    book = load_workbook(BytesIO(template.content))
    assert book.active['C1'].value == '姓名或设备名'
    preview = preview_workbook(template.content)
    assert preview['rows'][1]['kind'] == 'empty'
    assert not preview['rows'][1]['warnings']
    row = dict(preview['rows'][0], enrollment_year=None, program_level=None)
    assert len(validate_import_row(row)['warnings']) == 2
    assert not validate_import_row(dict(row, enrollment_year=2026, program_level='硕士'))['warnings']
    assert not validate_import_row(dict(row, kind='empty'))['warnings']
    with pytest.raises(ValueError, match='姓名或设备名'):
        preview_workbook(xlsx([['房间', '座位号']]))


def test_arrangement_conflicts_backup_atomic_write_and_consumed_preview(client):
    http, engine = client
    response = http.post('/api/admin/import/arrangement/preview', files=files())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['assignment_conflicts'][0]['seats'] == ['301/1', '301/2']
    endpoint = '/api/admin/import/arrangement/commit'
    payload = {'preview_id': data['preview_id'], 'choices': {}, 'acknowledged': True}
    assert http.post(endpoint, json=payload).status_code == 422
    payload['choices'] = {'import-001': '301/99'}
    assert http.post(endpoint, json=payload).status_code == 422
    payload['choices'] = {'import-001': '301/2'}
    done = http.post(endpoint, json=payload)
    assert done.status_code == 200, done.text
    assert (routes.settings.backup_dir / done.json()['backup']).is_file()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Student)) == 1
        assert db.scalar(select(AuditLog).where(AuditLog.action == 'latest.imported'))
    assert http.post(endpoint, json=payload).status_code == 410


def test_backup_failure_and_transaction_failure_leave_database_unchanged(client, monkeypatch):
    http, engine = client
    token = http.post('/api/admin/import/arrangement/preview', files=files()).json()['preview_id']
    payload = {'preview_id': token, 'choices': {'import-001': 'unassigned'}, 'acknowledged': True}
    original_backup, original_apply = routes.export_backup, routes.apply_latest
    def fail(*args, **kwargs):
        raise OSError('simulated failure')
    monkeypatch.setattr(routes, 'export_backup', fail)
    response = http.post('/api/admin/import/arrangement/commit', json=payload)
    assert response.status_code == 500 and '备份失败' in response.json()['detail']
    monkeypatch.setattr(routes, 'export_backup', original_backup)
    def partial_write(db, preview):
        original_apply(db, preview)
        raise RuntimeError('simulated write failure')
    monkeypatch.setattr(routes, 'apply_latest', partial_write)
    assert http.post('/api/admin/import/arrangement/commit', json=payload).status_code == 500
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Student)) == 0
        assert db.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_stale_preview_and_malformed_upload(client):
    http, engine = client
    assert http.post('/api/admin/import/arrangement/preview', files={key: ('wrong.xlsx', b'not xlsx') for key in files()}).status_code == 422
    token = http.post('/api/admin/import/arrangement/preview', files=files()).json()['preview_id']
    with Session(engine) as db:
        db.add(AuditLog(action='student.updated', target_type='student', target_id='1'))
        db.commit()
    assert http.post('/api/admin/import/arrangement/commit', json={'preview_id': token, 'choices': {'import-001': '301/1'}, 'acknowledged': True}).status_code == 409
    assert http.post('/api/admin/import/arrangement/commit', json={'preview_id': '../../other', 'acknowledged': True}).status_code == 422

    expired = http.post('/api/admin/import/arrangement/preview', files=files()).json()['preview_id']
    metadata = routes.settings.upload_dir / 'arrangement-previews' / expired / 'meta.json'
    meta = json.loads(metadata.read_text())
    meta['created'] = 0
    metadata.write_text(json.dumps(meta))
    assert http.post('/api/admin/import/arrangement/commit', json={'preview_id': expired, 'choices': {'import-001': '301/1'}, 'acknowledged': True}).status_code == 410
    http.cookies.clear()
    assert http.get('/api/admin/import/template').status_code == 401
    assert http.post('/api/admin/import/arrangement/preview', files=files()).status_code == 401
