from __future__ import annotations

import os
import uuid


def synthesize(text: str, voice_id: str, tmp_dir: str) -> str:
    """Generate a WAV line. Uses Coqui TTS when available, otherwise silent placeholder."""
    os.makedirs(tmp_dir, exist_ok=True)
    out_path = os.path.join(tmp_dir, f"line_{voice_id}_{uuid.uuid4().hex[:8]}.wav")

    try:
        from TTS.api import TTS  # type: ignore

        tts = TTS("tts_models/en/vctk/vits")
        speakers = tts.speakers or []
        speaker = speakers[0] if speakers else None
        if speaker:
            tts.tts_to_file(text=text, speaker=speaker, file_path=out_path)
        else:
            tts.tts_to_file(text=text, file_path=out_path)
        return out_path
    except Exception:
        from pydub import AudioSegment  # type: ignore

        # 1.2s placeholder keeps downstream timing and mixing functional.
        AudioSegment.silent(duration=1200).export(out_path, format="wav")
        return out_path
