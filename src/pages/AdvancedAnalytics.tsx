import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Gauge, MapPinned, RefreshCcw, Save, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { apiRequest } from "../lib/api";
import { useTrueRankStore } from "../lib/store";

type AdvancedAnalyticsResponse = {
  ok: boolean;
  tenantId: string;
  campaignId: string;
  campaignName: string;
  from: string;
  to: string;
  funnel: {
    eventsEvaluated: number;
    qualifiedDevices: number;
    activeAudience: number;
    convertedDevices: number;
    conversionRatePct: number;
    avgHoursToConvert: number;
  };
  dailyTrend: Array<{
    day: string;
    qualifiedDevices: number;
    convertedDevices: number;
    conversionRatePct: number;
  }>;
  zoneBreakdown: Array<{
    zoneId: string;
    zoneName: string;
    zoneType: string;
    conversions: number;
    uniqueDevices: number;
    avgHoursToConvert: number;
  }>;
  latencyBuckets: Array<{ bucket: string; count: number }>;
  hourly: Array<{ hour: number; count: number }>;
  topReasons: Array<{ reason_code: string; count: number }>;
  zones: Array<{
    id: string;
    name: string;
    zone_type: string;
    shape_type: string;
    radius_miles: number | null;
    center_lat: number | null;
    center_lng: number | null;
  }>;
};

type ConversionZonesResponse = {
  ok: boolean;
  campaignId: string;
  zones: Array<{
    id: string;
    name: string;
    zone_type: string;
    shape_type: string;
    radius_miles: number | null;
    center_lat: number | null;
    center_lng: number | null;
  }>;
};

function toDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  return `${Number(value || 0).toFixed(2)}%`;
}

export default function AdvancedAnalytics() {
  const apiBaseUrl = useTrueRankStore((s) => s.apiBaseUrl);
  const campaigns = useTrueRankStore((s) => s.campaigns);
  const activeCampaignId = useTrueRankStore((s) => s.activeCampaignId);
  const setActiveCampaign = useTrueRankStore((s) => s.setActiveCampaign);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === activeCampaignId) || campaigns[0] || null,
    [campaigns, activeCampaignId]
  );

  const [from, setFrom] = useState(() => toDateTimeLocalValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toDateTimeLocalValue(new Date()));
  const [operatorKey, setOperatorKey] = useState("");
  const [analytics, setAnalytics] = useState<AdvancedAnalyticsResponse | null>(null);
  const [zones, setZones] = useState<ConversionZonesResponse["zones"]>([]);
  const [loading, setLoading] = useState(false);
  const [runningAttribution, setRunningAttribution] = useState(false);
  const [savingZone, setSavingZone] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [zoneName, setZoneName] = useState("Showroom Visit Zone");
  const [zoneType, setZoneType] = useState("sales");
  const [zoneLat, setZoneLat] = useState("33.8806084");
  const [zoneLng, setZoneLng] = useState("-98.5460791");
  const [zoneRadiusMiles, setZoneRadiusMiles] = useState("0.4");

  const loadData = useCallback(async () => {
    if (!selectedCampaign) {
      setAnalytics(null);
      setZones([]);
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(to).toISOString();
      const [analyticsResponse, zonesResponse] = await Promise.all([
        apiRequest<AdvancedAnalyticsResponse>(
          `/api/analytics/advanced?campaignId=${encodeURIComponent(selectedCampaign.id)}&from=${encodeURIComponent(
            fromIso
          )}&to=${encodeURIComponent(toIso)}`,
          {},
          apiBaseUrl
        ),
        apiRequest<ConversionZonesResponse>(`/api/conversion-zones/${selectedCampaign.id}`, {}, apiBaseUrl)
      ]);

      setAnalytics(analyticsResponse);
      setZones(zonesResponse.zones || []);
    } catch (loadError) {
      if (loadError instanceof Error) {
        setError(loadError.message);
      } else {
        setError("Failed to load advanced analytics.");
      }
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, from, selectedCampaign, to]);

  async function runAttributionNow() {
    if (!selectedCampaign) {
      return;
    }

    setRunningAttribution(true);
    setError("");
    setMessage("");
    try {
      const response = await apiRequest<{
        ok: boolean;
        scannedEvents: number;
        conversionsAttributed: number;
      }>(
        "/api/analytics/conversion-zones/run",
        {
          method: "POST",
          headers: operatorKey ? { "x-operator-key": operatorKey } : {},
          body: JSON.stringify({
            campaignId: selectedCampaign.id,
            from: new Date(from).toISOString(),
            to: new Date(to).toISOString()
          })
        },
        apiBaseUrl
      );

      setMessage(
        `Attribution run complete. Scanned ${formatInteger(response.scannedEvents)} events and attributed ${formatInteger(
          response.conversionsAttributed
        )} conversions.`
      );
      await loadData();
    } catch (runError) {
      if (runError instanceof Error) {
        setError(runError.message);
      } else {
        setError("Failed to run conversion attribution.");
      }
    } finally {
      setRunningAttribution(false);
    }
  }

  async function saveZoneNow() {
    if (!selectedCampaign) {
      return;
    }

    setSavingZone(true);
    setError("");
    setMessage("");
    try {
      await apiRequest<ConversionZonesResponse>(
        "/api/conversion-zones",
        {
          method: "POST",
          headers: operatorKey ? { "x-operator-key": operatorKey } : {},
          body: JSON.stringify({
            campaignId: selectedCampaign.id,
            zone: {
              name: zoneName,
              zoneType,
              shapeType: "radius",
              centerLat: Number(zoneLat),
              centerLng: Number(zoneLng),
              radiusMiles: Number(zoneRadiusMiles)
            }
          })
        },
        apiBaseUrl
      );

      setMessage("Conversion zone saved.");
      await loadData();
    } catch (saveError) {
      if (saveError instanceof Error) {
        setError(saveError.message);
      } else {
        setError("Failed to save conversion zone.");
      }
    } finally {
      setSavingZone(false);
    }
  }

  useEffect(() => {
    if (!activeCampaignId && campaigns.length > 0) {
      setActiveCampaign(campaigns[0].id);
    }
  }, [activeCampaignId, campaigns, setActiveCampaign]);

  useEffect(() => {
    loadData().catch(() => {});
  }, [loadData]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-display text-white">
            <BarChart3 className="text-tr-primary" /> Advanced Analytics
          </h2>
          <p className="text-sm text-zinc-400">
            Conversion-zone tracking, attribution funnel, and campaign intelligence charts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadData()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
        >
          <RefreshCcw size={14} /> {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Operator Key (optional)</label>
            <input
              value={operatorKey}
              onChange={(event) => setOperatorKey(event.target.value)}
              placeholder="x-operator-key"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => {
                runAttributionNow().catch(() => {});
              }}
              disabled={runningAttribution || !selectedCampaign}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-tr-secondary px-3 py-2 text-xs font-semibold text-black disabled:opacity-60"
            >
              <Gauge size={14} /> {runningAttribution ? "Running..." : "Run Attribution"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Events Evaluated</p>
          <p className="mt-2 text-2xl font-display text-white">{formatInteger(analytics?.funnel.eventsEvaluated || 0)}</p>
        </article>
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Qualified Devices</p>
          <p className="mt-2 text-2xl font-display text-white">{formatInteger(analytics?.funnel.qualifiedDevices || 0)}</p>
        </article>
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Active Audience</p>
          <p className="mt-2 text-2xl font-display text-white">{formatInteger(analytics?.funnel.activeAudience || 0)}</p>
        </article>
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Converted Devices</p>
          <p className="mt-2 text-2xl font-display text-white">{formatInteger(analytics?.funnel.convertedDevices || 0)}</p>
        </article>
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Conversion Rate</p>
          <p className="mt-2 text-2xl font-display text-white">{formatPercent(analytics?.funnel.conversionRatePct || 0)}</p>
        </article>
        <article className="tr-glass rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Avg Hours to Convert</p>
          <p className="mt-2 text-2xl font-display text-white">{Number(analytics?.funnel.avgHoursToConvert || 0).toFixed(2)}</p>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-zinc-300">
            <TrendingUp size={14} className="text-tr-primary" /> Qualification vs Conversion Trend
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics?.dailyTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="day" stroke="#a3a3a3" tick={{ fontSize: 11 }} />
                <YAxis stroke="#a3a3a3" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: "#111111", border: "1px solid #2f2f2f" }} />
                <Legend />
                <Line type="monotone" dataKey="qualifiedDevices" stroke="#e60000" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="convertedDevices" stroke="#00e676" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 text-sm uppercase tracking-wider text-zinc-300">Conversion Zones Performance</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics?.zoneBreakdown || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="zoneName" stroke="#a3a3a3" tick={{ fontSize: 11 }} />
                <YAxis stroke="#a3a3a3" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: "#111111", border: "1px solid #2f2f2f" }} />
                <Legend />
                <Bar dataKey="conversions" fill="#e60000" radius={[4, 4, 0, 0]} />
                <Bar dataKey="uniqueDevices" fill="#00e676" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 text-sm uppercase tracking-wider text-zinc-300">Time-to-Conversion Buckets</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics?.latencyBuckets || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="bucket" stroke="#a3a3a3" tick={{ fontSize: 11 }} />
                <YAxis stroke="#a3a3a3" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: "#111111", border: "1px solid #2f2f2f" }} />
                <Bar dataKey="count" fill="#22d3ee" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 text-sm uppercase tracking-wider text-zinc-300">Conversion Hour Distribution</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics?.hourly || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="hour" stroke="#a3a3a3" tick={{ fontSize: 11 }} />
                <YAxis stroke="#a3a3a3" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: "#111111", border: "1px solid #2f2f2f" }} />
                <Bar dataKey="count" fill="#a78bfa" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-zinc-300">
            <MapPinned size={14} className="text-tr-primary" /> Conversion Zones
          </h3>
          <div className="mb-4 max-h-56 space-y-2 overflow-auto">
            {zones.map((zone) => (
              <div key={zone.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">
                <div className="font-semibold text-white">{zone.name}</div>
                <div className="text-xs text-zinc-400">
                  {zone.zone_type} • {zone.shape_type} • {zone.radius_miles ? `${zone.radius_miles} mi` : "polygon"}
                </div>
              </div>
            ))}
            {zones.length === 0 && <p className="text-sm text-zinc-400">No zones configured yet.</p>}
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={zoneName}
              onChange={(event) => setZoneName(event.target.value)}
              placeholder="Zone name"
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
            <select
              value={zoneType}
              onChange={(event) => setZoneType(event.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            >
              <option value="sales">Sales</option>
              <option value="service">Service</option>
              <option value="parts">Parts</option>
            </select>
            <input
              value={zoneLat}
              onChange={(event) => setZoneLat(event.target.value)}
              placeholder="Center lat"
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
            <input
              value={zoneLng}
              onChange={(event) => setZoneLng(event.target.value)}
              placeholder="Center lng"
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
            <input
              value={zoneRadiusMiles}
              onChange={(event) => setZoneRadiusMiles(event.target.value)}
              placeholder="Radius miles"
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              onClick={() => {
                saveZoneNow().catch(() => {});
              }}
              disabled={savingZone || !selectedCampaign}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300 disabled:opacity-60"
            >
              <Save size={14} /> {savingZone ? "Saving..." : "Save Zone"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="mb-3 text-sm uppercase tracking-wider text-zinc-300">Top Qualification Reason Codes</h3>
          <div className="space-y-2">
            {(analytics?.topReasons || []).map((item) => (
              <div key={item.reason_code} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <span className="text-zinc-200">{item.reason_code}</span>
                <span className="font-semibold text-white">{formatInteger(item.count)}</span>
              </div>
            ))}
            {!analytics?.topReasons?.length && <p className="text-sm text-zinc-400">No qualification reason data in this window.</p>}
          </div>
        </section>
      </div>

      <div className="text-xs text-zinc-400">
        {message ? <span className="text-emerald-300">{message}</span> : null}
        {message && error ? " " : null}
        {error ? <span className="text-red-300">{error}</span> : null}
      </div>
    </div>
  );
}
