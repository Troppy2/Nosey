"""
Final diagnostic: Test actual markdown extraction and RAG retrieval 
with content similar to what users would upload.
"""
import pytest
from src.services.llm_service import LLMService
from src.services.file_service import FileService
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio  
async def test_realistic_markdown_upload_and_retrieval():
    """
    Simulate a real user uploading a study guide markdown file and then
    asking Kojo a question about it.
    """
    print("\n=== REALISTIC MARKDOWN UPLOAD SIMULATION ===\n")
    
    # Realistic markdown study guide content
    # This simulates what a user might upload
    study_guide = b"""# CSCI 1082 - Threads and Multiprocessing Study Guide

## Introduction
This course covers concurrent programming using threads and processes in Python.

## Chapter 1: Fundamentals

### What is Threading?
Threading allows a program to run multiple code sequences concurrently within the same process.
Each thread shares the same memory space but can execute independently.

### What is Multiprocessing?
Multiprocessing uses separate processes instead of threads.
Each process has its own memory space, making them more isolated but heavier.

### Key Differences

| Aspect | Threads | Processes |
|--------|---------|-----------|
| Memory | Shared | Separate |
| Speed | Fast | Slow |
| Isolation | Low | High |
| Communication | Easy | Hard |

## Chapter 2: Python Threading

### Creating Threads
```python
import threading

def worker():
    print("Thread working")

t = threading.Thread(target=worker)
t.start()
```

### Thread Safety
When multiple threads access shared data, we need synchronization:
- **Lock**: Mutex lock for exclusive access
- **Semaphore**: Counter-based synchronization
- **Event**: Thread communication

### The GIL Problem
Python's Global Interpreter Lock (GIL) prevents true parallelism.
Only one thread can execute Python bytecode at a time.
This limits threading for CPU-bound tasks.

## Chapter 3: Python Multiprocessing

### Creating Processes
```python
from multiprocessing import Process

def worker():
    print("Process working")

p = Process(target=worker)
p.start()
```

### Process Communication
Processes communicate through:
- **Queues**: Thread-safe FIFO queues
- **Pipes**: Bidirectional communication
- **Shared Memory**: Via multiprocessing.Value and Array

## Chapter 4: Practical Considerations

### When to Use Threads
- I/O-bound tasks (network, files, databases)
- GUI applications (keep UI responsive)
- Tasks that need to share memory efficiently

### When to Use Processes
- CPU-bound tasks (calculations, data processing)
- Tasks that need true parallelism
- Long-running tasks that should be isolated

### Performance Tips
1. Minimize lock contention
2. Use thread pools for many small tasks
3. Prefer asyncio for I/O-bound work
4. Profile before optimizing

## Key Concepts to Remember
- Threads share memory; processes don't
- The GIL limits Python thread parallelism
- Synchronization primitives prevent race conditions
- Process creation has more overhead than threads
- Use the right tool for the right job

## Practice Questions (Solutions in Appendix)
1. Explain why the GIL exists in Python
2. When would you choose processes over threads?
3. What is a race condition and how do you prevent it?
4. Describe the purpose of locks and semaphores
5. Compare the performance of threads vs processes
"""
    
    # Step 1: Extract the file (simulating upload)
    file_svc = FileService()
    mock_file = MagicMock()
    mock_file.filename = "CSCI_1082_Threads_and_Multiprocessing_Study_Guide.md"
    mock_file.read = AsyncMock(return_value=study_guide)
    
    extracted_content, file_type = await file_svc.extract_from_file(mock_file)
    
    print(f"Step 1: File Extraction")
    print(f"  Filename: {mock_file.filename}")
    print(f"  Extracted length: {len(extracted_content)} chars")
    print(f"  Preview (first 200 chars):")
    print(f"  {extracted_content[:200]}")
    
    assert len(extracted_content) > 100, f"Extraction should produce substantial content, got {len(extracted_content)}"
    
    # Step 2: Simulate storage in database and retrieval (folder files formatting)
    # This is what get_folder_files_content would produce
    db_retrieval = f"[{mock_file.filename}]\n{extracted_content}"
    
    print(f"\nStep 2: Database Storage & Retrieval")
    print(f"  Formatted content length: {len(db_retrieval)} chars")
    
    # Step 3: Simulate Kojo chat - map_reduce flow
    llm_svc = LLMService()
    
    # Strip metadata like map_reduce does
    stripped = llm_svc._strip_metadata(db_retrieval)
    
    print(f"\nStep 3: Metadata Stripping (map_reduce preprocessing)")
    print(f"  After stripping: {len(stripped)} chars")
    print(f"  Preview: {stripped[:200]}")
    
    # Extract documents like map_reduce does
    documents = llm_svc._extract_document_blocks(stripped)
    
    print(f"\nStep 4: Document Extraction")
    print(f"  Documents found: {len(documents)}")
    for source, doc_content in documents:
        print(f"  - Source: {source}")
        print(f"    Content length: {len(doc_content)} chars")
    
    # Step 5: Simulate user asking a question and map_reduce retrieving context
    user_query = "Explain the difference between threading and multiprocessing"
    
    print(f"\nStep 5: RAG Retrieval for Query")
    print(f"  User query: {user_query}")
    
    for source, doc_text in documents[:1]:  # Test first document
        if len(doc_text.strip()) < 100:
            print(f"⚠️  WARNING: Document '{source}' is too short ({len(doc_text)} chars)")
            continue
            
        retrieved, meta = llm_svc._retrieve_relevant_context(
            doc_text, 
            user_query,
            top_k=max(2, 5 // 2)
        )
        
        print(f"  Retrieval result:")
        print(f"    Context length: {len(retrieved)} chars")
        print(f"    Chunks selected: {meta.get('retrieval_selected_chunks', 0)}")
        print(f"    Retrieved preview (first 250 chars):")
        print(f"    {retrieved[:250]}")
        
        if len(retrieved) < 100:
            print(f"\n⚠️  ISSUE FOUND: Retrieved context is too short!")
            print(f"   This is what Kojo would see as 'Relevant Sections'")
            print(f"   User would perceive this as empty content!")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
