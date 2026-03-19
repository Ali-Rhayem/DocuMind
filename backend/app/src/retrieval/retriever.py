from math import sqrt
from typing import Any


def _l2_distance(a: list[float], b: list[float]) -> float:
    return sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def top_k(query_vector: list[float], rows: list[dict[str, Any]], k: int = 3) -> list[dict[str, Any]]:
    """Return k closest vectors by L2 distance for initial retrieval wiring."""
    scored = []
    for row in rows:
        distance = _l2_distance(query_vector, row["vector"])
        scored.append({"distance": distance, **row})
    scored.sort(key=lambda item: item["distance"])
    return scored[:k]
