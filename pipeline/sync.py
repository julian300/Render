from __future__ import annotations

from pydub import AudioSegment  # type: ignore


def sync_audio(audio_path: str, start_sec: float, end_sec: float, output_path: str) -> str:
    """Trim or pad TTS line to fit the original timing window."""
    audio = AudioSegment.from_wav(audio_path)
    target_ms = max(200, int((end_sec - start_sec) * 1000))

    if len(audio) > target_ms:
        fitted = audio[:target_ms]
    else:
        fitted = audio + AudioSegment.silent(duration=(target_ms - len(audio)))

    fitted.export(output_path, format="wav")
    return output_path
