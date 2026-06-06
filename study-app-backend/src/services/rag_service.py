from __future__ import annotations

import hashlib
import re
from collections import OrderedDict
from dataclasses import dataclass
from math import sqrt
from typing import Any, Optional

from src.config import settings
from src.utils.logger import get_logger

try:
    from langchain_core.documents import Document
except ImportError:  # pragma: no cover - exercised only without optional deps
    @dataclass
    class Document:  # type: ignore[no-redef]
        page_content: str
        metadata: dict[str, Any]

try:
    from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
except ImportError:  # pragma: no cover - exercised only without optional deps
    MarkdownHeaderTextSplitter = None  # type: ignore[assignment]
    RecursiveCharacterTextSplitter = None  # type: ignore[assignment]

try:
    from rank_bm25 import BM25Okapi
except ImportError:  # pragma: no cover - exercised only without optional deps
    BM25Okapi = None  # type: ignore[assignment]

try:
    from sentence_transformers import CrossEncoder, SentenceTransformer
except ImportError:  # pragma: no cover - exercised only without optional deps
    CrossEncoder = None  # type: ignore[assignment]
    SentenceTransformer = None  # type: ignore[assignment]

try:
    from flashrank import Ranker, RerankRequest
except ImportError:  # pragma: no cover - exercised only without optional deps
    Ranker = None  # type: ignore[assignment]
    RerankRequest = None  # type: ignore[assignment]

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams
except ImportError:  # pragma: no cover - exercised only without optional deps
    QdrantClient = None  # type: ignore[assignment]
    Distance = None  # type: ignore[assignment]
    FieldCondition = None  # type: ignore[assignment]
    Filter = None  # type: ignore[assignment]
    MatchValue = None  # type: ignore[assignment]
    PointStruct = None  # type: ignore[assignment]
    VectorParams = None  # type: ignore[assignment]


logger = get_logger(__name__)

_DEFAULT_TOP_K = 6
_STAGE_MULTIPLIER = 4
_CONTEXT_CHAR_LIMIT = 8_000
_CHUNK_SIZE = 1_200
_CHUNK_OVERLAP = 180
_CACHE_SIZE = 512
_FALLBACK_EMBEDDING_DIM = 384

_STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "was", "one", "our",
    "out", "has", "how", "its", "may", "new", "now", "old", "two", "way", "did", "each", "from",
    "have", "what", "this", "that", "with", "want", "help", "explain", "show", "tell", "give", "does",
    "work", "will", "would", "could", "should", "about", "into", "there", "their", "then", "than", "when",
    "where", "which", "while", "also", "more", "like", "just", "here", "even", "know", "come", "said",
    "make", "look", "use", "some", "very", "over", "such", "been", "they", "them", "these",
}


@dataclass(frozen=True)
class RagChunk:
    index: int
    source: str
    text: str
    tokens: tuple[str, ...]
    section: str = ""
    source_type: str = "uploaded_file"


class HybridRAGService:
    _context_cache: OrderedDict[str, tuple[str, dict[str, object]]] = OrderedDict()
    _embedding_model: Any = None
    _cross_encoder: Any = None
    _flashrank_ranker: Any = None
    _qdrant_client: Any = None

    def retrieve_context(
        self,
        notes: str,
        query: str,
        top_k: int = _DEFAULT_TOP_K,
        source_filter: Optional[list[str]] = None,
    ) -> tuple[str, dict[str, object]]:
        query = (query or "").strip()
        cache_key = hashlib.sha256(
            (
                f"{hashlib.sha256((notes or '').encode('utf-8', errors='ignore')).hexdigest()}"
                f"::{query.lower()}::{top_k}::{','.join(sorted(source_filter or []))}"
            ).encode("utf-8")
        ).hexdigest()
        cached = self._cache_get(cache_key)
        if cached is not None:
            context, meta = cached
            meta["retrieval_cache_hit"] = True
            return context, meta

        chunks = self.chunk_notes(notes)
        if source_filter:
            allowed = set(source_filter)
            chunks = [chunk for chunk in chunks if chunk.source in allowed]

        meta: dict[str, object] = {
            "retrieval_enabled": True,
            "retrieval_total_chunks": len(chunks),
            "retrieval_selected_chunks": 0,
            "retrieval_top_k": 0,
            "retrieval_hybrid": True,
            "retrieval_backend": "local",
            "retrieval_semantic_backend": "sentence-transformers" if self._embedding_available() else "fallback",
            "retrieval_vector_store": "qdrant" if self._qdrant_configured() else "local",
            "retrieval_reranker": self._reranker_name(),
            "retrieval_cache_hit": False,
            "retrieval_sources": [],
        }
        if not chunks:
            result = ((notes or "")[:_CONTEXT_CHAR_LIMIT], meta)
            self._cache_set(cache_key, result)
            return result

        candidates = self._qdrant_candidates(chunks, query, top_k * _STAGE_MULTIPLIER)
        if candidates:
            meta["retrieval_backend"] = "qdrant"
        else:
            candidates = self._local_hybrid_candidates(chunks, query, top_k * _STAGE_MULTIPLIER)

        selected = self._rerank(query, candidates, top_k)
        selected = self._ensure_source_diversity(selected, candidates)
        meta["retrieval_selected_chunks"] = len(selected)
        meta["retrieval_top_k"] = len(selected)
        meta["retrieval_sources"] = list(dict.fromkeys(chunk.source for chunk in selected))

        context = self.format_context(selected)
        if not context:
            context = (notes or "")[:_CONTEXT_CHAR_LIMIT]
        result = (context[:_CONTEXT_CHAR_LIMIT], meta)
        self._cache_set(cache_key, result)
        return result

    def chunk_notes(self, notes: str) -> list[RagChunk]:
        documents = self._documents_from_notes(notes)
        chunks: list[RagChunk] = []
        for document in documents:
            chunks.extend(self._split_document(document, start_index=len(chunks)))
        return chunks

    def format_context(self, chunks: list[RagChunk]) -> str:
        parts: list[str] = []
        for chunk in chunks:
            section = f" | Section: {chunk.section}" if chunk.section else ""
            parts.append(
                f"[Source: {chunk.source} | Type: {chunk.source_type}{section} | Chunk: {chunk.index + 1}]\n"
                f"{chunk.text.strip()}"
            )
        return "\n\n".join(part for part in parts if part.strip()).strip()

    def _documents_from_notes(self, notes: str) -> list[Document]:
        blocks = self.extract_document_blocks(notes)
        return [
            Document(
                page_content=body,
                metadata={"source": source, "source_type": self._source_type(source), "section": ""},
            )
            for source, body in blocks
            if body.strip()
        ]

    def extract_document_blocks(self, notes: str) -> list[tuple[str, str]]:
        lines = (notes or "").replace("\r\n", "\n").replace("\r", "\n").splitlines()
        docs: list[tuple[str, str]] = []
        current_source = "document"
        current_lines: list[str] = []

        def flush() -> None:
            nonlocal current_lines
            content = self._strip_yaml_frontmatter("\n".join(current_lines)).strip()
            if content:
                docs.append((current_source, content))
            current_lines = []

        for line in lines:
            stripped = line.strip()
            marker_doc = re.match(r"^---\s*Document\s+\d+\s*:\s*(.+?)\s*---\s*$", stripped, re.IGNORECASE)
            marker_file = re.match(r"^\[(.+?)\]\s*$", stripped)
            if marker_doc:
                flush()
                current_source = marker_doc.group(1).strip() or "document"
                continue
            if marker_file:
                flush()
                current_source = marker_file.group(1).strip() or "document"
                continue
            if re.fullmatch(r"-{3,}", stripped):
                continue
            current_lines.append(line)

        flush()
        if not docs and (notes or "").strip():
            docs.append(("document", notes.strip()))
        return docs

    def _split_document(self, document: Document, start_index: int) -> list[RagChunk]:
        docs = self._section_documents(document)
        splitter = self._text_splitter()
        chunks: list[RagChunk] = []
        for section_doc in docs:
            section_chunks = splitter.split_documents([section_doc]) if splitter is not None else [section_doc]
            for chunk_doc in section_chunks:
                text = self._clean_chunk_text(chunk_doc.page_content)
                if not text:
                    continue
                metadata = dict(document.metadata)
                metadata.update(getattr(chunk_doc, "metadata", {}) or {})
                section = self._section_label(metadata)
                source = str(metadata.get("source") or "document")
                chunks.append(
                    RagChunk(
                        index=start_index + len(chunks),
                        source=source,
                        source_type=str(metadata.get("source_type") or self._source_type(source)),
                        section=section,
                        text=text,
                        tokens=tuple(self._tokenize(text)),
                    )
                )
        return chunks

    def _section_documents(self, document: Document) -> list[Document]:
        text = document.page_content
        if MarkdownHeaderTextSplitter is None:
            return self._manual_section_documents(document)
        headers = [("#", "h1"), ("##", "h2"), ("###", "h3"), ("####", "h4")]
        try:
            split_docs = MarkdownHeaderTextSplitter(headers_to_split_on=headers, strip_headers=False).split_text(text)
        except Exception:
            split_docs = []
        if not split_docs:
            return self._manual_section_documents(document)
        result: list[Document] = []
        for split_doc in split_docs:
            metadata = dict(document.metadata)
            metadata.update(getattr(split_doc, "metadata", {}) or {})
            result.append(Document(page_content=split_doc.page_content, metadata=metadata))
        return result

    def _manual_section_documents(self, document: Document) -> list[Document]:
        lines = document.page_content.splitlines()
        sections: list[Document] = []
        current_heading = ""
        current_lines: list[str] = []

        def flush() -> None:
            nonlocal current_lines
            text = "\n".join(current_lines).strip()
            if text:
                metadata = dict(document.metadata)
                metadata["section"] = current_heading
                sections.append(Document(page_content=text, metadata=metadata))
            current_lines = []

        for line in lines:
            heading = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", line)
            if heading:
                flush()
                current_heading = heading.group(1).strip()
            current_lines.append(line)
        flush()
        return sections or [document]

    def _text_splitter(self) -> Any:
        if RecursiveCharacterTextSplitter is None:
            return None
        return RecursiveCharacterTextSplitter(
            chunk_size=_CHUNK_SIZE,
            chunk_overlap=_CHUNK_OVERLAP,
            separators=["\n\n", "\n#", "\n- ", "\n", ". ", " ", ""],
        )

    def _local_hybrid_candidates(self, chunks: list[RagChunk], query: str, limit: int) -> list[RagChunk]:
        query_tokens = [token for token in self._tokenize(query) if token not in _STOPWORDS]
        semantic_scores = self._semantic_scores(chunks, query)
        lexical_scores = self._bm25_scores(chunks, query_tokens)
        semantic_norm = self._normalize(semantic_scores)
        lexical_norm = self._normalize(lexical_scores)
        scored: list[tuple[float, RagChunk]] = []
        query_set = set(query_tokens)
        for idx, chunk in enumerate(chunks):
            source_tokens = set(self._tokenize(chunk.source))
            section_tokens = set(self._tokenize(chunk.section))
            overlap = len(query_set.intersection(set(chunk.tokens))) / max(1, len(query_set))
            metadata_bonus = 0.12 if query_set.intersection(source_tokens | section_tokens) else 0.0
            score = (0.62 * semantic_norm[idx]) + (0.38 * lexical_norm[idx]) + (0.08 * overlap) + metadata_bonus
            scored.append((score, chunk))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [chunk for _, chunk in scored[: max(1, min(limit, len(scored)))]]

    def _qdrant_candidates(self, chunks: list[RagChunk], query: str, limit: int) -> list[RagChunk]:
        client = self._get_qdrant_client()
        if client is None:
            return []
        vectors = self._embed_many([chunk.text for chunk in chunks])
        if not vectors:
            return []
        collection_name = getattr(settings, "qdrant_collection", "nosey_rag")
        try:
            existing = {item.name for item in client.get_collections().collections}
            if collection_name not in existing:
                client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(size=len(vectors[0]), distance=Distance.COSINE),
                )
            namespace = hashlib.sha256("||".join(f"{c.source}:{c.index}:{c.text[:120]}" for c in chunks).encode("utf-8")).hexdigest()
            points = [
                PointStruct(
                    id=int(hashlib.sha256(f"{namespace}:{chunk.index}".encode("utf-8")).hexdigest()[:15], 16),
                    vector=vector,
                    payload={
                        "namespace": namespace,
                        "chunk_index": chunk.index,
                        "source": chunk.source,
                        "source_type": chunk.source_type,
                        "section": chunk.section,
                        "text": chunk.text,
                    },
                )
                for chunk, vector in zip(chunks, vectors)
            ]
            client.upsert(collection_name=collection_name, points=points, wait=True)
            query_vector = self._embed_many([query])[0]
            qfilter = Filter(must=[FieldCondition(key="namespace", match=MatchValue(value=namespace))])
            results = client.search(collection_name=collection_name, query_vector=query_vector, limit=limit, query_filter=qfilter)
        except Exception as exc:
            logger.warning("Qdrant retrieval unavailable; falling back to local hybrid RAG: %s", exc)
            return []

        by_index = {chunk.index: chunk for chunk in chunks}
        ordered: list[RagChunk] = []
        for item in results:
            payload = getattr(item, "payload", {}) or {}
            index = payload.get("chunk_index")
            if isinstance(index, int) and index in by_index:
                ordered.append(by_index[index])
        return ordered

    def _ensure_source_diversity(self, selected: list[RagChunk], pool: list[RagChunk]) -> list[RagChunk]:
        """Append one representative chunk for each source not already in selected.

        Prevents a single high-scoring document from monopolizing all top-k slots when
        the user has multiple files uploaded.
        """
        if not pool:
            return selected
        covered = {chunk.source for chunk in selected}
        seen_extra: set[str] = set()
        extra: list[RagChunk] = []
        for chunk in pool:
            if chunk.source not in covered and chunk.source not in seen_extra:
                extra.append(chunk)
                seen_extra.add(chunk.source)
        return selected + extra

    def _rerank(self, query: str, candidates: list[RagChunk], top_k: int) -> list[RagChunk]:
        if not candidates:
            return []
        if Ranker is not None and RerankRequest is not None:
            try:
                ranker = self._get_flashrank_ranker()
                passages = [{"id": str(chunk.index), "text": chunk.text, "meta": {"chunk": chunk}} for chunk in candidates]
                results = ranker.rerank(RerankRequest(query=query, passages=passages))
                ranked: list[RagChunk] = []
                by_id = {str(chunk.index): chunk for chunk in candidates}
                for item in results[:top_k]:
                    chunk = by_id.get(str(item.get("id")))
                    if chunk is not None:
                        ranked.append(chunk)
                if ranked:
                    return ranked
            except Exception as exc:
                logger.warning("Flashrank reranker unavailable; trying cross-encoder fallback: %s", exc)

        if CrossEncoder is not None:
            try:
                model = self._get_cross_encoder()
                scores = model.predict([(query, chunk.text) for chunk in candidates])
                ranked_pairs = sorted(zip([float(score) for score in scores], candidates), key=lambda item: item[0], reverse=True)
                return [chunk for _, chunk in ranked_pairs[:top_k]]
            except Exception as exc:
                logger.warning("Cross-encoder reranker unavailable; using hybrid rank order: %s", exc)
        return candidates[:top_k]

    def _semantic_scores(self, chunks: list[RagChunk], query: str) -> list[float]:
        texts = [query] + [chunk.text for chunk in chunks]
        vectors = self._embed_many(texts)
        if not vectors:
            return [0.0 for _ in chunks]
        query_vector = vectors[0]
        return [self._cosine(query_vector, vector) for vector in vectors[1:]]

    def _embed_many(self, texts: list[str]) -> list[list[float]]:
        model = self._get_embedding_model()
        if model is not None:
            try:
                embeddings = model.encode(texts, normalize_embeddings=True)
                return [[float(value) for value in row] for row in embeddings]
            except Exception as exc:
                logger.warning("sentence-transformers embedding failed; using local fallback: %s", exc)
        return [self._fallback_embedding(text) for text in texts]

    def _bm25_scores(self, chunks: list[RagChunk], query_tokens: list[str]) -> list[float]:
        if not chunks or not query_tokens:
            return [0.0 for _ in chunks]
        corpus = [list(chunk.tokens) for chunk in chunks]
        if BM25Okapi is not None:
            return [float(score) for score in BM25Okapi(corpus).get_scores(query_tokens)]
        return [float(len(set(query_tokens).intersection(set(tokens)))) for tokens in corpus]

    def _get_embedding_model(self) -> Any:
        if SentenceTransformer is None:
            return None
        if self.__class__._embedding_model is None:
            model_name = getattr(settings, "rag_embedding_model", "all-MiniLM-L6-v2")
            self.__class__._embedding_model = SentenceTransformer(model_name)
        return self.__class__._embedding_model

    def _get_cross_encoder(self) -> Any:
        if CrossEncoder is None:
            return None
        if self.__class__._cross_encoder is None:
            model_name = getattr(settings, "rag_reranker_model", "cross-encoder/ms-marco-MiniLM-L-6-v2")
            self.__class__._cross_encoder = CrossEncoder(model_name)
        return self.__class__._cross_encoder

    def _get_flashrank_ranker(self) -> Any:
        if Ranker is None:
            return None
        if self.__class__._flashrank_ranker is None:
            self.__class__._flashrank_ranker = Ranker()
        return self.__class__._flashrank_ranker

    def _get_qdrant_client(self) -> Any:
        if not self._qdrant_configured() or QdrantClient is None:
            return None
        if self.__class__._qdrant_client is None:
            self.__class__._qdrant_client = QdrantClient(
                url=getattr(settings, "qdrant_url", None),
                api_key=getattr(settings, "qdrant_api_key", None),
            )
        return self.__class__._qdrant_client

    def _embedding_available(self) -> bool:
        return SentenceTransformer is not None

    def _qdrant_configured(self) -> bool:
        return bool(getattr(settings, "qdrant_url", None) and getattr(settings, "qdrant_api_key", None) and QdrantClient is not None)

    def _reranker_name(self) -> str:
        if Ranker is not None:
            return "flashrank"
        if CrossEncoder is not None:
            return "cross-encoder"
        return "hybrid-score"

    def _source_type(self, source: str) -> str:
        if source.lower().startswith("session upload:"):
            return "session_upload"
        if "." in source.rsplit("/", 1)[-1]:
            return "uploaded_file"
        return "notes"

    def _section_label(self, metadata: dict[str, Any]) -> str:
        values = [
            str(metadata.get(key, "")).strip()
            for key in ("section", "h1", "h2", "h3", "h4")
            if str(metadata.get(key, "")).strip()
        ]
        return " > ".join(dict.fromkeys(values))

    def _clean_chunk_text(self, text: str) -> str:
        text = re.sub(r"\r\n?", "\n", text or "")
        text = self._strip_yaml_frontmatter(text)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _strip_yaml_frontmatter(self, text: str) -> str:
        cleaned = re.sub(r"(?sm)\A\s*---\s*\n.*?\n---\s*\n?", "", text or "", count=1)
        return re.sub(
            r"(?im)\A\s*(?:title|author|date|tags|description|subject):[^\n]*(?:\n(?:title|author|date|tags|description|subject):[^\n]*)*\n?",
            "",
            cleaned,
            count=1,
        )

    def _tokenize(self, text: str) -> list[str]:
        return [token for token in re.findall(r"[A-Za-z0-9_]+|[+\-*/^=]", (text or "").lower()) if token.strip()]

    def _fallback_embedding(self, text: str) -> list[float]:
        vector = [0.0] * _FALLBACK_EMBEDDING_DIM
        for token in self._tokenize(text):
            digest = hashlib.blake2b(token.encode("utf-8", errors="ignore"), digest_size=8).digest()
            hashed = int.from_bytes(digest, "big", signed=False)
            vector[hashed % _FALLBACK_EMBEDDING_DIM] += 1.0 if ((hashed >> 1) & 1) == 0 else -1.0
        norm = sqrt(sum(value * value for value in vector))
        return [value / norm for value in vector] if norm > 0 else vector

    def _cosine(self, left: list[float], right: list[float]) -> float:
        return sum(a * b for a, b in zip(left, right))

    def _normalize(self, values: list[float]) -> list[float]:
        if not values:
            return []
        low = min(values)
        high = max(values)
        if high <= low:
            return [0.0 for _ in values]
        return [(value - low) / (high - low) for value in values]

    def _cache_get(self, key: str) -> Optional[tuple[str, dict[str, object]]]:
        value = self._context_cache.get(key)
        if value is None:
            return None
        self._context_cache.move_to_end(key)
        return value[0], dict(value[1])

    def _cache_set(self, key: str, value: tuple[str, dict[str, object]]) -> None:
        self._context_cache[key] = (value[0], dict(value[1]))
        self._context_cache.move_to_end(key)
        while len(self._context_cache) > _CACHE_SIZE:
            self._context_cache.popitem(last=False)
