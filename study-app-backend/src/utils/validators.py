from __future__ import annotations
from typing import Optional

VALID_TEST_TYPES = {"MCQ_only", "FRQ_only", "mixed", "Extreme"}
VALID_QUESTION_TYPES = {"MCQ", "FRQ"}
ALLOWED_FILE_TYPES = {
    "pdf", "txt", "md", "docx", "html", "htm", "pptx",
    "py", "js", "ts", "tsx", "jsx", "java", "c", "cpp", "h", "hpp",
    "cs", "go", "rs", "swift", "kt", "scala", "rb", "php", "sql", "json", "xml", "yaml", "yml",
}
MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB per file
MAX_UPLOAD_TOTAL_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB across uploaded files


def normalize_file_extension(filename: Optional[str]) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[1].lower()
