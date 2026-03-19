from typing import Any


class InMemoryVectorStore:
    def __init__(self) -> None:
        self._rows: list[dict[str, Any]] = []

    def add(self, item_id: str, vector: list[float], payload: dict[str, Any]) -> None:
        self._rows.append({"id": item_id, "vector": vector, "payload": payload})

    def all(self) -> list[dict[str, Any]]:
        return list(self._rows)
