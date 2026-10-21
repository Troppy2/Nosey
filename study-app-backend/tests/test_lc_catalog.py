"""The backend's copy of the KojoCode catalog must match the frontend's."""
from __future__ import annotations

import pytest

from src.services import lc_catalog
from src.services.lc_taxonomy import TOPIC_IDS


@pytest.mark.skipif(not lc_catalog.FRONTEND_CATALOG.exists(), reason="frontend not checked out")
def test_backend_copy_matches_frontend() -> None:
    assert lc_catalog.CATALOG_PATH.read_text(encoding="utf-8") == lc_catalog.frontend_rows(), (
        "Run `python -m src.services.lc_catalog` after editing leetcodeTaxonomy.ts"
    )


def test_catalog_parses_with_known_topics() -> None:
    problems = lc_catalog.catalog()
    assert len(problems) > 100
    two_sum = lc_catalog.get("two-sum")
    assert two_sum is not None and two_sum.topic == "arrays" and two_sum.difficulty == "Easy"
    unknown = {p.topic for p in problems} - TOPIC_IDS
    assert not unknown, unknown
