"""081 solution_walkthrough

Kojo's video-style solution walkthrough (breakdown, approaches, ink sketch, line by
line code) cached on the solution article row. Null on old rows, which are rebuilt
the first time they are opened.

Revision ID: 081_solution_walkthrough
Revises: 080_mock_resume_questions
Create Date: 2026-11-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "081_solution_walkthrough"
down_revision = "080_mock_resume_questions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lc_solution_articles", sa.Column("walkthrough_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("lc_solution_articles", "walkthrough_json")
