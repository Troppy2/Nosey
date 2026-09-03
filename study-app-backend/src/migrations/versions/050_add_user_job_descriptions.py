"""050 add user_job_descriptions (saved JDs for mock interviews)

A pasted job description used to live only on the session that consumed it, and the
LLM parse of it was discarded. Running the same company twice meant pasting the JD
again and paying for another parse. This table saves a JD under a name, together
with the parsed analysis and the config the user settled on, so a repeat run is a
dropdown pick with no LLM call.

Revision ID: 050_add_user_job_descriptions
Revises: 049_mock_interview_cloud_sync
Create Date: 2026-08-04
"""
import sqlalchemy as sa
from alembic import op

revision = "050_add_user_job_descriptions"
down_revision = "049_mock_interview_cloud_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_job_descriptions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("company_name", sa.String(length=120), nullable=True),
        sa.Column("jd_text", sa.Text(), nullable=False),
        sa.Column("parsed_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_user_jd_user_name"),
    )
    op.create_index(
        "ix_user_job_descriptions_user_id", "user_job_descriptions", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_user_job_descriptions_user_id", table_name="user_job_descriptions")
    op.drop_table("user_job_descriptions")
