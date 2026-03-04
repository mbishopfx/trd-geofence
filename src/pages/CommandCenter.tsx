import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRightLeft, Crosshair, MousePointerClick, Radar, RefreshCcw } from "lucide-react";
import { useTrueRankStore } from "../lib/store";

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

export default function CommandCenter() {
  const campaigns = useTrueRankStore((s) => s.campaigns);
  const dashboard = useTrueRankStore((s) => s.dashboard);
  const activeCampaignId = useTrueRankStore((s) => s.activeCampaignId);
  const loading = useTrueRankStore((s) => s.loading);
  const error = useTrueRankStore((s) => s.error);
  const lastSyncAt = useTrueRankStore((s) => s.lastSyncAt);
  const bootstrap = useTrueRankStore((s) => s.bootstrap);
  const refreshDashboard = useTrueRankStore((s) => s.refreshDashboard);
  const recordEvent = useTrueRankStore((s) => s.recordEvent);
  const simulateCampaign = useTrueRankStore((s) => s.simulateCampaign);
  const setActiveCampaign = useTrueRankStore((s) => s.setActiveCampaign);

  const [isSendingEvent, setIsSendingEvent] = useState(false);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === activeCampaignId) || campaigns[0] || null,
    [campaigns, activeCampaignId]
  );

  useEffect(() => {
    bootstrap().catch(() => {});
  }, [bootstrap]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshDashboard().catch(() => {});
    }, 20000);

    return () => clearInterval(interval);
  }, [refreshDashboard]);

  useEffect(() => {
    if (!activeCampaignId && campaigns.length > 0) {
      setActiveCampaign(campaigns[0].id);
    }
  }, [activeCampaignId, campaigns, setActiveCampaign]);

  const cards = [
    { title: "Active Fences", value: formatInteger(dashboard.activeFences), icon: Crosshair },
    { title: "Impressions", value: formatInteger(dashboard.totalImpressions), icon: Radar },
    { title: "Clicks", value: formatInteger(dashboard.totalClicks), icon: MousePointerClick },
    { title: "CTR", value: `${dashboard.ctr.toFixed(2)}%`, icon: Activity }
  ];

  async function handleEvent(type: "impression" | "click", count: number): Promise<void> {
    if (!selectedCampaign) {
      return;
    }

    setIsSendingEvent(true);
    try {
      await recordEvent(selectedCampaign.id, type, count);
    } finally {
      setIsSendingEvent(false);
    }
  }

  async function handleSimulation(): Promise<void> {
    if (!selectedCampaign) {
      return;
    }

    setIsSendingEvent(true);
    try {
      await simulateCampaign(selectedCampaign.id, 6);
    } finally {
      setIsSendingEvent(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.title} className="tr-glass rounded-2xl p-4">
              <div className="mb-4 flex items-start justify-between">
                <p className="text-sm text-zinc-300">{card.title}</p>
                <div className="flex items-center gap-2">
                  <span className="live-dot" />
                  <span className="text-xs uppercase tracking-[0.18em] text-tr-secondary">Live</span>
                </div>
              </div>
              <div className="flex items-end justify-between">
                <p className="font-display text-3xl leading-none text-white">{card.value}</p>
                <Icon className="h-5 w-5 text-zinc-400" />
              </div>
            </article>
          );
        })}
      </div>

      <div className="tr-glass rounded-2xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl text-white">Live Conquest Tracking</h3>
            <p className="text-sm text-zinc-400">
              Focus metrics: impressions, clicks, CTR, and projected walk-ins. Total spend {formatCurrency(dashboard.totalSpend)}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshDashboard()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-xs text-zinc-200 hover:text-white"
          >
            <RefreshCcw size={14} /> Refresh
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
          <div className="overflow-auto rounded-xl border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-widest text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Device</th>
                  <th className="px-4 py-3">Velocity</th>
                  <th className="px-4 py-3">Dwell</th>
                  <th className="px-4 py-3">Result</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.liveFeed.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-zinc-400" colSpan={4}>
                      No activity yet. Launch a campaign and send traffic events.
                    </td>
                  </tr>
                )}
                {dashboard.liveFeed.map((event) => (
                  <tr key={event.id} className="border-t border-white/10 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium text-white">#{event.deviceId}</td>
                    <td className="px-4 py-3 text-zinc-300">{event.velocityMph} mph</td>
                    <td className="px-4 py-3 text-zinc-300">{event.dwellTimeMin} min</td>
                    <td className="px-4 py-3 text-zinc-100">{event.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.15em] text-zinc-400">Conquest Leaderboard</p>
              <div className="space-y-3">
                {dashboard.leaderboard.length === 0 && <p className="text-sm text-zinc-400">No campaigns tracked yet.</p>}
                {dashboard.leaderboard.map((item) => {
                  const width = Math.min(100, item.ctr * 12);
                  return (
                    <div key={item.campaignId}>
                      <div className="mb-1 flex items-center justify-between text-xs text-zinc-300">
                        <span>{item.campaignName}</span>
                        <span>{item.ctr.toFixed(2)}% CTR</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-800">
                        <div className="h-2 rounded-full bg-tr-primary" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.15em] text-zinc-400">Traffic Simulator</p>
              <select
                value={selectedCampaign?.id || ""}
                onChange={(event) => setActiveCampaign(event.target.value || null)}
                className="mb-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              >
                {campaigns.length === 0 && <option value="">No campaigns</option>}
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name} ({campaign.status})
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!selectedCampaign || isSendingEvent}
                  onClick={() => handleEvent("impression", 500)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-zinc-200 hover:text-white disabled:opacity-60"
                >
                  +500 Impressions
                </button>
                <button
                  type="button"
                  disabled={!selectedCampaign || isSendingEvent}
                  onClick={() => handleEvent("click", 20)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-zinc-200 hover:text-white disabled:opacity-60"
                >
                  +20 Clicks
                </button>
                <button
                  type="button"
                  disabled={!selectedCampaign || isSendingEvent}
                  onClick={handleSimulation}
                  className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-tr-secondary px-2 py-2 text-xs font-semibold text-black disabled:opacity-60"
                >
                  Run Simulation Burst <ArrowRightLeft size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 text-xs text-zinc-400">
          {loading ? "Loading..." : null}
          {error ? <span className="text-red-300">{error}</span> : null}
          {!loading && !error && lastSyncAt ? <span>Last sync: {new Date(lastSyncAt).toLocaleString()}</span> : null}
        </div>
      </div>
    </section>
  );
}
