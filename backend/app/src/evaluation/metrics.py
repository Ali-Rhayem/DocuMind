from __future__ import annotations

import math


def precision_at_k(relevant_ids: set[str], predicted_ids: list[str], k: int) -> float:
    if k <= 0:
        return 0.0
    top = predicted_ids[:k]
    if not top:
        return 0.0
    hit_count = sum(1 for item in top if item in relevant_ids)
    return hit_count / float(k)


def recall_at_k(relevant_ids: set[str], predicted_ids: list[str], k: int) -> float:
    if not relevant_ids or k <= 0:
        return 0.0
    top = predicted_ids[:k]
    hit_count = sum(1 for item in top if item in relevant_ids)
    return hit_count / float(len(relevant_ids))


def mrr(relevant_ids: set[str], predicted_ids: list[str]) -> float:
    for idx, item in enumerate(predicted_ids, start=1):
        if item in relevant_ids:
            return 1.0 / float(idx)
    return 0.0


def ndcg_at_k(relevant_ids: set[str], predicted_ids: list[str], k: int) -> float:
    if k <= 0:
        return 0.0

    def _dcg(ids: list[str]) -> float:
        total = 0.0
        for rank, item in enumerate(ids[:k], start=1):
            rel = 1.0 if item in relevant_ids else 0.0
            if rel > 0:
                total += rel / math.log2(rank + 1)
        return total

    dcg = _dcg(predicted_ids)
    ideal_hits = ["hit"] * min(len(relevant_ids), k)
    idcg = 0.0
    for rank, _ in enumerate(ideal_hits, start=1):
        idcg += 1.0 / math.log2(rank + 1)

    if idcg <= 0:
        return 0.0
    return dcg / idcg
