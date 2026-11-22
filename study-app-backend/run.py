"""Local dev runner: the backend on :8000 that restarts on every edit, plus the
Render keep-alive pinger.

    python run.py                  # server + auto-restart + keep-alive.js
    python run.py --no-keep-alive  # server + auto-restart only

Why not uvicorn's own reload=True: on Windows (uvicorn 0.24) the reloader sends
the worker a Ctrl+C and then waits for it to exit with NO timeout. A worker that
is still draining an open browser connection never exits, so the reloader hangs
forever and silently keeps serving the old code (2026-11-22: a new route 405'd
for a day). This supervisor polls file mtimes and hard-kills + respawns the
server instead, so an edit always lands.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
KEEP_ALIVE_JS = REPO_ROOT / "keep-alive.js"  # gitignored; skipped if missing
WATCH_DIRS = [BACKEND_DIR / "src"]
WATCH_FILES = [BACKEND_DIR / ".env"]
POLL_SECONDS = 1.0
SETTLE_SECONDS = 0.4  # let a multi-file save finish before restarting
HOST, PORT = "0.0.0.0", 8000


def serve() -> None:
    """Child mode: run the app once, no reloader."""
    if sys.platform == "win32":
        # psycopg async needs the selector loop on Windows.
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    import uvicorn

    uvicorn.run("src.main:app", host=HOST, port=PORT)


def snapshot() -> dict[Path, float]:
    mtimes: dict[Path, float] = {}
    for root in WATCH_DIRS:
        for path in root.rglob("*.py"):
            if "__pycache__" in path.parts:
                continue
            try:
                mtimes[path] = path.stat().st_mtime
            except OSError:
                pass  # deleted mid-scan
    for path in WATCH_FILES:
        try:
            mtimes[path] = path.stat().st_mtime
        except OSError:
            pass
    return mtimes


def changed(old: dict[Path, float], new: dict[Path, float]) -> list[Path]:
    return sorted({p for p in old.keys() | new.keys() if old.get(p) != new.get(p)})


def start_server() -> subprocess.Popen:
    return subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--serve"], cwd=BACKEND_DIR)


def stop(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.kill()  # TerminateProcess on Windows: immediate, cannot hang
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass


def start_keep_alive() -> subprocess.Popen | None:
    node = shutil.which("node")
    if not KEEP_ALIVE_JS.exists():
        print(f"[run] keep-alive skipped: {KEEP_ALIVE_JS} not found")
        return None
    if not node:
        print("[run] keep-alive skipped: node is not on PATH")
        return None
    return subprocess.Popen([node, str(KEEP_ALIVE_JS)], cwd=REPO_ROOT)


def supervise(keep_alive: bool) -> None:
    pinger = start_keep_alive() if keep_alive else None
    server = start_server()
    mtimes = snapshot()
    print(f"[run] watching {', '.join(str(d.relative_to(BACKEND_DIR)) for d in WATCH_DIRS)} and .env; Ctrl-C to stop")
    try:
        while True:
            time.sleep(POLL_SECONDS)
            current = snapshot()
            diff = changed(mtimes, current)
            if not diff:
                continue
            time.sleep(SETTLE_SECONDS)
            current = snapshot()
            diff = changed(mtimes, current) or diff
            mtimes = current
            names = ", ".join(str(p.relative_to(BACKEND_DIR)) for p in diff[:3])
            more = f" (+{len(diff) - 3} more)" if len(diff) > 3 else ""
            print(f"[run] change in {names}{more}, restarting backend")
            stop(server)
            server = start_server()
    except KeyboardInterrupt:
        print("[run] stopping")
    finally:
        stop(server)
        stop(pinger)


if __name__ == "__main__":
    if "--serve" in sys.argv:
        serve()
    else:
        os.chdir(BACKEND_DIR)
        supervise(keep_alive="--no-keep-alive" not in sys.argv)
