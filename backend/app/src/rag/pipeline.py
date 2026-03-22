from app.src.chunking import fixed_size_chunk
from app.src.embeddings.embedder import fake_embed
from app.src.ingestion.loader import load_documents
from app.src.retrieval.bm25 import BM25Index
from app.src.retrieval.hybrid import reciprocal_rank_fusion
from app.src.retrieval.reranker import CrossEncoderReranker
from app.src.vector_store.store import QdrantVectorStore
from pathlib import Path


def run_pipeline(query: str, data_dir: Path, k: int = 3, chunk_size: int = 500) -> dict[str, object]:
    documents = load_documents(data_dir)

    # Initialize Qdrant store (connects to localhost:6333 by default)
    store = QdrantVectorStore(collection_name="documents")

    # Clear previous data for clean indexing each run
    store.clear()

    indexed_chunks = 0
    indexed_rows: list[dict[str, object]] = []

    # Index all documents: load → chunk → embed → store in Qdrant
    for document in documents:
        chunks = fixed_size_chunk(document, chunk_size=chunk_size)
        for chunk_index, chunk_text in enumerate(chunks):
            if not chunk_text.strip():
                continue

            chunk_id = f"{document.id}:{chunk_index}"
            vector = fake_embed(chunk_text)
            payload = {
                "id": chunk_id,
                "source": document.source,
                "chunk_index": chunk_index,
                "text": chunk_text,
                "metadata": document.metadata,
            }
            store.add(
                item_id=chunk_id,
                vector=vector,
                payload=payload,
            )
            indexed_rows.append(payload)
            indexed_chunks += 1

    if indexed_chunks == 0:
        return {
            "query": query,
            "document_count": len(documents),
            "indexed_chunks": 0,
            "results": [],
        }

    # Stage 1A: dense retrieval from Qdrant.
    query_vector = fake_embed(query)
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

    # Stage 1B: lexical BM25 retrieval.
    bm25_index = BM25Index()
    bm25_index.build(indexed_rows)
    bm25_hits = bm25_index.search(query=query, k=max(10, k * 4))

    # Stage 1C: hybrid fusion (RRF).
    fused_hits = reciprocal_rank_fusion(
        vector_hits=vector_hits,
        bm25_hits=bm25_hits,
        top_n=max(10, k * 3),
    )

    # Stage 2: rerank fused candidates.
    reranker = CrossEncoderReranker()
    reranked_hits = reranker.rerank(query=query, candidates=fused_hits, top_n=max(1, k))

    results: list[dict[str, object]] = []
    for hit in reranked_hits:
        payload = dict(hit.get("payload", {}))
        results.append(
            {
                "id": str(hit.get("id")),
                "score": round(float(hit.get("rerank_score", 0.0)), 6),
                "vector_score": round(float(hit.get("vector_score", 0.0)), 6),
                "bm25_score": round(float(hit.get("bm25_score", 0.0)), 6),
                "hybrid_score": round(float(hit.get("hybrid_score", 0.0)), 6),
                "source": payload.get("source", ""),
                "chunk_index": payload.get("chunk_index", -1),
                "text": payload.get("text", ""),
                "metadata": payload.get("metadata", {}),
            }
        )

    return {
        "query": query,
        "document_count": len(documents),
        "indexed_chunks": indexed_chunks,
        "retrieval": {
            "vector_candidates": len(vector_hits),
            "bm25_candidates": len(bm25_hits),
            "fused_candidates": len(fused_hits),
            "final_k": max(1, k),
        },
        "results": results,
    }
