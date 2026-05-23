from __future__ import annotations

import os
from pathlib import Path

from fastapi import UploadFile

ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = ROOT / "storage"
UPLOADS_DIR = STORAGE_ROOT / "uploads"
TEMP_DIR = STORAGE_ROOT / "tmp"
OUTPUT_DIR = STORAGE_ROOT / "output"


def _ensure_dirs() -> None:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


async def save_upload(file: UploadFile) -> str:
    _ensure_dirs()
    target = UPLOADS_DIR / file.filename
    base, ext = os.path.splitext(file.filename)
    suffix = 1
    while target.exists():
        target = UPLOADS_DIR / f"{base}_{suffix}{ext}"
        suffix += 1

    with target.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    await file.close()
    return str(target)


def temp_dir_for_job(job_id: str) -> str:
    _ensure_dirs()
    path = TEMP_DIR / job_id
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def output_dir_for_job(job_id: str) -> str:
    _ensure_dirs()
    path = OUTPUT_DIR / job_id
    path.mkdir(parents=True, exist_ok=True)
    return str(path)
