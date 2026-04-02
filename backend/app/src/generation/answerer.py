from __future__ import annotations

import os
from time import perf_counter
from typing import Any


_CHAT_MODEL = os.environ.get("DOCUMIND_OPENAI_CHAT_MODEL", "gpt-4o-mini")
_ENABLE_GENERATION = os.environ.get("DOCUMIND_ENABLE_ANSWER_GENERATION", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


def _compact_text(value: str, limit: int = 360) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: limit - 3].rstrip()}..."


def _fallback_answer(query: str, results: list[dict[str, Any]], reason: str) -> dict[str, object]:
    if not results:
        return {
            "text": "I could not find enough evidence in the indexed documents to answer that question yet.",
            "citations": [],
            "provider": "fallback",
            "model": "none",
            "status": "empty",
            "reason": reason,
        }

    excerpts = [_compact_text(str(item.get("text", "")), limit=240) for item in results[:2]]
    citations = [str(item.get("citation", "")) for item in results[:2] if item.get("citation")]
    prefix = "Based on the retrieved documents"
    if query.strip():
        prefix = f'For "{query.strip()}", based on the retrieved documents'

    answer_text = f"{prefix}: {' '.join(piece for piece in excerpts if piece)}"
    return {
        "text": answer_text,
        "citations": citations,
        "provider": "fallback",
        "model": "extractive",
        "status": "fallback",
        "reason": reason,
    }


def _openai_answer(query: str, results: list[dict[str, Any]]) -> dict[str, object]:
    from openai import OpenAI

    context_blocks: list[str] = []
    for idx, item in enumerate(results[:4], start=1):
        context_blocks.append(
            "\n".join(
                [
                    f"[{idx}] citation: {item.get('citation', '')}",
                    f"source: {item.get('source', '')}",
                    f"text: {_compact_text(str(item.get('text', '')), limit=700)}",
                ]
            )
        )

    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    response = client.chat.completions.create(
        model=_CHAT_MODEL,
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are the answer generation layer for a RAG system. "
                    "Answer only from the supplied evidence. "
                    "Be concise, accurate, and explicit when the evidence is limited. "
                    "When returning code, use valid fenced markdown code blocks like ```javascript ... ``` "
                    "with no extra quotes around the fences."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Question: {query}\n\n"
                    "Evidence:\n"
                    f"{chr(10).join(context_blocks)}\n\n"
                    "Write a short answer grounded in the evidence only. Do not invent facts."
                ),
            },
        ],
    )
    text = (response.choices[0].message.content or "").strip()
    citations = [str(item.get("citation", "")) for item in results[:3] if item.get("citation")]
    return {
        "text": text or _fallback_answer(query=query, results=results, reason="empty_openai_response")["text"],
        "citations": citations,
        "provider": "openai",
        "model": _CHAT_MODEL,
        "status": "generated",
        "reason": "ok",
    }


def generate_answer(query: str, results: list[dict[str, Any]]) -> dict[str, object]:
    started_at = perf_counter()

    if not results:
        payload = _fallback_answer(query=query, results=results, reason="no_results")
        payload["latency_ms"] = round((perf_counter() - started_at) * 1000, 2)
        return payload

    if not _ENABLE_GENERATION:
        payload = _fallback_answer(query=query, results=results, reason="generation_disabled")
        payload["latency_ms"] = round((perf_counter() - started_at) * 1000, 2)
        return payload

    if os.environ.get("OPENAI_API_KEY"):
        try:
            payload = _openai_answer(query=query, results=results)
            payload["latency_ms"] = round((perf_counter() - started_at) * 1000, 2)
            return payload
        except Exception:
            pass

    payload = _fallback_answer(query=query, results=results, reason="openai_unavailable")
    payload["latency_ms"] = round((perf_counter() - started_at) * 1000, 2)
    return payload
