from __future__ import annotations


def assign_voices(speakers: list[str], voice_preset: str = "balanced-cinematic") -> dict[str, str]:
    """Stable mapping from speaker id to reusable voice profile id."""
    unique = sorted(set(speakers))
    mapping: dict[str, str] = {}
    for idx, speaker in enumerate(unique):
        mapping[speaker] = f"{voice_preset}_voice_{idx + 1}"
    return mapping
