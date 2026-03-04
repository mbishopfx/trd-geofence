import { useEffect, useMemo, useState } from "react";
import {
  FolderKanban,
  LayoutDashboard,
  PenTool,
  Presentation,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  Users,
  Wrench
} from "lucide-react";
import CommandCenter from "./pages/CommandCenter";
import { useTrueRankStore } from "./lib/store";
import { CampaignArchitect } from "./pages/CampaignArchitect";
import { AudienceMatrix } from "./pages/AudienceMatrix";
import { CreativeVault } from "./pages/CreativeVault";
import { FixedOpsSniper } from "./pages/FixedOpsSniper";
import { ROIForecaster } from "./pages/ROIForecaster";

type TabKey =
  | "command-center"
  | "campaign-architect"
  | "audience-matrix"
  | "creative-vault"
  | "fixed-ops-sniper"
  | "roi-forecaster";

const tabs = [
  { key: "command-center", label: "Command Center", icon: LayoutDashboard },
  { key: "campaign-architect", label: "Campaign Architect", icon: PenTool },
  { key: "audience-matrix", label: "Audience Matrix", icon: Users },
  { key: "creative-vault", label: "Creative Vault", icon: FolderKanban },
  { key: "fixed-ops-sniper", label: "Fixed Ops Sniper", icon: Wrench },
  { key: "roi-forecaster", label: "ROI Forecaster", icon: TrendingUp }
] as const;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("command-center");
  const [apiInput, setApiInput] = useState("");

  const apiBaseUrl = useTrueRankStore((s) => s.apiBaseUrl);
  const isPresentationMode = useTrueRankStore((s) => s.isPresentationMode);
  const togglePresentationMode = useTrueRankStore((s) => s.togglePresentationMode);
  const setApiBaseUrl = useTrueRankStore((s) => s.setApiBaseUrl);
  const bootstrap = useTrueRankStore((s) => s.bootstrap);
  const setup = useTrueRankStore((s) => s.setup);

  useEffect(() => {
    setApiInput(apiBaseUrl);
  }, [apiBaseUrl]);

  useEffect(() => {
    bootstrap().catch(() => {});
  }, [bootstrap]);

  const activeTitle = useMemo(() => tabs.find((tab) => tab.key === activeTab)?.label ?? "TrueRankDigital", [activeTab]);

  async function reconnect(): Promise<void> {
    setApiBaseUrl(apiInput);
    await bootstrap();
  }

  return (
    <div className="min-h-screen bg-tr-bg text-zinc-100">
      <div className="relative mx-auto flex min-h-screen max-w-[1600px] gap-6 p-5 md:p-8">
        <aside className="tr-glass sticky top-6 hidden h-[calc(100vh-3rem)] w-72 shrink-0 flex-col rounded-3xl p-5 lg:flex">
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-tr-primary/30 bg-tr-primary/10 px-3 py-1 text-xs uppercase tracking-widest text-tr-primary">
              <ShieldCheck className="h-3.5 w-3.5" /> Proprietary DSP
            </div>
            <h1 className="mt-4 text-2xl font-display leading-tight text-white">
              TrueRankDigital <span className="block text-tr-primary">Geo-Conquest Engine</span>
            </h1>
            {!isPresentationMode && (
              <p className="mt-3 text-xs text-zinc-400">Built for ACC/AutoDirect dealership conquest + home-fencing workflows.</p>
            )}
            {setup && <p className="mt-2 text-xs text-zinc-500">Requester: {setup.requestedBy}</p>}
          </div>

          <nav className="space-y-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as TabKey)}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${
                    isActive
                      ? "bg-tr-primary/20 text-white ring-1 ring-tr-primary/40"
                      : "text-zinc-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className={`h-4.5 w-4.5 ${isActive ? "text-tr-primary" : "text-zinc-400"}`} />
                  <span className="text-sm">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="tr-glass mb-6 rounded-2xl p-4">
            <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-400">Control Surface</p>
                <h2 className="font-display text-2xl text-white">{activeTitle}</h2>
              </div>
              <button
                onClick={togglePresentationMode}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${
                  isPresentationMode
                    ? "bg-tr-secondary/20 text-tr-secondary ring-1 ring-tr-secondary/40"
                    : "bg-white/5 text-zinc-200 ring-1 ring-white/10"
                }`}
              >
                <Presentation className="h-4 w-4" /> Presentation Mode {isPresentationMode ? "On" : "Off"}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr,auto]">
              <input
                value={apiInput}
                onChange={(event) => setApiInput(event.target.value)}
                className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                placeholder="Backend API base URL"
              />
              <button
                type="button"
                onClick={() => {
                  reconnect().catch(() => {});
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200"
              >
                <RefreshCcw size={15} /> Reconnect API
              </button>
            </div>
          </header>

          {activeTab === "command-center" && <CommandCenter />}
          {activeTab === "campaign-architect" && <CampaignArchitect />}
          {activeTab === "audience-matrix" && <AudienceMatrix />}
          {activeTab === "creative-vault" && <CreativeVault />}
          {activeTab === "fixed-ops-sniper" && <FixedOpsSniper />}
          {activeTab === "roi-forecaster" && <ROIForecaster />}
        </main>
      </div>
    </div>
  );
}
