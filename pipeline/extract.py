from __future__ import annotations

import os
import subprocess


def extract_audio(video_path: str, output_path: str) -> str:
    """Extract mono 16k wav for ASR/diarization stages."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return output_path


def mux_audio_to_video(video_path: str, dubbed_audio_path: str, output_video_path: str) -> str:
    """Mux dubbed dialogue mix back with source video stream."""
    os.makedirs(os.path.dirname(output_video_path), exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-i",
        dubbed_audio_path,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        output_video_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return output_video_path
