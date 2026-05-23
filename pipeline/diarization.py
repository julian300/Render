from __future__ import annotations

from typing import Any


def diarize(audio_path: str) -> list[dict[str, Any]]:
    """Run speaker diarization with pyannote; fallback to one synthetic speaker track."""
    try:
        from pyannote.audio import Pipeline  # type: ignore

        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization")
        diarization = pipeline(audio_path)
        return [
            {
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": str(speaker),
            }
            for turn, _, speaker in diarization.itertracks(yield_label=True)
        ]
    except Exception:
        return [
            {"start": 0.0, "end": 9999.0, "speaker": "SPEAKER_00"},
        ]


def attach_speaker_to_segments(
    asr_segments: list[dict[str, Any]],
    speaker_turns: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Assign speaker by max overlap between ASR segment and diarization turns."""
    merged: list[dict[str, Any]] = []

    for seg in asr_segments:
        seg_start = float(seg["start"])
        seg_end = float(seg["end"])
        best_speaker = "SPEAKER_00"
        best_overlap = -1.0

        for turn in speaker_turns:
            overlap = min(seg_end, float(turn["end"])) - max(seg_start, float(turn["start"]))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = str(turn["speaker"])

        merged.append({**seg, "speaker": best_speaker})

    return merged
