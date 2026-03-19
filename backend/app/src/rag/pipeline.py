from app.src.chunking import fixed_size_chunk
from app.src.embeddings.embedder import fake_embed
from app.src.ingestion.loader import load_documents
from app.src.vector_store.store import QdrantVectorStore
from pathlib import Path


def run_pipeline(query: str, data_dir: Path, k: int = 3, chunk_size: int = 500) -> dict[str, object]:
    documents = load_documents(data_dir)
    
    # Initialize Qdrant store (connects to localhost:6333 by default)
    store = QdrantVectorStore(collection_name="documents")
    
    # Clear previous data for clean indexing each run
    store.clear()

    indexed_chunks = 0

    # Index all documents: load → chunk → embed → store in Qdrant
    for document in documents:
        chunks = fixed_size_chunk(document, chunk_size=chunk_size)
        for chunk_index, chunk_text in enumerate(chunks):
            if not chunk_text.strip():
                continue

            chunk_id = f"{document.id}:{chunk_index}"
            vector = fake_embed(chunk_text)
            store.add(
                item_id=chunk_id,
                vector=vector,
                payload={
                    "source": document.source,
                    "chunk_index": chunk_index,
                    "text": chunk_text,
                    "metadata": document.metadata,
                },
            )
            indexed_chunks += 1

    if indexed_chunks == 0:
        return {
            "query": query,
            "document_count": len(documents),
            "indexed_chunks": 0,
            "results": [],
        }

    # Query: embed the query and search Qdrant for top-k results
    query_vector = fake_embed(query)
    hits = store.search(query_vector=query_vector, k=max(1, k))

    results: list[dict[str, object]] = []
    for hit in hits:
        payload = hit["payload"]
        results.append(
            {
                "id": str(hit["id"]),
                "score": round(hit["score"], 6),
                "source": payload["source"],
                "chunk_index": payload["chunk_index"],
                "text": payload["text"],
                "metadata": payload["metadata"],
            }
        )

    return {
        "query": query,
        "document_count": len(documents),
        "indexed_chunks": indexed_chunks,
        "results": results,
    }
