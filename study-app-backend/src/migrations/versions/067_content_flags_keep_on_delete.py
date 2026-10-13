"""067 content_flags: keep flags past account deletion (repair for 066 drift)

066 was amended after it had already been applied to some databases. The
amended version added content_flags.subject_hash, made user_id nullable and
changed its foreign key from ON DELETE CASCADE to ON DELETE SET NULL; a
database that ran the first version has none of that, and the admin flag
queue fails on the missing column. This migration brings either version to
the amended shape, so it is a no-op where 066 already did it.

Revision ID: 067_content_flags_keep_on_delete
Revises: 066_account_safety
Create Date: 2026-10-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "067_content_flags_keep_on_delete"
down_revision = "066_account_safety"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {col["name"]: col for col in inspector.get_columns("content_flags")}
    indexes = {ix["name"] for ix in inspector.get_indexes("content_flags")}

    if "subject_hash" not in columns:
        op.add_column("content_flags", sa.Column("subject_hash", sa.String(length=64), nullable=True))
    if "ix_content_flags_subject_hash" not in indexes:
        op.create_index("ix_content_flags_subject_hash", "content_flags", ["subject_hash"])

    if not columns["user_id"]["nullable"]:
        op.alter_column("content_flags", "user_id", existing_type=sa.BigInteger(), nullable=True)

    # Re-point the foreign key at ON DELETE SET NULL if it still cascades.
    for fk in inspector.get_foreign_keys("content_flags"):
        if fk["referred_table"] == "users" and (fk.get("options") or {}).get("ondelete", "").upper() != "SET NULL":
            op.drop_constraint(fk["name"], "content_flags", type_="foreignkey")
            op.create_foreign_key(
                "content_flags_user_id_fkey", "content_flags", "users", ["user_id"], ["id"], ondelete="SET NULL"
            )


def downgrade() -> None:
    # 066 (amended) owns this shape; nothing to undo beyond it.
    pass
