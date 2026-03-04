import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, RefreshCcw } from "lucide-react";
import { apiRequest } from "../lib/api";
import { useTrueRankStore } from "../lib/store";

type FeedMonitorResponse = {
  ok: boolean;
  tenantId: string;
  throughput: {
    ingested_last_hour: number;
    ingested_last_day: number;
    unique_devices_day: number;
  };
  deadLetters: Array<{ reason: string; count: number }>;
  queueDepth: {
    ingest: number;
    qualify: number;
    activation: number;
  };
};

export default function PartnerFeedMonitor() {
  const apiBaseUrl = useTrueRankStore((s) => s.apiBaseUrl);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [monitor, setMonitor] = useState<FeedMonitorResponse | null>(null);

  const loadMonitor = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<FeedMonitorResponse>("/api/ingest/monitor", {}, apiBaseUrl);
      setMonitor(response);
    } catch (loadError) {
      if (loadError instanceof Error) {
        setError(loadError.message);
      } else {
        setError("Failed to load partner feed monitor.");
      }
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    loadMonitor().catch(() => {});

    const timer = setInterval(() => {
      loadMonitor().catch(() => {});
    }, 30000);

    return () => clearInterval(timer);
  }, [loadMonitor]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-display text-white">Partner Feed Monitor</h2>
          <p className="text-sm text-zinc-400">Ingest throughput, queue depth, and dead-letter triage.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            loadMonitor().catch(() => {});
          }}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
        >
          <RefreshCcw size={14} /> {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Ingested (Last Hour)</p>
          <p className="mt-2 text-3xl font-display text-white">{monitor?.throughput.ingested_last_hour || 0}</p>
        </article>
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Ingested (Last Day)</p>
          <p className="mt-2 text-3xl font-display text-white">{monitor?.throughput.ingested_last_day || 0}</p>
        </article>
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Unique Devices (Day)</p>
          <p className="mt-2 text-3xl font-display text-white">{monitor?.throughput.unique_devices_day || 0}</p>
        </article>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-zinc-300">
            <Activity size={14} className="text-tr-primary" /> Queue Depth
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span className="text-zinc-200">Ingest Queue</span>
              <span className="font-semibold text-white">{monitor?.queueDepth.ingest || 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span className="text-zinc-200">Qualification Queue</span>
              <span className="font-semibold text-white">{monitor?.queueDepth.qualify || 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span className="text-zinc-200">Activation Queue</span>
              <span className="font-semibold text-white">{monitor?.queueDepth.activation || 0}</span>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-zinc-300">
            <AlertTriangle size={14} className="text-amber-300" /> Dead Letters (24h)
          </h3>
          <div className="space-y-2 text-sm">
            {(monitor?.deadLetters || []).map((item) => (
              <div key={item.reason} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <span className="text-zinc-200">{item.reason}</span>
                <span className="font-semibold text-white">{item.count}</span>
              </div>
            ))}
            {!monitor?.deadLetters?.length && <p className="text-zinc-400">No dead-letter events in the selected window.</p>}
          </div>
        </section>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-zinc-300">
        Suggested webhook payload keys: <code>externalEventId</code>, <code>deviceId</code>, <code>timestamp</code>, <code>lat</code>, <code>lng</code>, <code>speedMph</code>, <code>accuracyM</code>.
      </div>

      <div className="text-xs text-zinc-400">{error ? <span className="text-red-300">{error}</span> : null}</div>
    </div>
  );
}
