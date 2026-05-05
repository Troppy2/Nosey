"""
Test to identify why Kojo sees "Relevant Sections" but they're empty.
"""
import pytest
from src.services.llm_service import LLMService


@pytest.mark.asyncio
async def test_metadata_only_file():
    """Test what happens when a file contains only metadata (title, tags, date)."""
    print("\n=== METADATA-ONLY FILE TEST ===\n")
    
    # Simulate a file that was stripped of content, leaving only metadata
    metadata_content = """---
title: CSCI_1082_Threads_and_Multiprocessing_Study_Guide
tags: threading,processes,concurrency
date: 2025-05-05
---

"""
    
    llm_svc = LLMService()
    
    # Try to extract study content
    study = await llm_svc._extract_study_content(metadata_content)
    
    print(f"Study extraction from metadata-only file:")
    print(f"  Title: {study.title}")
    print(f"  Terms: {len(study.terms)}")
    print(f"  Concepts: {len(study.concepts)}")
    
    # Try to retrieve for query
    user_query = "What is threading?"
    context, meta = llm_svc._retrieve_relevant_context(metadata_content, user_query, top_k=5)
    
    print(f"\nRetrieval from metadata-only file:")
    print(f"  Context length: {len(context)} chars")
    print(f"  Chunks selected: {meta.get('retrieval_selected_chunks', 0)}")
    print(f"  Context: {context[:200]}")
    
    if not context or len(context.strip()) < 50:
        print("\n⚠️  ISSUE FOUND: File with only metadata returns minimal/empty context!")


@pytest.mark.asyncio
async def test_file_extraction_stripping_content():
    """Test what the file extraction process returns."""
    print("\n=== FILE EXTRACTION OUTPUT TEST ===\n")
    
    from unittest.mock import AsyncMock, MagicMock
    from src.services.file_service import FileService
    
    # Create a markdown file with content
    md_content = b"""---
title: Study Guide
date: 2025-05-05
tags: test
---

# Threading

Threads are lightweight processes. They share memory.

## Synchronization

Use locks to protect shared resources.

### Lock Types
- Mutex: Binary lock
- Semaphore: Counting mechanism
"""
    
    mock_file = MagicMock()
    mock_file.filename = "Study.md"
    mock_file.read = AsyncMock(return_value=md_content)
    
    file_svc = FileService()
    extracted, file_type = await file_svc.extract_from_file(mock_file)
    
    print(f"File extraction result:")
    print(f"  File type: {file_type}")
    print(f"  Extracted length: {len(extracted)} chars")
    print(f"  Extracted content:\n{extracted}\n")
    
    if not extracted or len(extracted.strip()) < 50:
        print("⚠️  ISSUE FOUND: File extraction is returning minimal/empty content!")
    
    # Now check if this can be retrieved
    llm_svc = LLMService()
    context, meta = llm_svc._retrieve_relevant_context(extracted, "What is threading?", top_k=5)
    
    print(f"\nRetrieval from extracted content:")
    print(f"  Context length: {len(context)} chars")
    print(f"  Chunks: {meta.get('retrieval_selected_chunks', 0)} / {meta.get('retrieval_total_chunks', 0)}")


@pytest.mark.asyncio
async def test_map_reduce_with_minimal_content():
    """Simulate map_reduce with a file that has minimal retrievable content."""
    print("\n=== MAP-REDUCE WITH MINIMAL CONTENT TEST ===\n")
    
    llm_svc = LLMService()
    
    # Simulate minimal content from a file
    minimal_content = """[Study.md]
Title: Threading Study Guide
Date: 2025-05-05
Tags: concurrency

"""
    
    # Extract documents like map_reduce does
    documents = llm_svc._extract_document_blocks(llm_svc._strip_metadata(minimal_content))
    
    print(f"Documents extracted for map_reduce:")
    print(f"  Count: {len(documents)}")
    for source, content in documents:
        print(f"  Source: {source}")
        print(f"  Content length: {len(content)} chars")
        print(f"  Content preview: {content[:100]}")
        
        # Try retrieving from this document
        user_query = "What is threading?"
        retrieved, meta = llm_svc._retrieve_relevant_context(
            content, user_query, top_k=max(2, 5 // 2)
        )
        print(f"  Retrieved length: {len(retrieved)} chars")
        print(f"  Chunks selected: {meta.get('retrieval_selected_chunks', 0)}")
    
    if len(documents) == 0:
        print("\n⚠️  ISSUE FOUND: No documents extracted from content!")
    
    for source, doc_text in documents:
        if len(doc_text.strip()) < 50:
            print(f"\n⚠️  ISSUE FOUND: Document '{source}' has very minimal content!")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
