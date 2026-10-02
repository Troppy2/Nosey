"""Run long background work outside the request/response cycle.

FastAPI BackgroundTasks run INSIDE the ASGI response cycle. With a single uvicorn
worker and HTTP/1.1 keep-alive, the request's connection stays busy until the
task ends, so the browser's next request on that connection queues behind it
(rules-gotchas 8a). asyncio.create_task frees the connection as soon as the
response is sent. A strong reference is kept so the task is not
garbage-collected mid-run.
"""
from __future__ import annotations

import asyncio
from typing import Any, Coroutine

_detached_tasks: set[asyncio.Task] = set()


def spawn_detached(coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
    """Schedule coro on the running loop and keep it alive until it finishes."""
    task = asyncio.create_task(coro)
    _detached_tasks.add(task)
    task.add_done_callback(_detached_tasks.discard)
    return task
