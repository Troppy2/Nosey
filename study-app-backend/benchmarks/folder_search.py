"""Read-only quick-search latency and EXPLAIN measurements; never prints titles/IDs.

Run from study-app-backend with .venv/Scripts/python.exe benchmarks/folder_search.py
--output <report.json>. Percentiles include the database round trip and result mapping,
but exclude connection setup, HTTP, browser debounce, and rendering.
"""
import argparse
import asyncio
import json
import math
from pathlib import Path
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select, text
from sqlalchemy.dialects import postgresql

from src.database import async_session_maker, engine
from src.models.folder import Folder
from src.models.test import Test
from src.repositories.folder_search_repository import FolderSearchRepository
from src.services.folder_search_service import FolderSearchService


def percentiles(samples):
    ordered = sorted(samples)
    return {f"p{p}_ms": round(ordered[max(0, math.ceil(len(ordered) * p / 100) - 1)], 2)
            for p in (50, 95, 99)}


def scan_nodes(node):
    yield {key: node[key] for key in ("Node Type", "Index Name", "Actual Rows", "Rows Removed by Filter") if key in node}
    for child in node.get("Plans", []):
        yield from scan_nodes(child)


async def synthetic_dataset(session, indexed):
    # Session-local tables shadow the real tables only on this connection.
    # Closing/rolling back drops all synthetic records; no user data is changed.
    await session.execute(text("CREATE TEMP TABLE folders (id bigint PRIMARY KEY, user_id bigint NOT NULL, name text NOT NULL, is_archived boolean NOT NULL, subject text) ON COMMIT DROP"))
    await session.execute(text("CREATE TEMP TABLE tests (id bigint PRIMARY KEY, folder_id bigint NOT NULL, title text NOT NULL) ON COMMIT DROP"))
    await session.execute(text("""INSERT INTO folders (id, user_id, name, is_archived) SELECT g, CASE WHEN g <= 1000 THEN 1 ELSE 2 + g % 99 END,
        'Biology ' || lpad(g::text, 6, '0'), g % 20 = 0 FROM generate_series(1, 10000) g"""))
    await session.execute(text("""INSERT INTO tests SELECT g,
        CASE WHEN g <= 50000 THEN 1 + g % 1000 ELSE 1001 + g % 9000 END,
        CASE WHEN g % 20 = 0 THEN 'Biology' ELSE 'Practice' END || ' exam ' || lpad(g::text, 6, '0')
        FROM generate_series(1, 100000) g"""))
    await session.execute(text("CREATE INDEX bench_folders_user ON folders (user_id)"))
    await session.execute(text("CREATE INDEX bench_tests_folder ON tests (folder_id)"))
    if indexed:
        for table, field in (("folders", "name"), ("tests", "title")):
            partial = " WHERE is_archived IS false" if table == "folders" else ""
            await session.execute(text(f"CREATE INDEX bench_{table}_trgm ON {table} USING gin (lower({field}) gin_trgm_ops){partial}"))
            await session.execute(text(f"CREATE INDEX bench_{table}_prefix ON {table} (lower({field}) text_pattern_ops){partial}"))
    await session.execute(text("ANALYZE folders"))
    await session.execute(text("ANALYZE tests"))


async def main(args):
    async with async_session_maker() as session:
        await session.execute(text("SET LOCAL statement_timeout = '5s'"))
        if args.synthetic:
            await synthetic_dataset(session, not args.without_indexes)
        uid = await session.scalar(select(Folder.user_id).outerjoin(Test, Test.folder_id == Folder.id)
                                   .where(Folder.is_archived.is_(False)).group_by(Folder.user_id)
                                   .order_by(func.count(Test.id).desc()).limit(1))
        if uid is None:
            raise RuntimeError("No active folders available for a representative measurement.")
        owned = (Folder.user_id == uid, Folder.is_archived.is_(False))
        folder_name = await session.scalar(select(Folder.name).where(*owned).limit(1))
        title = await session.scalar(select(Test.title).join(Folder).where(*owned).limit(1)) or folder_name
        normalized = title.strip().lower()
        queries = {"exact": normalized[:160], "prefix_2": normalized[:2],
                   "substring": normalized[1: min(len(normalized), 7)] if len(normalized) > 4 else normalized,
                   "no_match": "zzquicksearchnomatch982137"}
        report = {"samples_per_class": args.samples, "synthetic": args.synthetic, "search_indexes": not args.without_indexes,
                  "measurement": "warm service + database round trip; excludes HTTP/debounce/render",
                  "dataset": {"all_folders": await session.scalar(select(func.count(Folder.id))),
                              "all_tests": await session.scalar(select(func.count(Test.id))),
                              "account_active_folders": await session.scalar(select(func.count(Folder.id)).where(*owned)),
                              "account_active_tests": await session.scalar(select(func.count(Test.id)).join(Folder).where(*owned))},
                  "classes": {}}
        for label, query in queries.items():
            service = FolderSearchService()
            for _ in range(3):
                await service.search(uid, query, session)
            times = []
            for _ in range(args.samples):
                start = perf_counter()
                result = await service.search(uid, query, session)
                times.append((perf_counter() - start) * 1000)
            compiled = FolderSearchRepository.statement(uid, query, 20).compile(
                dialect=postgresql.dialect(paramstyle="named"))
            plan = await session.scalar(text(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {compiled}"), compiled.params)
            if isinstance(plan, str):
                plan = json.loads(plan)
            report["classes"][label] = {**percentiles(times), "results": len(result.results),
                                        "server_execution_ms": plan[0]["Execution Time"],
                                        "plan": list(scan_nodes(plan[0]["Plan"]))}
        Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"dataset": report["dataset"], "classes": {
            key: {k: v for k, v in value.items() if k != "plan"} for key, value in report["classes"].items()}}, indent=2))
    await engine.dispose()


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--output", required=True)
    parser.add_argument("--synthetic", action="store_true", help="Use temporary 10k folder/100k test tables, automatically discarded.")
    parser.add_argument("--without-indexes", action="store_true", help="Synthetic baseline with only existing ownership/foreign-key indexes.")
    args = parser.parse_args()
    if not 10 <= args.samples <= 1000:
        parser.error("--samples must be between 10 and 1000")
    if args.without_indexes and not args.synthetic:
        parser.error("--without-indexes only applies to temporary synthetic tables")
    asyncio.run(main(args))
