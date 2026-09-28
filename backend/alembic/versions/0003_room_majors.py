"""Keep room subject affiliations independent of current occupants."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "0003_room_majors"
down_revision = "0002_repair_equipment_overlap"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("rooms")}
    if "major_names" in columns:
        # Databases created by create_all() already carry the column.
        return
    op.add_column("rooms", sa.Column("major_names", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
                                    nullable=False, server_default=sa.text("'[]'")))


def downgrade():
    op.drop_column("rooms", "major_names")
