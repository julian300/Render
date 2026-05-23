from __future__ import annotations

import os
from typing import Any, Callable

from pipeline.asr import transcribe
from pipeline.diarization import attach_speaker_to_segments, diarize
from pipeline.extract import extract_audio, mux_audio_to_video
from pipeline.mix import mix
from pipeline.sync import sync_audio
from pipeline.translate import translate
from pipeline.tts import synthesize
from pipeline.voice_assign import assign_voices
from utils.storage import output_dir_for_job, temp_dir_for_job


StageCallback = Callable[[int, int, str], None]


def _progress(stage: int) -> int:
    return int(((stage + 1) / 8) * 100)


def run_pipeline(
    video_path: str,
    job_id: str,
    target_language: str,
    voice_preset: str,
    on_stage: StageCallback,
) -> dict[str, Any]:
    tmp_dir = temp_dir_for_job(job_id)
    out_dir = output_dir_for_job(job_id)
    os.makedirs(tmp_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    on_stage(0, _progress(0), "Queued job accepted by worker.")

    audio_path = extract_audio(video_path, os.path.join(tmp_dir, "source.wav"))
    asr_segments = transcribe(audio_path)
    on_stage(1, _progress(1), f"ASR produced {len(asr_segments)} segments.")

    speaker_turns = diarize(audio_path)
    speaker_segments = attach_speaker_to_segments(asr_segments, speaker_turns)
    on_stage(2, _progress(2), "Diarization aligned to ASR timeline.")

    for seg in speaker_segments:
        seg["english_text"] = translate(seg["text"], target_language=target_language)
    on_stage(3, _progress(3), "Translation completed.")

    voice_map = assign_voices([seg["speaker"] for seg in speaker_segments], voice_preset=voice_preset)
    on_stage(4, _progress(4), "Voice profiles assigned per speaker.")

    generated_lines: list[dict[str, Any]] = []
    for idx, seg in enumerate(speaker_segments):
        voice_id = voice_map[seg["speaker"]]
        wav_path = synthesize(seg["english_text"], voice_id, tmp_dir)
        synced_path = os.path.join(tmp_dir, f"synced_{idx:04d}.wav")
        sync_audio(wav_path, float(seg["start"]), float(seg["end"]), synced_path)
        generated_lines.append({"path": synced_path, "start": float(seg["start"])})
    on_stage(5, _progress(5), "TTS lines synthesized.")

    on_stage(6, _progress(6), "Line durations fitted into source timing windows.")

    mixed_audio_path = mix(audio_path, generated_lines, os.path.join(out_dir, "dub_mix.wav"))
    output_file_name = "dubbed_output.mp4"
    output_file_path = mux_audio_to_video(video_path, mixed_audio_path, os.path.join(out_dir, output_file_name))
    on_stage(7, _progress(7), "Final dubbed video rendered.")

    return {
        "output_file_path": output_file_path,
        "output_file_name": output_file_name,
        "segments": [
            {
                "start_time": float(seg["start"]),
                "end_time": float(seg["end"]),
                "japanese_text": seg["text"],
                "english_text": seg["english_text"],
                "speaker_id": seg["speaker"],
                "character_id": seg["speaker"],
                "asr_confidence": float(seg.get("confidence", 0.85)),
            }
            for seg in speaker_segments
        ],
    }
