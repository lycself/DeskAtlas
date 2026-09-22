"""Teacher directory and virtual placement groups."""
import sqlalchemy as sa
from alembic import op

revision = "0004_centers_virtual"
down_revision = "0003_room_majors"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("rooms", sa.Column("is_virtual", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("students", sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table("teachers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("title", sa.String(80)),
        sa.Column("role", sa.String(120)),
        sa.Column("major_id", sa.Integer(), sa.ForeignKey("majors.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name", "major_id", name="uq_teacher_center_name"))
    op.create_index("ix_teachers_major_id", "teachers", ["major_id"])


def downgrade():
    op.drop_table("teachers")
    op.drop_column("rooms", "is_virtual")
    op.drop_column("students", "is_archived")
