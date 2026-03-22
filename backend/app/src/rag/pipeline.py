from pathlib import Path

from app.src.chunking import chunk_document
from app.src.embeddings.embedder import fake_embed
from app.src.ingestion.loader import load_documents
from app.src.retrieval.bm25 import BM25Index
from app.src.retrieval.hybrid import reciprocal_rank_fusion
from app.src.retrieval.reranker import CrossEncoderReranker
from app.src.vector_store.store import QdrantVectorStore


def _collect_chunk_rows(data_dir: Path, chunk_size: int, chunk_strategy: str, overlap: int) -> list[dict[str, object]]:
    documents = load_documents(data_dir)
    indexed_rows: list[dict[str, object]] = []

    for document in documents:
        chunks = chunk_document(
            document=document,
            chunk_size=chunk_size,
            strategy=chunk_strategy,
            overlap=overlap,
        )
        for chunk_index, chunk_text in enumerate(chunks):
            if not chunk_text.strip():
                continue

            payload = {
                "id": f"{document.id}:{chunk_index}",
                "source": document.source,
                "chunk_index": chunk_index,
                "text": chunk_text,
                "metadata": document.metadata,
                "chunk_strategy": chunk_strategy,
            }
            indexed_rows.append(payload)

    return indexed_rows


def build_index(
    data_dir: Path,
    chunk_size: int = 500,
    collection_name: str = "documents",
    chunk_strategy: str = "fixed",
    overlap: int = 100,
) -> dict[str, object]:
    indexed_rows = _collect_chunk_rows(
        data_dir=data_dir,
        chunk_size=chunk_size,
        chunk_strategy=chunk_strategy,
        overlap=overlap,
    )

    if not indexed_rows:
        return {
            "status": "empty",
            "collection": collection_name,
            "indexed_chunks": 0,
            "message": "No chunkable documents found.",
        }

    indexed_vectors: list[list[float]] = []
    index_payloads: list[dict[str, object]] = []
    for row in indexed_rows:
        vector = fake_embed(str(row.get("text", "")))
        if vector:
            indexed_vectors.append(vector)
            index_payloads.append(row)

    if not indexed_vectors:
        return {
            "status": "empty",
            "collection": collection_name,
            "indexed_chunks": 0,
            "message": "No embeddings could be generated.",
        }

    vector_size = len(indexed_vectors[0])

    store = QdrantVectorStore(collection_name=collection_name, vector_size=vector_size)
    store.recreate(vector_size=vector_size)

    indexed_chunks = 0
    for payload, vector in zip(index_payloads, indexed_vectors):
        chunk_id = str(payload["id"])
        try:
            store.add(
                item_id=chunk_id,
                vector=vector,
                payload=payload,
            )
            indexed_chunks += 1
        except Exception:
            continue

    source_count = len({str(item.get("source", "")) for item in index_payloads})

    return {
        "status": "ok",
        "collection": collection_name,
        "indexed_chunks": indexed_chunks,
        "source_count": source_count,
        "vector_size": vector_size,
        "chunk_size": chunk_size,
        "chunk_strategy": chunk_strategy,
        "overlap": overlap,
    }


def _normalize_confidence(scores: list[float]) -> list[float]:
    if not scores:
        return []
    low = min(scores)
    high = max(scores)
    span = high - low
    if span <= 0:
        return [0.5 for _ in scores]
    return [round((s - low) / span, 6) for s in scores]


def query_index(query: str, k: int = 3, collection_name: str = "documents") -> dict[str, object]:
    query_vector = fake_embed(query)
    if not query_vector:
        return {
            "query": query,
            "indexed_chunks": 0,
            "results": [],
            "retrieval": {
                "vector_candidates": 0,
                "bm25_candidates": 0,
                "fused_candidates": 0,
                "final_k": max(1, k),
            },
        }

    store = QdrantVectorStore(collection_name=collection_name, vector_size=len(query_vector))
    indexed_rows = store.all_payloads()

    if not indexed_rows:
        return {
            "query": query,
            "indexed_chunks": 0,
            "results": [],
            "retrieval": {
                "vector_candidates": 0,
                "bm25_candidates": 0,
                "fused_candidates": 0,
                "final_k": max(1, k),
            },
        }

    vector_hits_raw = store.search(query_vector=query_vector, k=max(10, k * 4))
    vector_hits: list[dict[str, object]] = []
    for hit in vector_hits_raw:
        payload = dict(hit.get("payload", {}))
        vector_hits.append(
            {
                "id": str(payload.get("id", hit.get("id"))),
                "score": float(hit.get("score", 0.0)),
                "payload": payload,
            }
        )

    bm25_index = BM25Index()
    bm25_index.build(indexed_rows)
    bm25_hits = bm25_index.search(query=query, k=max(10, k * 4))

    fused_hits = reciprocal_rank_fusion(
        vector_hits=vector_hits,
        bm25_hits=bm25_hits,
        top_n=max(10, k * 3),
    )

    reranker = CrossEncoderReranker()
    reranked_hits = reranker.rerank(query=query, candidates=fused_hits, top_n=max(1, k))

    rerank_scores = [float(hit.get("rerank_score", 0.0)) for hit in reranked_hits]
    confidences = _normalize_confidence(rerank_scores)

    results: list[dict[str, object]] = []
    for idx, hit in enumerate(reranked_hits):
        payload = dict(hit.get("payload", {}))
        source = str(payload.get("source", ""))
        chunk_index = int(payload.get("chunk_index", -1))
        citation = f"{source}#chunk-{chunk_index}" if source else f"chunk-{chunk_index}"
        results.append(
            {
                "id": str(hit.get("id")),
                "score": round(float(hit.get("rerank_score", 0.0)), 6),
                "vector_score": round(float(hit.get("vector_score", 0.0)), 6),
                "bm25_score": round(float(hit.get("bm25_score", 0.0)), 6),
                "hybrid_score": round(float(hit.get("hybrid_score", 0.0)), 6),
                "confidence": confidences[idx] if idx < len(confidences) else 0.0,
                "citation": citation,
                "source": source,
                "chunk_index": chunk_index,
                "text": payload.get("text", ""),
                "metadata": payload.get("metadata", {}),
            }
        )

    return {
        "query": query,
        "indexed_chunks": len(indexed_rows),
        "retrieval": {
            "vector_candidates": len(vector_hits),
            "bm25_candidates": len(bm25_hits),
            "fused_candidates": len(fused_hits),
            "final_k": max(1, k),
        },
        "results": results,
    }


def run_pipeline(query: str, data_dir: Path, k: int = 3, chunk_size: int = 500) -> dict[str, object]:
    # Backwards-compatible helper: if index is empty, build once then query.
    probe_store = QdrantVectorStore(collection_name="documents", vector_size=max(1, len(fake_embed(query) or [0.0])))
    if probe_store.count() == 0:
        build_index(data_dir=data_dir, chunk_size=chunk_size, collection_name="documents")
    return query_index(query=query, k=k, collection_name="documents")
