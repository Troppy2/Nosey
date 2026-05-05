"""
Diagnostic tests for RAG pipeline to identify where notes/content is being lost.
"""
import pytest
from src.services.llm_service import LLMService
from src.services.file_service import FileService
from unittest.mock import MagicMock, AsyncMock, patch
from io import BytesIO


class TestRAGDiagnostics:
    """Test the RAG pipeline step-by-step to identify content loss."""

    def test_retrieval_with_sample_notes(self):
        """Test if retrieval pipeline works with real markdown content."""
        llm_svc = LLMService()
        
        # Sample markdown study notes with clear content
        sample_notes = """
# Threading and Multiprocessing Study Guide

## Key Terms

### Thread
A lightweight process that shares memory with other threads. Threads can run concurrently and communicate via shared variables.

### Process
An independent program instance with its own memory space. Processes are heavier than threads but more isolated.

### GIL (Global Interpreter Lock)
In Python, the GIL prevents multiple threads from executing bytecode simultaneously. Only one thread can execute Python bytecode at a time.

### Lock
A synchronization primitive that allows only one thread to access a resource at a time.

### Semaphore
A counter-based synchronization primitive. Allows multiple threads (up to the counter value) to access a resource.

## Key Concepts

- Threads are created using the threading module in Python.
- Multiple threads can run concurrently on multi-core processors.
- The GIL limits true parallelism in Python threading; use multiprocessing for CPU-bound tasks.
- Process communication is slower than thread communication because of memory isolation.
- Deadlock can occur when two threads wait for each other's resources.
- Context switching has overhead; too many threads can reduce performance.
"""
        
        # Test retrieval with a sample query
        retrieval_query = "What is threading and how does it differ from processes?"
        
        context, meta = llm_svc._retrieve_relevant_context(sample_notes, retrieval_query, top_k=5)
        
        print("\n=== RETRIEVAL DIAGNOSTICS ===")
        print(f"Query: {retrieval_query}")
        print(f"Metadata: {meta}")
        print(f"Context length: {len(context)} chars")
        print(f"Selected chunks: {meta.get('retrieval_selected_chunks', 0)}")
        print(f"Total chunks: {meta.get('retrieval_total_chunks', 0)}")
        print(f"\nRetrieved context (first 500 chars):\n{context[:500]}")
        
        # Assertions to verify retrieval is working
        assert context, "Retrieved context should not be empty"
        assert len(context) > 0, "Context should have substantial length"
        assert meta.get("retrieval_selected_chunks", 0) > 0, "Should have selected at least one chunk"
        
    def test_chunking_pipeline(self):
        """Test if notes are being chunked correctly."""
        llm_svc = LLMService()
        
        sample_notes = """
# Test Document

## Section 1
This is section one with some content about topic A. It has multiple sentences to test chunking.
The chunking algorithm should split this into overlapping chunks.

## Section 2
This is section two with content about topic B. This section is separate from section one.
It tests whether the chunking preserves section boundaries or just splits by word count.

## Section 3
Final section with content about topic C. This tests the continuation of the chunking process.
"""
        
        chunks = llm_svc._chunk_notes_for_retrieval(sample_notes)
        
        print("\n=== CHUNKING DIAGNOSTICS ===")
        print(f"Total chunks created: {len(chunks)}")
        for i, chunk in enumerate(chunks):
            print(f"\nChunk {i}:")
            print(f"  Source: {chunk.source}")
            print(f"  Index: {chunk.index}")
            print(f"  Text length: {len(chunk.text)} chars")
            print(f"  Tokens: {len(chunk.tokens)}")
            print(f"  Text preview: {chunk.text[:100]}...")
        
        assert len(chunks) > 0, "Should create chunks from notes"
        assert all(chunk.text for chunk in chunks), "All chunks should have non-empty text"
        
    def test_compression_does_not_strip_content(self):
        """Test that compression doesn't remove all content."""
        llm_svc = LLMService()
        
        # Create sample chunks with content
        sample_text = (
            "Threading is a fundamental concept in concurrent programming. "
            "A thread is a lightweight process that shares memory with other threads. "
            "Multiple threads can run concurrently and communicate via shared variables. "
            "In Python, threads are created using the threading module. "
            "The Global Interpreter Lock (GIL) prevents multiple threads from executing bytecode simultaneously."
        )
        
        query_variants = ["threading", "concurrent", "threads"]
        
        compressed = llm_svc._compress_chunk_for_query(sample_text, query_variants)
        
        print("\n=== COMPRESSION DIAGNOSTICS ===")
        print(f"Original length: {len(sample_text)} chars")
        print(f"Compressed length: {len(compressed)} chars")
        print(f"Original: {sample_text}")
        print(f"Compressed: {compressed}")
        
        assert compressed, "Compression should not produce empty string"
        assert len(compressed) > 0, "Compressed content should have non-zero length"
        
    def test_retrieval_with_empty_notes(self):
        """Test retrieval with empty/whitespace-only notes."""
        llm_svc = LLMService()
        
        empty_notes = "   \n\n  "
        retrieval_query = "What is threading?"
        
        context, meta = llm_svc._retrieve_relevant_context(empty_notes, retrieval_query)
        
        print("\n=== EMPTY NOTES DIAGNOSTICS ===")
        print(f"Context returned: '{context}'")
        print(f"Metadata: {meta}")
        
        # Should handle gracefully by returning empty with proper metadata
        assert meta.get("retrieval_selected_chunks", 0) == 0, "Should select 0 chunks for empty notes"


class TestFileExtractionDiagnostics:
    """Test file extraction and storage."""

    @pytest.mark.asyncio
    async def test_markdown_extraction_preserves_content(self):
        """Test if markdown extraction preserves text content."""
        file_svc = FileService()
        
        # Create a mock file
        md_content = b"""# Study Guide

## Introduction
This is an important introduction to the topic.

## Main Content
Threading allows concurrent execution of code.
Threads share memory space and communicate via shared variables.

## Definitions
- **Thread**: A lightweight process sharing memory
- **Process**: Independent program instance
- **GIL**: Global Interpreter Lock in Python
"""
        
        mock_file = MagicMock()
        mock_file.filename = "study.md"
        mock_file.read = AsyncMock(return_value=md_content)
        
        # Extract the file
        extracted_text, file_type = await file_svc.extract_from_file(mock_file)
        
        print("\n=== FILE EXTRACTION DIAGNOSTICS ===")
        print(f"File type: {file_type}")
        print(f"Extracted text length: {len(extracted_text)} chars")
        print(f"First 300 chars:\n{extracted_text[:300]}")
        
        assert extracted_text, "Extracted text should not be empty"
        assert len(extracted_text) > 0, "Extracted text should have content"
        assert "Study Guide" in extracted_text or "threading" in extracted_text.lower(), "Should contain original content"


class TestKojoChatRetrieval:
    """Test if Kojo chat can retrieve and access folder file content."""

    def test_map_reduce_context_building(self):
        """Test if map-reduce builds context correctly for Kojo chat."""
        llm_svc = LLMService()
        
        # Simulate folder file content (what would come from database)
        folder_content = """
[Threads_and_Processes.md]
# Threading vs Multiprocessing

## Threads
- Lightweight
- Shared memory
- Fast communication

## Processes  
- Independent memory
- Heavier
- Slower communication
- True parallelism possible

---

[GIL_Explained.md]
# Python's Global Interpreter Lock

The GIL is a mutex that protects access to Python objects.
Only one thread can execute Python bytecode at a time.
This limits threading effectiveness for CPU-bound tasks.
"""
        
        user_query = "What is the difference between threads and processes?"
        
        # Simulate what happens in map_reduce_long_answer
        retrieval_query = f"Relevant context for: {user_query}"
        context, meta = llm_svc._retrieve_relevant_context(folder_content, retrieval_query, top_k=5)
        
        print("\n=== KOJO CHAT RETRIEVAL DIAGNOSTICS ===")
        print(f"User query: {user_query}")
        print(f"Retrieval context length: {len(context)} chars")
        print(f"Metadata: {meta}")
        print(f"\nRetrieved context (first 400 chars):\n{context[:400]}")
        
        assert context, "Should retrieve context for Kojo chat"
        assert len(context) > 0, "Retrieved context should have content"


# Run diagnostics
if __name__ == "__main__":
    import asyncio
    
    print("Starting RAG Pipeline Diagnostics...\n")
    
    # Run sync tests
    diag = TestRAGDiagnostics()
    diag.test_retrieval_with_sample_notes()
    diag.test_chunking_pipeline()
    diag.test_compression_does_not_strip_content()
    diag.test_retrieval_with_empty_notes()
    
    # Run chat retrieval test
    chat_diag = TestKojoChatRetrieval()
    chat_diag.test_map_reduce_context_building()
    
    print("\n✓ Diagnostics completed. Check output for potential issues.")
