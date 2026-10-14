"""068 MCP connector OAuth: clients, authorization requests, tokens

- mcp_oauth_clients: AI apps registered through dynamic client registration.
- mcp_oauth_requests: one /oauth/authorize pass, from consent page to the
  single-use code (stored hashed).
- mcp_oauth_tokens: one connected app per user; access and refresh tokens
  stored hashed and rotated in place on refresh.

Revision ID: 068_mcp_oauth
Revises: 067_content_flags_keep_on_delete
Create Date: 2026-10-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "068_mcp_oauth"
down_revision = "067_content_flags_keep_on_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mcp_oauth_clients",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("client_name", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("redirect_uris", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_mcp_oauth_clients_client_id", "mcp_oauth_clients", ["client_id"], unique=True)

    op.create_table(
        "mcp_oauth_requests",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column(
            "client_id",
            sa.String(length=64),
            sa.ForeignKey("mcp_oauth_clients.client_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=True),
        sa.Column("code_challenge", sa.String(length=128), nullable=False),
        sa.Column("scope", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("resource", sa.Text(), nullable=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("code_hash", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_mcp_oauth_requests_request_id", "mcp_oauth_requests", ["request_id"], unique=True)
    op.create_index("ix_mcp_oauth_requests_code_hash", "mcp_oauth_requests", ["code_hash"], unique=True)

    op.create_table(
        "mcp_oauth_tokens",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "client_id",
            sa.String(length=64),
            sa.ForeignKey("mcp_oauth_clients.client_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scope", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("access_hash", sa.String(length=64), nullable=False),
        sa.Column("refresh_hash", sa.String(length=64), nullable=False),
        sa.Column("access_expires_at", sa.DateTime(), nullable=False),
        sa.Column("refresh_expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_mcp_oauth_tokens_user_id", "mcp_oauth_tokens", ["user_id"])
    op.create_index("ix_mcp_oauth_tokens_access_hash", "mcp_oauth_tokens", ["access_hash"], unique=True)
    op.create_index("ix_mcp_oauth_tokens_refresh_hash", "mcp_oauth_tokens", ["refresh_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_mcp_oauth_tokens_refresh_hash", table_name="mcp_oauth_tokens")
    op.drop_index("ix_mcp_oauth_tokens_access_hash", table_name="mcp_oauth_tokens")
    op.drop_index("ix_mcp_oauth_tokens_user_id", table_name="mcp_oauth_tokens")
    op.drop_table("mcp_oauth_tokens")
    op.drop_index("ix_mcp_oauth_requests_code_hash", table_name="mcp_oauth_requests")
    op.drop_index("ix_mcp_oauth_requests_request_id", table_name="mcp_oauth_requests")
    op.drop_table("mcp_oauth_requests")
    op.drop_index("ix_mcp_oauth_clients_client_id", table_name="mcp_oauth_clients")
    op.drop_table("mcp_oauth_clients")
