from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import selectinload

from src.models.study_plan import StudyPlan, StudyPlanItem
from src.repositories.base_repository import BaseRepository
from src.schemas.study_plan import StudyPlanItemCreate, StudyPlanItemIn


class StudyPlanRepository(BaseRepository[StudyPlan]):
    async def list_for_user(self, user_id: int) -> list[tuple[StudyPlan, int, int]]:
        stmt = (
            select(
                StudyPlan,
                func.count(StudyPlanItem.id).label("total_items"),
                func.count(case((StudyPlanItem.done.is_(True), 1))).label("done_items"),
            )
            .outerjoin(StudyPlanItem, StudyPlanItem.plan_id == StudyPlan.id)
            .where(StudyPlan.user_id == user_id, StudyPlan.archived_at.is_(None))
            .group_by(StudyPlan.id)
            .order_by(StudyPlan.is_pinned.desc(), StudyPlan.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return [(row[0], int(row[1] or 0), int(row[2] or 0)) for row in result.all()]

    async def get_for_user(self, plan_id: int, user_id: int) -> Optional[StudyPlan]:
        stmt = (
            select(StudyPlan)
            .options(selectinload(StudyPlan.items))
            .where(StudyPlan.id == plan_id, StudyPlan.user_id == user_id)
        )
        return await self.session.scalar(stmt)

    async def get_pinned_for_user(self, user_id: int) -> Optional[StudyPlan]:
        stmt = (
            select(StudyPlan)
            .options(selectinload(StudyPlan.items))
            .where(
                StudyPlan.user_id == user_id,
                StudyPlan.is_pinned.is_(True),
                StudyPlan.archived_at.is_(None),
            )
        )
        return await self.session.scalar(stmt)

    async def get_item_with_plan(self, item_id: int) -> Optional[StudyPlanItem]:
        stmt = (
            select(StudyPlanItem)
            .options(selectinload(StudyPlanItem.plan))
            .where(StudyPlanItem.id == item_id)
        )
        return await self.session.scalar(stmt)

    async def unpin_all_for_user(self, user_id: int, except_plan_id: Optional[int] = None) -> None:
        stmt = (
            update(StudyPlan)
            .where(StudyPlan.user_id == user_id, StudyPlan.is_pinned.is_(True))
        )
        if except_plan_id is not None:
            stmt = stmt.where(StudyPlan.id != except_plan_id)
        stmt = stmt.values(is_pinned=False).execution_options(synchronize_session="fetch")
        await self.session.execute(stmt)

    async def create(
        self,
        user_id: int,
        title: str,
        exam_date: Optional[date],
        is_pinned: bool,
        items: list[StudyPlanItemCreate],
    ) -> StudyPlan:
        if is_pinned:
            await self.unpin_all_for_user(user_id)

        plan = StudyPlan(
            user_id=user_id,
            title=title,
            exam_date=exam_date,
            is_pinned=is_pinned,
        )
        self.session.add(plan)
        await self.session.flush()

        for idx, it in enumerate(items):
            item_row = StudyPlanItem(
                plan_id=plan.id,
                position=idx,
                kind=it.kind,
                label=it.label,
                target_id=it.target_id,
                target_count=it.target_count,
                due_date=it.due_date,
            )
            self.session.add(item_row)

        await self.session.flush()
        return plan

    async def update(self, plan: StudyPlan, fields: dict[str, Any]) -> StudyPlan:
        if fields.get("is_pinned") and not plan.is_pinned:
            await self.unpin_all_for_user(plan.user_id, except_plan_id=plan.id)
        for name, value in fields.items():
            setattr(plan, name, value)

        await self.session.flush()
        return plan

    async def replace_items(
        self,
        plan: StudyPlan,
        items_data: list[StudyPlanItemIn],
    ) -> list[StudyPlanItem]:
        existing_items = {it.id: it for it in plan.items}
        incoming_ids = {it.id for it in items_data if it.id is not None}

        # Delete removed items
        for old_id, old_item in list(existing_items.items()):
            if old_id not in incoming_ids:
                await self.session.delete(old_item)

        new_items: list[StudyPlanItem] = []
        for idx, incoming in enumerate(items_data):
            if incoming.id is not None and incoming.id in existing_items:
                item = existing_items[incoming.id]
                item.position = idx
                item.kind = incoming.kind
                item.label = incoming.label
                item.target_id = incoming.target_id
                item.target_count = incoming.target_count
                item.due_date = incoming.due_date
                if incoming.done is not None and incoming.done != item.done:
                    item.done = incoming.done
                    item.done_at = datetime.utcnow() if incoming.done else None
                    item.done_source = "manual"
                new_items.append(item)
            else:
                done = bool(incoming.done)
                new_item = StudyPlanItem(
                    plan_id=plan.id,
                    position=idx,
                    kind=incoming.kind,
                    label=incoming.label,
                    target_id=incoming.target_id,
                    target_count=incoming.target_count,
                    due_date=incoming.due_date,
                    done=done,
                    done_at=datetime.utcnow() if done else None,
                    done_source="manual" if done else None,
                )
                self.session.add(new_item)
                new_items.append(new_item)

        await self.session.flush()
        return new_items

    async def toggle_item_done(self, item: StudyPlanItem, done: bool) -> StudyPlanItem:
        item.done = done
        item.done_at = datetime.utcnow() if done else None
        item.done_source = "manual"
        await self.session.flush()
        return item

    async def delete(self, plan: StudyPlan) -> None:
        await self.session.delete(plan)
        await self.session.flush()
