"""add learning_modules.video_url (user-attached video resource)

A user can attach one video link per lesson article (YouTube/Vimeo/direct
file); the frontend embeds a player at the bottom of the article. Display
only: the video is never used as LLM source material.

Revision ID: 035_add_module_video_url
Revises: 034_add_module_tts_script
Create Date: 2026-07-12 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "035_add_module_video_url"
down_revision = "034_add_module_tts_script"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("learning_modules", sa.Column("video_url", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("learning_modules", "video_url")
