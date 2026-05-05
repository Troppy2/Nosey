"""
Integration test: Simulate actual folder file upload → storage → retrieval flow.
"""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock
from io import BytesIO
from fastapi import UploadFile

from src.services.file_service import FileService
from src.services.llm_service import LLMService
from src.models.folder_file import FolderFile
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_folder_file_upload_to_retrieval():
    """
    Simulate: Upload → Extract → Store → Retrieve → Retrieve for chat → RAG retrieval
    This tests the full pipeline.
    """
    print("\n=== FULL PIPELINE INTEGRATION TEST ===\n")
    
    # Step 1: Simulate file upload
    markdown_content = b"""# Threading and Processes Study Guide

## Chapter 1: Introduction to Threading

### What is a Thread?
A thread is a lightweight process that shares memory with other threads in the same process.
Threads can run concurrently and communicate via shared variables.

### Process vs Thread
- **Thread**: Lightweight, shared memory, fast communication
- **Process**: Independent, separate memory, slower communication

## Chapter 2: Thread Synchronization

### Locks
A lock is a synchronization primitive that allows only one thread to access a resource at a time.

### Semaphore
A semaphore is a counter-based synchronization primitive.

## Key Definitions
- **Concurrency**: Multiple tasks making progress simultaneously
- **GIL**: Global Interpreter Lock in Python
"""
    
    # Create mock UploadFile
    upload_file = MagicMock(spec=UploadFile)
    upload_file.filename = "Threads_Study.md"
    upload_file.read = AsyncMock(return_value=markdown_content)
    
    # Step 2: Extract file content
    file_svc = FileService()
    extracted_content, file_type = await file_svc.extract_from_file(upload_file)
    
    print(f"Step 1: File extracted")
    print(f"  Filename: {upload_file.filename}")
    print(f"  File type: {file_type}")
    print(f"  Extracted content length: {len(extracted_content)} chars")
    print(f"  Content preview: {extracted_content[:150]}...")
    
    assert extracted_content, "Extracted content should not be empty"
    assert "Threading" in extracted_content, "Should contain original content"
    
    # Step 3: Simulate storing in database (this is what FolderFile.content would store)
    # In real scenario, this is persisted
    stored_content = extracted_content
    
    # Step 4: Simulate retrieving from database (get_folder_files_content)
    # In a real test with DB, we'd query FolderFile records
    # For this test, we simulate by creating a formatted string like get_folder_files_content would
    simulated_db_retrieval = f"[{upload_file.filename}]\n{stored_content}"
    
    print(f"\nStep 2: Retrieved from database")
    print(f"  Retrieved content length: {len(simulated_db_retrieval)} chars")
    print(f"  Content preview: {simulated_db_retrieval[:150]}...")
    
    # Step 5: Use for Kojo chat - test RAG retrieval
    llm_svc = LLMService()
    
    # User asks a question about threading
    user_query = "Explain the difference between threads and processes"
    
    # This is what happens in map_reduce_long_answer
    context, meta = llm_svc._retrieve_relevant_context(
        simulated_db_retrieval,
        user_query,
        top_k=5
    )
    
    print(f"\nStep 3: RAG retrieval for Kojo chat")
    print(f"  User query: {user_query}")
    print(f"  RAG context length: {len(context)} chars")
    print(f"  Chunks selected: {meta.get('retrieval_selected_chunks', 0)} / {meta.get('retrieval_total_chunks', 0)}")
    print(f"  Context preview: {context[:200]}...")
    
    assert context, "RAG should retrieve some context"
    assert len(context) > 0, "Retrieved context should have content"
    assert meta.get('retrieval_selected_chunks', 0) > 0, "Should select at least one chunk"
    
    # Step 6: Test that extracted content is suitable for extraction/study
    # This is what happens in test generation
    study_content = await llm_svc._extract_study_content(extracted_content)
    
    print(f"\nStep 4: Study content extraction for test generation")
    print(f"  Title: {study_content.title}")
    print(f"  Terms found: {len(study_content.terms)}")
    print(f"  Concepts found: {len(study_content.concepts)}")
    
    # Extract terms/concepts should work
    assert len(study_content.terms) > 0 or len(study_content.concepts) > 0, \
        "Should extract terms or concepts from content"
    
    print("\n✓ Full pipeline test passed!")


@pytest.mark.asyncio
async def test_empty_folder_files_content():
    """Test what happens when folder has no files."""
    print("\n=== EMPTY FOLDER TEST ===\n")
    
    # Simulate empty folder_files_content (what get_folder_files_content returns)
    folder_files_content = ""
    
    llm_svc = LLMService()
    
    user_query = "What is threading?"
    context, meta = llm_svc._retrieve_relevant_context(
        folder_files_content,
        user_query,
        top_k=5
    )
    
    print(f"Empty folder files retrieval:")
    print(f"  Retrieved content: '{context}'")
    print(f"  Chunks: {meta.get('retrieval_selected_chunks', 0)}")
    
    # Should handle gracefully
    assert meta.get('retrieval_selected_chunks', 0) == 0, \
        "Should select 0 chunks for empty content"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
