from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from jobs.queue import enqueue_job, get_job_result, get_job_status
from utils.storage import save_upload

app = FastAPI(title="DubForge FastAPI Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/upload")
async def upload(
    file: UploadFile = File(...),
    target_language: str = "en-US",
    voice_preset: str = "balanced-cinematic",
) -> dict[str, str]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="file name is required")

    lowered = file.filename.lower()
    if not (lowered.endswith(".mp4") or lowered.endswith(".mkv")):
        raise HTTPException(status_code=400, detail="unsupported file type")

    path = await save_upload(file)
    job_id = enqueue_job(path, file.filename, target_language, voice_preset)
    return {"job_id": job_id, "status": "queued"}


@app.get("/status/{job_id}")
def status(job_id: str) -> dict:
    job = get_job_status(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.get("/result/{job_id}")
def result(job_id: str):
    job = get_job_result(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="job not completed")
    if not job.get("output_file_path"):
        raise HTTPException(status_code=404, detail="output not available")

    return FileResponse(
        job["output_file_path"],
        media_type="video/mp4",
        filename=job.get("output_file_name", f"{job_id}_dubbed.mp4"),
    )
