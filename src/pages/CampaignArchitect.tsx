import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet-draw";
import { CheckCircle2, Crosshair, Link2, Rocket, Save, SlidersHorizontal, Wrench, X } from "lucide-react";
import { apiRequest } from "../lib/api";
import { type SetupLocation, useTrueRankStore } from "../lib/store";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png"
});

const fixedOpsIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const platformLabels: Record<string, string> = {
  "specialized-dsp": "Specialized Geo DSP",
  google: "Google Ads",
  meta: "Meta Ads"
};

function offsetPoint(base: { lat: number; lng: number }, latOffset: number, lngOffset: number) {
  return [base.lat + latOffset, base.lng + lngOffset] as [number, number];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function CampaignArchitect() {
  const setup = useTrueRankStore((s) => s.setup);
  const campaigns = useTrueRankStore((s) => s.campaigns);
  const apiBaseUrl = useTrueRankStore((s) => s.apiBaseUrl);
  const platformOptions = useTrueRankStore((s) => s.platformOptions);
  const loading = useTrueRankStore((s) => s.loading);
  const launchCampaign = useTrueRankStore((s) => s.launchCampaign);
  const activationChecklist = useTrueRankStore((s) => s.activationChecklist);
  const refreshDashboard = useTrueRankStore((s) => s.refreshDashboard);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const contextLayerRef = useRef<L.LayerGroup | null>(null);
  const fixedOpsLayerRef = useRef<L.LayerGroup | null>(null);

  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [fixedOpsActive, setFixedOpsActive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [drawnCoords, setDrawnCoords] = useState<Array<{ lat: number; lng: number }>>([]);
  const [launchMessage, setLaunchMessage] = useState<string>("");
  const [isPushingGoogle, setIsPushingGoogle] = useState(false);
  const [googlePushMessage, setGooglePushMessage] = useState("");
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [ruleSaveMessage, setRuleSaveMessage] = useState("");
  const [ruleCampaignId, setRuleCampaignId] = useState<string>("");

  const [campaignName, setCampaignName] = useState("Q2 Honest Pricing Conquest");
  const [dailyBudget, setDailyBudget] = useState(150);
  const [retargetDays, setRetargetDays] = useState(21);
  const [radiusFeet, setRadiusFeet] = useState(450);
  const [dwellTime, setDwellTime] = useState(12);
  const [velocityMax, setVelocityMax] = useState(6);
  const [accuracyMaxM, setAccuracyMaxM] = useState(100);
  const [cooldownHours, setCooldownHours] = useState(24);
  const [sessionBoundaryMin, setSessionBoundaryMin] = useState(20);
  const [lateGraceMin, setLateGraceMin] = useState(30);
  const [message, setMessage] = useState("NO GAMES - Just Honest Pricing and Extraordinary Service");
  const [ctaUrl, setCtaUrl] = useState("https://autodirect.example.com/schedule-test-drive");
  const [platforms, setPlatforms] = useState<Record<string, boolean>>({
    "specialized-dsp": true,
    google: true,
    meta: true
  });

  const [competitorAddresses, setCompetitorAddresses] = useState<Record<string, string>>({});
  const [competitorFenceModes, setCompetitorFenceModes] = useState<Record<string, "radius" | "polygon">>({});

  const selectedLocation = useMemo<SetupLocation | null>(() => {
    if (!setup) {
      return null;
    }
    return setup.locations.find((location) => location.id === selectedLocationId) || setup.locations[0] || null;
  }, [setup, selectedLocationId]);

  const linkedGoogleCampaign = useMemo(
    () =>
      campaigns.find(
        (campaign) => campaign.integration?.source === "google_ads" && Boolean(campaign.integration?.googleCampaignId)
      ) || null,
    [campaigns]
  );

  useEffect(() => {
    if (!setup || setup.locations.length === 0) {
      return;
    }

    setSelectedLocationId((current) => current || setup.locations[0].id);

    setCompetitorAddresses((current) => {
      const next = { ...current };
      for (const location of setup.locations) {
        for (const competitor of location.competitorSuggestions) {
          const key = `${location.id}:${competitor.name}`;
          if (!(key in next)) {
            next[key] = competitor.address.startsWith("TBD") ? "" : competitor.address;
          }
        }
      }
      return next;
    });

    setCompetitorFenceModes((current) => {
      const next = { ...current };
      for (const location of setup.locations) {
        for (const competitor of location.competitorSuggestions) {
          const key = `${location.id}:${competitor.name}`;
          if (!(key in next)) {
            next[key] = "radius";
          }
        }
      }
      return next;
    });

    setRadiusFeet(setup.fenceRecommendations.defaultFeet);
    setDwellTime(setup.fenceRecommendations.dwellTimeMin);
    setVelocityMax(setup.fenceRecommendations.velocityMaxMph);
    setRetargetDays(setup.fenceRecommendations.retargetDays.default);
    setMessage(setup.defaultMessage);
  }, [setup]);

  useEffect(() => {
    if (ruleCampaignId) {
      return;
    }

    const preferred = linkedGoogleCampaign?.id || campaigns[0]?.id;
    if (preferred) {
      setRuleCampaignId(preferred);
    }
  }, [ruleCampaignId, linkedGoogleCampaign, campaigns]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) {
      return;
    }

    const map = L.map(mapRef.current).setView([33.8806084, -98.5460791], 13);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; TrueRankDigital Engine",
      maxZoom: 19,
      subdomains: "abcd"
    }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    drawnItemsRef.current = drawnItems;
    map.addLayer(drawnItems);

    contextLayerRef.current = L.layerGroup().addTo(map);
    fixedOpsLayerRef.current = L.layerGroup();

    const drawControl = new L.Control.Draw({
      edit: { featureGroup: drawnItems },
      draw: {
        polygon: { shapeOptions: { color: "#e60000", weight: 3, fillOpacity: 0.3 } },
        rectangle: { shapeOptions: { color: "#e60000", weight: 3, fillOpacity: 0.3 } },
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false
      }
    });

    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (event: unknown) => {
      const layer = (event as { layer: L.Layer }).layer;
      drawnItems.clearLayers();
      drawnItems.addLayer(layer);

      const polygon = (layer as unknown as { getLatLngs: () => Array<Array<{ lat: number; lng: number }>> }).getLatLngs();
      const points = Array.isArray(polygon) && Array.isArray(polygon[0]) ? polygon[0] : [];
      setDrawnCoords(points.map((point) => ({ lat: point.lat, lng: point.lng })));
      setIsModalOpen(true);
    });

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selectedLocation || !mapInstance.current || !contextLayerRef.current) {
      return;
    }

    contextLayerRef.current.clearLayers();

    const center = selectedLocation.coordinates;
    const map = mapInstance.current;

    const marker = L.marker([center.lat, center.lng]).bindPopup(selectedLocation.dealershipName);
    const radiusMeters = radiusFeet * 0.3048;
    const homeCircle = L.circle([center.lat, center.lng], {
      radius: radiusMeters,
      color: "#00e676",
      fillColor: "#00e676",
      fillOpacity: 0.12,
      weight: 2
    });

    contextLayerRef.current.addLayer(marker);
    contextLayerRef.current.addLayer(homeCircle);

    map.setView([center.lat, center.lng], 13);

    if (fixedOpsLayerRef.current) {
      fixedOpsLayerRef.current.clearLayers();
      fixedOpsLayerRef.current.addLayer(
        L.marker(offsetPoint(center, 0.01, -0.012), { icon: fixedOpsIcon }).bindPopup("Service Center A")
      );
      fixedOpsLayerRef.current.addLayer(
        L.marker(offsetPoint(center, -0.011, 0.014), { icon: fixedOpsIcon }).bindPopup("Service Center B")
      );
      fixedOpsLayerRef.current.addLayer(
        L.marker(offsetPoint(center, 0.014, 0.006), { icon: fixedOpsIcon }).bindPopup("Service Center C")
      );

      if (fixedOpsActive) {
        fixedOpsLayerRef.current.addTo(map);
      }
    }
  }, [selectedLocation, radiusFeet, fixedOpsActive]);

  const competitorCompletion = useMemo(() => {
    if (!selectedLocation) {
      return { filled: 0, required: 0 };
    }

    let filled = 0;
    for (const competitor of selectedLocation.competitorSuggestions) {
      const key = `${selectedLocation.id}:${competitor.name}`;
      if ((competitorAddresses[key] || "").trim()) {
        filled += 1;
      }
    }

    return { filled, required: selectedLocation.requiredCompetitorCount };
  }, [selectedLocation, competitorAddresses]);

  function toggleFixedOps(): void {
    if (!mapInstance.current || !fixedOpsLayerRef.current) {
      return;
    }

    if (fixedOpsActive) {
      mapInstance.current.removeLayer(fixedOpsLayerRef.current);
    } else {
      fixedOpsLayerRef.current.addTo(mapInstance.current);
    }

    setFixedOpsActive((value) => !value);
  }

  async function handleSaveLiveRuleSet(): Promise<void> {
    const targetCampaignId = ruleCampaignId || linkedGoogleCampaign?.id || campaigns[0]?.id || "";
    if (!targetCampaignId) {
      setRuleSaveMessage("Create or sync a campaign first, then save rules.");
      return;
    }

    setIsSavingRules(true);
    setRuleSaveMessage("Saving live qualification rules...");

    try {
      await apiRequest<{ ok: boolean; campaignId: string }>(
        `/api/campaigns/${targetCampaignId}/rules`,
        {
          method: "POST",
          body: JSON.stringify({
            accuracyMaxM,
            cooldownHours,
            sessionBoundaryMin,
            lateGraceMin,
            dwellMin: dwellTime,
            velocityMaxMph: velocityMax
          })
        },
        apiBaseUrl
      );

      setRuleSaveMessage(`Live rule set saved on campaign ${targetCampaignId}.`);
      await refreshDashboard();
    } catch (error) {
      if (error instanceof Error) {
        setRuleSaveMessage(error.message);
      } else {
        setRuleSaveMessage("Failed to save live rule set.");
      }
    } finally {
      setIsSavingRules(false);
    }
  }

  async function handleLaunch(): Promise<void> {
    if (!selectedLocation) {
      return;
    }

    const selectedPlatforms = Object.entries(platforms)
      .filter(([, enabled]) => enabled)
      .map(([platform]) => platform);

    if (selectedPlatforms.length === 0) {
      setLaunchMessage("Select at least one ad platform.");
      return;
    }

    const homeShapeType: "radius" | "polygon" = drawnCoords.length >= 3 ? "polygon" : "radius";
    const defaultCoords = [selectedLocation.coordinates];
    const coords = homeShapeType === "polygon" ? drawnCoords : defaultCoords;

    const fences = [
      {
        type: "home" as const,
        shapeType: homeShapeType,
        locationName: selectedLocation.dealershipName,
        address: selectedLocation.address,
        radiusFeet,
        dwellTimeMin: dwellTime,
        velocityMax,
        isEVMode: false,
        coordinates: coords
      },
      ...selectedLocation.competitorSuggestions.map((competitor) => {
        const key = `${selectedLocation.id}:${competitor.name}`;
        const mode = competitorFenceModes[key] || "radius";
        return {
          type: "competitor" as const,
          shapeType: mode,
          locationName: competitor.name,
          address: competitorAddresses[key] || "",
          radiusFeet,
          dwellTimeMin: dwellTime,
          velocityMax,
          isEVMode: false,
          coordinates: mode === "polygon" ? coords : []
        };
      })
    ];

    setIsLaunching(true);
    setLaunchMessage("");

    try {
      const campaign = await launchCampaign({
        name: campaignName,
        dealershipName: selectedLocation.dealershipName,
        dealershipAddress: selectedLocation.address,
        locationId: selectedLocation.id,
        platforms: selectedPlatforms,
        retargetDays,
        dailyBudget,
        baseCpm: 8.5,
        cpcEstimate: 2.4,
        ctaUrl,
        message,
        qualificationRules: {
          accuracyMaxM,
          cooldownHours,
          sessionBoundaryMin,
          lateGraceMin,
          dwellMin: dwellTime,
          velocityMaxMph: velocityMax
        },
        fences
      });

      setRuleCampaignId(campaign.id);
      setLaunchMessage(
        campaign.status === "active"
          ? `Campaign ${campaign.name} launched.`
          : `Campaign ${campaign.name} saved as draft. Add missing competitor addresses to activate.`
      );
      setIsModalOpen(false);
    } catch (error) {
      if (error instanceof Error) {
        setLaunchMessage(error.message);
      } else {
        setLaunchMessage("Failed to launch campaign.");
      }
    } finally {
      setIsLaunching(false);
    }
  }

  async function pushCompetitorFenceToGoogle(): Promise<void> {
    if (!selectedLocation) {
      return;
    }

    if (!linkedGoogleCampaign?.integration?.googleCampaignId) {
      setGooglePushMessage("Activate Nissan live data first so a Google campaign is linked.");
      return;
    }

    const primaryCompetitor = selectedLocation.competitorSuggestions[0];
    if (!primaryCompetitor) {
      setGooglePushMessage("No competitor is configured for this location.");
      return;
    }

    const competitorKey = `${selectedLocation.id}:${primaryCompetitor.name}`;
    const competitorAddress = (competitorAddresses[competitorKey] || primaryCompetitor.address || "").trim();
    if (!competitorAddress) {
      setGooglePushMessage("Enter the competitor address before pushing to Google Ads.");
      return;
    }

    const radiusMiles = Math.max(0.3, Number((radiusFeet / 5280).toFixed(2)));

    setIsPushingGoogle(true);
    setGooglePushMessage("Pushing competitor geofence to Google Ads...");
    try {
      const response = await apiRequest<{
        ok: boolean;
        googleCampaignId: string;
        competitorName: string;
        radiusMiles: number;
      }>(
        "/api/integrations/google-ads/nissan/geofence/push",
        {
          method: "POST",
          body: JSON.stringify({
            googleCampaignId: linkedGoogleCampaign.integration.googleCampaignId,
            competitorName: primaryCompetitor.name,
            competitorAddress,
            radiusMiles,
            centerLat: 33.8884365,
            centerLng: -98.4861729,
            replaceExisting: true,
            validateOnly: false,
            confirmNoEUPoliticalAds: true
          })
        },
        apiBaseUrl
      );

      setGooglePushMessage(
        `Google Ads geofence pushed: ${response.competitorName} at ${response.radiusMiles}mi on campaign ${response.googleCampaignId}.`
      );
      await refreshDashboard();
    } catch (error) {
      if (error instanceof Error) {
        setGooglePushMessage(error.message);
      } else {
        setGooglePushMessage("Failed to push geofence to Google Ads.");
      }
    } finally {
      setIsPushingGoogle(false);
    }
  }

  function applyNearSniperPreset(): void {
    setRadiusFeet(5280);
    setDwellTime(12);
    setVelocityMax(6);
    setRetargetDays(21);
    setAccuracyMaxM(100);
    setCooldownHours(24);
    setSessionBoundaryMin(20);
    setLateGraceMin(30);
    setPlatforms((current) => ({
      ...current,
      google: true,
      meta: true
    }));
    setLaunchMessage(
      "Near-Sniper preset applied: 1-mile radius, 12 min dwell, 6 mph max, 21-day retarget window."
    );
  }

  return (
    <div className="space-y-4">
      <div className="tr-glass rounded-2xl p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl text-white">
              <Crosshair className="text-tr-primary" /> Campaign Architect
            </h2>
            <p className="text-sm text-zinc-400">
              Build home fences + competitor conquest campaigns with platform-ready launch payloads.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyNearSniperPreset}
              className="rounded-lg border border-white/15 bg-black/25 px-4 py-2 text-sm text-zinc-200"
            >
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal size={16} /> Apply Near-Sniper Preset
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="rounded-lg bg-tr-secondary px-4 py-2 text-sm font-semibold text-black"
            >
              Open Launch Modal
            </button>
            <button
              type="button"
              onClick={() => {
                pushCompetitorFenceToGoogle().catch(() => {});
              }}
              disabled={isPushingGoogle}
              className="rounded-lg border border-tr-primary/30 bg-tr-primary/10 px-4 py-2 text-sm text-tr-primary disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <Link2 size={16} /> {isPushingGoogle ? "Pushing..." : "Push Competitor Fence to Google"}
              </span>
            </button>
            <button
              type="button"
              onClick={handleSaveLiveRuleSet}
              disabled={isSavingRules}
              className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-300 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <Save size={16} /> {isSavingRules ? "Saving..." : "Save as Live Rule Set"}
              </span>
            </button>
            <button
              type="button"
              onClick={toggleFixedOps}
              className={`rounded-lg border px-4 py-2 text-sm ${
                fixedOpsActive
                  ? "border-yellow-500/50 bg-yellow-500/20 text-yellow-300"
                  : "border-white/10 bg-black/30 text-zinc-200"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Wrench size={16} /> Fixed Ops Layer
              </span>
            </button>
          </div>
        </div>

        <div className="mb-3 grid gap-2 md:grid-cols-[2fr,1fr]">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Qualification Rules</p>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs text-zinc-300">
                Accuracy Max (m)
                <input
                  type="number"
                  min={5}
                  max={500}
                  value={accuracyMaxM}
                  onChange={(event) => setAccuracyMaxM(clampNumber(Number(event.target.value), 5, 500))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Cooldown (hours)
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={cooldownHours}
                  onChange={(event) => setCooldownHours(clampNumber(Number(event.target.value), 1, 72))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white"
                />
              </label>
              <label className="text-xs text-zinc-300">
                Session Boundary (min)
                <input
                  type="number"
                  min={5}
                  max={60}
                  value={sessionBoundaryMin}
                  onChange={(event) => setSessionBoundaryMin(clampNumber(Number(event.target.value), 5, 60))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white"
                />
              </label>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Rule Target Campaign</p>
            <select
              value={ruleCampaignId}
              onChange={(event) => setRuleCampaignId(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white"
            >
              {campaigns.length === 0 && <option value="">No campaigns yet</option>}
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {setup?.locations.map((location) => {
            const required = location.requiredCompetitorCount;
            let filled = 0;
            for (const competitor of location.competitorSuggestions) {
              const key = `${location.id}:${competitor.name}`;
              if ((competitorAddresses[key] || "").trim()) {
                filled += 1;
              }
            }
            return (
              <button
                key={location.id}
                type="button"
                onClick={() => setSelectedLocationId(location.id)}
                className={`rounded-xl border p-4 text-left ${
                  selectedLocationId === location.id
                    ? "border-tr-primary/50 bg-tr-primary/10"
                    : "border-white/10 bg-black/25 hover:bg-black/35"
                }`}
              >
                <p className="text-sm font-semibold text-white">{location.dealershipName}</p>
                <p className="mt-1 text-xs text-zinc-400">{location.address}</p>
                <p className="mt-2 text-xs text-zinc-300">Competitors confirmed: {filled}/{required}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative h-[520px] overflow-hidden rounded-2xl border border-white/10">
        <div ref={mapRef} className="h-full w-full" />
      </div>

      {launchMessage && (
        <div className="tr-glass flex items-center gap-2 rounded-xl border border-tr-secondary/30 p-3 text-sm text-zinc-200">
          <CheckCircle2 size={16} className="text-tr-secondary" /> {launchMessage}
        </div>
      )}

      {googlePushMessage && (
        <div className="tr-glass flex items-center gap-2 rounded-xl border border-tr-primary/30 p-3 text-sm text-zinc-200">
          <Link2 size={16} className="text-tr-primary" /> {googlePushMessage}
        </div>
      )}

      {ruleSaveMessage && (
        <div className="tr-glass flex items-center gap-2 rounded-xl border border-emerald-400/30 p-3 text-sm text-zinc-200">
          <Save size={16} className="text-emerald-300" /> {ruleSaveMessage}
        </div>
      )}

      {isModalOpen && selectedLocation && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/85 p-4">
          <div className="tr-glass max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#0a0a0a]/95 p-4">
              <h3 className="flex items-center gap-2 font-display text-lg text-white">
                <Rocket className="text-tr-primary" /> Launch Geo-Conquest Campaign
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Campaign Name</label>
                  <input
                    value={campaignName}
                    onChange={(event) => setCampaignName(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Dealership</label>
                  <input
                    value={selectedLocation.dealershipName}
                    readOnly
                    className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Daily Budget ($)</label>
                  <input
                    type="number"
                    min={10}
                    value={dailyBudget}
                    onChange={(event) => setDailyBudget(Number(event.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Retarget Window (Days)</label>
                  <input
                    type="number"
                    min={14}
                    max={30}
                    value={retargetDays}
                    onChange={(event) => setRetargetDays(Number(event.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Fence Radius (ft)</label>
                  <input
                    type="number"
                    min={200}
                    max={5280}
                    value={radiusFeet}
                    onChange={(event) => setRadiusFeet(Number(event.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Min Dwell (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={dwellTime}
                    onChange={(event) => setDwellTime(Number(event.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Velocity Max (mph)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={velocityMax}
                    onChange={(event) => setVelocityMax(Number(event.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <p className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Qualification Rules</p>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="text-xs text-zinc-300">
                    Accuracy Max (m)
                    <input
                      type="number"
                      min={5}
                      max={500}
                      value={accuracyMaxM}
                      onChange={(event) => setAccuracyMaxM(clampNumber(Number(event.target.value), 5, 500))}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white"
                    />
                  </label>
                  <label className="text-xs text-zinc-300">
                    Cooldown (h)
                    <input
                      type="number"
                      min={1}
                      max={72}
                      value={cooldownHours}
                      onChange={(event) => setCooldownHours(clampNumber(Number(event.target.value), 1, 72))}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white"
                    />
                  </label>
                  <label className="text-xs text-zinc-300">
                    Session Boundary (min)
                    <input
                      type="number"
                      min={5}
                      max={60}
                      value={sessionBoundaryMin}
                      onChange={(event) => setSessionBoundaryMin(clampNumber(Number(event.target.value), 5, 60))}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white"
                    />
                  </label>
                  <label className="text-xs text-zinc-300">
                    Late Grace (min)
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={lateGraceMin}
                      onChange={(event) => setLateGraceMin(clampNumber(Number(event.target.value), 0, 120))}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Primary Message</label>
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">CTA URL</label>
                <input
                  value={ctaUrl}
                  onChange={(event) => setCtaUrl(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                />
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Platform Mix</p>
                <div className="grid gap-2 md:grid-cols-3">
                  {platformOptions.map((platform) => (
                    <label key={platform.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200">
                      <input
                        type="checkbox"
                        checked={Boolean(platforms[platform.id])}
                        onChange={(event) =>
                          setPlatforms((current) => ({
                            ...current,
                            [platform.id]: event.target.checked
                          }))
                        }
                      />
                      {platformLabels[platform.id] || platform.name}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-wider text-zinc-400">
                  Competitor Addresses + Fence Type ({competitorCompletion.filled}/{competitorCompletion.required})
                </p>
                <div className="space-y-2">
                  {selectedLocation.competitorSuggestions.map((competitor) => {
                    const key = `${selectedLocation.id}:${competitor.name}`;
                    return (
                      <div key={key} className="grid gap-2 md:grid-cols-[220px,1fr,140px]">
                        <input value={competitor.name} readOnly className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-200" />
                        <input
                          value={competitorAddresses[key] || ""}
                          placeholder="Enter exact address"
                          onChange={(event) =>
                            setCompetitorAddresses((current) => ({
                              ...current,
                              [key]: event.target.value
                            }))
                          }
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        />
                        <select
                          value={competitorFenceModes[key] || "radius"}
                          onChange={(event) =>
                            setCompetitorFenceModes((current) => ({
                              ...current,
                              [key]: event.target.value === "polygon" ? "polygon" : "radius"
                            }))
                          }
                          className="rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-sm text-white"
                        >
                          <option value="radius">Radius</option>
                          <option value="polygon">Polygon</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-zinc-300">
                Drawn polygon points: {drawnCoords.length > 0 ? drawnCoords.length : 0}. If none are drawn, the API uses a radius-based home fence.
              </div>
            </div>

            <div className="sticky bottom-0 border-t border-white/10 bg-[#0a0a0a]/95 p-4">
              <button
                type="button"
                onClick={handleLaunch}
                disabled={isLaunching || loading}
                className="w-full rounded-xl bg-tr-secondary py-3 text-sm font-black uppercase text-black disabled:opacity-60"
              >
                {isLaunching ? "Launching..." : "Launch Campaign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activationChecklist.length > 0 && (
        <div className="tr-glass rounded-xl border border-white/10 p-4">
          <p className="mb-2 text-xs uppercase tracking-[0.15em] text-zinc-400">Activation Checklist</p>
          <ul className="space-y-1 text-sm text-zinc-200">
            {activationChecklist.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-tr-secondary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
