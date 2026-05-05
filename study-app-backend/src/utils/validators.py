from __future__ import annotations
from typing import Optional

VALID_TEST_TYPES = {"MCQ_only", "FRQ_only", "mixed", "Extreme"}
VALID_QUESTION_TYPES = {"MCQ", "FRQ", "matching", "ordering", "fill_blank", "select_all"}
ALLOWED_FILE_TYPES = {"pdf", "txt", "md", "docx"}
MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB per file
MAX_UPLOAD_DOCUMENTS = 30
MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB per file


def normalize_file_extension(filename: Optional[str]) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[1].lower()
