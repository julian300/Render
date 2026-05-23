from __future__ import annotations

from pydub import AudioSegment  # type: ignore


def mix(base_audio_path: str, voices: list[dict], output_path: str) -> str:
    """Overlay generated line clips over base audio timeline."""
    base = AudioSegment.from_file(base_audio_path)
    mixed = base

    for voice in voices:
        clip = AudioSegment.from_wav(voice["path"])
        position_ms = int(float(voice["start"]) * 1000)
        mixed = mixed.overlay(clip, position=position_ms)

    mixed.export(output_path, format="wav")
    return output_path
