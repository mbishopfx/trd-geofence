import { useMemo, useState } from "react";
import { ArrowRight, Image as ImageIcon, Layout, Sparkles, Video } from "lucide-react";
import { useTrueRankStore } from "../lib/store";

type AssetStatus = "missing" | "ready";

export const CreativeVault = () => {
  const creativeRequirements = useTrueRankStore((s) => s.creativeRequirements);
  const campaigns = useTrueRankStore((s) => s.campaigns);
  const activeCampaignId = useTrueRankStore((s) => s.activeCampaignId);

  const [assets, setAssets] = useState<Record<string, AssetStatus>>({
    "cr-300x250": "ready",
    "cr-728x90": "ready",
    "cr-320x50": "ready",
    "cr-1080x1080": "missing",
    "cr-rda": "missing"
  });

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === activeCampaignId) || campaigns[0] || null,
    [campaigns, activeCampaignId]
  );

  const readyCount = useMemo(
    () => creativeRequirements.filter((item) => assets[item.id] === "ready").length,
    [creativeRequirements, assets]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-display text-white">
            <Layout className="text-tr-primary" /> Creative Vault
          </h2>
          <p className="text-sm text-zinc-400">
            Asset readiness for launch message: "NO GAMES - Just Honest Pricing and Extraordinary Service".
          </p>
        </div>
        <button className="rounded-lg border border-tr-secondary/50 bg-tr-secondary/10 px-4 py-2 text-sm font-semibold text-tr-secondary">
          <span className="inline-flex items-center gap-2">
            <Sparkles size={16} /> Request Variants
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[2fr,1fr]">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {creativeRequirements.map((asset) => {
            const status = assets[asset.id] || "missing";
            const isVideo = asset.channel.toLowerCase().includes("youtube") || asset.label.toLowerCase().includes("video");

            return (
              <article
                key={asset.id}
                className="tr-glass rounded-xl border border-white/10 p-5 transition-colors hover:border-tr-primary/40"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="rounded-full bg-black/30 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
                    {asset.channel}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-wider ${
                      status === "ready" ? "bg-tr-secondary/20 text-tr-secondary" : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {status === "ready" ? "Ready" : "Missing"}
                  </span>
                </div>
                <div className="mb-3 flex h-24 items-center justify-center rounded-lg border border-dashed border-white/15 bg-black/25">
                  {isVideo ? <Video size={28} className="text-zinc-500" /> : <ImageIcon size={28} className="text-zinc-500" />}
                </div>
                <h4 className="text-sm font-semibold text-white">{asset.label}</h4>
                <p className="mt-1 text-xs text-zinc-400">{asset.size}</p>
                <button
                  type="button"
                  onClick={() =>
                    setAssets((current) => ({
                      ...current,
                      [asset.id]: current[asset.id] === "ready" ? "missing" : "ready"
                    }))
                  }
                  className="mt-3 rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-200"
                >
                  Toggle Status
                </button>
              </article>
            );
          })}
        </div>

        <aside className="tr-glass h-fit rounded-xl border border-white/10 p-5 lg:sticky lg:top-24">
          <p className="text-xs uppercase tracking-[0.15em] text-zinc-400">Launch Readiness</p>
          <p className="mt-2 text-3xl font-black text-white">
            {readyCount}/{creativeRequirements.length}
          </p>
          <p className="text-sm text-zinc-400">Required assets ready</p>

          <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-zinc-300">
            {selectedCampaign ? (
              <>
                <p className="font-semibold text-white">Current campaign</p>
                <p className="mt-1">{selectedCampaign.name}</p>
                <p className="mt-1 text-zinc-400">Platforms: {selectedCampaign.platforms.join(", ")}</p>
              </>
            ) : (
              <p>No active campaign selected.</p>
            )}
          </div>

          <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-tr-primary py-2 text-sm font-semibold text-white">
            Deploy Assets <ArrowRight size={15} />
          </button>
        </aside>
      </div>
    </div>
  );
};
