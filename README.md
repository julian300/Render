# FastAPI Dubbing Backend

This backend matches the frontend endpoints and your FastAPI approach while fixing the main pipeline wiring issues.

## Run

1. Create venv and install deps:
   - `pip install -r requirements.txt`
2. Run API:
   - `uvicorn main:app --reload --port 8000`
3. Run frontend in repo root:
   - `npm run dev`

Frontend default API base URL is `http://localhost:8000`.

## Endpoints

- `GET /health`
- `POST /upload`
- `GET /status/{job_id}`
- `GET /result/{job_id}`

## Important Fixes vs Raw Snippets

- ASR and diarization are now aligned by timestamp overlap before speaker assignment.
- TTS file names are unique, so lines do not overwrite each other.
- Audio sync uses trim/pad (pydub has no `set_duration`).
- Mix and mux produce a final downloadable MP4 artifact.
- Queue worker runs background jobs and updates progress/stage metadata.

## Notes

- First run may be heavy due to model downloads.
- `pyannote/speaker-diarization` may require access token/login depending on your environment.
- If a model step fails, fallback logic keeps the job pipeline alive for integration testing.