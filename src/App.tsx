import { useEffect, useMemo, useRef, useState } from 'react';

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

type StageResult = {
  id: number;
  title: string;
  summary: string;
};

type Segment = {
  start_time: number;
  end_time: number;
  japanese_text: string;
  english_text: string;
  speaker_id: string;
  character_id: string;
  asr_confidence: number;
};

type PipelineJob = {
  id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  input_file_name: string;
  input_file_size_mb: number;
  target_language: string;
  voice_preset: string;
  stage_index: number;
  progress: number;
  error_message?: string;
  output_file_path?: string;
  output_download_url?: string;
  output_file_name?: string;
  stage_results: StageResult[];
};

type JobListResponse = {
  jobs: PipelineJob[];
};

type UploadResponse = {
  job_id: string;
  status: JobStatus;
  created_at: string;
};

type ResultResponse = {
  job_id: string;
  status: JobStatus;
  output_video_url?: string;
  manifest_url?: string;
  segments: Segment[];
};

type BackendMode = 'node' | 'fastapi' | 'offline';

const apiBaseUrl =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL ??
  'http://localhost:8000';
const maxUploadSizeMb = 4096;

const architectureDiagram = `Client (React/Vite)
  -> API (Express/Fastify/FastAPI)
    -> Object Storage (S3/R2/local) for source + artifacts
    -> Queue + worker orchestrator
      -> ASR stage
      -> Diarization stage
      -> Translation stage
      -> Voice mapping stage
      -> TTS stage
      -> Timing/lipsync stage
      -> Mixing/render stage
    -> Job metadata store (Postgres/Redis)
  -> Signed file delivery`;

const moduleSpecs = [
  '1) Ingestion: validate + persist upload, enqueue job.',
  '2) ASR: extract audio and transcribe Japanese segments with confidence.',
  '3) Diarization: assign speaker_id and stable character_id.',
  '4) Translation: convert Japanese text to dub-friendly target language.',
  '5) Voice profiles: map each character to persistent voice persona.',
  '6) Voice generation: synthesize per-line audio with timing constraints.',
  '7) Timing/lipsync: fit generated lines into original timing windows.',
  '8) Mixing/render: preserve music/SFX, replace dialogue, export dubbed video.',
];

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatStatus(status: JobStatus) {
  if (status === 'queued') return 'Queued';
  if (status === 'processing') return 'Processing';
  if (status === 'completed') return 'Completed';
  return 'Failed';
}

function statusClass(status: JobStatus) {
  if (status === 'queued') return 'text-amber-300';
  if (status === 'processing') return 'text-sky-300';
  if (status === 'completed') return 'text-emerald-300';
  return 'text-rose-300';
}

export default function App() {
  const [targetLanguage, setTargetLanguage] = useState('en-US');
  const [voicePreset, setVoicePreset] = useState('balanced-cinematic');
  const [fileError, setFileError] = useState('');
  const [apiError, setApiError] = useState('');
  const [apiOnline, setApiOnline] = useState(false);
  const [backendMode, setBackendMode] = useState<BackendMode>('offline');
  const [uploading, setUploading] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const jobsRef = useRef<PipelineJob[]>([]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? jobs[0],
    [jobs, selectedJobId],
  );

  async function fetchJobs(mode: BackendMode = backendMode) {
    if (mode === 'node') {
      const response = await fetch(`${apiBaseUrl}/api/v1/jobs`);
      if (!response.ok) {
        throw new Error(`Failed to fetch jobs: ${response.status}`);
      }

      const data = (await response.json()) as JobListResponse;
      setJobs(data.jobs);
      if (!selectedJobId && data.jobs.length > 0) {
        setSelectedJobId(data.jobs[0].id);
      }
      return;
    }

    if (mode === 'fastapi') {
      if (jobsRef.current.length === 0) return;

      const refreshed = await Promise.all(
        jobsRef.current.map(async (job) => {
          const response = await fetch(`${apiBaseUrl}/status/${job.id}`);
          if (!response.ok) return job;

          const payload = (await response.json()) as {
            status?: JobStatus;
            progress?: number;
            error?: string;
            output_file_path?: string;
            output_url?: string;
          };

          return {
            ...job,
            status: payload.status ?? job.status,
            progress: typeof payload.progress === 'number' ? payload.progress : job.progress,
            error_message: payload.error ?? job.error_message,
            output_file_path: payload.output_file_path ?? job.output_file_path,
            output_download_url:
              payload.output_url ??
              (payload.status === 'completed' ? `${apiBaseUrl}/result/${job.id}` : job.output_download_url),
            updated_at: new Date().toISOString(),
          };
        }),
      );

      setJobs(refreshed);
    }
  }

  async function detectBackendMode(): Promise<BackendMode> {
    try {
      const nodeHealth = await fetch(`${apiBaseUrl}/api/v1/health`).then((response) => response.ok).catch(() => false);

      if (nodeHealth) {
        setApiOnline(true);
        setBackendMode('node');
        return 'node';
      }

      const fastapiOpenapi = await fetch(`${apiBaseUrl}/openapi.json`)
        .then(async (response) => {
          if (!response.ok) return false;
          const schema = (await response.json()) as { paths?: Record<string, unknown> };
          return Boolean(schema.paths?.['/upload'] && schema.paths?.['/status/{job_id}']);
        })
        .catch(() => false);

      if (fastapiOpenapi) {
        setApiOnline(true);
        setBackendMode('fastapi');
        return 'fastapi';
      }

      setApiOnline(false);
      setBackendMode('offline');
      return 'offline';
    } catch {
      setApiOnline(false);
      setBackendMode('offline');
      return 'offline';
    }
  }

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    let mounted = true;

    async function loadInitial() {
      try {
        const mode = await detectBackendMode();
        if (mode === 'offline') {
          throw new Error('Cannot reach API server. Start FastAPI or Node backend first.');
        }
        await fetchJobs(mode);
      } catch (error) {
        if (mounted) {
          setApiError(error instanceof Error ? error.message : 'Unable to reach API server.');
        }
      } finally {
        if (mounted) setLoadingJobs(false);
      }
    }

    loadInitial();

    const timer = window.setInterval(async () => {
      try {
        const mode = await detectBackendMode();
        if (mode === 'offline') {
          throw new Error('Cannot reach API server. Start FastAPI or Node backend first.');
        }
        await fetchJobs(mode);
        if (mounted) setApiError('');
      } catch (error) {
        if (mounted) {
          setApiError(error instanceof Error ? error.message : 'Unable to refresh jobs.');
        }
      }
    }, 2200);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [selectedJobId]);

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    if (!apiOnline) {
      setApiError('Upload blocked: API is offline. Start FastAPI or Node backend and try again.');
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const fileSizeMb = file.size / (1024 * 1024);

    if (!['mp4', 'mkv'].includes(extension)) {
      setFileError('Unsupported file type. Allowed: mp4, mkv.');
      return;
    }

    if (fileSizeMb > maxUploadSizeMb) {
      setFileError(`File too large (${fileSizeMb.toFixed(1)} MB). Max ${maxUploadSizeMb} MB.`);
      return;
    }

    setUploading(true);
    setFileError('');
    setApiError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('target_language', targetLanguage);
      formData.append('voice_preset', voicePreset);

      const endpoint = backendMode === 'fastapi' ? `${apiBaseUrl}/upload` : `${apiBaseUrl}/api/v1/jobs`;
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Upload failed.' }));
        throw new Error(body.error ?? 'Upload failed.');
      }

      const data = (await response.json()) as UploadResponse;

      if (backendMode === 'fastapi') {
        const now = new Date().toISOString();
        const createdJob: PipelineJob = {
          id: data.job_id,
          status: 'queued',
          created_at: now,
          updated_at: now,
          input_file_name: file.name,
          input_file_size_mb: Number((file.size / (1024 * 1024)).toFixed(2)),
          target_language: targetLanguage,
          voice_preset: voicePreset,
          stage_index: -1,
          progress: 0,
          stage_results: [],
        };
        setJobs((current) => [createdJob, ...current]);
        setSelectedJobId(createdJob.id);
      } else {
        setSelectedJobId(data.job_id);
        await fetchJobs();
      }
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to upload file.');
    } finally {
      setUploading(false);
      event.currentTarget.value = '';
    }
  }

  async function downloadManifest() {
    if (!selectedJob) return;

    const endpoint =
      backendMode === 'fastapi'
        ? `${apiBaseUrl}/result/${selectedJob.id}`
        : `${apiBaseUrl}/api/v1/jobs/${selectedJob.id}/result`;

    const response = await fetch(endpoint);
    if (!response.ok) {
      setApiError('Unable to fetch manifest.');
      return;
    }

    const result = (await response.json()) as ResultResponse;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedJob.id}_manifest.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadDubbedVideo() {
    if (!selectedJob?.output_download_url || selectedJob.status !== 'completed') return;
    const url = selectedJob.output_download_url.startsWith('http')
      ? selectedJob.output_download_url
      : `${apiBaseUrl}${selectedJob.output_download_url}`;
    window.location.href = url;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="hero-motion border-b border-white/10 bg-[radial-gradient(circle_at_25%_10%,rgba(99,102,241,0.45),transparent_40%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.35),transparent_35%),linear-gradient(180deg,#020617,#0b1120)]">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-300">DubForge</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Automatic anime dubbing pipeline with queue workers and downloadable outputs.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
            This UI now talks to a real backend API. Upload a Japanese episode, monitor stages, and download the
            rendered output artifact once complete.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-10 px-6 py-10">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-4 border border-white/10 bg-slate-900/50 p-6">
            <h2 className="text-2xl font-semibold text-white">Upload Job</h2>
            <p className="text-sm text-slate-300">Accepted types: .mp4, .mkv. Backend enqueues long-running jobs.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-slate-300">Target language</span>
                <select
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                  className="w-full border border-white/15 bg-slate-950 px-3 py-2 outline-none focus:border-sky-400"
                >
                  <option value="en-US">English (US)</option>
                  <option value="es-ES">Spanish</option>
                  <option value="fr-FR">French</option>
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-300">Voice preset</span>
                <select
                  value={voicePreset}
                  onChange={(event) => setVoicePreset(event.target.value)}
                  className="w-full border border-white/15 bg-slate-950 px-3 py-2 outline-none focus:border-sky-400"
                >
                  <option value="balanced-cinematic">Balanced cinematic</option>
                  <option value="shounen-energetic">Shounen energetic</option>
                  <option value="dramatic-dark">Dramatic dark</option>
                </select>
              </label>
            </div>
            <label className="block border border-dashed border-white/20 bg-slate-950/70 p-5 text-sm text-slate-300">
              <span className="block pb-2 text-slate-200">Upload source episode (max {maxUploadSizeMb} MB)</span>
              <input
                type="file"
                accept=".mp4,.mkv"
                onChange={handleFileUpload}
                className="block w-full text-sm"
                disabled={uploading}
              />
            </label>
            {uploading ? <p className="text-sm text-sky-300">Uploading and creating job...</p> : null}
            {fileError ? <p className="text-sm text-rose-300">{fileError}</p> : null}
            {apiError ? <p className="text-sm text-rose-300">{apiError}</p> : null}
            <p className={`text-xs ${apiOnline ? 'text-emerald-300' : 'text-amber-300'}`}>
              API status: {apiOnline ? 'online' : 'offline'}
            </p>
            <p className="text-xs text-slate-400">API base URL: {apiBaseUrl}</p>
            <p className="text-xs text-slate-400">Detected backend mode: {backendMode}</p>
            <p className="text-xs text-slate-400">
              FastAPI: uvicorn main:app --reload --port 8000 | Node: node server/index.js
            </p>
          </div>

          <div className="space-y-4 border border-white/10 bg-slate-900/50 p-6">
            <h2 className="text-2xl font-semibold text-white">Job Status</h2>
            <div className="max-h-64 space-y-2 overflow-y-auto border border-white/10 bg-slate-950/70 p-3">
              {loadingJobs ? <p className="text-sm text-slate-400">Loading jobs...</p> : null}
              {!loadingJobs && jobs.length === 0 ? <p className="text-sm text-slate-400">No jobs yet.</p> : null}
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className={`w-full border px-3 py-2 text-left transition ${
                    selectedJob?.id === job.id
                      ? 'border-sky-400 bg-sky-500/10'
                      : 'border-white/10 bg-slate-900 hover:border-white/20'
                  }`}
                >
                  <p className="font-mono text-xs text-slate-300">{job.id}</p>
                  <p className="text-sm text-slate-200">{job.input_file_name}</p>
                  <p className={`text-xs ${statusClass(job.status)}`}>{formatStatus(job.status)}</p>
                </button>
              ))}
            </div>

            {selectedJob ? (
              <div className="space-y-3 border border-white/10 bg-slate-950/80 p-4">
                <p className="font-mono text-xs text-slate-400">{selectedJob.id}</p>
                <p className="text-sm text-slate-200">Created: {formatDate(selectedJob.created_at)}</p>
                <p className="text-sm text-slate-200">Input: {selectedJob.input_file_name}</p>
                <p className="text-sm text-slate-200">Size: {selectedJob.input_file_size_mb} MB</p>
                <p className={`text-sm font-medium ${statusClass(selectedJob.status)}`}>
                  Status: {formatStatus(selectedJob.status)}
                </p>
                <div className="h-2 w-full overflow-hidden bg-white/10">
                  <div className="h-full bg-sky-400 transition-all" style={{ width: `${selectedJob.progress}%` }} />
                </div>
                <div className="max-h-28 space-y-1 overflow-auto border border-white/10 bg-slate-900/70 p-2 text-xs text-slate-300">
                  {selectedJob.stage_results.length === 0 ? <p>No completed stages yet.</p> : null}
                  {selectedJob.stage_results.map((stage) => (
                    <p key={stage.id}>
                      {stage.id}. {stage.title}: {stage.summary}
                    </p>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={selectedJob.status !== 'completed'}
                    onClick={downloadManifest}
                    className="border border-sky-300 px-3 py-1 text-sm text-sky-200 enabled:hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Download manifest JSON
                  </button>
                  <button
                    type="button"
                    disabled={selectedJob.status !== 'completed' || !selectedJob.output_download_url}
                    onClick={downloadDubbedVideo}
                    className="border border-emerald-300 px-3 py-1 text-sm text-emerald-200 enabled:hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Download dubbed video
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-4 border border-white/10 bg-slate-900/50 p-6">
          <h2 className="text-2xl font-semibold text-white">Architecture</h2>
          <pre className="overflow-x-auto border border-white/10 bg-slate-950/80 p-4 text-xs leading-relaxed text-slate-200">
            {architectureDiagram}
          </pre>
        </section>

        <section className="space-y-4 border border-white/10 bg-slate-900/50 p-6">
          <h2 className="text-2xl font-semibold text-white">Module breakdown</h2>
          <ul className="space-y-1 text-sm text-slate-200">
            {moduleSpecs.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
