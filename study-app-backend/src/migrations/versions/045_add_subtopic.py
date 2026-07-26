"""add subtopic to lc_custom_problems, lc_struggle_events, lc_test_runs

KojoCode tracked weakness at a single coarse topic level (e.g. "graph"). A big
topic bundles distinct techniques (BFS / DFS / Union-Find), so a user weak at BFS
was only flagged as weak at graphs and the pickers could hand them a DFS problem.
This adds a finer subtopic dimension alongside topic on the custom-problem row and
on both weakness signals. Nullable: existing rows and clients that don't send a
subtopic degrade cleanly to pure topic-level scoring (backward compatible). No
backfill here; existing custom problems are backfilled by the classify-only
"Regenerate topics" pass. See services/lc_taxonomy.py for the vocabulary.

Revision ID: 045_add_subtopic
Revises: 044_add_progress_solved_at
Create Date: 2026-07-24 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "045_add_subtopic"
down_revision = "044_add_progress_solved_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lc_custom_problems", sa.Column("subtopic", sa.String(length=120), nullable=True))
    op.add_column("lc_struggle_events", sa.Column("subtopic", sa.String(length=120), nullable=True))
    op.add_column("lc_test_runs", sa.Column("subtopic", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("lc_test_runs", "subtopic")
    op.drop_column("lc_struggle_events", "subtopic")
    op.drop_column("lc_custom_problems", "subtopic")
