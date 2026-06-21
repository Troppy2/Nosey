import json
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str = Field(
        default="",
        alias="DATABASE_URL",
    )
    google_client_id: str = Field(default="replace-me", alias="GOOGLE_CLIENT_ID")
    google_client_secret: str = Field(default="replace-me", alias="GOOGLE_CLIENT_SECRET")
    jwt_secret: str = Field(default="replace-me", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expiration_hours: int = Field(default=720, alias="JWT_EXPIRATION_HOURS")
    ollama_base_url: str = Field(default="https://api.ollama.com", alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="mistral:7b-instruct-q3_K_M", alias="OLLAMA_MODEL")
    ollama_api_key: Optional[str] = Field(default=None, alias="OLLAMA_API_KEY")
    ollama_is_cloud: bool = Field(default=False, alias="OLLAMA_IS_CLOUD")
    # Input context window for Ollama. Ollama silently truncates the prompt when it
    # exceeds num_ctx, which drops the trailing JSON-schema instructions and makes the
    # model emit empty or off-schema output. Set this high enough to hold a full
    # generation prompt (terms + concepts + rules + format spec).
    ollama_num_ctx: int = Field(default=8192, alias="OLLAMA_NUM_CTX")
    groq_api_key: Optional[str] = Field(default=None, alias="GROQ_API_KEY")
    google_ai_api_key: Optional[str] = Field(default=None, alias="GOOGLE_AI_API_KEY")
    # Real Google Generative Language model. The UI may label this provider "DeepSeek",
    # but the endpoint must point at a valid Gemini model. A previous refactor corrupted
    # this to a non-existent "deepseek-v4-flash:cloud" model, which 404'd on every call.
    google_ai_model: str = Field(default="gemini-2.0-flash", alias="GOOGLE_AI_MODEL")
    anthropic_api_key: Optional[str] = Field(default=None, alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(default="claude-haiku-4-5-20251001", alias="ANTHROPIC_MODEL")
    environment: str = Field(default="production", alias="ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    cors_origins: Any = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5174",
            "https://nosey-eosin.vercel.app",
        ],
        alias="CORS_ORIGINS",
    )
    max_file_size_bytes: int = Field(default=52_428_800, alias="MAX_FILE_SIZE_BYTES")
    allowed_file_types: Any = Field(default_factory=lambda: ["pdf", "txt", "md"], alias="ALLOWED_FILE_TYPES")
    llm_max_tokens: int = Field(default=4096, alias="LLM_MAX_TOKENS")
    # Chat/interactive calls (Kojo) — keep short so a hung provider doesn't block the user.
    llm_timeout_seconds: int = Field(default=60, alias="LLM_TIMEOUT_SECONDS")
    # Background JSON generation (test/flashcard) — longer ceiling for slow 31B cloud models.
    llm_generation_timeout_seconds: int = Field(default=180, alias="LLM_GENERATION_TIMEOUT_SECONDS")
    llm_uncertainty_threshold: float = Field(default=0.6, alias="LLM_UNCERTAINTY_THRESHOLD")
    llm_provider: str = Field(default="auto", alias="LLM_PROVIDER")
    qdrant_url: Optional[str] = Field(default=None, alias="QDRANT_URL")
    qdrant_api_key: Optional[str] = Field(default=None, alias="QDRANT_API_KEY")
    qdrant_collection: str = Field(default="nosey_rag", alias="QDRANT_COLLECTION")
    rag_embedding_model: str = Field(default="all-MiniLM-L6-v2", alias="RAG_EMBEDDING_MODEL")
    rag_reranker_model: str = Field(default="cross-encoder/ms-marco-MiniLM-L-6-v2", alias="RAG_RERANKER_MODEL")
    admin_email: str = Field(default="", alias="ADMIN_EMAIL")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                try:
                    return json.loads(stripped)
                except (json.JSONDecodeError, ValueError):
                    pass
            return [origin.strip() for origin in stripped.split(",") if origin.strip()]
        return value

    @field_validator("allowed_file_types", mode="before")
    @classmethod
    def parse_allowed_file_types(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                try:
                    return [item.lower() for item in json.loads(stripped)]
                except (json.JSONDecodeError, ValueError):
                    pass
            return [item.strip().lower() for item in stripped.split(",") if item.strip()]
        return value


settings = Settings()

# If an Ollama API key is provided, prefer the cloud endpoint unless the user explicitly set another base URL.
try:
    if settings.ollama_api_key:
        # If still pointing at the local default, switch to Ollama Cloud API endpoint.
        if settings.ollama_base_url.strip() in ("http://localhost:11434", "http://127.0.0.1:11434"):
            settings.ollama_base_url = "https://api.ollama.com"
        # Convenience boolean for other modules to detect cloud usage.
        settings.ollama_is_cloud = True
except Exception:
    # Be defensive — do not crash on config mutations
    pass
