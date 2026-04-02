import logging
from pathlib import Path
from time import perf_counter

from app.src.chunking import chunk_document
from app.src.embeddings.embedder import embed_text, embed_texts_batch
from app.src.generation.answerer import generate_answer
from app.src.ingestion.loader import collect_file_signatures, load_documents
from app.src.retrieval.bm25 import BM25Index
from app.src.retrieval.hybrid import reciprocal_rank_fusion
from app.src.retrieval.reranker import CrossEncoderReranker
from app.src.vector_store.store import QdrantVectorStore

logger = logging.getLogger(__name__)


def _document_source_file(document: object) -> str:
    metadata = getattr(document, "metadata", {}) or {}
    source = str(getattr(document, "source", ""))
    filename = str(metadata.get("filename", "") or "")
    return filename or Path(source).name


def _document_source_hash(document: object) -> str:
    metadata = getattr(document, "metadata", {}) or {}
    signature = str(metadata.get("file_signature", "") or "")
    if signature:
        return signature

    size_bytes = metadata.get("size_bytes")
    source = str(getattr(document, "source", ""))
    return f"fallback:{size_bytes}:{Path(source).name}"


def _collect_chunk_rows(
    documents: list[object],
    chunk_size: int,
    chunk_strategy: str,
    overlap: int,
) -> list[dict[str, object]]:
    logger.info(f"Collecting chunks with strategy={chunk_strategy}, chunk_size={chunk_size}, overlap={overlap}")
    start_chunk = perf_counter()

    indexed_rows: list[dict[str, object]] = []

    for document in documents:
        source_file = _document_source_file(document)
        source_hash = _document_source_hash(document)
        chunks = chunk_document(
            document=document,
            chunk_size=chunk_size,
            strategy=chunk_strategy,
            overlap=overlap,
        )
        logger.debug(f"Document {document.source}: {len(chunks)} chunks")
        for chunk_index, chunk_text in enumerate(chunks):
            if not chunk_text.strip():
                continue

            payload = {
                "id": f"{document.id}:{chunk_index}",
                "source": document.source,
                "source_file": source_file,
                "source_hash": source_hash,
                "chunk_index": chunk_index,
                "text": chunk_text,
                "metadata": document.metadata,
                "chunk_strategy": chunk_strategy,
            }
            indexed_rows.append(payload)

    elapsed_chunk = perf_counter() - start_chunk
    logger.info(f"Chunking complete: {len(indexed_rows)} chunks in {elapsed_chunk:.2f}s")
    return indexed_rows


def build_index(
    data_dir: Path,
    chunk_size: int = 500,
    collection_name: str = "documents",
    chunk_strategy: str = "fixed",
    overlap: int = 100,
    skip_unchanged: bool = True,
    prune_missing: bool = True,
) -> dict[str, object]:
    logger.info(f"Starting index build: collection={collection_name}")
    start_build = perf_counter()

    current_signatures = collect_file_signatures(data_dir)
    if not current_signatures:
        return {
            "status": "empty",
            "collection": collection_name,
            "indexed_chunks": 0,
            "message": "No chunkable documents found.",
        }

    store = QdrantVectorStore(collection_name=collection_name, vector_size=1)
    existing_payloads = store.all_payloads()

    existing_chunks_by_file: dict[str, set[str]] = {}
    existing_hashes_by_file: dict[str, set[str]] = {}
    for payload in existing_payloads:
        source_file = str(
            payload.get("source_file")
            or (payload.get("metadata") or {}).get("filename")
            or Path(str(payload.get("source", ""))).name
        )
        chunk_id = str(payload.get("id", "") or "")
        source_hash = str(payload.get("source_hash") or (payload.get("metadata") or {}).get("file_signature") or "")

        if source_file and chunk_id:
            existing_chunks_by_file.setdefault(source_file, set()).add(chunk_id)
        if source_file and source_hash:
            existing_hashes_by_file.setdefault(source_file, set()).add(source_hash)

    files_to_index: set[str] = set()
    active_files: set[str] = set(current_signatures.keys())
    skipped_documents = 0
    removed_chunks = 0

    for source_file, source_hash in current_signatures.items():
        is_unchanged = (
            skip_unchanged
            and source_file in existing_hashes_by_file
            and source_hash in existing_hashes_by_file[source_file]
        )
        if is_unchanged:
            skipped_documents += 1
            continue

        stale_ids = sorted(existing_chunks_by_file.get(source_file, set()))
        if stale_ids:
            removed_chunks += store.delete_ids(stale_ids)

        files_to_index.add(source_file)

    if prune_missing:
        missing_files = set(existing_chunks_by_file.keys()) - active_files
        for source_file in sorted(missing_files):
            stale_ids = sorted(existing_chunks_by_file.get(source_file, set()))
            if stale_ids:
                removed_chunks += store.delete_ids(stale_ids)

    documents_to_index = load_documents(data_dir, include_files=files_to_index)

    indexed_rows = _collect_chunk_rows(
        documents=documents_to_index,
        chunk_size=chunk_size,
        chunk_strategy=chunk_strategy,
        overlap=overlap,
    )

    if not indexed_rows and removed_chunks == 0:
        return {
            "status": "ok",
            "collection": collection_name,
            "indexed_chunks": 0,
            "source_count": len(active_files),
            "skipped_documents": skipped_documents,
            "removed_chunks": removed_chunks,
            "message": "All documents are already indexed. Nothing to update.",
        }

    if not indexed_rows and removed_chunks > 0:
        elapsed_total = perf_counter() - start_build
        return {
            "status": "ok",
            "collection": collection_name,
            "indexed_chunks": 0,
            "source_count": len(active_files),
            "skipped_documents": skipped_documents,
            "removed_chunks": removed_chunks,
            "chunk_size": chunk_size,
            "chunk_strategy": chunk_strategy,
            "overlap": overlap,
            "build_time_seconds": round(elapsed_total, 2),
            "message": "Removed stale indexed chunks. No new documents required indexing.",
        }

    # Batch embed all chunks at once (3-5x faster than sequential)
    logger.info(f"Embedding {len(indexed_rows)} chunks...")
    start_embed = perf_counter()
    chunk_texts = [str(row.get("text", "")) for row in indexed_rows]
    indexed_vectors = embed_texts_batch(chunk_texts)
    elapsed_embed = perf_counter() - start_embed
    logger.info(f"Embedding took {elapsed_embed:.2f}s ({len(indexed_rows) / elapsed_embed:.1f} chunks/sec)")
    
    index_payloads: list[dict[str, object]] = []
    for row, vector in zip(indexed_rows, indexed_vectors):
        if vector:
            index_payloads.append(row)

    if not indexed_vectors:
        return {
            "status": "empty",
            "collection": collection_name,
            "indexed_chunks": 0,
            "message": "No embeddings could be generated.",
        }

    vector_size = len(indexed_vectors[0])
    logger.debug(f"Vector size: {vector_size}")

    logger.info("Preparing vector store...")
    start_store = perf_counter()
    if store.count() == 0:
        store.recreate(vector_size=vector_size)
    elapsed_recreate = perf_counter() - start_store
    logger.info(f"Vector store ready in {elapsed_recreate:.2f}s")

    logger.info(f"Indexing {len(index_payloads)} vectors...")
    start_index = perf_counter()
    indexed_chunks = 0
    for idx, (payload, vector) in enumerate(zip(index_payloads, indexed_vectors), 1):
        chunk_id = str(payload["id"])
        try:
            store.add(
                item_id=chunk_id,
                vector=vector,
                payload=payload,
            )
            indexed_chunks += 1
        except Exception as e:
            logger.warning(f"Failed to index chunk {chunk_id}: {str(e)}")
            continue
        if idx % 100 == 0:
            logger.debug(f"Indexed {idx}/{len(index_payloads)} vectors")
    elapsed_index = perf_counter() - start_index
    logger.info(f"Indexing took {elapsed_index:.2f}s ({indexed_chunks / elapsed_index:.1f} vectors/sec)")

    source_count = len(active_files)
    
    elapsed_total = perf_counter() - start_build
    logger.info(f"Index build complete: {indexed_chunks} chunks, {source_count} sources in {elapsed_total:.2f}s total")

    return {
        "status": "ok",
        "collection": collection_name,
        "indexed_chunks": indexed_chunks,
        "source_count": source_count,
        "skipped_documents": skipped_documents,
        "removed_chunks": removed_chunks,
        "processed_documents": len(documents_to_index),
        "vector_size": vector_size,
        "chunk_size": chunk_size,
        "chunk_strategy": chunk_strategy,
        "overlap": overlap,
        "build_time_seconds": round(elapsed_total, 2),
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
    query_vector = embed_text(query)
    if not query_vector:
        return {
            "query": query,
            "indexed_chunks": 0,
            "source_count": 0,
            "answer": generate_answer(query=query, results=[]),
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
            "source_count": 0,
            "answer": generate_answer(query=query, results=[]),
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

    # Filter out low-confidence results (minimum 0.35 confidence threshold)
    MIN_CONFIDENCE_THRESHOLD = 0.35
    filtered_hits = [
        (hit, conf) for hit, conf in zip(reranked_hits, confidences)
        if conf >= MIN_CONFIDENCE_THRESHOLD
    ]
    
    # If we filtered too many, keep at least the top result
    if not filtered_hits and reranked_hits:
        filtered_hits = [(reranked_hits[0], confidences[0])]

    results: list[dict[str, object]] = []
    for idx, (hit, confidence) in enumerate(filtered_hits):
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
                "confidence": confidence,
                "citation": citation,
                "source": source,
                "chunk_index": chunk_index,
                "text": payload.get("text", ""),
                "metadata": payload.get("metadata", {}),
            }
        )

    source_count = len({str(item.get("source", "")) for item in indexed_rows if item.get("source")})

    return {
        "query": query,
        "indexed_chunks": len(indexed_rows),
        "source_count": source_count,
        "answer": generate_answer(query=query, results=results),
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
    probe_store = QdrantVectorStore(collection_name="documents", vector_size=max(1, len(embed_text(query) or [0.0])))
    if probe_store.count() == 0:
        build_index(data_dir=data_dir, chunk_size=chunk_size, collection_name="documents")
    return query_index(query=query, k=k, collection_name="documents")
