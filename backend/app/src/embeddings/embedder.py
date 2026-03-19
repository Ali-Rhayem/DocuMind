def fake_embed(text: str) -> list[float]:
    """Temporary deterministic embedding stub for pipeline wiring."""
    length_score = float(len(text))
    word_score = float(len(text.split()))
    return [length_score, word_score]
