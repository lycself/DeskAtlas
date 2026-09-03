"""Move imported equipment away from overlapping seats and fixtures."""

import sqlalchemy as sa
from alembic import op

from backend.app.layout_utils import repair_imported_equipment


revision = "0002_repair_equipment_overlap"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    rooms = sa.table(
        "rooms",
        sa.column("id", sa.Integer),
        sa.column("canvas_width", sa.Integer),
        sa.column("canvas_height", sa.Integer),
        sa.column("draft_layout", sa.JSON),
        sa.column("published_layout", sa.JSON),
    )
    connection = op.get_bind()
    rows = connection.execute(
        sa.select(
            rooms.c.id,
            rooms.c.canvas_width,
            rooms.c.canvas_height,
            rooms.c.draft_layout,
            rooms.c.published_layout,
        )
    ).mappings()
    for row in rows:
        draft, draft_changed = repair_imported_equipment(row["draft_layout"], row["canvas_width"], row["canvas_height"])
        published, published_changed = repair_imported_equipment(row["published_layout"], row["canvas_width"], row["canvas_height"])
        if draft_changed or published_changed:
            connection.execute(
                sa.update(rooms)
                .where(rooms.c.id == row["id"])
                .values(draft_layout=draft, published_layout=published)
            )


def downgrade() -> None:
    # This is a corrective data migration; restoring invalid overlaps is intentionally a no-op.
    pass
