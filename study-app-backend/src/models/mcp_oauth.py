"""OAuth 2.1 state for the Nosey MCP connector (Claude, ChatGPT).

Nosey is both the authorization server and the MCP resource server. AI apps
register themselves (dynamic client registration), send the user through a
consent page on the Nosey frontend, then trade the one-time code for tokens.
Every secret (codes, access and refresh tokens) is stored only as a SHA-256
hash, so a database leak cannot be replayed against /mcp.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import BIGINT_ID, Base
from src.utils.time import utcnow_naive


class McpOAuthClient(Base):
    """An AI app that registered itself through POST /oauth/register."""

    __tablename__ = "mcp_oauth_clients"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    client_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # JSON list of exact redirect URIs; /oauth/authorize must match one exactly.
    redirect_uris: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow_naive)


class McpOAuthRequest(Base):
    """One pass through /oauth/authorize, from consent page to code redemption.

    Created when the AI app sends the user to /oauth/authorize. The consent
    page reads it by request_id; approving binds the user and mints the code.
    The code is single use (used_at) and short lived (expires_at).
    """

    __tablename__ = "mcp_oauth_requests"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    # Random public id the consent page carries in its URL. Not a secret on
    # its own: approving it still needs the user's Nosey session.
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    client_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("mcp_oauth_clients.client_id", ondelete="CASCADE"), nullable=False
    )
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    code_challenge: Mapped[str] = mapped_column(String(128), nullable=False)
    scope: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    resource: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    code_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow_naive)


class McpOAuthToken(Base):
    """One connected AI app for one user: the grant behind an access token.

    A refresh rotates both hashes on this same row, so the row is a stable
    "connection" the Settings page can list and revoke.
    """

    __tablename__ = "mcp_oauth_tokens"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("mcp_oauth_clients.client_id", ondelete="CASCADE"), nullable=False
    )
    scope: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    access_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    refresh_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    access_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    refresh_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow_naive)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
