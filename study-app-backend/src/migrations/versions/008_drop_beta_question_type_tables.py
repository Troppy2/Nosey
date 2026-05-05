"""drop_beta_question_type_tables

Revision ID: 008_drop_beta_tables
Revises: 9449496ba921
Create Date: 2026-05-05

"""
from alembic import op


revision = '008_drop_beta_tables'
down_revision = '9449496ba921'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table('matching_answers')
    op.drop_table('ordering_answers')
    op.drop_table('fill_blank_answers')
    op.drop_table('select_all_answers')


def downgrade() -> None:
    import sqlalchemy as sa
    op.create_table(
        'select_all_answers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('question_id', sa.Integer(), nullable=False),
        sa.Column('correct_indices_json', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'fill_blank_answers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('question_id', sa.Integer(), nullable=False),
        sa.Column('acceptable_answers_json', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'ordering_answers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('question_id', sa.Integer(), nullable=False),
        sa.Column('correct_order_json', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'matching_answers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('question_id', sa.Integer(), nullable=False),
        sa.Column('pairs_json', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
