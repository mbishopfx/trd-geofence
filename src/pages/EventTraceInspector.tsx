import { useMemo, useState } from "react";
import { Search, RefreshCcw } from "lucide-react";
import { apiRequest } from "../lib/api";
import { useTrueRankStore } from "../lib/store";

type TraceRow = {
  id: number;
  device_id_hash: string;
  geofence_id: string;
  event_time: string;
  inside: boolean;
  dwell_minutes: number;
  velocity_mph: number;
  qualified: boolean;
  reason_code: string;
  trace_json: Record<string, unknown>;
};

type TraceAnalyticsResponse = {
  ok: boolean;
  campaignId: string;
  reasonsBreakdown: Array<{ reason_code: string; count: number }>;
  traces: TraceRow[];
};

export default function EventTraceInspector() {
  const apiBaseUrl = useTrueRankStore((s) => s.apiBaseUrl);
  const campaigns = useTrueRankStore((s) => s.campaigns);
  const activeCampaignId = useTrueRankStore((s) => s.activeCampaignId);
  const setActiveCampaign = useTrueRankStore((s) => s.setActiveCampaign);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === activeCampaignId) || campaigns[0] || null,
    [campaigns, activeCampaignId]
  );

  const [deviceIdHash, setDeviceIdHash] = useState("");
  const [fenceId, setFenceId] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<TraceAnalyticsResponse | null>(null);

  async function loadTraces() {
    if (!selectedCampaign) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("campaignId", selectedCampaign.id);
      params.set("from", new Date(from).toISOString());
      params.set("to", new Date(to).toISOString());
      params.set("limit", "300");
      if (deviceIdHash.trim()) {
        params.set("deviceIdHash", deviceIdHash.trim());
      }
      if (fenceId.trim()) {
        params.set("fenceId", fenceId.trim());
      }

      const response = await apiRequest<TraceAnalyticsResponse>(
        `/api/analytics/qualification?${params.toString()}`,
        {},
        apiBaseUrl
      );
      setData(response);
    } catch (loadError) {
      if (loadError instanceof Error) {
        setError(loadError.message);
      } else {
        setError("Failed to load traces.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <div>
        <h2 className="text-2xl font-display text-white">Event Trace Inspector</h2>
        <p className="text-sm text-zinc-400">Inspect per-device qualification decisions and reason codes.</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Device Hash</label>
            <input
              value={deviceIdHash}
              onChange={(event) => setDeviceIdHash(event.target.value)}
              placeholder="optional"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Fence ID</label>
            <input
              value={fenceId}
              onChange={(event) => setFenceId(event.target.value)}
              placeholder="optional"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => {
                loadTraces().catch(() => {});
              }}
              disabled={loading || !selectedCampaign}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-tr-secondary px-3 py-2 text-xs font-semibold text-black disabled:opacity-60"
            >
              <Search size={14} /> {loading ? "Loading..." : "Run Query"}
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">From</label>
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">To</label>
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px,1fr]">
        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm uppercase tracking-wider text-zinc-300">Reason Codes</h3>
            <button
              type="button"
              onClick={() => {
                loadTraces().catch(() => {});
              }}
              className="inline-flex items-center gap-1 text-xs text-zinc-300"
            >
              <RefreshCcw size={12} /> Refresh
            </button>
          </div>
          <div className="space-y-2 text-sm">
            {(data?.reasonsBreakdown || []).map((item) => (
              <div key={item.reason_code} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <span className="text-zinc-200">{item.reason_code}</span>
                <span className="font-semibold text-white">{item.count}</span>
              </div>
            ))}
            {!data?.reasonsBreakdown?.length && <p className="text-zinc-400">No reason data loaded.</p>}
          </div>
        </section>

        <section className="overflow-auto rounded-xl border border-white/10 bg-black/30">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Fence</th>
                <th className="px-3 py-2">Inside</th>
                <th className="px-3 py-2">Dwell</th>
                <th className="px-3 py-2">Velocity</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(data?.traces || []).map((trace) => (
                <tr key={trace.id} className="border-t border-white/10">
                  <td className="px-3 py-2 text-zinc-300">{new Date(trace.event_time).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-300">{trace.device_id_hash.slice(0, 10)}...</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-300">{trace.geofence_id}</td>
                  <td className="px-3 py-2 text-zinc-200">{trace.inside ? "yes" : "no"}</td>
                  <td className="px-3 py-2 text-zinc-200">{trace.dwell_minutes.toFixed(2)}m</td>
                  <td className="px-3 py-2 text-zinc-200">{trace.velocity_mph?.toFixed(2)} mph</td>
                  <td className="px-3 py-2 text-zinc-100">{trace.reason_code}</td>
                </tr>
              ))}
              {!data?.traces?.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-5 text-zinc-400">
                    No traces loaded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <div className="text-xs text-zinc-400">{error ? <span className="text-red-300">{error}</span> : null}</div>
    </div>
  );
}
