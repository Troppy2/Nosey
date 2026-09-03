#!/usr/bin/env python3
"""
One-time cleanup of vector-index chunks that predate owner tagging.

Before the owner_id change, every chunk written to Qdrant was keyed only by a
content hash, so there was no way to tell which account a chunk belonged to and
no way to purge it when that account was deleted. Chunks written from now on
carry an owner_id and are purged by HybridRAGService.purge_owner() during
account deletion. This script clears the untagged backlog.

Deleting these points is safe: the collection is a derived cache, not a source
of truth. Every retrieval upserts its chunks before querying, so anything still
in use is rewritten (with an owner_id) on the next request.

Usage:
    cd study-app-backend
    python scripts/purge_unattributed_chunks.py --dry-run   # count only
    python scripts/purge_unattributed_chunks.py             # delete
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FilterSelector, IsEmptyCondition, PayloadField

from src.config import settings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="count matching points without deleting")
    args = parser.parse_args()

    url = getattr(settings, "qdrant_url", None)
    api_key = getattr(settings, "qdrant_api_key", None)
    collection = getattr(settings, "qdrant_collection", "nosey_rag")
    if not url or not api_key:
        print("Qdrant is not configured (QDRANT_URL / QDRANT_API_KEY unset). Nothing to purge.")
        return 0

    client = QdrantClient(url=url, api_key=api_key)
    existing = {item.name for item in client.get_collections().collections}
    if collection not in existing:
        print(f"Collection '{collection}' does not exist. Nothing to purge.")
        return 0

    untagged = Filter(must=[IsEmptyCondition(is_empty=PayloadField(key="owner_id"))])
    count = int(client.count(collection_name=collection, count_filter=untagged, exact=True).count)
    print(f"Collection '{collection}': {count} point(s) with no owner_id.")
    if count == 0 or args.dry_run:
        return 0

    client.delete(
        collection_name=collection,
        points_selector=FilterSelector(filter=untagged),
        wait=True,
    )
    remaining = int(client.count(collection_name=collection, count_filter=untagged, exact=True).count)
    print(f"Deleted {count - remaining} point(s). Remaining untagged: {remaining}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
