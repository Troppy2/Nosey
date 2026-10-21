"""The built-in KojoCode problem catalog, read-only, for the MCP connector.

The source of truth is PROBLEM_ROWS in
study-app-frontend/src/data/leetcodeTaxonomy.ts. src/data/lc_catalog.txt is a
verbatim copy of those rows (category|title|difficulty|slug|extra|subtopics),
because the backend deploys without the frontend. Regenerate it after editing the catalog with
`python -m src.services.lc_catalog` (from study-app-backend);
tests/test_lc_catalog.py fails while the two copies differ.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "lc_catalog.txt"
FRONTEND_CATALOG = (
    Path(__file__).resolve().parents[3] / "study-app-frontend" / "src" / "data" / "leetcodeTaxonomy.ts"
)
_DIFFICULTIES = ("Easy", "Medium", "Hard")


@dataclass(frozen=True)
class CatalogProblem:
    slug: str
    title: str
    difficulty: str
    topic: str
    topic_label: str
    subtopics: tuple[str, ...]


def to_topic_id(label: str) -> str:
    """Same as toTopicId in leetcodeTaxonomy.ts: "Hash Table" -> "hash-table"."""
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


def parse_rows(text: str) -> list[CatalogProblem]:
    # Mirrors TAXONOMY_PROBLEMS: rows without a slug or a known difficulty are
    # author placeholders and are skipped.
    problems: list[CatalogProblem] = []
    seen: set[str] = set()
    for line in text.strip().splitlines():
        parts = line.split("|")
        if len(parts) < 4:
            continue
        label, title, difficulty, slug = (p.strip() for p in parts[:4])
        if not slug or not title or difficulty not in _DIFFICULTIES or slug in seen:
            continue
        seen.add(slug)
        subtopics = tuple(s.strip() for s in parts[5].split(",") if s.strip()) if len(parts) > 5 else ()
        problems.append(CatalogProblem(slug, title, difficulty, to_topic_id(label), label, subtopics))
    return problems


@lru_cache(maxsize=1)
def catalog() -> tuple[CatalogProblem, ...]:
    return tuple(parse_rows(CATALOG_PATH.read_text(encoding="utf-8")))


@lru_cache(maxsize=1)
def _by_slug() -> dict[str, CatalogProblem]:
    return {p.slug: p for p in catalog()}


def get(slug: str) -> Optional[CatalogProblem]:
    return _by_slug().get(slug)


def frontend_rows() -> str:
    """PROBLEM_ROWS as the frontend has it, normalized the way the copy is written."""
    source = FRONTEND_CATALOG.read_text(encoding="utf-8")
    match = re.search(r"export const PROBLEM_ROWS = `(.*?)`;", source, re.S)
    if match is None:
        raise SystemExit(f"PROBLEM_ROWS not found in {FRONTEND_CATALOG}")
    return match.group(1).strip() + "\n"


if __name__ == "__main__":
    CATALOG_PATH.write_text(frontend_rows(), encoding="utf-8", newline="\n")
    print(f"Wrote {CATALOG_PATH}")
