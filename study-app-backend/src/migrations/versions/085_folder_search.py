"""Indexed name/title lookup for the folder quick-search overlay.

Revision ID: 085_folder_search
Revises: 084_folder_display_order
"""
from alembic import op
import sqlalchemy as sa

revision = "085_folder_search"
down_revision = "084_folder_display_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL is production; SQLite remains supported by isolated tests.
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    # Concurrent builds avoid blocking writes on populated production tables.
    # IF NOT EXISTS permits resuming after an interrupted, partially built revision.
    with op.get_context().autocommit_block():
        for table, field, label in (("folders", "name", "search_name"), ("tests", "title", "search_title")):
            expression = sa.func.lower(sa.column(field)).label(label)
            partial = {"postgresql_where": sa.text("is_archived IS false")} if table == "folders" else {}
            for suffix, method, operator in (("trgm", "gin", "gin_trgm_ops"), ("prefix", "btree", "text_pattern_ops")):
                name = f"ix_{table}_search_{suffix}"
                valid = op.get_bind().execute(sa.text(
                    "SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = current_schema() AND c.relname = :name"
                ), {"name": name}).scalar()
                if valid is False:
                    raise RuntimeError(f"Index {name} is invalid after an interrupted build; repair it before retrying.")
                op.create_index(
                    name, table, [expression],
                    postgresql_using=method, postgresql_ops={label: operator},
                    postgresql_concurrently=True, if_not_exists=True, **partial,
                )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    with op.get_context().autocommit_block():
        for table in ("tests", "folders"):
            for suffix in ("prefix", "trgm"):
                op.drop_index(f"ix_{table}_search_{suffix}", table_name=table,
                              postgresql_concurrently=True, if_exists=True)
    # pg_trgm may also be used by other features, so leave the extension installed.
