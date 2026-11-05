from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.flashcard import Flashcard, FlashcardAttempt
from src.models.folder import Folder
from src.models.lc_sync import LCCustomProblem, LCProgress
from src.models.learning_module import LearningModule, LearningTrack
from src.models.mock_interview import MockInterviewSession
from src.models.study_plan import StudyPlan, StudyPlanItem
from src.models.system_design import SDConceptProgress, SDCustomTopic
from src.models.test import Test
from src.models.user_attempt import UserAttempt
from src.repositories.study_plan_repository import StudyPlanRepository
from src.schemas.study_plan import (
    CatalogItem,
    CatalogResponse,
    StudyPlanCreateRequest,
    StudyPlanDetailResponse,
    StudyPlanItemCreate,
    StudyPlanItemIn,
    StudyPlanItemResponse,
    StudyPlanReplaceItemsRequest,
    StudyPlanSummaryResponse,
    StudyPlanUpdateRequest,
)
from src.utils.exceptions import ResourceNotFoundException, ValidationException


class StudyPlanService:
    async def list_plans(
        self, user_id: int, session: AsyncSession
    ) -> list[StudyPlanSummaryResponse]:
        repo = StudyPlanRepository(session)
        rows = await repo.list_for_user(user_id)
        return [
            StudyPlanSummaryResponse(
                id=plan.id,
                title=plan.title,
                exam_date=plan.exam_date,
                is_pinned=plan.is_pinned,
                created_at=plan.created_at,
                updated_at=plan.updated_at,
                archived_at=plan.archived_at,
                total_items=total,
                done_items=done,
            )
            for plan, total, done in rows
        ]

    async def get_pinned_plan(
        self, user_id: int, session: AsyncSession
    ) -> Optional[StudyPlanDetailResponse]:
        repo = StudyPlanRepository(session)
        plan = await repo.get_pinned_for_user(user_id)
        if plan is None:
            return None
        return await self._detail(plan, session)

    async def get_plan(
        self, plan_id: int, user_id: int, session: AsyncSession
    ) -> StudyPlanDetailResponse:
        repo = StudyPlanRepository(session)
        plan = await repo.get_for_user(plan_id, user_id)
        if plan is None:
            raise ResourceNotFoundException("Study plan")
        return await self._detail(plan, session)

    async def create_plan(
        self, user_id: int, data: StudyPlanCreateRequest, session: AsyncSession
    ) -> StudyPlanDetailResponse:
        await self.validate_target_ids(user_id, data.items, session)
        repo = StudyPlanRepository(session)
        created = await repo.create(
            user_id=user_id,
            title=data.title,
            exam_date=data.exam_date,
            is_pinned=data.is_pinned,
            items=data.items,
        )
        plan_id = created.id
        await session.commit()
        plan = await repo.get_for_user(plan_id, user_id)
        return await self._detail(plan, session)

    async def update_plan(
        self, plan_id: int, user_id: int, data: StudyPlanUpdateRequest, session: AsyncSession
    ) -> StudyPlanDetailResponse:
        repo = StudyPlanRepository(session)
        plan = await repo.get_for_user(plan_id, user_id)
        if plan is None:
            raise ResourceNotFoundException("Study plan")

        # Only exam_date may be cleared with an explicit null.
        fields = {
            name: value
            for name, value in data.model_dump(exclude_unset=True).items()
            if value is not None or name == "exam_date"
        }
        await repo.update(plan, fields)
        await session.commit()
        plan = await repo.get_for_user(plan_id, user_id)
        return await self._detail(plan, session)

    async def replace_items(
        self,
        plan_id: int,
        user_id: int,
        data: StudyPlanReplaceItemsRequest,
        session: AsyncSession,
    ) -> StudyPlanDetailResponse:
        repo = StudyPlanRepository(session)
        plan = await repo.get_for_user(plan_id, user_id)
        if plan is None:
            raise ResourceNotFoundException("Study plan")

        await self.validate_target_ids(user_id, data.items, session)
        await repo.replace_items(plan, data.items)
        await session.commit()
        plan = await repo.get_for_user(plan_id, user_id)
        return await self._detail(plan, session)

    async def toggle_item_done(
        self, item_id: int, user_id: int, done: bool, session: AsyncSession
    ) -> StudyPlanItemResponse:
        repo = StudyPlanRepository(session)
        item = await repo.get_item_with_plan(item_id)
        if item is None or item.plan.user_id != user_id:
            raise ResourceNotFoundException("Study plan item")

        await repo.toggle_item_done(item, done)
        await session.commit()
        return StudyPlanItemResponse.model_validate(item)

    async def delete_plan(
        self, plan_id: int, user_id: int, session: AsyncSession
    ) -> None:
        repo = StudyPlanRepository(session)
        plan = await repo.get_for_user(plan_id, user_id)
        if plan is None:
            raise ResourceNotFoundException("Study plan")

        await repo.delete(plan)
        await session.commit()

    async def get_catalog(self, user_id: int, session: AsyncSession) -> CatalogResponse:
        active_folder = (Folder.user_id == user_id) & Folder.is_archived.is_(False)

        async def rows(stmt):
            return (await session.execute(stmt.limit(CATALOG_LIMIT_PER_KIND))).all()

        tests = await rows(
            select(Test.id, Test.title, Folder.name)
            .join(Folder, Folder.id == Test.folder_id)
            .where(active_folder)
            .order_by(Test.created_at.desc())
        )
        modules = await rows(
            select(LearningModule.id, LearningModule.title, Folder.name)
            .join(LearningTrack, LearningTrack.id == LearningModule.track_id)
            .join(Folder, Folder.id == LearningTrack.folder_id)
            .where(active_folder)
            .order_by(LearningModule.created_at.desc())
        )
        decks = await rows(
            select(Folder.id, Folder.name, func.count(Flashcard.id))
            .join(Flashcard, Flashcard.folder_id == Folder.id)
            .where(active_folder)
            .group_by(Folder.id, Folder.name)
            .order_by(Folder.created_at.desc())
        )
        problems = await rows(
            select(LCCustomProblem.id, LCCustomProblem.title)
            .where(LCCustomProblem.user_id == user_id, LCCustomProblem.is_archived.is_(False))
            .order_by(LCCustomProblem.created_at.desc())
        )
        topics = await rows(
            select(SDCustomTopic.id, SDCustomTopic.title)
            .where(SDCustomTopic.user_id == user_id)
            .order_by(SDCustomTopic.created_at.desc())
        )
        interviews = await rows(
            select(MockInterviewSession.id, MockInterviewSession.company, MockInterviewSession.level)
            .where(MockInterviewSession.user_id == user_id)
            .order_by(MockInterviewSession.created_at.desc())
        )

        return CatalogResponse(
            tests=[CatalogItem(id=i, title=t, kind="test", extra=f) for i, t, f in tests],
            modules=[CatalogItem(id=i, title=t, kind="module", extra=f) for i, t, f in modules],
            flashcards=[
                CatalogItem(id=i, title=f"{name} ({n} cards)", kind="flashcards", extra=name)
                for i, name, n in decks
            ],
            leetcode=[CatalogItem(id=i, title=t, kind="leetcode") for i, t in problems],
            system_design=[CatalogItem(id=i, title=t, kind="system_design") for i, t in topics],
            mock_interview=[
                CatalogItem(id=i, title=f"{company.capitalize()} ({level})", kind="mock_interview")
                for i, company, level in interviews
            ],
        )

    async def validate_target_ids(self, user_id: int, items: list[Any], session: AsyncSession) -> None:
        owned_queries = {
            "test": lambda ids: select(Test.id)
            .join(Folder, Folder.id == Test.folder_id)
            .where(Folder.user_id == user_id, Test.id.in_(ids)),
            "module": lambda ids: select(LearningModule.id)
            .join(LearningTrack, LearningTrack.id == LearningModule.track_id)
            .join(Folder, Folder.id == LearningTrack.folder_id)
            .where(Folder.user_id == user_id, LearningModule.id.in_(ids)),
            "flashcards": lambda ids: select(Folder.id).where(Folder.user_id == user_id, Folder.id.in_(ids)),
            "leetcode": lambda ids: select(LCCustomProblem.id)
            .where(LCCustomProblem.user_id == user_id, LCCustomProblem.id.in_(ids)),
            "system_design": lambda ids: select(SDCustomTopic.id)
            .where(SDCustomTopic.user_id == user_id, SDCustomTopic.id.in_(ids)),
            "mock_interview": lambda ids: select(MockInterviewSession.id)
            .where(MockInterviewSession.user_id == user_id, MockInterviewSession.id.in_(ids)),
        }
        for kind, query in owned_queries.items():
            ids = {it.target_id for it in items if it.kind == kind and it.target_id is not None}
            if not ids:
                continue
            missing = ids - set(await session.scalars(query(ids)))
            if missing:
                raise ValidationException(f"Invalid {kind} target_id: {sorted(missing)}")

    async def evaluate_auto_completion(self, plan: StudyPlan, session: AsyncSession) -> dict[int, str]:
        """Tick open linked items whose work happened after the item was added.

        One query per kind. A manual untick (done_source='manual') is never re-ticked.
        Returns flashcard progress strings keyed by item id.
        """
        user_id = plan.user_id
        open_items = [
            it for it in plan.items
            if not it.done and it.target_id is not None and it.done_source != "manual"
        ]
        changed = False

        def tick(item: StudyPlanItem) -> None:
            nonlocal changed
            item.done = True
            item.done_at = datetime.utcnow()
            item.done_source = "auto"
            changed = True

        def of_kind(kind: str) -> list[StudyPlanItem]:
            return [it for it in open_items if it.kind == kind]

        if tests := of_kind("test"):
            latest = dict((await session.execute(
                select(UserAttempt.test_id, func.max(UserAttempt.created_at))
                .where(
                    UserAttempt.user_id == user_id,
                    UserAttempt.test_id.in_({it.target_id for it in tests}),
                    UserAttempt.status == "submitted",
                )
                .group_by(UserAttempt.test_id)
            )).all())
            for it in tests:
                if _after(latest.get(it.target_id), it.created_at):
                    tick(it)

        # learning_modules has no passed_at, so a module passed before the item
        # was added still ticks it. Add a timestamp column if that matters.
        if modules := of_kind("module"):
            passed = set(await session.scalars(
                select(LearningModule.id).where(
                    LearningModule.id.in_({it.target_id for it in modules}),
                    LearningModule.passed.is_(True),
                )
            ))
            for it in modules:
                if it.target_id in passed:
                    tick(it)

        progress: dict[int, str] = {}
        decks = [it for it in plan.items if it.kind == "flashcards" and it.target_id is not None]
        if decks:
            # Count in SQL: each item joined to its folder's attempts made after
            # the item was created.
            counts = dict((await session.execute(
                select(StudyPlanItem.id, func.count(FlashcardAttempt.id))
                .join(Flashcard, Flashcard.folder_id == StudyPlanItem.target_id)
                .join(
                    FlashcardAttempt,
                    (FlashcardAttempt.flashcard_id == Flashcard.id)
                    & (FlashcardAttempt.user_id == user_id)
                    & (FlashcardAttempt.created_at > StudyPlanItem.created_at),
                )
                .where(StudyPlanItem.id.in_([it.id for it in decks]))
                .group_by(StudyPlanItem.id)
            )).all())
            for it in decks:
                count = counts.get(it.id, 0)
                progress[it.id] = f"{count}/{it.target_count}" if it.target_count else str(count)
                if it in open_items and count >= (it.target_count or 1):
                    tick(it)

        if problems := of_kind("leetcode"):
            slugs = dict((await session.execute(
                select(LCCustomProblem.id, LCCustomProblem.slug).where(
                    LCCustomProblem.id.in_({it.target_id for it in problems}),
                    LCCustomProblem.user_id == user_id,
                )
            )).all())
            solved = dict((await session.execute(
                select(LCProgress.problem_slug, LCProgress.solved_at).where(
                    LCProgress.user_id == user_id,
                    LCProgress.problem_slug.in_(set(slugs.values())),
                    LCProgress.done.is_(True),
                )
            )).all()) if slugs else {}
            for it in problems:
                if _after(solved.get(slugs.get(it.target_id)), it.created_at):
                    tick(it)

        if topics := of_kind("system_design"):
            completed = dict((await session.execute(
                select(SDConceptProgress.concept_id, SDConceptProgress.completed_at).where(
                    SDConceptProgress.user_id == user_id,
                    SDConceptProgress.concept_id.in_({f"custom-{it.target_id}" for it in topics}),
                )
            )).all())
            for it in topics:
                if _after(completed.get(f"custom-{it.target_id}"), it.created_at):
                    tick(it)

        if changed:
            await session.commit()
        return progress

    async def _detail(self, plan: StudyPlan, session: AsyncSession) -> StudyPlanDetailResponse:
        progress = await self.evaluate_auto_completion(plan, session)
        folders = await self._target_folders(plan, session)
        return self._to_detail_response(plan, progress, folders)

    async def _target_folders(self, plan: StudyPlan, session: AsyncSession) -> dict[int, int]:
        """Folder id per test/module item, so the client can link straight to it.

        One query per kind. Flashcard items already target a folder id.
        """
        folders: dict[int, int] = {}
        for kind, query in (
            ("test", lambda ids: select(Test.id, Test.folder_id).where(Test.id.in_(ids))),
            (
                "module",
                lambda ids: select(LearningModule.id, LearningTrack.folder_id)
                .join(LearningTrack, LearningTrack.id == LearningModule.track_id)
                .where(LearningModule.id.in_(ids)),
            ),
        ):
            items = [it for it in plan.items if it.kind == kind and it.target_id is not None]
            if not items:
                continue
            by_target = dict((await session.execute(query({it.target_id for it in items}))).all())
            for it in items:
                if (folder_id := by_target.get(it.target_id)) is not None:
                    folders[it.id] = folder_id
        return folders

    def _to_detail_response(
        self, plan: StudyPlan, progress: dict[int, str], folders: dict[int, int]
    ) -> StudyPlanDetailResponse:
        items = [
            StudyPlanItemResponse.model_validate(it).model_copy(
                update={"progress": progress.get(it.id), "target_folder_id": folders.get(it.id)}
            )
            for it in plan.items
        ]
        return StudyPlanDetailResponse.model_validate(plan).model_copy(update={"items": items})


# Per kind, so a user with many tests still gets modules and decks in the
# brain-dump catalog.
CATALOG_LIMIT_PER_KIND = 30


def _naive_utc(value: datetime | str) -> datetime:
    # SQLite returns aggregates as strings; LC/SD timestamps are tz-aware while
    # plan items are naive UTC.
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


def _after(event: Optional[datetime | str], item_created: datetime | str) -> bool:
    return event is not None and _naive_utc(event) > _naive_utc(item_created)
