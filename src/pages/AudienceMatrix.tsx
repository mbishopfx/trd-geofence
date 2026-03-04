import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Clock3, RefreshCcw, Users } from "lucide-react";
import { apiRequest } from "../lib/api";
import { useTrueRankStore } from "../lib/store";

type AudienceSummary = {
  ok: boolean;
  campaignId: string;
  activeCount: number;
  totalCount: number;
  lastQualifiedAt: string | null;
  expiryDistribution: Array<{ bucket: string; count: number }>;
};

type QualificationAnalytics = {
  ok: boolean;
  campaignId: string;
  from: string;
  to: string;
  qualified: number;
  reasonsBreakdown: Array<{ reason_code: string; count: number }>;
};

function formatBucket(bucket: string) {
  if (bucket === "0_7") {
    return "0-7 days";
  }
  if (bucket === "8_14") {
    return "8-14 days";
  }
  if (bucket === "15_30") {
    return "15-30 days";
  }
  if (bucket === "31_plus") {
    return "31+ days";
  }
  if (bucket === "expired") {
    return "Expired";
  }
  return bucket;
}

export const AudienceMatrix = () => {
  const apiBaseUrl = useTrueRankStore((s) => s.apiBaseUrl);
  const campaigns = useTrueRankStore((s) => s.campaigns);
  const activeCampaignId = useTrueRankStore((s) => s.activeCampaignId);
  const setActiveCampaign = useTrueRankStore((s) => s.setActiveCampaign);

  const [loading, setLoading] = useState(false);
  const [runningQualify, setRunningQualify] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<AudienceSummary | null>(null);
  const [analytics, setAnalytics] = useState<QualificationAnalytics | null>(null);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === activeCampaignId) || campaigns[0] || null,
    [campaigns, activeCampaignId]
  );

  const loadData = useCallback(async () => {
    if (!selectedCampaign) {
      setSummary(null);
      setAnalytics(null);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const to = now.toISOString();

      const [audience, qualification] = await Promise.all([
        apiRequest<AudienceSummary>(`/api/audiences/${selectedCampaign.id}`, {}, apiBaseUrl),
        apiRequest<QualificationAnalytics>(
          `/api/analytics/qualification?campaignId=${encodeURIComponent(selectedCampaign.id)}&from=${encodeURIComponent(
            from
          )}&to=${encodeURIComponent(to)}&limit=200`,
          {},
          apiBaseUrl
        )
      ]);

      setSummary(audience);
      setAnalytics(qualification);
    } catch (loadError) {
      if (loadError instanceof Error) {
        setError(loadError.message);
      } else {
        setError("Failed to load audience analytics.");
      }
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, selectedCampaign]);

  const runQualificationNow = useCallback(async () => {
    if (!selectedCampaign) {
      return;
    }

    setRunningQualify(true);
    setError("");

    try {
      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const to = now.toISOString();

      await apiRequest<{ ok: boolean }>(
        "/api/qualify/run",
        {
          method: "POST",
          body: JSON.stringify({
            campaignId: selectedCampaign.id,
            from,
            to
          })
        },
        apiBaseUrl
      );

      await loadData();
    } catch (qualifyError) {
      if (qualifyError instanceof Error) {
        setError(qualifyError.message);
      } else {
        setError("Failed to run qualification.");
      }
    } finally {
      setRunningQualify(false);
    }
  }, [apiBaseUrl, loadData, selectedCampaign]);

  useEffect(() => {
    if (!activeCampaignId && campaigns.length > 0) {
      setActiveCampaign(campaigns[0].id);
    }
  }, [activeCampaignId, campaigns, setActiveCampaign]);

  useEffect(() => {
    loadData().catch(() => {});
  }, [loadData]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-display text-white">
            <Users className="text-tr-primary" /> Audience Matrix
          </h2>
          <p className="text-sm text-zinc-400">
            Live audience counts, qualification reason codes, and TTL distribution.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadData()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
          >
            <RefreshCcw size={14} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              runQualificationNow().catch(() => {});
            }}
            disabled={runningQualify || !selectedCampaign}
            className="inline-flex items-center gap-2 rounded-lg border border-tr-secondary/40 bg-tr-secondary/10 px-3 py-2 text-xs text-tr-secondary disabled:opacity-60"
          >
            <Activity size={14} /> {runningQualify ? "Running..." : "Run Qualification (24h)"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <label className="mb-2 block text-xs uppercase tracking-wider text-zinc-400">Campaign</label>
        <select
          value={selectedCampaign?.id || ""}
          onChange={(event) => setActiveCampaign(event.target.value || null)}
          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
        >
          {campaigns.length === 0 && <option value="">No campaigns available</option>}
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Audience Active</p>
          <p className="mt-2 text-3xl font-display text-white">{summary?.activeCount || 0}</p>
        </article>
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Total Memberships</p>
          <p className="mt-2 text-3xl font-display text-white">{summary?.totalCount || 0}</p>
        </article>
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Qualified (Window)</p>
          <p className="mt-2 text-3xl font-display text-white">{analytics?.qualified || 0}</p>
        </article>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-zinc-300">
            <Clock3 size={14} className="text-tr-primary" /> TTL Timeline
          </h3>
          <div className="space-y-2 text-sm">
            {(summary?.expiryDistribution || []).map((item) => (
              <div key={item.bucket} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                <span className="text-zinc-200">{formatBucket(item.bucket)}</span>
                <span className="font-semibold text-white">{item.count}</span>
              </div>
            ))}
            {!summary?.expiryDistribution?.length && <p className="text-zinc-400">No audience memberships yet.</p>}
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Last qualified: {summary?.lastQualifiedAt ? new Date(summary.lastQualifiedAt).toLocaleString() : "N/A"}
          </p>
        </section>

        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 text-sm uppercase tracking-wider text-zinc-300">Reason Breakdown</h3>
          <div className="space-y-2 text-sm">
            {(analytics?.reasonsBreakdown || []).map((item) => (
              <div
                key={item.reason_code}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-3 py-2"
              >
                <span className="text-zinc-200">{item.reason_code}</span>
                <span className="font-semibold text-white">{item.count}</span>
              </div>
            ))}
            {!analytics?.reasonsBreakdown?.length && <p className="text-zinc-400">No qualification events yet.</p>}
          </div>
        </section>
      </div>

      <div className="text-xs text-zinc-400">{loading ? "Loading..." : null} {error ? <span className="text-red-300">{error}</span> : null}</div>
    </div>
  );
};
