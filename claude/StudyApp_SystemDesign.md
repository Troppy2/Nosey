---
title: Study App - System Design Document
tags: [backend, system-design, database, architecture, fastapi, postgresql]
created: 2026-04-28
---

# Study App - System Design Document

## Quick Navigation

**Table of Contents:**
- [[#Overview]]
- [[#Architecture]]
- [[#Database Schema]]
- [[#API Endpoints]]
- [[#Business Logic Layer]]
- [[#Tools & Utilities]]
- [[#Database Migrations]]
- [[#Implementation Notes]]

---

## Overview

### Purpose
Study App is a self-hosted, free alternative to paywalled study tools like Quizlet. It allows students to upload study materials (PDFs, text files), create practice tests with MCQ/FRQ questions, take unlimited graded tests with AI-powered feedback, and generate flashcards with spaced repetition tracking.

### Tech Stack
- **Frontend:** React + TypeScript (Netlify)
- **Backend:** FastAPI (Python, async/await)
- **Database:** PostgreSQL (Neon)
- **Deployment:** Render (Backend)
- **AI Grading:** Ollama (local) + Groq (optional hosted inference)
- **Auth:** Google OAuth 2.0

### Key Design Principles
1. **Guardrailed AI:** LLM only answers what's in uploaded notes; flags uncertainty
2. **Honest feedback:** Disclaimer that all AI-generated content may be incorrect
3. **Privacy-first:** Notes stored locally in PostgreSQL, not synced to external AI services
4. **Simplicity:** No vector DB complexity; context passed directly to LLM
5. **Scalability:** Single database for MVP; sharding not needed

---

## Architecture

### Layered Backend Structure

```
┌─────────────────────────────────────────────────────┐
│               FastAPI Application                   │
├─────────────────────────────────────────────────────┤
│  Route Layer (Endpoints)                            │
│  - /auth, /folders, /tests, /flashcards, /attempts  │
├─────────────────────────────────────────────────────┤
│  Business Logic Layer                               │
│  - TestService, FlashcardService, GradingService   │
│  - LLM Orchestration (Ollama/Groq calls)           │
├─────────────────────────────────────────────────────┤
│  Data Access Layer (DAO/Repository Pattern)         │
│  - UserRepository, TestRepository, etc.            │
├─────────────────────────────────────────────────────┤
│  Database Layer (SQLAlchemy ORM)                   │
│  - Models, async session management                │
├─────────────────────────────────────────────────────┤
│               PostgreSQL (Neon)                     │
└─────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

> [!warning] Important
> Do NOT use a distributed system or vector DB for MVP. Context passing (Option A) is sufficient for note sets under 100 pages.

#### Why No Vector DB / RAG?
- User uploads 5-20 pages of notes per test
- Simple context window passing to LLM works fine
- Vector DB adds deployment complexity (Pinecone, Supabase pgvector)
- Context retrieval overhead not justified for small note sets
- Future: Add pgvector to PostgreSQL if note libraries exceed 500+ pages

#### Why Async FastAPI?
- I/O-bound operations (DB queries, LLM calls, file uploads)
- Concurrent request handling without thread overhead
- Scales horizontally on Render with minimal cost

---

## Database Schema

### Schema Overview

```
users
├── folders
│   ├── tests
│   │   ├── questions
│   │   │   ├── mcq_options
│   │   │   └── frq_answers
│   │   ├── user_attempts
│   │   │   └── user_answers
│   │   └── notes
│   └── flashcards
│       └── flashcard_attempts
```

### Table Definitions

#### 1. **users**
```sql
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    google_id VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    profile_picture_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_google_id (google_id),
    INDEX idx_email (email)
);
```

**Why:** Google OAuth stores `google_id` as the primary identifier. Email is unique but `google_id` is the OAuth key.

---

#### 2. **folders**
```sql
CREATE TABLE folders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, name),
    INDEX idx_user_id (user_id)
);
```

**Why:** Folders organize tests and flashcards by subject. Unique constraint on (user_id, name) prevents duplicate folder names per user.

---

#### 3. **tests**
```sql
CREATE TABLE tests (
    id BIGSERIAL PRIMARY KEY,
    folder_id BIGINT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    test_type VARCHAR(50) NOT NULL, -- 'MCQ_only', 'FRQ_only', 'mixed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_folder_id (folder_id)
);
```

**Why:** `test_type` determines frontend rendering and grading logic. Cascade delete ensures cleanup when folder is deleted.

---

#### 4. **questions**
```sql
CREATE TABLE questions (
    id BIGSERIAL PRIMARY KEY,
    test_id BIGINT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type VARCHAR(10) NOT NULL, -- 'MCQ' or 'FRQ'
    display_order INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_test_id (test_id)
);
```

**Why:** `display_order` maintains question sequence. Separate `question_text` from options/answers for cleaner schema.

---

#### 5. **mcq_options**
```sql
CREATE TABLE mcq_options (
    id BIGSERIAL PRIMARY KEY,
    question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    display_order INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_question_id (question_id)
);
```

**Why:** Multiple options per question. `is_correct` flag set by LLM during test generation. Only ONE option should have `is_correct = true`.

---

#### 6. **frq_answers**
```sql
CREATE TABLE frq_answers (
    id BIGSERIAL PRIMARY KEY,
    question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    expected_answer TEXT NOT NULL, -- Extracted from uploaded notes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_question_id (question_id)
);
```

**Why:** FRQ questions have one expected answer (from notes). LLM uses this as reference for grading similarity.

---

#### 7. **notes**
```sql
CREATE TABLE notes (
    id BIGSERIAL PRIMARY KEY,
    test_id BIGINT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(10) NOT NULL, -- 'pdf' or 'txt'
    content TEXT NOT NULL, -- Full extracted text from PDF/TXT
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_test_id (test_id)
);
```

**Why:** Store extracted note content as plain text. LLM receives this as context during grading. No file storage on disk; everything in DB.

---

#### 8. **user_attempts**
```sql
CREATE TABLE user_attempts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    test_id BIGINT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL,
    total_score DECIMAL(5, 2),
    total_questions INT,
    correct_count INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, test_id, attempt_number),
    INDEX idx_user_id (user_id),
    INDEX idx_test_id (test_id)
);
```

**Why:** Track attempt history and score progression. Unique constraint prevents duplicate attempt numbers per test. Used for progress tracking.

---

#### 9. **user_answers**
```sql
CREATE TABLE user_answers (
    id BIGSERIAL PRIMARY KEY,
    attempt_id BIGINT NOT NULL REFERENCES user_attempts(id) ON DELETE CASCADE,
    question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_answer TEXT NOT NULL,
    is_correct BOOLEAN,
    ai_feedback TEXT, -- LLM-generated explanation
    confidence_score DECIMAL(3, 2), -- 0.0 to 1.0 (how confident LLM is)
    flagged_uncertain BOOLEAN DEFAULT FALSE, -- True if LLM said "I don't know"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(attempt_id, question_id),
    INDEX idx_attempt_id (attempt_id)
);
```

**Why:** One row per question answered. Stores user's answer, correctness, LLM feedback, and confidence. `flagged_uncertain` marks answers where LLM couldn't ground answer in notes.

---

#### 10. **flashcards**
```sql
CREATE TABLE flashcards (
    id BIGSERIAL PRIMARY KEY,
    folder_id BIGINT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    source VARCHAR(50), -- 'extracted_from_test', 'generated_from_prompt', 'user_created'
    difficulty INT DEFAULT 1, -- 1-5 scale (1=easy, 5=hard)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_folder_id (folder_id)
);
```

**Why:** Flashcards tied to folder (can reference multiple tests). `difficulty` tracks weakness areas. `source` tracks origin for debug/audit.

---

#### 11. **flashcard_attempts**
```sql
CREATE TABLE flashcard_attempts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    flashcard_id BIGINT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    correct BOOLEAN NOT NULL,
    time_ms INT, -- milliseconds spent on card
    attempt_number INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user_id (user_id),
    INDEX idx_flashcard_id (flashcard_id)
);
```

**Why:** Track spaced repetition. Weak cards (low success rate) get higher difficulty. Time spent helps identify cards needing review.

---

### Indexes & Query Performance

```
Primary Indexes (MUST HAVE):
- users(google_id) — OAuth lookups
- folders(user_id) — Fetch user's folders
- tests(folder_id) — Fetch tests in folder
- questions(test_id) — Fetch questions in test
- notes(test_id) — Fetch notes for test
- user_attempts(user_id, test_id) — Fetch attempt history
- flashcards(folder_id) — Fetch flashcards in folder
- flashcard_attempts(user_id, flashcard_id) — Weak card detection
```

> [!tip] Performance Optimization
> Add these indexes **after** initial schema creation. Monitor slow query logs and add indexes as needed.

---

## API Endpoints

### Authentication Routes

#### `POST /auth/google`
**Purpose:** Google OAuth callback. Verify token and create/update user.

**Request:**
```json
{
  "token": "google_id_token"
}
```

**Response:**
```json
{
  "user_id": 123,
  "access_token": "jwt_token",
  "email": "user@example.com"
}
```

**Business Logic:**
1. Verify Google token signature
2. Check if user exists (by google_id)
3. If not, create new user record
4. Generate JWT token
5. Return to frontend

---

### Folder Routes

#### `GET /folders`
Fetch all folders for authenticated user.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Discrete Structures",
    "subject": "Math",
    "test_count": 5,
    "flashcard_count": 42,
    "created_at": "2026-04-28T10:00:00Z"
  }
]
```

**Query:** `SELECT * FROM folders WHERE user_id = ? ORDER BY created_at DESC`

---

#### `POST /folders`
Create new folder.

**Request:**
```json
{
  "name": "Discrete Structures",
  "subject": "Math"
}
```

**Response:** Folder object (201 Created)

---

#### `GET /folders/{folder_id}`
Fetch folder details + nested tests/flashcards count.

---

#### `DELETE /folders/{folder_id}`
Delete folder (cascades to tests, flashcards, attempts).

---

### Test Routes

#### `POST /folders/{folder_id}/tests`
Create new test. User uploads PDF/TXT notes here.

**Request (multipart/form-data):**
```
- title: "Midterm Practice"
- test_type: "mixed"
- notes_file: [PDF/TXT file]
```

**Business Logic:**
1. Extract text from PDF/TXT
2. Create test record
3. Store notes in `notes` table
4. Prompt LLM: "Generate 10 MCQ + 5 FRQ from these notes"
5. LLM returns structured question data
6. Insert questions + options/answers into DB

**Response:**
```json
{
  "test_id": 42,
  "title": "Midterm Practice",
  "questions_generated": 15,
  "message": "Test created. Ready to take."
}
```

---

#### `GET /folders/{folder_id}/tests`
Fetch all tests in folder.

**Response:**
```json
[
  {
    "id": 42,
    "title": "Midterm Practice",
    "test_type": "mixed",
    "question_count": 15,
    "best_score": 92.5,
    "attempt_count": 3,
    "created_at": "2026-04-28T10:00:00Z"
  }
]
```

---

#### `GET /tests/{test_id}`
Fetch test + all questions (for taking test).

**Response:**
```json
{
  "id": 42,
  "title": "Midterm Practice",
  "test_type": "mixed",
  "questions": [
    {
      "id": 100,
      "type": "MCQ",
      "question_text": "What is recursion?",
      "options": [
        { "id": 1, "text": "...", "is_correct": null }, // Null to user
        { "id": 2, "text": "...", "is_correct": null },
        // ...
      ]
    },
    {
      "id": 101,
      "type": "FRQ",
      "question_text": "Explain tail recursion."
    }
  ]
}
```

**Why `is_correct: null`?** Don't leak correct answer to frontend before grading.

---

#### `POST /tests/{test_id}/attempts`
Submit test answers. Triggers grading.

**Request:**
```json
{
  "answers": [
    { "question_id": 100, "answer": "A" },
    { "question_id": 101, "answer": "Tail recursion is..." }
  ]
}
```

**Business Logic (Critical):**
1. Create `user_attempt` record
2. For each answer:
   a. **MCQ:** Match against `mcq_options.is_correct`
   b. **FRQ:** Call LLM grader with expected_answer + user_answer + notes context
3. Store results in `user_answers`
4. Calculate score
5. Return detailed feedback

**LLM Prompt Structure (FRQ):**
```
You are a grading assistant. Grade the user's FRQ response.

NOTES (your knowledge base):
{notes_content}

EXPECTED ANSWER:
{expected_answer}

USER'S ANSWER:
{user_answer}

Task:
1. Is the user's answer substantially correct? (Yes/No)
2. If "No", explain what they got wrong.
3. If "Yes", provide one area they could improve.
4. If your notes don't cover this question, respond with: "I don't have enough information to grade this. Check with your instructor or classmates."

Respond ONLY with:
is_correct: [true/false]
feedback: [explanation]
flagged_uncertain: [true/false]
confidence: [0.0-1.0]
```

**Response:**
```json
{
  "attempt_id": 555,
  "score": 85.5,
  "correct_count": 12,
  "total": 15,
  "answers": [
    {
      "question_id": 100,
      "user_answer": "A",
      "is_correct": true,
      "feedback": null
    },
    {
      "question_id": 101,
      "user_answer": "...",
      "is_correct": true,
      "feedback": "Good explanation. Next time, mention stack frames.",
      "confidence": 0.92
    }
  ]
}
```

---

#### `GET /tests/{test_id}/attempts`
Fetch attempt history for user on this test.

**Response:**
```json
[
  {
    "attempt_number": 1,
    "score": 78.5,
    "correct_count": 11,
    "total": 15,
    "created_at": "2026-04-25T14:00:00Z"
  },
  {
    "attempt_number": 2,
    "score": 85.5,
    "correct_count": 12,
    "total": 15,
    "created_at": "2026-04-28T10:00:00Z"
  }
]
```

---

#### `GET /tests/{test_id}/attempts/{attempt_id}`
Fetch detailed results for specific attempt.

**Response:** Full attempt data + all answers + feedback.

---

### Flashcard Routes

#### `POST /folders/{folder_id}/flashcards`
Create flashcard (user-created or LLM-generated).

**Request:**
```json
{
  "front": "What is recursion?",
  "back": "A function that calls itself with a base case.",
  "source": "user_created" // or "generated_from_prompt"
}
```

---

#### `POST /folders/{folder_id}/flashcards/generate`
Generate flashcards from test or custom prompt.

**Request:**
```json
{
  "source_type": "test", // or "prompt"
  "test_id": 42, // if source_type = "test"
  "prompt": null, // if source_type = "prompt", e.g., "Recursion in Java"
  "count": 10
}
```

**Business Logic:**
1. If source_type = "test":
   - Fetch test notes + questions
   - Prompt: "Generate 10 flashcards from this test material"
2. If source_type = "prompt":
   - Prompt: "Generate 10 flashcards on {prompt}. Use uploaded notes as reference if available."
3. LLM returns structured flashcard data
4. Insert into `flashcards` table

---

#### `GET /folders/{folder_id}/flashcards`
Fetch all flashcards in folder + weakness indicators.

**Response:**
```json
[
  {
    "id": 1,
    "front": "...",
    "back": "...",
    "difficulty": 3,
    "attempt_count": 10,
    "correct_count": 6,
    "success_rate": 0.6, // 6/10
    "last_attempted": "2026-04-28T10:00:00Z"
  }
]
```

---

#### `POST /folders/{folder_id}/flashcards/{flashcard_id}/attempt`
Record flashcard study attempt (for spaced repetition).

**Request:**
```json
{
  "correct": true,
  "time_ms": 2500
}
```

**Business Logic:**
1. Insert into `flashcard_attempts`
2. Calculate success rate
3. Update `flashcards.difficulty` based on success trend:
   - 80%+ success → difficulty -= 1
   - 40-79% success → difficulty unchanged
   - <40% success → difficulty += 1

---

### Progress/Analytics Routes

#### `GET /tests/{test_id}/progress`
Fetch weakness detection for test.

**Query:**
```sql
SELECT 
  q.id,
  q.question_text,
  COUNT(*) as times_attempted,
  SUM(CASE WHEN ua.is_correct THEN 1 ELSE 0 END) as times_correct,
  (SUM(CASE WHEN ua.is_correct THEN 1 ELSE 0 END) / COUNT(*)) as success_rate
FROM user_answers ua
JOIN questions q ON ua.question_id = q.id
WHERE q.test_id = ? AND ua.attempt_id IN (SELECT id FROM user_attempts WHERE user_id = ? AND test_id = ?)
GROUP BY q.id, q.question_text
ORDER BY success_rate ASC;
```

**Response:**
```json
[
  {
    "question_id": 101,
    "question_text": "Explain tail recursion.",
    "times_attempted": 3,
    "times_correct": 1,
    "success_rate": 0.33,
    "category": "weak"
  }
]
```

---

## Business Logic Layer

### Service Architecture

```
services/
├── test_service.py
├── grading_service.py
├── flashcard_service.py
├── llm_service.py
├── auth_service.py
└── file_service.py
```

---

### TestService

**Responsibilities:**
- Test creation
- Question/option generation via LLM
- Test retrieval

**Key Methods:**

```python
class TestService:
    async def create_test(
        self,
        folder_id: int,
        title: str,
        test_type: str,
        notes_file: UploadFile
    ) -> TestDTO:
        """
        1. Extract text from PDF/TXT
        2. Create test record
        3. Store notes in DB
        4. Call LLM to generate questions
        5. Insert questions/options/answers
        """
        pass
    
    async def get_test_with_questions(self, test_id: int) -> TestDTO:
        """
        Fetch test + all questions for taking test.
        Returns is_correct=null to avoid leaking answers.
        """
        pass
    
    async def get_attempt_history(self, test_id: int, user_id: int):
        """Fetch score history for user on this test."""
        pass
```

---

### GradingService

**Responsibilities:**
- Answer submission + grading
- LLM orchestration for FRQ grading
- Score calculation

**Key Methods:**

```python
class GradingService:
    async def submit_and_grade(
        self,
        test_id: int,
        user_id: int,
        answers: List[AnswerDTO]
    ) -> AttemptResultDTO:
        """
        1. Create user_attempt record
        2. For each answer:
           a. Grade MCQ directly (match against is_correct)
           b. Call LLM for FRQ grading
        3. Store all results
        4. Calculate final score
        5. Return graded attempt
        """
        pass
    
    async def grade_frq(
        self,
        question_id: int,
        user_answer: str,
        test_id: int
    ) -> FRQGradeDTO:
        """
        1. Fetch expected_answer, notes, question_text
        2. Build LLM prompt with guardrails
        3. Call Ollama or Groq
        4. Parse response (is_correct, feedback, confidence)
        5. Return grade
        """
        pass
    
    async def get_weakness_detection(
        self,
        test_id: int,
        user_id: int
    ) -> List[WeaknessDTO]:
        """
        Query user_answers for this test.
        Group by question.
        Calculate success_rate per question.
        Return sorted by success_rate (weakest first).
        """
        pass
```

---

### FlashcardService

**Responsibilities:**
- Flashcard creation (user + LLM-generated)
- Spaced repetition tracking
- Weakness detection

**Key Methods:**

```python
class FlashcardService:
    async def generate_from_test(
        self,
        test_id: int,
        folder_id: int,
        count: int
    ) -> List[FlashcardDTO]:
        """
        1. Fetch test notes + questions
        2. Build prompt for LLM
        3. Generate flashcards
        4. Store in DB
        5. Return created flashcards
        """
        pass
    
    async def generate_from_prompt(
        self,
        folder_id: int,
        prompt: str,
        count: int
    ) -> List[FlashcardDTO]:
        """
        1. Fetch folder's notes (if any)
        2. Build prompt: "Generate {count} flashcards on {prompt}"
        3. Call LLM
        4. Store + return
        """
        pass
    
    async def record_attempt(
        self,
        flashcard_id: int,
        user_id: int,
        correct: bool,
        time_ms: int
    ):
        """
        1. Insert flashcard_attempt
        2. Calculate success rate
        3. Update difficulty:
           - success_rate >= 0.8: difficulty -= 1
           - success_rate < 0.4: difficulty += 1
        4. Return updated flashcard
        """
        pass
    
    async def get_weak_flashcards(
        self,
        folder_id: int,
        user_id: int,
        threshold: float = 0.5
    ) -> List[FlashcardDTO]:
        """
        Query flashcard_attempts for user.
        Calculate success_rate per flashcard.
        Return cards with success_rate < threshold (sorted by difficulty).
        """
        pass
```

---

### LLMService

**Responsibilities:**
- Ollama/Groq API calls
- Prompt engineering
- Response parsing

**Key Methods:**

```python
class LLMService:
    async def generate_test_questions(
        self,
        notes: str,
        test_type: str,
        count_mcq: int,
        count_frq: int
    ) -> GeneratedTestDTO:
        """
        Build prompt:
        "From these notes, generate {count_mcq} MCQ + {count_frq} FRQ.
         Each MCQ needs 4 options, 1 correct.
         Each FRQ needs 1 expected answer."
        
        Call Ollama/Groq with structured output.
        Parse JSON response.
        Return structured questions.
        """
        pass
    
    async def grade_frq_answer(
        self,
        notes: str,
        question: str,
        expected_answer: str,
        user_answer: str
    ) -> FRQGradeDTO:
        """
        Build prompt with guardrails (see endpoint section).
        Call LLM.
        Parse response:
          - is_correct (bool)
          - feedback (str)
          - flagged_uncertain (bool)
          - confidence (float 0-1)
        Return FRQGradeDTO
        """
        pass
    
    async def generate_flashcards(
        self,
        content: str,
        count: int,
        prompt: str = None
    ) -> List[FlashcardDTO]:
        """
        Build prompt:
        "Generate {count} flashcards from this content.
         Format: front: ..., back: ..."
        
        Call LLM.
        Parse JSON response.
        Return list of flashcards.
        """
        pass
```

---

### AuthService

**Responsibilities:**
- Google OAuth verification
- JWT generation/validation
- User session management

**Key Methods:**

```python
class AuthService:
    async def verify_google_token(self, token: str) -> GoogleUserDTO:
        """
        1. Call Google token verification endpoint
        2. Extract user info (email, name, picture)
        3. Return user data
        """
        pass
    
    async def authenticate_user(
        self,
        google_id: str,
        email: str,
        full_name: str,
        picture_url: str
    ) -> TokenDTO:
        """
        1. Check if user exists (by google_id)
        2. If not, create new user record
        3. Generate JWT token
        4. Return token + user info
        """
        pass
    
    def generate_jwt(self, user_id: int) -> str:
        """Create JWT token with user_id claim."""
        pass
    
    def verify_jwt(self, token: str) -> int:
        """Validate JWT. Return user_id or raise exception."""
        pass
```

---

### FileService

**Responsibilities:**
- PDF/TXT parsing
- Text extraction

**Key Methods:**

```python
class FileService:
    async def extract_text_from_pdf(self, file: UploadFile) -> str:
        """
        1. Read file bytes
        2. Use pdfplumber to extract text
        3. Return plain text string
        """
        pass
    
    async def extract_text_from_txt(self, file: UploadFile) -> str:
        """
        1. Read file bytes
        2. Decode as UTF-8
        3. Return text
        """
        pass
    
    async def extract_from_file(self, file: UploadFile) -> str:
        """
        Route to correct extraction method based on file extension.
        """
        pass
```

---

## Tools & Utilities

### Directory Structure

```
src/
├── main.py                 # FastAPI app initialization
├── config.py               # Environment variables
├── dependencies.py         # Dependency injection
├── models/
│   ├── user.py
│   ├── folder.py
│   ├── test.py
│   ├── question.py
│   ├── flashcard.py
│   └── attempt.py
├── schemas/                # Pydantic models (DTOs)
│   ├── user_schema.py
│   ├── test_schema.py
│   ├── attempt_schema.py
│   └── flashcard_schema.py
├── routes/
│   ├── auth.py
│   ├── folders.py
│   ├── tests.py
│   ├── attempts.py
│   └── flashcards.py
├── services/
│   ├── test_service.py
│   ├── grading_service.py
│   ├── flashcard_service.py
│   ├── llm_service.py
│   ├── auth_service.py
│   └── file_service.py
├── repositories/           # Data access
│   ├── user_repository.py
│   ├── test_repository.py
│   ├── attempt_repository.py
│   └── flashcard_repository.py
├── utils/
│   ├── logger.py
│   ├── exceptions.py
│   └── validators.py
└── migrations/             # Alembic
```

---

### Key Utilities

#### config.py
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str
    JWT_SECRET: str
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    GROQ_API_KEY: str = None  # Optional
    
    class Config:
        env_file = ".env"

settings = Settings()
```

#### exceptions.py
```python
class StudyAppException(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code

class UnauthorizedException(StudyAppException):
    def __init__(self):
        super().__init__("Unauthorized", 401)

class ResourceNotFoundException(StudyAppException):
    def __init__(self, resource: str):
        super().__init__(f"{resource} not found", 404)

class LLMGradingException(StudyAppException):
    def __init__(self, reason: str):
        super().__init__(f"LLM grading failed: {reason}", 500)
```

---

## Database Migrations

### Alembic Setup

```bash
alembic init migrations
```

### Migration Strategy

**Structure:**
```
migrations/
├── versions/
│   ├── 001_initial_schema.py
│   ├── 002_add_indexes.py
│   └── 003_add_constraints.py
└── env.py
```

### Initial Schema Migration (001)

```python
"""Initial schema creation

Revision ID: 001
Revises: None
Create Date: 2026-04-28

"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    op.create_table(
        'users',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('google_id', sa.String(255), nullable=False, unique=True),
        sa.Column('full_name', sa.String(255)),
        sa.Column('profile_picture_url', sa.Text()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id')
    )
    
    # ... repeat for all tables
    
    # Create indexes
    op.create_index('idx_google_id', 'users', ['google_id'])
    op.create_index('idx_email', 'users', ['email'])

def downgrade():
    op.drop_table('users')
    # ... drop all other tables in reverse order
```

### Running Migrations

```bash
# Create new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

> [!warning] Production Caution
> Always test migrations on a staging database before production deployment.

---

## Implementation Notes

### Async/Await Best Practices

**Use async for:**
- Database queries (SQLAlchemy async)
- LLM API calls (httpx async)
- File I/O

```python
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

engine = create_async_engine(settings.DATABASE_URL)

async def get_session() -> AsyncSession:
    async with AsyncSession(engine) as session:
        yield session

@app.post("/tests/{test_id}/attempts")
async def submit_test(
    test_id: int,
    request: AttemptDTO,
    session: AsyncSession = Depends(get_session),
    user_id: int = Depends(get_current_user)
):
    result = await grading_service.submit_and_grade(
        test_id, user_id, request.answers, session
    )
    return result
```

---

### LLM Integration Pattern

**Ollama (Local):**
```python
import httpx

async def call_ollama(prompt: str, model: str = "mistral") -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.OLLAMA_BASE_URL}/api/generate",
            json={"model": model, "prompt": prompt}
        )
    return response.json()["response"]
```

**Groq (Hosted, Optional):**
```python
from groq import Groq

async def call_groq(prompt: str) -> str:
    client = Groq(api_key=settings.GROQ_API_KEY)
    response = client.chat.completions.create(
        model="mixtral-8x7b-32768",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content
```

---

### Error Handling

```python
@app.exception_handler(StudyAppException)
async def exception_handler(request, exc: StudyAppException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.message}
    )

@app.exception_handler(Exception)
async def general_exception_handler(request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"}
    )
```

---

### Testing Strategy

**Unit Tests:**
- Service layer (grading_service, flashcard_service)
- Utilities (file_service, auth_service)

**Integration Tests:**
- API endpoints
- Database interactions
- LLM mocking

```python
import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_grade_mcq():
    # Mock dependencies
    # Call endpoint
    # Assert results
    pass

@pytest.mark.asyncio
async def test_grade_frq_with_llm_fallback():
    # Mock LLM to return "uncertain"
    # Assert feedback flagged
    pass
```

---

### Deployment Checklist

- [ ] Database migrations run successfully on Neon
- [ ] Environment variables set on Render (.env)
- [ ] Google OAuth credentials configured
- [ ] Ollama service running (local) or Groq API key set
- [ ] JWT secret generated and stored securely
- [ ] CORS configured for Netlify frontend domain
- [ ] Rate limiting enabled on endpoints
- [ ] Logging configured (Render logs)
- [ ] Backup strategy for PostgreSQL (Neon backups)
- [ ] Health check endpoint (`GET /health`)

---

## Summary & Key Takeaways

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Database** | PostgreSQL (Neon) | Relational schema, strong consistency, async support |
| **AI Grading** | Ollama/Groq | Guardrailed, notes-based grading; not pure hallucination |
| **Architecture** | Layered (routes → services → repos → DB) | Clean separation, testability, scalability |
| **Async/Await** | Full async stack | I/O-heavy workload, scales efficiently |
| **RAG/Vector DB** | Not used (Context passing) | Overkill for small note sets; added complexity |
| **Auth** | Google OAuth | No password handling, reduces security burden |
| **Flashcards** | Spaced repetition + difficulty tracking | Adaptive learning, weakness detection |

---

## Related Topics

[[Park&Go V2 Architecture]]
[[FastAPI Best Practices]]
[[PostgreSQL Schema Design]]

