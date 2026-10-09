"""Separate actual remarks from legacy generated text once, preserving its history."""

from datetime import datetime, timezone
import re

from alembic import op
import sqlalchemy as sa

revision = "0005_note_sources"
down_revision = "0004_centers_virtual"
branch_labels = None
depends_on = None


def legacy_note(note):
    """Frozen compatibility rules for old imports; never used during export."""
    levels = {"本", "本科", "本科生", "硕", "硕士", "硕士生", "博", "博士", "博士生",
              "博后", "博士后", "硕转博", "科研助理", "联培", "出国联培"}
    generated = {"备用间", "分布图未提供唯一位置", "姓名在汇总表中重复", "未按姓名合并，请核对学号",
                 "平台占用与Excel不一致，待核对", "汇总表未列，使用情况待核对", "识别为设备，请确认",
                 "备注退学", "保留表内占用，待核实是否已腾退"}
    parts = []
    for part in re.split(r"[；;]", note or ""):
        part = part.strip()
        if not part or part in levels or part.rstrip("。.") in generated:
            continue
        if part.startswith(("教研中心：", "导师：", "培养层次缺失", "年级缺失",
                            "无法识别培养层次：", "年级需要人工确认：")):
            continue
        if re.fullmatch(r"汇总表第\s*\d+\s*行|工位分布图\s+[A-Z]+\d+", part):
            continue
        if re.fullmatch(r".+在最新表存在重复安排，原记录保留待核对[。.]?", part):
            continue
        if re.match(r"^(?:\d{4}-\d{2}-\d{2}\s*)?用户(?:确认|核定)", part):
            continue
        if re.fullmatch(r"(?:\d+(?:-\d+)?/\d+\s*)?解除(?:备用|重复安排)?预留[。.]?", part):
            continue
        part = re.sub(r"^(科研助理|(?:出国)?联培)(?=$|[\s（(])", "", part).strip()
        if part.startswith(("（", "(")):
            part = "时间" + part
        if part:
            parts.append(part)
    return "；".join(dict.fromkeys(parts)) or None


def legacy_description(description):
    text = description or ""
    for value in ("按实测工位分布图还原相对位置；间距为示意尺寸。",
                  "分布图未提供此房间；按座位号暂排，实际位置待核对。"):
        text = text.replace(value, "")
    return re.sub(r"\s*(?:未定位编号|图中重复编号|图有但汇总表未列编号)：[^。]*。", "", text).strip() or None


def retired_operation(note):
    """Only the historical operation remarks explicitly retired during this migration."""
    return bool(note and (
        "2026-09-28 用户确认可用，解除备用预留" in note
        or re.fullmatch(r"2026-09-28 用户核定：.+；\d+/\d+解除重复安排预留。", note)))


def upgrade():
    connection = op.get_bind()
    if "note_source" in {c["name"] for c in sa.inspect(connection).get_columns("seats")}:
        return
    op.add_column("seats", sa.Column("note_source", sa.String(24), nullable=False, server_default="none"))
    metadata = sa.MetaData()
    seats = sa.Table("seats", metadata, autoload_with=connection)
    rooms = sa.Table("rooms", metadata, autoload_with=connection)
    audits = sa.Table("audit_logs", metadata, autoload_with=connection)
    manual_notes, manual_descriptions = {}, {}
    for event in connection.execute(sa.select(audits).order_by(audits.c.id)).mappings():
        after = event["after_data"] or {}
        if event["action"] == "seat.status_updated" and "note" in after:
            manual_notes[event["target_id"]] = after["note"]
        if event["action"] in {"room.created", "room.updated"} and "description" in after:
            manual_descriptions[event["target_id"]] = after["description"]

    def record(target_type, target_id, before, after):
        connection.execute(audits.insert().values(
            action="remarks.migrated", target_type=target_type, target_id=str(target_id),
            before_data=before, after_data=after, created_at=datetime.now(timezone.utc)))

    for row in connection.execute(sa.select(seats)).mappings().all():
        old = row["note"]
        explicitly_manual = row["id"] in manual_notes and manual_notes[row["id"]] == old
        imported = bool(old and re.search(r"汇总表第\s*\d+\s*行|工位分布图\s+[A-Z]+\d+", old))
        operation = bool(old and re.match(r"^(?:\d{4}-\d{2}-\d{2}\s*)?用户(?:确认|核定)", old))
        if retired_operation(old):
            note, source = None, "manual"  # The administrator explicitly cleared these old operations.
        elif explicitly_manual:
            note, source = old, "manual"
        elif imported or operation:
            note, source = legacy_note(old), "import" if imported else "none"
        else:
            note, source = old, "manual" if old else "none"
        connection.execute(seats.update().where(seats.c.id == row["id"]).values(note=note, note_source=source))
        if old != note:
            record("seat", row["id"], {"note": old}, {"note": note, "note_source": source})
    for row in connection.execute(sa.select(rooms)).mappings().all():
        old = row["description"]
        if str(row["id"]) in manual_descriptions and manual_descriptions[str(row["id"])] == old:
            continue
        cleaned = legacy_description(old)
        if old != cleaned:
            connection.execute(rooms.update().where(rooms.c.id == row["id"]).values(description=cleaned))
            record("room", row["id"], {"description": old}, {"description": cleaned})


def downgrade():
    op.drop_column("seats", "note_source")
