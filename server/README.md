# DubForge API Server

Run the API locally:

1. `node server/index.js`
2. Frontend runs with `npm run dev`
3. Optionally set `VITE_API_BASE_URL=http://localhost:8787`

## Endpoints

- `POST /api/v1/jobs` multipart upload (`file`, `target_language`, `voice_preset`)
- `GET /api/v1/jobs` list jobs
- `GET /api/v1/jobs/:jobId` job status
- `GET /api/v1/jobs/:jobId/result` result payload
- `GET /api/v1/jobs/:jobId/manifest` JSON manifest
- `GET /api/v1/jobs/:jobId/download` download output video

## Notes

- Jobs are stored in memory for this prototype.
- Uploaded files and output artifacts are written to `storage/`.
- If FFmpeg is not available on PATH, server returns a fallback output by copying source media.
- Replace `buildSegments` and `renderDubbedVideo` internals with real ASR, diarization, translation, TTS, and mixing modules.