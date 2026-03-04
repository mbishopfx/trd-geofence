import { useMemo } from "react";
import { Activity, Clock, ShieldAlert, Wrench } from "lucide-react";
import { useTrueRankStore } from "../lib/store";

export const FixedOpsSniper = () => {
  const dashboard = useTrueRankStore((s) => s.dashboard);

  const serviceLogs = useMemo(() => {
    return dashboard.liveFeed.slice(0, 8).map((event) => ({
      id: event.id,
      time: new Date(event.timestamp).toLocaleTimeString(),
      location: event.competitorLot,
      action: event.result,
      projected: Math.max(75, Math.round(event.dwellTimeMin * 32)),
      status: `Dwelling (${event.dwellTimeMin}m)`
    }));
  }, [dashboard.liveFeed]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-display text-white">
            <Wrench className="text-yellow-500" /> Fixed Ops Sniper
          </h2>
          <p className="text-sm text-zinc-400">Monitor service-center conquest opportunities from the same geofence feed.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm font-semibold text-yellow-300">
          <Activity size={16} className="animate-pulse" /> Service Feed Active
        </div>
      </div>

      <div className="tr-glass overflow-hidden rounded-xl border border-white/10">
        <div className="border-b border-white/10 bg-black/30 p-4">
          <h3 className="flex items-center gap-2 font-semibold text-white">
            <ShieldAlert className="text-yellow-500" size={18} /> Live Aftermarket Intercepts
          </h3>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-black/20 text-zinc-400">
            <tr>
              <th className="px-6 py-3">Timestamp</th>
              <th className="px-6 py-3">Competitor Bay</th>
              <th className="px-6 py-3">Trigger</th>
              <th className="px-6 py-3">Projected RO</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {serviceLogs.length === 0 && (
              <tr>
                <td className="px-6 py-4 text-zinc-400" colSpan={4}>
                  No tracked events yet. Record impressions/clicks in Command Center to populate this feed.
                </td>
              </tr>
            )}
            {serviceLogs.map((log) => (
              <tr key={log.id} className="hover:bg-black/30">
                <td className="flex items-center gap-2 px-6 py-4 font-mono text-zinc-400">
                  <Clock size={14} />
                  {log.time}
                </td>
                <td className="px-6 py-4 text-white">
                  {log.location}
                  <div className="mt-1 text-xs text-yellow-500">{log.status}</div>
                </td>
                <td className="px-6 py-4 text-tr-secondary">{log.action}</td>
                <td className="px-6 py-4 font-mono text-white">${log.projected.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
