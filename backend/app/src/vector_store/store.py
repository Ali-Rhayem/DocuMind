from typing import Any
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct


class QdrantVectorStore:
    def __init__(self, collection_name: str = "documents", url: str = "http://localhost:6333") -> None:
        """
        Initialize Qdrant vector store.
        
        Args:
            collection_name: Name of the collection in Qdrant
            url: Qdrant server URL (default: localhost:6333)
        """
        self.client = QdrantClient(url=url)
        self.collection_name = collection_name
        self._ensure_collection_exists()

    def _ensure_collection_exists(self) -> None:
        """Create collection if it doesn't exist."""
        try:
            self.client.get_collection(self.collection_name)
        except Exception:
            # Collection doesn't exist, create it with vector size 2 (from fake_embed)
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=2, distance=Distance.COSINE),
            )

    def add(self, item_id: str, vector: list[float], payload: dict[str, Any]) -> None:
        """Add a vector with metadata to the collection."""
        # Qdrant uses hash of string ID as numeric ID
        numeric_id = hash(item_id) & 0x7FFFFFFF
        
        point = PointStruct(
            id=numeric_id,
            vector=vector,
            payload=payload,
        )
        self.client.upsert(
            collection_name=self.collection_name,
            points=[point],
        )

    def search(self, query_vector: list[float], k: int = 3) -> list[dict[str, Any]]:
        """Search for nearest neighbors."""
        results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            limit=k,
        )
        
        hits = []
        for result in results:
            hits.append({
                "id": result.id,
                "score": result.score,
                "payload": result.payload,
            })
        return hits

    def clear(self) -> None:
        """Clear all data in the collection."""
        try:
            self.client.delete_collection(self.collection_name)
            self._ensure_collection_exists()
        except Exception:
            pass
