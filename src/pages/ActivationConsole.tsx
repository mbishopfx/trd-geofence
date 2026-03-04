import { useMemo, useState } from "react";
import { Download, RefreshCcw, Send, ShieldAlert } from "lucide-react";
import { apiRequest } from "../lib/api";
import { useTrueRankStore } from "../lib/store";

type ActivationJobResponse = {
  ok: boolean;
  jobId: string;
};

type ActivationJobStatus = {
  ok: boolean;
  job: {
    id: string;
    campaign_id: string;
    platform: string;
    mode: string;
    status: string;
    artifact_path: string | null;
    input_count: number;
    success_count: number;
    failure_count: number;
    started_at: string | null;
    completed_at: string | null;
    error_json: { message?: string } | null;
  };
  items: Array<{
    id: number;
    device_id_hash: string;
    mapped_identifier: string | null;
    status: string;
    error: string | null;
    created_at: string;
  }>;
};

export default function ActivationConsole() {
  const apiBaseUrl = useTrueRankStore((s) => s.apiBaseUrl);
  const campaigns = useTrueRankStore((s) => s.campaigns);
  const activeCampaignId = useTrueRankStore((s) => s.activeCampaignId);
  const setActiveCampaign = useTrueRankStore((s) => s.setActiveCampaign);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === activeCampaignId) || campaigns[0] || null,
    [campaigns, activeCampaignId]
  );

  const [platform, setPlatform] = useState<"google" | "meta">("google");
  const [mode, setMode] = useState("export_only");
  const [currentJobId, setCurrentJobId] = useState("");
  const [jobStatus, setJobStatus] = useState<ActivationJobStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");

  async function createJob() {
    if (!selectedCampaign) {
      return;
    }

    setCreating(true);
    setError("");

    try {
      const response = await apiRequest<ActivationJobResponse>(
        "/api/activation/jobs",
        {
          method: "POST",
          body: JSON.stringify({
            campaignId: selectedCampaign.id,
            platform,
            mode
          })
        },
        apiBaseUrl
      );

      setCurrentJobId(response.jobId);
      await loadJob(response.jobId);
    } catch (createError) {
      if (createError instanceof Error) {
        setError(createError.message);
      } else {
        setError("Failed to create activation job.");
      }
    } finally {
      setCreating(false);
    }
  }

  async function loadJob(jobId = currentJobId) {
    if (!jobId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<ActivationJobStatus>(`/api/activation/jobs/${jobId}`, {}, apiBaseUrl);
      setJobStatus(response);
      setCurrentJobId(jobId);
    } catch (loadError) {
      if (loadError instanceof Error) {
        setError(loadError.message);
      } else {
        setError("Failed to load activation job.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function retryFailures() {
    if (!currentJobId) {
      return;
    }

    setRetrying(true);
    setError("");

    try {
      await apiRequest<{ ok: boolean }>(
        `/api/activation/jobs/${currentJobId}/retry-failures`,
        {
          method: "POST",
          body: JSON.stringify({})
        },
        apiBaseUrl
      );

      await loadJob(currentJobId);
    } catch (retryError) {
      if (retryError instanceof Error) {
        setError(retryError.message);
      } else {
        setError("Failed to retry activation failures.");
      }
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <div>
        <h2 className="text-2xl font-display text-white">Activation Console</h2>
        <p className="text-sm text-zinc-400">Create Google/Meta audience export jobs and inspect item-level results.</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Campaign</label>
            <select
              value={selectedCampaign?.id || ""}
              onChange={(event) => setActiveCampaign(event.target.value || null)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            >
              {campaigns.length === 0 && <option value="">No campaigns</option>}
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Platform</label>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value === "meta" ? "meta" : "google")}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            >
              <option value="google">Google</option>
              <option value="meta">Meta</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Mode</label>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            >
              <option value="export_only">Export Only</option>
              <option value="api_attempt">API Attempt</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => {
                createJob().catch(() => {});
              }}
              disabled={creating || !selectedCampaign}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-tr-secondary px-3 py-2 text-xs font-semibold text-black disabled:opacity-60"
            >
              <Send size={14} /> {creating ? "Creating..." : "Create Job"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={currentJobId}
            onChange={(event) => setCurrentJobId(event.target.value.trim())}
            placeholder="Paste activation job ID"
            className="min-w-[280px] flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => {
              loadJob().catch(() => {});
            }}
            disabled={loading || !currentJobId}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
          >
            <RefreshCcw size={14} /> {loading ? "Loading..." : "Load Job"}
          </button>
          <button
            type="button"
            onClick={() => {
              retryFailures().catch(() => {});
            }}
            disabled={retrying || !currentJobId}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 disabled:opacity-60"
          >
            <ShieldAlert size={14} /> {retrying ? "Retrying..." : "Retry Failures"}
          </button>
        </div>

        {jobStatus?.job ? (
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <article className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wider text-zinc-400">Status</p>
              <p className="mt-1 text-lg font-semibold text-white">{jobStatus.job.status}</p>
            </article>
            <article className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wider text-zinc-400">Input</p>
              <p className="mt-1 text-lg font-semibold text-white">{jobStatus.job.input_count}</p>
            </article>
            <article className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wider text-zinc-400">Success</p>
              <p className="mt-1 text-lg font-semibold text-emerald-300">{jobStatus.job.success_count}</p>
            </article>
            <article className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wider text-zinc-400">Failures</p>
              <p className="mt-1 text-lg font-semibold text-rose-300">{jobStatus.job.failure_count}</p>
            </article>
          </div>
        ) : null}

        {jobStatus?.job?.artifact_path ? (
          <p className="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
            <Download size={14} /> Artifact: {jobStatus.job.artifact_path}
          </p>
        ) : null}

        <div className="max-h-[380px] overflow-auto rounded-lg border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-3 py-2">Device Hash</th>
                <th className="px-3 py-2">Mapped ID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {jobStatus?.items?.length ? (
                jobStatus.items.map((item) => (
                  <tr key={item.id} className="border-t border-white/10">
                    <td className="px-3 py-2 font-mono text-xs text-zinc-200">{item.device_id_hash.slice(0, 16)}...</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-300">{item.mapped_identifier?.slice(0, 16) || "-"}</td>
                    <td className="px-3 py-2 text-zinc-100">{item.status}</td>
                    <td className="px-3 py-2 text-rose-300">{item.error || "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-zinc-400">
                    No job items loaded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-zinc-400">{error ? <span className="text-red-300">{error}</span> : null}</div>
    </div>
  );
}
