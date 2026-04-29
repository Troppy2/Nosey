from __future__ import annotations

VALID_TEST_TYPES = {"MCQ_only", "FRQ_only", "mixed"}
VALID_QUESTION_TYPES = {"MCQ", "FRQ"}
ALLOWED_FILE_TYPES = {"pdf", "txt", "md"}
MAX_UPLOAD_DOCUMENTS = 5
MAX_UPLOAD_FILE_SIZE_BYTES = 5 * 1024 * 1024


def normalize_file_extension(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[1].lower()
