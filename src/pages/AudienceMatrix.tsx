import { useMemo, useState } from "react";
import { CheckCircle2, Code, Copy, MousePointerClick, Radar, UploadCloud, Users } from "lucide-react";
import { useTrueRankStore } from "../lib/store";

export const AudienceMatrix = () => {
  const campaigns = useTrueRankStore((s) => s.campaigns);
  const activeCampaignId = useTrueRankStore((s) => s.activeCampaignId);
  const setActiveCampaign = useTrueRankStore((s) => s.setActiveCampaign);
  const recordEvent = useTrueRankStore((s) => s.recordEvent);

  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "analyzing" | "complete">("idle");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === activeCampaignId) || campaigns[0] || null,
    [campaigns, activeCampaignId]
  );

  const projectedReach = useMemo(() => {
    if (!selectedCampaign) {
      return 0;
    }
    return Math.round(selectedCampaign.dailyBudget * 120);
  }, [selectedCampaign]);

  function simulateUpload() {
    setUploadStatus("analyzing");
    setTimeout(() => setUploadStatus("complete"), 1600);
  }

  async function triggerEvent(type: "impression" | "click") {
    if (!selectedCampaign) {
      return;
    }
    setSending(true);
    try {
      await recordEvent(selectedCampaign.id, type, type === "impression" ? 400 : 12);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-8">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-display text-white">
          <Users className="text-tr-primary" /> Audience Matrix
        </h2>
        <p className="text-sm text-zinc-400">
          CRM ingestion + pixel instrumentation for impressions/click tracking and 14-30 day retargeting pools.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="tr-glass rounded-xl border border-white/10 p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <UploadCloud className="text-tr-secondary" size={20} /> First-Party CRM Match
          </h3>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              simulateUpload();
            }}
            className={`rounded-xl border-2 border-dashed p-8 text-center ${
              isDragging ? "border-tr-secondary bg-tr-secondary/5" : "border-white/15 bg-black/30"
            }`}
          >
            {uploadStatus === "idle" && (
              <button type="button" className="w-full" onClick={simulateUpload}>
                <UploadCloud size={40} className="mx-auto mb-3 text-zinc-400" />
                <p className="font-semibold text-white">Drop CSV / Excel list here</p>
                <p className="mt-1 text-xs text-zinc-400">Email, phone, and VIN-based audiences supported.</p>
              </button>
            )}
            {uploadStatus === "analyzing" && (
              <div className="py-4">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-tr-secondary border-t-transparent" />
                <p className="animate-pulse font-mono text-sm text-tr-secondary">Hashing and matching records...</p>
              </div>
            )}
            {uploadStatus === "complete" && (
              <div className="py-2">
                <CheckCircle2 size={40} className="mx-auto mb-3 text-tr-secondary" />
                <h4 className="text-xl font-bold text-white">Match Rate: 71.8%</h4>
                <p className="mt-1 text-sm text-zinc-400">8,142 uploaded to 5,846 devices available for retargeting.</p>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-zinc-300">
            Estimated reachable devices from selected campaign budget: <span className="font-semibold text-white">{projectedReach.toLocaleString()}</span>
          </div>
        </div>

        <div className="tr-glass flex flex-col rounded-xl border border-white/10 p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <Code className="text-tr-primary" size={20} /> TrueRank Pixel + Event Verification
          </h3>

          <select
            value={selectedCampaign?.id || ""}
            onChange={(event) => setActiveCampaign(event.target.value || null)}
            className="mb-4 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
          >
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>

          <div className="relative flex-1 rounded-lg border border-white/10 bg-[#050505] p-4">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `<script>\nwindow.TrueRank=window.TrueRank||function(){(window.TrueRank.q=window.TrueRank.q||[]).push(arguments)};\nTrueRank('init','ACC_AutoDirect_001');\nTrueRank('track','PageView');\n</script>`
                );
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="absolute right-3 top-3 text-zinc-400 hover:text-white"
            >
              {copied ? <CheckCircle2 size={18} className="text-tr-secondary" /> : <Copy size={18} />}
            </button>
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-tr-secondary">
{`<script>
window.TrueRank=window.TrueRank||function(){(window.TrueRank.q=window.TrueRank.q||[]).push(arguments)};
TrueRank('init', 'ACC_AutoDirect_001');
TrueRank('track', 'PageView');
</script>`}
            </pre>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!selectedCampaign || sending}
              onClick={() => triggerEvent("impression")}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
            >
              <Radar size={14} /> Test Impression
            </button>
            <button
              type="button"
              disabled={!selectedCampaign || sending}
              onClick={() => triggerEvent("click")}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
            >
              <MousePointerClick size={14} /> Test Click
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
