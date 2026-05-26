"""Add name column to kojo_conversations and drop unique constraint for multi-chat"""
from alembic import op
import sqlalchemy as sa

revision = "013_multi_chat_kojo"
down_revision = "012_conversation_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kojo_conversations", sa.Column("name", sa.String(200), nullable=True))
    op.drop_constraint("uq_kojo_user_folder", "kojo_conversations", type_="unique")


def downgrade() -> None:
    op.drop_column("kojo_conversations", "name")
    op.create_unique_constraint(
        "uq_kojo_user_folder", "kojo_conversations", ["user_id", "folder_id"]
    )
