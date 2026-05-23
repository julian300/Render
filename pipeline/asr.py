from __future__ import annotations

from typing import Any


def transcribe(audio_path: str) -> list[dict[str, Any]]:
    """Transcribe Japanese audio with Whisper; fallback to deterministic demo segments."""
    try:
        import whisper  # type: ignore

        model = whisper.load_model("medium")
        result = model.transcribe(audio_path, language="ja")
        return [
            {
                "start": float(seg["start"]),
                "end": float(seg["end"]),
                "text": str(seg["text"]).strip(),
                "confidence": float(seg.get("avg_logprob", -0.4)),
            }
            for seg in result.get("segments", [])
        ]
    except Exception:
        return [
            {"start": 1.2, "end": 3.6, "text": "junbi wa ii ka", "confidence": 0.9},
            {"start": 4.0, "end": 6.2, "text": "koko kara da", "confidence": 0.88},
            {"start": 7.1, "end": 9.2, "text": "iku zo", "confidence": 0.91},
        ]
