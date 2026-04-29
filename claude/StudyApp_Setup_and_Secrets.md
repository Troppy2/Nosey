---
title: Study App Backend - Setup & Environment Configuration
tags: [setup, environment, gitignore, secrets, configuration]
created: 2026-04-28
---

# Study App Backend - Setup & Environment Configuration

## Overview

This guide covers initial project setup, environment configuration, and secrets management. **All sensitive data requires explicit user approval before being used in code.**

---

## Part 1: Project Initialization

### Step 1: Clone & Setup

```bash
# Create project directory
mkdir study-app-backend
cd study-app-backend

# Initialize git
git init
git config user.name "Your Name"
git config user.email "your.email@example.com"

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env from template
cp .env.example .env
```

### Step 2: Directory Structure

```bash
mkdir -p src/{models,schemas,routes,services,repositories,utils,migrations}
mkdir -p tests/{test_services,test_routes,fixtures}
mkdir -p logs
```

---

## Part 2: .env.example (Template)

**File: `.env.example`** (commit to git, NEVER commit `.env`)

```env
# ============================================================================
# DATABASE CONFIGURATION
# ============================================================================
# TODO: USER MUST PROVIDE
# Connection string for PostgreSQL database
# Format: async postgresql+asyncpg://username:password@host:port/database
# 
# For local development:
# - PostgreSQL running on localhost:5432
# - Database: study_app_dev
# - User: postgres
# - Password: (your choice)
#
# For Neon (production):
# - Use Neon connection string directly
# - Keep password SECRET
#
DATABASE_URL=async postgresql+asyncpg://user:password@localhost:5432/study_app_dev

# ============================================================================
# GOOGLE OAUTH CONFIGURATION
# ============================================================================
# TODO: USER MUST OBTAIN FROM GOOGLE CLOUD CONSOLE
# Steps:
# 1. Go to https://console.cloud.google.com/
# 2. Create new project "StudyApp"
# 3. Enable OAuth 2.0 consent screen
# 4. Create OAuth 2.0 Client ID (Web Application)
# 5. Add authorized redirect URIs:
#    - http://localhost:3000/auth/callback
#    - http://localhost:5173/auth/callback
#    - https://yourdomain.com/auth/callback (production)
# 6. Copy Client ID and Client Secret below
#
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_HERE
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET_HERE

# ============================================================================
# JWT CONFIGURATION
# ============================================================================
# TODO: USER MUST GENERATE SECURE SECRET
# Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
# Keep this VERY SECRET. Never expose in logs or responses.
#
JWT_SECRET=YOUR_JWT_SECRET_KEY_MIN_32_CHARS_HERE
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24

# ============================================================================
# LLM CONFIGURATION
# ============================================================================
# Ollama (Local, Self-Hosted):
# - Install from https://ollama.ai
# - Run: ollama pull mistral
# - Runs on http://localhost:11434
#
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral

# Groq (Optional, Hosted):
# TODO: USER MUST OBTAIN API KEY (optional)
# Get free API key from https://console.groq.com/
# Leave empty if using Ollama only
# Keep this SECRET
#
GROQ_API_KEY=

# ============================================================================
# APPLICATION CONFIGURATION
# ============================================================================
ENVIRONMENT=development  # development, staging, production
LOG_LEVEL=INFO

# CORS origins (comma-separated)
# Update for your frontend deployment
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:8000

# ============================================================================
# OPTIONAL: FILE UPLOAD CONFIGURATION
# ============================================================================
# Maximum file size for test notes (bytes)
MAX_FILE_SIZE_BYTES=52428800  # 50MB

# Allowed file types
ALLOWED_FILE_TYPES=pdf,txt

# ============================================================================
# OPTIONAL: LLM SAFETY LIMITS
# ============================================================================
# Maximum tokens for LLM responses
LLM_MAX_TOKENS=1000

# LLM request timeout (seconds)
LLM_TIMEOUT_SECONDS=30

# Confidence threshold for flagging uncertain answers
LLM_UNCERTAINTY_THRESHOLD=0.6
```

---

## Part 3: .env (Actual File - GITIGNORED)

**File: `.env`** (DO NOT COMMIT)

This file will be created locally by each developer. It contains **actual secrets**.

> [!warning] CRITICAL
> This file is in `.gitignore`. Never commit it. Never share it. Each developer creates their own `.env` locally.

**Your local `.env` should look like:**

```env
DATABASE_URL=async postgresql+asyncpg://postgres:your_local_password@localhost:5432/study_app_dev

GOOGLE_CLIENT_ID=YOUR_ACTUAL_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_ACTUAL_GOOGLE_CLIENT_SECRET

JWT_SECRET=YOUR_ACTUAL_JWT_SECRET_KEY_HERE

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral

GROQ_API_KEY=  # Leave empty if using Ollama

ENVIRONMENT=development
LOG_LEVEL=DEBUG

CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:8000
```

---

## Part 4: .gitignore

**File: `.gitignore`** (commit this to git)

```gitignore
# Environment variables
.env
.env.local
.env.*.local

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg
MANIFEST
pip-log.txt
pip-delete-this-directory.txt

# Virtual Environment
venv/
ENV/
env/
.venv
env.bak/
venv.bak/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store

# Testing
.pytest_cache/
.coverage
htmlcov/
.tox/

# Logs
logs/
*.log

# Database
*.db
*.sqlite
*.sqlite3

# Temporary files
tmp/
temp/
*.tmp

# OS
Thumbs.db
.DS_Store

# Sensitive/Private
secrets.json
private_key*
*.pem
*.key

# Node modules (if using node tools)
node_modules/
npm-debug.log

# Docker
.dockerignore

# Production builds
dist/
build/
```

---

## Part 5: config.py with TODO Comments

**File: `src/config.py`**

```python
"""
Application configuration from environment variables.

IMPORTANT: All sensitive values are marked with TODO comments.
User MUST provide values before running the application.
"""

from pydantic_settings import BaseSettings
from typing import Optional
import os

class Settings(BaseSettings):
    """
    Load configuration from .env file.
    
    All sensitive fields require explicit user approval in code.
    See .env.example for setup instructions.
    """
    
    # ========================================================================
    # DATABASE - CRITICAL
    # ========================================================================
    # TODO: USER MUST PROVIDE
    # This is the connection string to PostgreSQL.
    # 
    # For local development:
    # DATABASE_URL=async postgresql+asyncpg://postgres:password@localhost:5432/study_app_dev
    #
    # For production (Neon):
    # DATABASE_URL=async postgresql+asyncpg://user:password@neon_host/database
    #
    # DO NOT log or expose this URL.
    DATABASE_URL: str
    
    # ========================================================================
    # GOOGLE OAUTH - CRITICAL
    # ========================================================================
    # TODO: USER MUST OBTAIN FROM GOOGLE CLOUD CONSOLE
    # Steps to obtain:
    # 1. Create project in https://console.cloud.google.com
    # 2. Enable OAuth 2.0 Consent Screen
    # 3. Create OAuth 2.0 Client ID (Web Application type)
    # 4. Add redirect URIs (local + production)
    # 5. Copy Client ID + Secret to .env
    #
    # These are sensitive credentials. Never share or log them.
    GOOGLE_CLIENT_ID: str  # Public, but confidential
    GOOGLE_CLIENT_SECRET: str  # SENSITIVE - keep secret
    
    # ========================================================================
    # JWT TOKEN SECRET - CRITICAL
    # ========================================================================
    # TODO: USER MUST GENERATE SECURE SECRET
    # Generate secure random key:
    # 
    # Python:
    # python -c "import secrets; print(secrets.token_urlsafe(32))"
    #
    # Bash:
    # openssl rand -base64 32
    #
    # Requirements:
    # - Minimum 32 characters
    # - Use in production: rotate every 90 days
    # - Keep EXTREMELY SECRET - anyone with this can forge tokens
    # - Never log or expose in error messages
    #
    JWT_SECRET: str  # SENSITIVE
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24
    
    # ========================================================================
    # LLM CONFIGURATION
    # ========================================================================
    # Ollama (local, self-hosted):
    # - Install: https://ollama.ai
    # - Run: ollama pull mistral
    # - Base URL: http://localhost:11434
    #
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "mistral"
    
    # Groq API (optional, hosted):
    # TODO: USER MAY PROVIDE FOR FASTER INFERENCE
    # Optional: If you want to use Groq instead of Ollama
    # Get free API key: https://console.groq.com
    # Leave empty to use Ollama only
    #
    GROQ_API_KEY: Optional[str] = None  # SENSITIVE if provided
    
    # ========================================================================
    # APPLICATION ENVIRONMENT
    # ========================================================================
    # Options: development, staging, production
    # Used for logging, error responses, security settings
    ENVIRONMENT: str = "development"
    
    # Logging level: DEBUG, INFO, WARNING, ERROR, CRITICAL
    LOG_LEVEL: str = "INFO"
    
    # CORS allowed origins (comma-separated)
    # TODO: USER MUST UPDATE FOR FRONTEND DEPLOYMENT
    # Local: http://localhost:3000,http://localhost:5173
    # Production: https://yourdomain.com
    #
    CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:5173"]
    
    # ========================================================================
    # FILE UPLOAD LIMITS
    # ========================================================================
    # Maximum file size: 50MB
    MAX_FILE_SIZE_BYTES: int = 52428800
    
    # Allowed file types for notes
    ALLOWED_FILE_TYPES: list = ["pdf", "txt"]
    
    # ========================================================================
    # LLM SAFETY LIMITS
    # ========================================================================
    # Max tokens in LLM response (prevent runaway generations)
    LLM_MAX_TOKENS: int = 1000
    
    # LLM request timeout (seconds)
    LLM_TIMEOUT_SECONDS: int = 30
    
    # Confidence threshold: below this, mark answer as "uncertain"
    LLM_UNCERTAINTY_THRESHOLD: float = 0.6
    
    # ========================================================================
    # PYDANTIC CONFIGURATION
    # ========================================================================
    class Config:
        env_file = ".env"
        case_sensitive = True
    
    # ========================================================================
    # VALIDATION & STARTUP CHECKS
    # ========================================================================
    def __init__(self, **data):
        """
        Validate critical settings on startup.
        """
        super().__init__(**data)
        
        # TODO: COMMENT OUT THESE CHECKS DURING DEVELOPMENT IF NEEDED
        # But in production, all critical fields must be set.
        
        # Check database URL is present
        if not self.DATABASE_URL:
            raise ValueError(
                "DATABASE_URL not set. Check .env file. "
                "See .env.example for instructions."
            )
        
        # Check Google OAuth credentials
        if not self.GOOGLE_CLIENT_ID or not self.GOOGLE_CLIENT_SECRET:
            raise ValueError(
                "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set. "
                "Get from https://console.cloud.google.com. "
                "See .env.example for steps."
            )
        
        # Check JWT secret
        if not self.JWT_SECRET or len(self.JWT_SECRET) < 32:
            raise ValueError(
                "JWT_SECRET not set or too short (min 32 chars). "
                "Generate with: python -c \"import secrets; print(secrets.token_urlsafe(32))\" "
                "See .env.example."
            )
        
        # In production, require Groq or Ollama
        if self.ENVIRONMENT == "production":
            if not self.GROQ_API_KEY and not self.OLLAMA_BASE_URL:
                raise ValueError(
                    "Must set either GROQ_API_KEY or OLLAMA_BASE_URL for production."
                )
    
    # ========================================================================
    # SECURITY CHECKS
    # ========================================================================
    def validate_production_settings(self):
        """
        Validate production-only requirements.
        Call this before deploying to production.
        """
        assert self.ENVIRONMENT == "production", "Not in production mode"
        assert not self.JWT_SECRET.startswith("YOUR_"), "JWT_SECRET not configured"
        assert self.GROQ_API_KEY or self.OLLAMA_BASE_URL, "LLM not configured"
        assert len(self.CORS_ORIGINS) > 0, "CORS_ORIGINS not set"
        print("✓ Production settings validated")


# ============================================================================
# SINGLETON INSTANCE
# ============================================================================
# Load settings once at startup
settings = Settings()

# Print configuration on startup (hide secrets)
if settings.ENVIRONMENT == "development":
    print(f"Environment: {settings.ENVIRONMENT}")
    print(f"Database: {settings.DATABASE_URL[:50]}...")  # Truncate to hide password
    print(f"LLM: {settings.OLLAMA_BASE_URL if not settings.GROQ_API_KEY else 'Groq'}")
    print(f"Log Level: {settings.LOG_LEVEL}")
    print(f"CORS Origins: {settings.CORS_ORIGINS}")
```

---

## Part 6: utils/logger.py with Secret Redaction

**File: `src/utils/logger.py`**

```python
"""
Structured logging with automatic secret redaction.

IMPORTANT: Prevents accidental exposure of secrets in logs.
"""

import logging
import re
from typing import Any
from src.config import settings

# List of patterns to redact from logs
REDACT_PATTERNS = [
    (r"password[\"']?\s*[:=]\s*[\"']([^\"']*)[\"']", "password=***"),
    (r"token[\"']?\s*[:=]\s*[\"']([^\"']*)[\"']", "token=***"),
    (r"secret[\"']?\s*[:=]\s*[\"']([^\"']*)[\"']", "secret=***"),
    (r"api[_-]?key[\"']?\s*[:=]\s*[\"']([^\"']*)[\"']", "api_key=***"),
    (r"authorization[\"']?\s*[:=]\s*[\"']Bearer ([^\"']*)[\"']", "authorization=Bearer ***"),
]

def redact_secrets(message: str) -> str:
    """
    Redact sensitive information from log messages.
    
    Replaces passwords, tokens, API keys, and secrets with ***.
    """
    for pattern, replacement in REDACT_PATTERNS:
        message = re.sub(pattern, replacement, message, flags=re.IGNORECASE)
    return message

class SecureFormatter(logging.Formatter):
    """
    Logging formatter that redacts secrets before output.
    """
    def format(self, record: logging.LogRecord) -> str:
        msg = super().format(record)
        return redact_secrets(msg)

def setup_logger(name: str) -> logging.Logger:
    """
    Create logger with secure formatting.
    
    Usage:
        logger = setup_logger(__name__)
        logger.info("User logged in", extra={"user_id": 123})
    """
    logger = logging.getLogger(name)
    logger.setLevel(settings.LOG_LEVEL)
    
    # Console handler
    handler = logging.StreamHandler()
    formatter = SecureFormatter(
        fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    
    return logger

# Global logger
logger = setup_logger(__name__)

# ============================================================================
# SECURITY REMINDER
# ============================================================================
# NEVER log:
# - Passwords
# - API keys / tokens
# - JWTs
# - Database passwords
# - User PII (emails, phone numbers, SSNs)
#
# GOOD:
# logger.info("User created", extra={"user_id": 123, "email_domain": "example.com"})
#
# BAD:
# logger.info(f"User created: {user.email}")  # Exposes email
# logger.debug(f"Token: {jwt_token}")  # Exposes token
```

---

## Part 7: Database Setup Instructions

### Local Development (PostgreSQL)

#### Option A: Docker Compose (Recommended)

**File: `docker-compose.yml`**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      # TODO: USER SETS PASSWORD
      # Choose a strong password for local dev
      # This is only for local development, not production
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: your_local_password_here  # TODO: CHANGE THIS
      POSTGRES_DB: study_app_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

**Start database:**
```bash
docker-compose up -d
# Verify: docker-compose ps
```

#### Option B: Manual Installation

```bash
# macOS
brew install postgresql

# Linux (Ubuntu)
sudo apt install postgresql

# Start service
pg_ctl -D /usr/local/var/postgres start

# Create database
createdb study_app_dev

# Connect
psql study_app_dev
```

### Production (Neon)

**Steps:**
1. Go to https://neon.tech
2. Sign up (free tier available)
3. Create project "studyapp"
4. Copy connection string
5. Add to `.env` as `DATABASE_URL`

> [!warning] CRITICAL
> Neon connection string contains password. Keep it SECRET. Never commit.

---

## Part 8: Google OAuth Setup

**Steps:**

### 1. Create Google Cloud Project

- Go to https://console.cloud.google.com
- Create new project: "StudyApp"
- Enable "OAuth 2.0 Consent Screen" API

### 2. Configure Consent Screen

- User Type: External
- App name: Study App
- User support email: your@email.com
- Developer contact: your@email.com

### 3. Create OAuth 2.0 Client ID

- Type: Web Application
- Name: "Study App Web"
- Authorized redirect URIs:
  - `http://localhost:3000/auth/callback`
  - `http://localhost:5173/auth/callback`
  - `https://yourdomain.com/auth/callback` (production)

### 4. Copy Credentials

- Copy **Client ID** → `GOOGLE_CLIENT_ID` in `.env`
- Copy **Client Secret** → `GOOGLE_CLIENT_SECRET` in `.env`

> [!warning] CRITICAL
> Client Secret is sensitive. Never commit to git. Keep `.env` gitignored.

---

## Part 9: JWT Secret Generation

**Generate secure JWT secret:**

```bash
# Python
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Bash
openssl rand -base64 32

# Copy output → JWT_SECRET in .env
```

> [!warning] CRITICAL
> This is your most critical secret. Anyone with it can forge authentication tokens.
> - Rotate in production every 90 days
> - Never log it
> - Never share it
> - Never expose in error messages

---

## Part 10: Startup Checklist

Before running the application, verify:

```bash
# 1. Virtual environment activated
which python  # Should show venv/bin/python

# 2. Dependencies installed
pip list | grep fastapi

# 3. .env file created
test -f .env && echo "✓ .env exists" || echo "✗ Create .env"

# 4. Database running
psql study_app_dev -c "SELECT 1;" && echo "✓ DB connected" || echo "✗ Start DB"

# 5. Database URL correct
grep DATABASE_URL .env | head -c 50

# 6. Google OAuth credentials set
grep GOOGLE_CLIENT_ID .env | grep -v "^#"

# 7. JWT secret set (non-placeholder)
grep JWT_SECRET .env | grep -v "YOUR_"

# 8. LLM reachable (if using Ollama)
curl http://localhost:11434/api/tags && echo "✓ Ollama running" || echo "✗ Start Ollama"
```

---

## Part 11: Running the Application

### Development

```bash
# Activate venv
source venv/bin/activate

# Run migrations
alembic upgrade head

# Start server
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Server running: http://localhost:8000
# API docs: http://localhost:8000/docs
```

### Production (Before Deploying)

```bash
# Validate all production settings
python -c "from src.config import settings; settings.validate_production_settings()"

# Run migrations
alembic upgrade head

# Run tests
pytest tests/ --cov=src

# Check code quality
black src/
flake8 src/
mypy src/
```

---

## Part 12: Sensitive Data Checklist

Before committing code or sharing:

```bash
# 1. Verify .env is gitignored
cat .gitignore | grep "^\.env"

# 2. Check for hardcoded secrets in code
grep -r "api_key\s*=" src/ && echo "✗ FOUND HARDCODED SECRETS"
grep -r "password\s*=" src/ && echo "✗ FOUND HARDCODED SECRETS"
grep -r "YOUR_" src/ && echo "✗ FOUND PLACEHOLDER VALUES"

# 3. Verify no secrets in git history
git log --all --pretty=format: --name-only | xargs grep -l "password\|secret\|api_key" || echo "✓ No secrets in git"

# 4. Check logs don't expose secrets
grep -r "logger.debug" src/ | grep -E "password|token|secret" && echo "⚠ Review logging"

# 5. Verify JWT_SECRET non-placeholder
grep JWT_SECRET .env | grep -q "YOUR_" && echo "✗ JWT_SECRET not set" || echo "✓ JWT_SECRET set"
```

---

## Summary & Next Steps

| Step | Status | Notes |
|------|--------|-------|
| Create `.env` from `.env.example` | ❌ TODO | User action required |
| Set `DATABASE_URL` | ❌ TODO | Local or Neon |
| Get `GOOGLE_CLIENT_ID/SECRET` | ❌ TODO | https://console.cloud.google.com |
| Generate `JWT_SECRET` | ❌ TODO | Use `secrets.token_urlsafe(32)` |
| Start PostgreSQL | ❌ TODO | Docker or manual |
| Run migrations | ❌ TODO | `alembic upgrade head` |
| Start Ollama (optional) | ❌ TODO | `ollama pull mistral` |
| Run development server | ❌ TODO | `uvicorn src.main:app --reload` |

---

## Related Documents

[[StudyApp_SystemDesign]]
[[StudyApp_Backend_ImplementationPrompt]]

