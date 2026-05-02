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
    jwt_expiration_hours: int = Field(default=24, alias="JWT_EXPIRATION_HOURS")
    ollama_base_url: str = Field(default="https://api.ollama.com", alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="mistral:7b-instruct-q3_K_M", alias="OLLAMA_MODEL")
    ollama_api_key: Optional[str] = Field(default=None, alias="OLLAMA_API_KEY")
    groq_api_key: Optional[str] = Field(default=None, alias="GROQ_API_KEY")
    google_ai_api_key: Optional[str] = Field(default=None, alias="GOOGLE_AI_API_KEY")
    anthropic_api_key: Optional[str] = Field(default=None, alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(default="claude-haiku-4-5-20251001", alias="ANTHROPIC_MODEL")
    environment: str = Field(default="production", alias="ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    cors_origins: Any = Field(
        default_factory=lambda: ["https://nosey-eosin.vercel.app"],
        alias="CORS_ORIGINS",
    )
    max_file_size_bytes: int = Field(default=52_428_800, alias="MAX_FILE_SIZE_BYTES")
    allowed_file_types: Any = Field(default_factory=lambda: ["pdf", "txt", "md"], alias="ALLOWED_FILE_TYPES")
    llm_max_tokens: int = Field(default=4096, alias="LLM_MAX_TOKENS")
    llm_timeout_seconds: int = Field(default=30, alias="LLM_TIMEOUT_SECONDS")
    llm_uncertainty_threshold: float = Field(default=0.6, alias="LLM_UNCERTAINTY_THRESHOLD")
    llm_provider: str = Field(default="auto", alias="LLM_PROVIDER")

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
