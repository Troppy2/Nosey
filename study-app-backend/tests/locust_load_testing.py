"""
Locust load testing for the Nosey study app backend.

Usage:
  # Install locust (once):
  pip install locust

  # Run with the web UI:
  locust -f tests/locust_load_testing.py --host http://localhost:8000

  # Run headless (CI / quick smoke test):
  locust -f tests/locust_load_testing.py --host http://localhost:8000 \
         --headless -u 20 -r 5 --run-time 60s

Environment variables:
  LOCUST_TOKEN   Bearer JWT for a real user account. Obtain by logging in via
                 the frontend and copying the token from DevTools → Application
                 → Local Storage. Required — every route is authenticated.
  LOCUST_FOLDER  An existing folder ID owned by that user (int). Optional; if
                 omitted the user task will create one on start.
"""

import os
import random
import string

from locust import HttpUser, between, task, TaskSet

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TOKEN = os.getenv("LOCUST_TOKEN", "")
SEED_FOLDER_ID = os.getenv("LOCUST_FOLDER", "")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _rand(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_lowercase, k=n))


# ---------------------------------------------------------------------------
# Task sets — grouped by feature area
# ---------------------------------------------------------------------------

class FolderTasks(TaskSet):
    """CRUD operations on folders. Read-heavy, low write rate."""

    folder_ids: list[int]

    def on_start(self):
        self.folder_ids = self.user.folder_ids  # shared from parent

    # weight 5 — most common action
    @task(5)
    def list_folders(self):
        self.client.get("/folders", headers=_auth(self.user.token), name="/folders [GET]")

    @task(2)
    def get_folder(self):
        if not self.folder_ids:
            return
        fid = random.choice(self.folder_ids)
        self.client.get(f"/folders/{fid}", headers=_auth(self.user.token), name="/folders/{id} [GET]")

    @task(1)
    def create_and_delete_folder(self):
        name = f"load-test-{_rand()}"
        r = self.client.post(
            "/folders",
            json={"name": name},
            headers=_auth(self.user.token),
            name="/folders [POST]",
        )
        if r.status_code == 201:
            fid = r.json().get("id")
            if fid:
                self.folder_ids.append(fid)
                # Delete it right away so we don't accumulate garbage
                self.client.delete(
                    f"/folders/{fid}",
                    headers=_auth(self.user.token),
                    name="/folders/{id} [DELETE]",
                )
                self.folder_ids.remove(fid)


class FileTasks(TaskSet):
    """List files in folders — upload is excluded from load tests because it
    involves heavy extraction; test it separately with a small user count."""

    def on_start(self):
        self.folder_ids = self.user.folder_ids

    @task(3)
    def list_files(self):
        if not self.folder_ids:
            return
        fid = random.choice(self.folder_ids)
        self.client.get(
            f"/folders/{fid}/files",
            headers=_auth(self.user.token),
            name="/folders/{id}/files [GET]",
        )


class TestTasks(TaskSet):
    """Read-heavy test browsing. Generation (LLM) is in a separate low-weight user."""

    def on_start(self):
        self.folder_ids = self.user.folder_ids
        self.test_ids: list[int] = []
        self._refresh_tests()

    def _refresh_tests(self):
        r = self.client.get("/tests", headers=_auth(self.user.token), name="/tests [GET]")
        if r.status_code == 200:
            self.test_ids = [t["id"] for t in r.json()]

    @task(5)
    def list_all_tests(self):
        self.client.get("/tests", headers=_auth(self.user.token), name="/tests [GET]")

    @task(3)
    def list_tests_by_folder(self):
        if not self.folder_ids:
            return
        fid = random.choice(self.folder_ids)
        self.client.get(
            f"/folders/{fid}/tests",
            headers=_auth(self.user.token),
            name="/folders/{id}/tests [GET]",
        )

    @task(3)
    def get_test(self):
        if not self.test_ids:
            self._refresh_tests()
            return
        tid = random.choice(self.test_ids)
        self.client.get(f"/tests/{tid}", headers=_auth(self.user.token), name="/tests/{id} [GET]")

    @task(2)
    def get_test_progress(self):
        if not self.test_ids:
            return
        tid = random.choice(self.test_ids)
        self.client.get(
            f"/tests/{tid}/progress",
            headers=_auth(self.user.token),
            name="/tests/{id}/progress [GET]",
        )

    @task(1)
    def get_resumable_tests(self):
        self.client.get(
            "/users/resumable-tests",
            headers=_auth(self.user.token),
            name="/users/resumable-tests [GET]",
        )


class FlashcardTasks(TaskSet):
    """Flashcard browsing and attempt recording."""

    def on_start(self):
        self.folder_ids = self.user.folder_ids
        self.flashcard_ids_by_folder: dict[int, list[int]] = {}

    def _get_flashcards(self, folder_id: int) -> list[int]:
        if folder_id not in self.flashcard_ids_by_folder:
            r = self.client.get(
                f"/folders/{folder_id}/flashcards",
                headers=_auth(self.user.token),
                name="/folders/{id}/flashcards [GET]",
            )
            if r.status_code == 200:
                self.flashcard_ids_by_folder[folder_id] = [fc["id"] for fc in r.json()]
            else:
                self.flashcard_ids_by_folder[folder_id] = []
        return self.flashcard_ids_by_folder[folder_id]

    @task(4)
    def list_flashcards(self):
        if not self.folder_ids:
            return
        fid = random.choice(self.folder_ids)
        self.client.get(
            f"/folders/{fid}/flashcards",
            headers=_auth(self.user.token),
            name="/folders/{id}/flashcards [GET]",
        )

    @task(2)
    def list_weak_flashcards(self):
        if not self.folder_ids:
            return
        fid = random.choice(self.folder_ids)
        self.client.get(
            f"/folders/{fid}/flashcards/weak",
            headers=_auth(self.user.token),
            name="/folders/{id}/flashcards/weak [GET]",
        )

    @task(2)
    def list_all_flashcards(self):
        self.client.get("/flashcards", headers=_auth(self.user.token), name="/flashcards [GET]")

    @task(1)
    def record_attempt(self):
        if not self.folder_ids:
            return
        fid = random.choice(self.folder_ids)
        cards = self._get_flashcards(fid)
        if not cards:
            return
        cid = random.choice(cards)
        self.client.post(
            f"/folders/{fid}/flashcards/{cid}/attempt",
            json={"correct": random.choice([True, False])},
            headers=_auth(self.user.token),
            name="/folders/{id}/flashcards/{id}/attempt [POST]",
        )


class KojoTasks(TaskSet):
    """Kojo AI tutor — read-only endpoints only. Chat is in LLMUser."""

    def on_start(self):
        self.folder_ids = self.user.folder_ids

    @task(3)
    def get_conversation(self):
        if not self.folder_ids:
            return
        fid = random.choice(self.folder_ids)
        self.client.get(
            f"/kojo/folders/{fid}/conversation",
            headers=_auth(self.user.token),
            name="/kojo/folders/{id}/conversation [GET]",
        )

    @task(2)
    def get_cleared_conversations(self):
        self.client.get(
            "/kojo/conversations/cleared",
            headers=_auth(self.user.token),
            name="/kojo/conversations/cleared [GET]",
        )

    @task(1)
    def providers_status(self):
        self.client.get(
            "/kojo/providers/status",
            headers=_auth(self.user.token),
            name="/kojo/providers/status [GET]",
        )


# ---------------------------------------------------------------------------
# User classes
# ---------------------------------------------------------------------------

class BrowsingUser(HttpUser):
    """
    Simulates a student browsing their study materials.
    High volume, no LLM calls, fast response expected.
    Represents the majority of traffic.
    """

    weight = 10
    wait_time = between(1, 3)

    token: str = TOKEN
    folder_ids: list[int] = []

    def on_start(self):
        if not self.token:
            self.environment.runner.quit()
            raise ValueError("LOCUST_TOKEN env var is required")

        # Seed folder IDs — use env var if provided, otherwise fetch from API
        if SEED_FOLDER_ID:
            self.folder_ids = [int(SEED_FOLDER_ID)]
        else:
            r = self.client.get("/folders", headers=_auth(self.token))
            if r.status_code == 200 and r.json():
                self.folder_ids = [f["id"] for f in r.json()]

        if not self.folder_ids:
            # Create a folder to work with
            r = self.client.post(
                "/folders",
                json={"name": f"locust-{_rand()}"},
                headers=_auth(self.token),
            )
            if r.status_code == 201:
                self.folder_ids = [r.json()["id"]]

    @task(4)
    def browse_folders(self):
        FolderTasks(self).run()

    @task(3)
    def browse_tests(self):
        TestTasks(self).run()

    @task(2)
    def browse_flashcards(self):
        FlashcardTasks(self).run()

    @task(1)
    def browse_files(self):
        FileTasks(self).run()

    @task(1)
    def check_health(self):
        self.client.get("/health", name="/health [GET]")


class ActiveUser(HttpUser):
    """
    Simulates a student actively studying: reads + writes drafts + records attempts.
    Medium volume.
    """

    weight = 5
    wait_time = between(2, 5)

    token: str = TOKEN
    folder_ids: list[int] = []

    def on_start(self):
        if not self.token:
            raise ValueError("LOCUST_TOKEN env var is required")

        if SEED_FOLDER_ID:
            self.folder_ids = [int(SEED_FOLDER_ID)]
        else:
            r = self.client.get("/folders", headers=_auth(self.token))
            if r.status_code == 200 and r.json():
                self.folder_ids = [f["id"] for f in r.json()]

        self._test_ids: list[int] = []
        r = self.client.get("/tests", headers=_auth(self.token))
        if r.status_code == 200:
            self._test_ids = [t["id"] for t in r.json()]

    @task(4)
    def browse(self):
        self.client.get("/folders", headers=_auth(self.token), name="/folders [GET]")
        self.client.get("/tests", headers=_auth(self.token), name="/tests [GET]")

    @task(2)
    def save_draft_attempt(self):
        if not self._test_ids:
            return
        tid = random.choice(self._test_ids)
        # Fetch the test to get real question IDs
        r = self.client.get(f"/tests/{tid}", headers=_auth(self.token), name="/tests/{id} [GET]")
        if r.status_code != 200:
            return
        questions = r.json().get("questions", [])
        if not questions:
            return
        answers = {str(q["id"]): "load-test-draft" for q in questions[:3]}
        self.client.post(
            f"/tests/{tid}/attempts/draft",
            json={"answers": answers, "time_elapsed_seconds": random.randint(30, 300)},
            headers=_auth(self.token),
            name="/tests/{id}/attempts/draft [POST]",
        )

    @task(1)
    def view_attempt_history(self):
        if not self._test_ids:
            return
        tid = random.choice(self._test_ids)
        self.client.get(
            f"/tests/{tid}/attempts",
            headers=_auth(self.token),
            name="/tests/{id}/attempts [GET]",
        )

    @task(1)
    def record_flashcard_attempt(self):
        FlashcardTasks(self).run()


class LLMUser(HttpUser):
    """
    Simulates users triggering LLM-backed endpoints (Kojo chat, test generation).
    Kept at very low weight — these are slow and expensive.
    Increase --users carefully; each request hits Claude/OpenAI.
    """

    weight = 1
    wait_time = between(10, 30)

    token: str = TOKEN
    folder_ids: list[int] = []

    def on_start(self):
        if not self.token:
            raise ValueError("LOCUST_TOKEN env var is required")

        if SEED_FOLDER_ID:
            self.folder_ids = [int(SEED_FOLDER_ID)]
        else:
            r = self.client.get("/folders", headers=_auth(self.token))
            if r.status_code == 200 and r.json():
                self.folder_ids = [f["id"] for f in r.json()]

    @task(3)
    def kojo_chat(self):
        if not self.folder_ids:
            return
        fid = random.choice(self.folder_ids)
        questions = [
            "Can you explain the main concept in my notes?",
            "What are the key points I should remember?",
            "Give me a quick summary of the material.",
            "What topics should I focus on for studying?",
        ]
        self.client.post(
            f"/kojo/folders/{fid}/chat",
            json={"message": random.choice(questions)},
            headers=_auth(self.token),
            name="/kojo/folders/{id}/chat [POST]",
            timeout=60,
        )

    @task(1)
    def clear_kojo_conversation(self):
        if not self.folder_ids:
            return
        fid = random.choice(self.folder_ids)
        self.client.post(
            f"/kojo/folders/{fid}/clear",
            headers=_auth(self.token),
            name="/kojo/folders/{id}/clear [POST]",
        )
