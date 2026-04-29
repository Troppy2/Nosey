---
title: Study App Backend - Implementation Prompt
tags: [backend, implementation, prompt, fastapi, postgresql]
created: 2026-04-28
---

# Study App Backend - Implementation Prompt

## Task Overview

**Objective:** Build a production-ready FastAPI backend + PostgreSQL database for a free study app alternative to Quizlet.

**Scope:** 
- Full layered architecture (routes → services → repositories → models)
- PostgreSQL schema with 11 tables, proper relationships, constraints, indexes
- 20+ API endpoints with async/await throughout
- LLM integration (Ollama/Groq) for test grading and flashcard generation
- Google OAuth authentication
- Unit + integration tests

**Success Criteria:**
1. All 11 tables created with correct relationships and constraints
2. All endpoints functional and tested
3. Async/await used consistently (no blocking I/O)
4. 80%+ test coverage (services + critical routes)
5. Code follows SWE guardrails (see below)
6. Database migrations run cleanly on Neon

---

## Phase 1: Project Structure & Setup

### Directory Layout

```
study-app-backend/
├── src/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app entry point
│   ├── config.py               # Environment variables + Settings
│   ├── dependencies.py         # Dependency injection (get_session, get_current_user)
│   ├── models/                 # SQLAlchemy ORM models
│   │   ├── __init__.py
│   │   ├── base.py             # Base model class
│   │   ├── user.py
│   │   ├── folder.py
│   │   ├── test.py
│   │   ├── question.py
│   │   ├── mcq_option.py
│   │   ├── frq_answer.py
│   │   ├── note.py
│   │   ├── user_attempt.py
│   │   ├── user_answer.py
│   │   ├── flashcard.py
│   │   └── flashcard_attempt.py
│   ├── schemas/                # Pydantic models (request/response DTOs)
│   │   ├── __init__.py
│   │   ├── auth_schema.py
│   │   ├── folder_schema.py
│   │   ├── test_schema.py
│   │   ├── question_schema.py
│   │   ├── attempt_schema.py
│   │   └── flashcard_schema.py
│   ├── routes/                 # API endpoints
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── folders.py
│   │   ├── tests.py
│   │   ├── attempts.py
│   │   └── flashcards.py
│   ├── services/               # Business logic
│   │   ├── __init__.py
│   │   ├── auth_service.py
│   │   ├── test_service.py
│   │   ├── grading_service.py
│   │   ├── flashcard_service.py
│   │   ├── llm_service.py
│   │   └── file_service.py
│   ├── repositories/           # Data access layer
│   │   ├── __init__.py
│   │   ├── base_repository.py  # Abstract base for all repos
│   │   ├── user_repository.py
│   │   ├── folder_repository.py
│   │   ├── test_repository.py
│   │   ├── attempt_repository.py
│   │   └── flashcard_repository.py
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── logger.py
│   │   ├── exceptions.py
│   │   └── validators.py
│   └── migrations/             # Alembic
│       ├── env.py
│       ├── script.py.mako
│       └── versions/
├── tests/
│   ├── __init__.py
│   ├── conftest.py             # Pytest fixtures
│   ├── test_auth_service.py
│   ├── test_test_service.py
│   ├── test_grading_service.py
│   ├── test_flashcard_service.py
│   ├── test_llm_service.py
│   ├── test_routes/
│   │   ├── test_auth_routes.py
│   │   ├── test_test_routes.py
│   │   └── test_attempt_routes.py
│   └── fixtures/
│       ├── user_fixtures.py
│       ├── test_fixtures.py
│       └── attempt_fixtures.py
├── .env.example
├── .env                        # (gitignored)
├── requirements.txt
├── docker-compose.yml          # Local PostgreSQL
├── alembic.ini
└── README.md
```

### requirements.txt

```
fastapi==0.104.1
uvicorn==0.24.0
sqlalchemy==2.0.23
alembic==1.13.0
psycopg[asyncio]==3.1.14
pydantic==2.5.0
pydantic-settings==2.1.0
python-dotenv==1.0.0
httpx==0.25.2
google-auth==2.25.2
PyJWT==2.8.1
pytest==7.4.3
pytest-asyncio==0.21.1
pytest-cov==4.1.0
httpx[testing]==0.25.2
pdfplumber==0.10.3
```

---

## Phase 2: Database & ORM Setup

### models/base.py

```python
from sqlalchemy.orm import declarative_base
from datetime import datetime
from sqlalchemy import Column, DateTime, func

Base = declarative_base()

class TimestampMixin:
    """Mixin for created_at/updated_at timestamps."""
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
```

### models/user.py

```python
from sqlalchemy import Column, BigInteger, String, Text, Index
from sqlalchemy.orm import relationship
from src.models.base import Base, TimestampMixin

class User(Base, TimestampMixin):
    __tablename__ = "users"
    
    id = Column(BigInteger, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    google_id = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255))
    profile_picture_url = Column(Text)
    
    # Relationships
    folders = relationship("Folder", back_populates="user", cascade="all, delete-orphan")
    flashcards = relationship("Flashcard", back_populates="user", cascade="all, delete-orphan")
    user_attempts = relationship("UserAttempt", back_populates="user", cascade="all, delete-orphan")
    flashcard_attempts = relationship("FlashcardAttempt", back_populates="user", cascade="all, delete-orphan")
```

### models/[all_other_models].py

**Apply the same pattern:**
1. Inherit from `Base` + `TimestampMixin` (where relevant)
2. Use `Column` with proper types, nullable, constraints
3. Define relationships with `back_populates` (bidirectional)
4. Set `cascade="all, delete-orphan"` for parent-child relationships
5. Add `__repr__` for debugging

**Models needed:**
- Folder
- Test
- Question
- MCQOption
- FRQAnswer
- Note
- UserAttempt
- UserAnswer
- Flashcard
- FlashcardAttempt

### config.py

```python
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # Database
    DATABASE_URL: str  # async postgresql+asyncpg://user:pass@host/db
    
    # Google OAuth
    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str
    
    # JWT
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24
    
    # LLM
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "mistral"
    GROQ_API_KEY: Optional[str] = None
    
    # App
    ENVIRONMENT: str = "development"  # development, staging, production
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:5173"]
    
    class Config:
        env_file = ".env"

settings = Settings()
```

### .env.example

```
DATABASE_URL=async postgresql+asyncpg://user:password@localhost:5432/study_app
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
JWT_SECRET=your_jwt_secret_key_min_32_chars
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral
GROQ_API_KEY=
ENVIRONMENT=development
LOG_LEVEL=INFO
```

---

## Phase 3: Database Migrations

### Alembic Initialization

```bash
alembic init migrations
```

### migrations/env.py

```python
from sqlalchemy import engine_from_config
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from alembic import context
from src.models.base import Base
from src.config import settings

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

target_metadata = Base.metadata

def run_migrations_offline():
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()

async def run_migrations_online():
    """Run migrations in 'online' mode with async engine."""
    engine = create_async_engine(
        config.get_main_option("sqlalchemy.url"),
        future=True
    )
    async with engine.begin() as connection:
        await connection.run_sync(context.configure, target_metadata=target_metadata)
        await connection.run_sync(context.run_migrations())

if context.is_offline_mode():
    run_migrations_offline()
else:
    import asyncio
    asyncio.run(run_migrations_online())
```

### Initial Migration (001_initial_schema.py)

Generate with:
```bash
alembic revision --autogenerate -m "initial schema"
```

Verify the generated migration includes all 11 tables with correct constraints. **DO NOT run until verified.**

### Running Migrations

```bash
# Test locally
docker-compose up -d
alembic upgrade head

# On Neon
alembic upgrade head
```

---

## Phase 4: Dependency Injection & Core Setup

### dependencies.py

```python
from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.config import settings
from src.models.user import User
import jwt

async def get_session() -> AsyncSession:
    """Provide DB session to routes."""
    from src.main import engine
    async with AsyncSession(engine) as session:
        yield session

async def get_current_user(
    authorization: str = Header(...),
    session: AsyncSession = Depends(get_session)
) -> User:
    """Validate JWT and return current user."""
    try:
        token = authorization.replace("Bearer ", "")
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    stmt = select(User).where(User.id == user_id)
    user = await session.scalar(stmt)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

### main.py

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from src.config import settings
from src.routes import auth, folders, tests, attempts, flashcards

# Create async engine
engine = create_async_engine(settings.DATABASE_URL, echo=False, future=True)

app = FastAPI(title="Study App", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(folders.router, prefix="/folders", tags=["folders"])
app.include_router(tests.router, prefix="/tests", tags=["tests"])
app.include_router(attempts.router, prefix="/attempts", tags=["attempts"])
app.include_router(flashcards.router, prefix="/flashcards", tags=["flashcards"])

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
```

---

## Phase 5: Service Layer Implementation

### Key Pattern

**Every service method must:**
1. Accept `session: AsyncSession` as parameter
2. Use `await` for all DB operations
3. Handle exceptions gracefully (raise custom exceptions from `utils/exceptions.py`)
4. Return DTO (Pydantic schema), NOT ORM model
5. Have comprehensive docstring with args, returns, raises

### Example: test_service.py

```python
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.models.test import Test
from src.models.folder import Folder
from src.schemas.test_schema import CreateTestDTO, TestDTO
from src.services.file_service import FileService
from src.services.llm_service import LLMService
from src.utils.exceptions import ResourceNotFoundException
from fastapi import UploadFile

class TestService:
    def __init__(self, llm_service: LLMService, file_service: FileService):
        self.llm_service = llm_service
        self.file_service = file_service
    
    async def create_test(
        self,
        folder_id: int,
        user_id: int,
        title: str,
        test_type: str,
        notes_file: UploadFile,
        session: AsyncSession
    ) -> TestDTO:
        """
        Create test: extract notes → LLM generates questions → store in DB.
        
        Args:
            folder_id: Parent folder ID
            user_id: User creating test
            title: Test title
            test_type: 'MCQ_only', 'FRQ_only', or 'mixed'
            notes_file: PDF or TXT file
            session: DB session
        
        Returns:
            TestDTO with generated questions
        
        Raises:
            ResourceNotFoundException: If folder doesn't exist
            LLMException: If LLM generation fails
        """
        # 1. Verify folder exists and user owns it
        stmt = select(Folder).where(
            Folder.id == folder_id,
            Folder.user_id == user_id
        )
        folder = await session.scalar(stmt)
        if not folder:
            raise ResourceNotFoundException("Folder")
        
        # 2. Extract text from file
        notes_content = await self.file_service.extract_from_file(notes_file)
        
        # 3. Create test record
        test = Test(
            folder_id=folder_id,
            title=title,
            test_type=test_type
        )
        session.add(test)
        await session.flush()  # Get test.id without commit
        
        # 4. Store notes
        note = Note(test_id=test.id, content=notes_content, file_name=notes_file.filename)
        session.add(note)
        
        # 5. LLM generates questions
        questions_data = await self.llm_service.generate_test_questions(
            notes=notes_content,
            test_type=test_type
        )
        
        # 6. Insert questions, options, answers
        # ... (detailed implementation in actual code)
        
        # 7. Commit all changes
        await session.commit()
        
        return TestDTO.from_orm(test)
    
    async def get_test_with_questions(
        self,
        test_id: int,
        session: AsyncSession
    ) -> TestDTO:
        """
        Fetch test with all questions (without revealing correct answers).
        """
        stmt = select(Test).where(Test.id == test_id)
        test = await session.scalar(stmt)
        if not test:
            raise ResourceNotFoundException("Test")
        
        # Fetch questions + options (is_correct will be None in response)
        # ... implementation
        
        return TestDTO.from_orm(test)
```

### grading_service.py

**Critical methods:**
1. `submit_and_grade(test_id, user_id, answers)` → Main grading orchestrator
2. `grade_frq(question_id, user_answer, test_id)` → LLM FRQ grading
3. `grade_mcq(question_id, user_answer)` → Direct answer matching
4. `get_weakness_detection(test_id, user_id)` → Weakness analysis

**Guardrails:**
- MCQ: Use simple string matching (case-insensitive)
- FRQ: LLM must check notes for answer; flag uncertain answers
- All answers stored with `is_correct` boolean + feedback text
- Score = (correct_count / total) * 100

### flashcard_service.py

**Methods:**
1. `generate_from_test(test_id, folder_id, count)` → Extract from test + notes
2. `generate_from_prompt(folder_id, prompt, count)` → LLM-only generation
3. `record_attempt(flashcard_id, user_id, correct, time_ms)` → Track study
4. `get_weak_flashcards(folder_id, user_id, threshold)` → Return weak cards

**Spaced repetition logic:**
- After each attempt, calculate success_rate (correct / total attempts)
- If success_rate >= 0.8: difficulty -= 1 (cap at 1)
- If success_rate < 0.4: difficulty += 1 (cap at 5)
- Otherwise: no change

---

## Phase 6: Route Layer (API Endpoints)

### Pattern for Every Route

```python
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Header
from sqlalchemy.ext.asyncio import AsyncSession
from src.dependencies import get_session, get_current_user
from src.models.user import User
from src.services.test_service import TestService

router = APIRouter()

@router.post("/")
async def create_test(
    folder_id: int,
    title: str,
    test_type: str,
    notes_file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)
):
    """
    Create test from uploaded notes.
    
    - Extracts text from PDF/TXT
    - LLM generates MCQ/FRQ questions
    - Stores test + questions in DB
    """
    try:
        result = await test_service.create_test(
            folder_id=folder_id,
            user_id=user.id,
            title=title,
            test_type=test_type,
            notes_file=notes_file,
            session=session
        )
        return {"status": "success", "test": result}
    except ResourceNotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Every route must:**
1. Use `Depends(get_session)` to inject DB session
2. Use `Depends(get_current_user)` to ensure authentication
3. Try/except with proper HTTP status codes
4. Accept `user: User` from dependency
5. Use `await` for all async operations

---

## Phase 7: Unit Tests

### Test Structure

```
tests/
├── conftest.py                    # Shared fixtures
├── test_services/
│   ├── test_auth_service.py
│   ├── test_test_service.py
│   ├── test_grading_service.py
│   └── test_flashcard_service.py
└── test_routes/
    ├── test_auth_routes.py
    ├── test_test_routes.py
    └── test_attempt_routes.py
```

### conftest.py

```python
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from src.models.base import Base
from src.config import settings

@pytest_asyncio.fixture
async def test_db():
    """Create in-memory SQLite DB for testing."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()

@pytest_asyncio.fixture
async def test_session(test_db):
    """Provide async session for tests."""
    async with AsyncSession(test_db) as session:
        yield session

@pytest.fixture
def test_user_data():
    """Sample user data."""
    return {
        "email": "test@example.com",
        "google_id": "123456789",
        "full_name": "Test User"
    }

@pytest.fixture
def test_folder_data():
    """Sample folder data."""
    return {
        "name": "Discrete Structures",
        "subject": "Math"
    }
```

### test_services/test_grading_service.py

```python
import pytest
from unittest.mock import AsyncMock, patch
from src.services.grading_service import GradingService
from src.models.question import Question
from src.models.mcq_option import MCQOption
from src.models.user_attempt import UserAttempt

@pytest.mark.asyncio
async def test_grade_mcq_correct(test_session):
    """Test MCQ grading for correct answer."""
    # 1. Create test data
    # 2. Call grade_mcq()
    # 3. Assert is_correct = True
    pass

@pytest.mark.asyncio
async def test_grade_frq_with_uncertain_flag(test_session):
    """Test FRQ grading when LLM is uncertain."""
    # Mock LLM to return "I don't know"
    with patch('src.services.llm_service.LLMService.grade_frq_answer') as mock_llm:
        mock_llm.return_value = {
            "is_correct": False,
            "feedback": "I don't have enough information",
            "flagged_uncertain": True,
            "confidence": 0.0
        }
        
        # Call grading_service.grade_frq()
        result = await grading_service.grade_frq(...)
        
        # Assert flagged_uncertain = True
        assert result.flagged_uncertain == True

@pytest.mark.asyncio
async def test_submit_and_grade_mixed_test(test_session):
    """Test full submission/grading workflow for mixed test."""
    # 1. Create test with 3 MCQ + 2 FRQ
    # 2. Mock LLM for FRQ grading
    # 3. Submit answers
    # 4. Assert scores correct
    # 5. Assert attempt record created
    # 6. Assert weakness detection populated
    pass

@pytest.mark.asyncio
async def test_weakness_detection_accuracy(test_session):
    """Test weakness detection groups questions correctly."""
    # 1. Create test with 1 question
    # 2. Create 3 attempts with different results
    # 3. Call get_weakness_detection()
    # 4. Assert success_rate calculated correctly
    pass
```

### test_routes/test_attempt_routes.py

```python
import pytest
from httpx import AsyncClient
from src.main import app

@pytest.mark.asyncio
async def test_submit_test_requires_auth(test_session):
    """Test that endpoint requires authentication."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/tests/1/attempts", json={})
        assert response.status_code == 401

@pytest.mark.asyncio
async def test_submit_test_success(test_session, test_user_token):
    """Test successful test submission."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/tests/1/attempts",
            json={"answers": [...]},
            headers={"Authorization": f"Bearer {test_user_token}"}
        )
        assert response.status_code == 200
        assert "score" in response.json()
```

### Test Coverage Requirements

**Minimum 80% coverage for:**
- `services/` (all business logic)
- `routes/` (critical endpoints: auth, submit test, grade)
- `repositories/` (DB queries)

**Exclude from coverage:**
- `main.py` (app startup)
- `config.py` (configuration)
- Type hints

Run coverage:
```bash
pytest --cov=src --cov-report=html tests/
```

---

## SWE Guardrails

### Code Quality Standards

#### 1. **Async/Await Consistency**
- ✅ All I/O operations (`session.execute()`, `httpx` calls, file reads) must use `await`
- ✅ No blocking operations in async functions (no `open()`, use `aiofiles`)
- ❌ NEVER use `session.query()` (sync API); always `select()` + `session.scalar()`/`session.execute()`
- ❌ NEVER use `time.sleep()`; use `asyncio.sleep()`

**Check:**
```bash
# Find blocking calls
grep -r "\.query(" src/
grep -r "time\.sleep" src/
```

---

#### 2. **Exception Handling**
- ✅ Use custom exceptions (`StudyAppException`, `ResourceNotFoundException`)
- ✅ Log all exceptions with context (user ID, resource, action)
- ✅ Return meaningful HTTP status codes (401, 403, 404, 422, 500)
- ❌ NEVER return raw ORM models in error responses
- ❌ NEVER expose database errors to client

**Pattern:**
```python
try:
    result = await operation()
except SpecificException as e:
    logger.error(f"Operation failed for user {user_id}: {e}")
    raise HTTPException(status_code=400, detail="User-friendly message")
except Exception as e:
    logger.exception(f"Unexpected error: {e}")
    raise HTTPException(status_code=500, detail="Internal server error")
```

---

#### 3. **Type Safety**
- ✅ Use type hints on all function arguments and returns
- ✅ Use Pydantic schemas for all API inputs/outputs
- ✅ Use `Optional[T]` for nullable fields
- ❌ NEVER use `Any` type
- ❌ NEVER accept bare dictionaries; use Pydantic models

**Check:**
```bash
# Find missing type hints
mypy src/ --disallow-untyped-defs
```

---

#### 4. **Database Operations**
- ✅ Use `session.flush()` before accessing auto-generated IDs
- ✅ Use `cascade="all, delete-orphan"` for parent-child relationships
- ✅ Add indexes on foreign keys and frequently queried columns
- ✅ Use `unique=True` constraint to prevent duplicates
- ❌ NEVER do N+1 queries; always use `joinedload()` or separate fetch
- ❌ NEVER leak ORM models to frontend; convert to schemas

**Pattern:**
```python
# GOOD
stmt = select(Test).options(joinedload(Test.questions))
test = await session.scalar(stmt)

# BAD
test = await session.scalar(select(Test).where(Test.id == test_id))
# Then accessing test.questions triggers another query
```

---

#### 5. **Data Validation**
- ✅ Use Pydantic validators for all inputs
- ✅ Validate file types on upload (PDF, TXT only)
- ✅ Validate file size (<50MB)
- ✅ Validate answer format (MCQ: A-Z, FRQ: string)
- ❌ NEVER trust user input
- ❌ NEVER insert unsanitized data into LLM prompts (escape injection attempts)

**Pattern:**
```python
from pydantic import BaseModel, Field, validator

class SubmitAnswerDTO(BaseModel):
    question_id: int
    answer: str = Field(..., min_length=1, max_length=5000)
    
    @validator("answer")
    def answer_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Answer cannot be empty")
        return v.strip()
```

---

#### 6. **LLM Safety**
- ✅ Always include notes context in grading prompts
- ✅ Flag answers with low confidence (< 0.6)
- ✅ Limit LLM response length (max 1000 tokens)
- ✅ Timeout LLM calls (30s max)
- ❌ NEVER let LLM respond freely without guardrails
- ❌ NEVER trust LLM grading without noting uncertainty

**Pattern:**
```python
prompt = f"""
You are a study assistant grading a test. You ONLY grade based on the provided notes.

NOTES (your knowledge base):
{notes_content}

QUESTION: {question}
USER_ANSWER: {user_answer}
EXPECTED_ANSWER: {expected_answer}

If you cannot grade based on the notes, respond with:
is_correct: false
feedback: "I don't have enough information from the provided notes."
confidence: 0.0

Otherwise, respond with:
is_correct: [true/false]
feedback: [brief explanation]
confidence: [0.0-1.0]
"""
```

---

#### 7. **Logging & Observability**
- ✅ Log all critical operations (auth, test creation, grading)
- ✅ Log with structured fields (user_id, resource_id, action, result)
- ✅ Use appropriate log levels (INFO, WARNING, ERROR)
- ❌ NEVER log passwords, tokens, or sensitive data
- ❌ NEVER use generic log messages

**Pattern:**
```python
logger.info(
    "Test submitted",
    extra={
        "user_id": user.id,
        "test_id": test_id,
        "attempt_number": attempt_number,
        "score": score
    }
)
```

---

#### 8. **Code Organization**
- ✅ Keep functions <50 lines (break into helpers)
- ✅ Use repositories for ALL database access (no direct session in services)
- ✅ Use services for ALL business logic (no logic in routes)
- ✅ Use constants for magic strings/numbers
- ❌ NEVER access DB directly in routes
- ❌ NEVER mix business logic with API logic

**Correct flow:** Route → Service → Repository → DB

---

#### 9. **Performance**
- ✅ Use `LIMIT` on all list queries (pagination)
- ✅ Use indexes on `user_id`, `test_id`, `folder_id` (all FK columns)
- ✅ Batch LLM calls (don't call once per question)
- ✅ Cache LLM responses for identical inputs
- ❌ NEVER load entire tables into memory
- ❌ NEVER call LLM synchronously (always async)

**Pattern:**
```python
# Pagination
limit = 20
offset = (page - 1) * limit
stmt = select(Test).where(Test.folder_id == folder_id).limit(limit).offset(offset)
```

---

#### 10. **Testing**
- ✅ Write unit tests for all service methods
- ✅ Mock external dependencies (LLM, Google OAuth)
- ✅ Test both happy path + error cases
- ✅ Use fixtures for repeated test data
- ❌ NEVER make actual LLM API calls in tests
- ❌ NEVER test with production database

**Pattern:**
```python
@pytest.mark.asyncio
async def test_submit_test_handles_llm_failure(test_session):
    """Test graceful degradation when LLM fails."""
    with patch('src.services.llm_service.LLMService.grade_frq_answer') as mock_llm:
        mock_llm.side_effect = TimeoutError("LLM timeout")
        
        # Should flag answer as uncertain, not crash
        result = await grading_service.submit_and_grade(...)
        assert any(ans.flagged_uncertain for ans in result.answers)
```

---

### Pre-Commit Checklist

Before pushing code:

```bash
# 1. Format code
black src/ tests/

# 2. Lint
flake8 src/ tests/ --max-line-length=100

# 3. Type check
mypy src/ --disallow-untyped-defs

# 4. Run tests
pytest tests/ -v --cov=src

# 5. Check async consistency
grep -r "\.query(" src/ && echo "FAIL: Found sync queries"
grep -r "time\.sleep" src/ && echo "FAIL: Found blocking sleeps"

# 6. Verify no hardcoded secrets
grep -r "api_key" src/ && echo "FAIL: Found hardcoded secrets"
```

---

## Implementation Order

### Week 1: Database + ORM

- [ ] Create all 11 models in `models/`
- [ ] Write Alembic initial migration
- [ ] Test migration on local PostgreSQL
- [ ] Verify relationships + constraints

### Week 2: Services + Business Logic

- [ ] Implement `AuthService` (Google OAuth)
- [ ] Implement `FileService` (PDF/TXT parsing)
- [ ] Implement `TestService` (test creation)
- [ ] Implement `LLMService` (stub with mock responses)
- [ ] Unit test all services (80%+ coverage)

### Week 3: Routes + API

- [ ] Implement auth routes
- [ ] Implement folder routes
- [ ] Implement test CRUD routes
- [ ] Implement attempt/grading routes
- [ ] Implement flashcard routes
- [ ] Integration test all endpoints

### Week 4: LLM + Polish

- [ ] Connect real LLM (Ollama or Groq)
- [ ] Implement full grading logic
- [ ] Test with real notes + questions
- [ ] Performance optimization (indexes, caching)
- [ ] Production deployment

---

## Definition of Done

Code is ready for deployment when:

1. ✅ All 11 database tables created + indexed
2. ✅ All 20+ endpoints implemented + tested
3. ✅ Async/await used consistently (no blocking I/O)
4. ✅ 80%+ test coverage (services + routes)
5. ✅ All errors properly handled + logged
6. ✅ LLM integration working (grading + generation)
7. ✅ Google OAuth authentication functional
8. ✅ Migrations run cleanly on Neon
9. ✅ Code passes all pre-commit checks
10. ✅ README + API docs complete

---

## Related Documents

[[StudyApp_SystemDesign]]
[[FastAPI Best Practices]]
[[PostgreSQL Schema Design]]

