from typing import Any
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointIdsList, VectorParams, PointStruct


class QdrantVectorStore:
    def __init__(
        self,
        collection_name: str = "documents",
        url: str = "http://localhost:6333",
        vector_size: int = 2,
    ) -> None:
        """
        Initialize Qdrant vector store.
        
        Args:
            collection_name: Name of the collection in Qdrant
            url: Qdrant server URL (default: localhost:6333)
            vector_size: Embedding vector size for collection schema
        """
        self.client = QdrantClient(url=url)
        self.collection_name = collection_name
        self.vector_size = max(1, int(vector_size))
        self._ensure_collection_exists()

    def _ensure_collection_exists(self) -> None:
        """Create collection if it doesn't exist."""
        try:
            self.client.get_collection(self.collection_name)
            return
        except Exception:
            pass

        try:
            # Collection doesn't exist, create it with configured vector size.
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=self.vector_size, distance=Distance.COSINE),
            )
        except Exception as exc:
            raise RuntimeError(
                "Qdrant is unavailable. Start Qdrant on http://localhost:6333 before querying."
            ) from exc

    def recreate(self, vector_size: int | None = None) -> None:
        if vector_size is not None:
            self.vector_size = max(1, int(vector_size))
        try:
            self.client.delete_collection(self.collection_name)
        except Exception:
            pass
        self._ensure_collection_exists()

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

    def _numeric_id(self, item_id: str) -> int:
        return hash(item_id) & 0x7FFFFFFF

    def delete_ids(self, item_ids: list[str]) -> int:
        """Delete points by their original string IDs. Returns number of requested deletions."""
        if not item_ids:
            return 0

        numeric_ids = [self._numeric_id(item_id) for item_id in item_ids]
        self.client.delete(
            collection_name=self.collection_name,
            points_selector=PointIdsList(points=numeric_ids),
        )
        return len(numeric_ids)

    def count(self) -> int:
        try:
            result = self.client.count(collection_name=self.collection_name, exact=True)
            return int(result.count)
        except Exception:
            return 0

    def all_payloads(self) -> list[dict[str, Any]]:
        payloads: list[dict[str, Any]] = []
        offset: Any = None

        while True:
            points, next_offset = self.client.scroll(
                collection_name=self.collection_name,
                limit=256,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )

            for point in points:
                payload = dict(point.payload or {})
                if payload:
                    payloads.append(payload)

            if next_offset is None:
                break

            offset = next_offset

        return payloads

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
