import math
import re
from collections import Counter


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z0-9]+", text.lower())


class BM25Index:
    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self.documents: list[dict[str, object]] = []
        self.doc_tokens: list[list[str]] = []
        self.term_freqs: list[Counter[str]] = []
        self.doc_freqs: Counter[str] = Counter()
        self.avg_doc_len: float = 0.0

    def build(self, documents: list[dict[str, object]]) -> None:
        self.documents = documents
        self.doc_tokens = []
        self.term_freqs = []
        self.doc_freqs = Counter()

        total_len = 0
        for doc in documents:
            text = str(doc.get("text", ""))
            tokens = _tokenize(text)
            self.doc_tokens.append(tokens)
            tf = Counter(tokens)
            self.term_freqs.append(tf)
            total_len += len(tokens)
            for term in tf.keys():
                self.doc_freqs[term] += 1

        doc_count = len(documents)
        self.avg_doc_len = (total_len / doc_count) if doc_count else 0.0

    def search(self, query: str, k: int = 10) -> list[dict[str, object]]:
        if not self.documents:
            return []

        query_terms = _tokenize(query)
        if not query_terms:
            return []

        n_docs = len(self.documents)
        scored: list[tuple[int, float]] = []

        for doc_idx, tf in enumerate(self.term_freqs):
            doc_len = len(self.doc_tokens[doc_idx])
            score = 0.0
            for term in query_terms:
                if term not in tf:
                    continue
                df = self.doc_freqs.get(term, 0)
                if df == 0:
                    continue
                idf = math.log(1.0 + ((n_docs - df + 0.5) / (df + 0.5)))
                freq = tf[term]
                numerator = freq * (self.k1 + 1.0)
                denominator = freq + self.k1 * (1.0 - self.b + self.b * (doc_len / (self.avg_doc_len or 1.0)))
                score += idf * (numerator / denominator)

            if score > 0:
                scored.append((doc_idx, score))

        scored.sort(key=lambda item: item[1], reverse=True)
        top = scored[: max(1, k)]

        hits: list[dict[str, object]] = []
        for rank, (doc_idx, score) in enumerate(top, start=1):
            doc = self.documents[doc_idx]
            hits.append({
                "id": doc.get("id"),
                "score": float(score),
                "rank": rank,
                "payload": doc,
            })
        return hits
