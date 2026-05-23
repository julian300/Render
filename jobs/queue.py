from __future__ import annotations

import threading
import uuid
from datetime import datetime
from queue import Empty, Queue
from typing import Any

from pipeline.runner import run_pipeline

_jobs: dict[str, dict[str, Any]] = {}
_queue: Queue[str] = Queue()
_worker_started = False


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _worker() -> None:
    while True:
        try:
            job_id = _queue.get(timeout=1)
        except Empty:
            continue

        job = _jobs.get(job_id)
        if not job:
            _queue.task_done()
            continue

        job["status"] = "processing"
        job["updated_at"] = _now()

        def stage_update(stage_index: int, progress: int, message: str) -> None:
            stage_title = STAGES[stage_index]
            job["stage_index"] = stage_index
            job["progress"] = progress
            job["updated_at"] = _now()
            job["stage_results"].append(
                {
                    "id": stage_index + 1,
                    "title": stage_title,
                    "summary": message,
                }
            )

        try:
            result = run_pipeline(
                video_path=job["input_file_path"],
                job_id=job_id,
                target_language=job["target_language"],
                voice_preset=job["voice_preset"],
                on_stage=stage_update,
            )
            job["status"] = "completed"
            job["progress"] = 100
            job["updated_at"] = _now()
            job["output_file_path"] = result["output_file_path"]
            job["output_file_name"] = result["output_file_name"]
            job["segments"] = result["segments"]
        except Exception as exc:
            job["status"] = "failed"
            job["error"] = str(exc)
            job["updated_at"] = _now()

        _queue.task_done()


STAGES = [
    "Ingestion",
    "Audio Extraction + ASR",
    "Speaker Diarization + Character Clustering",
    "Translation",
    "Character Voice Profiles",
    "Voice Generation",
    "Timing + Lip Sync",
    "Audio Mixing + Final Render",
]


def _ensure_worker() -> None:
    global _worker_started
    if _worker_started:
        return
    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
    _worker_started = True


def enqueue_job(
    input_file_path: str,
    input_file_name: str,
    target_language: str,
    voice_preset: str,
) -> str:
    _ensure_worker()
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    now = _now()
    _jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "created_at": now,
        "updated_at": now,
        "input_file_path": input_file_path,
        "input_file_name": input_file_name,
        "target_language": target_language,
        "voice_preset": voice_preset,
        "progress": 0,
        "stage_index": -1,
        "stage_results": [],
        "segments": [],
        "output_file_path": None,
        "output_file_name": None,
        "error": None,
    }
    _queue.put(job_id)
    return job_id


def get_job_status(job_id: str) -> dict[str, Any] | None:
    return _jobs.get(job_id)


def get_job_result(job_id: str) -> dict[str, Any] | None:
    return _jobs.get(job_id)
