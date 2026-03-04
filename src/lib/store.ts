import { create } from "zustand";
import { apiRequest, DEFAULT_API_BASE_URL, normalizeApiBaseUrl } from "./api";

export type CampaignStatus = "active" | "paused" | "draft";

export interface Fence {
  id: string;
  type: "home" | "competitor";
  shapeType?: "radius" | "polygon";
  locationName: string;
  address: string;
  radiusFeet: number;
  dwellTimeMin: number;
  velocityMax: number;
  isEVMode: boolean;
  coordinates: Array<{ lat: number; lng: number }>;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  createdAt: string;
  dealershipName: string;
  dealershipAddress: string;
  locationId: string;
  platforms: string[];
  retargetDays: number;
  dailyBudget: number;
  monthlyBudgetEstimate: number;
  baseCpm: number;
  cpcEstimate: number;
  ctaUrl: string;
  message: string;
  qualificationRules?: {
    accuracyMaxM: number;
    cooldownHours: number;
    sessionBoundaryMin: number;
    lateGraceMin: number;
    dwellMin: number;
    velocityMaxMph: number;
  };
  fences: Fence[];
  missingInputs: string[];
  integration?: {
    source?: string;
    customerId?: string;
    googleCampaignId?: string;
    googleCampaignName?: string;
    channelType?: string;
    syncedAt?: string;
    geofenceLastPushedAt?: string;
    geofenceTarget?: {
      competitorName: string;
      competitorAddress: string;
      radiusMiles: number;
      centerLat: number;
      centerLng: number;
    };
  };
}

export interface MatchBackEvent {
  id: string;
  campaignId: string;
  campaignName: string;
  timestamp: string;
  type: string;
  deviceId: string;
  velocityMph: number;
  dwellTimeMin: number;
  result: string;
  competitorLot: string;
}

export interface LeaderboardItem {
  campaignId: string;
  campaignName: string;
  dealershipName: string;
  clicks: number;
  impressions: number;
  ctr: number;
}

export interface Dashboard {
  activeCampaigns: number;
  activeFences: number;
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
  totalSpend: number;
  capturedWalkIns: number;
  leaderboard: LeaderboardItem[];
  liveFeed: MatchBackEvent[];
  dsp?: {
    eventsIngested: number;
    devicesQualified: number;
    audienceActive: number;
    activationSuccessRate: number;
  };
}

export interface SetupLocation {
  id: string;
  dealershipName: string;
  address: string;
  coordinates: { lat: number; lng: number };
  requiredCompetitorCount: number;
  competitorSuggestions: Array<{ name: string; address: string }>;
}

export interface SetupTemplate {
  requestedBy: string;
  objective: string;
  defaultMessage: string;
  fenceRecommendations: {
    preferredFeetRange: [number, number];
    maxFeet: number;
    defaultFeet: number;
    dwellTimeMin: number;
    velocityMaxMph: number;
    retargetDays: { min: number; max: number; default: number };
  };
  locations: SetupLocation[];
  trackingGoals: string[];
}

export interface CreativeRequirement {
  id: string;
  label: string;
  size: string;
  channel: string;
  required: boolean;
}

export interface PlatformOption {
  id: string;
  name: string;
  recommendedVendors: string[];
  priority: string;
}

export interface LaunchCampaignInput {
  name: string;
  dealershipName: string;
  dealershipAddress: string;
  locationId: string;
  platforms: string[];
  retargetDays: number;
  dailyBudget: number;
  baseCpm: number;
  cpcEstimate: number;
  ctaUrl: string;
  message: string;
  fences: Array<{
    type: "home" | "competitor";
    shapeType?: "radius" | "polygon";
    locationName: string;
    address: string;
    radiusFeet: number;
    dwellTimeMin: number;
    velocityMax: number;
    isEVMode: boolean;
    coordinates: Array<{ lat: number; lng: number }>;
  }>;
  qualificationRules?: {
    accuracyMaxM: number;
    cooldownHours: number;
    sessionBoundaryMin: number;
    lateGraceMin: number;
    dwellMin: number;
    velocityMaxMph: number;
  };
}

interface BootstrapResponse {
  ok: boolean;
  setup: SetupTemplate;
  creativeRequirements: CreativeRequirement[];
  platformOptions: PlatformOption[];
}

interface CampaignsResponse {
  ok: boolean;
  campaigns: Campaign[];
}

interface DashboardResponse {
  ok: boolean;
  dashboard: Dashboard;
  campaigns: Campaign[];
}

interface LaunchCampaignResponse {
  ok: boolean;
  campaign: Campaign;
  activationChecklist: string[];
}

interface EventResponse {
  ok: boolean;
  campaignId: string;
  dashboard: Dashboard;
}

interface ActivateNissanLiveResponse {
  ok: boolean;
  integration: string;
  accountName: string;
  customerId: string;
  selectedGoogleCampaign: {
    id: string;
    name: string;
    status: string;
    channelType: string;
    impressions: number;
    clicks: number;
    ctr: number;
    costMicros: number;
    cost: number;
  };
  linkedCampaign: Campaign;
  dashboard: Dashboard;
  autoSync: GoogleAdsAutoSyncStatus;
}

interface GoogleAdsIntegrationStatus {
  ready: boolean;
  developerTokenReady: boolean;
  refreshTokenReady: boolean;
  loginCustomerIdSet: boolean;
  nissanCustomerId: string | null;
  apiVersion: string;
  oauth: {
    ready: boolean;
    source: string;
    error?: string;
    filePath?: string | null;
    tokenUri?: string;
  };
}

interface GoogleAdsAutoSyncStatus {
  enabled: boolean;
  timerActive: boolean;
  running: boolean;
  intervalSec: number;
  intervalMinutes: number;
  tickCount: number;
  nextRunAt: string | null;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  lastSummary: string | null;
}

interface GoogleAdsStatusResponse {
  ok: boolean;
  integration: string;
  status: GoogleAdsIntegrationStatus;
  autoSync: GoogleAdsAutoSyncStatus;
}

interface TrueRankState {
  apiBaseUrl: string;
  campaigns: Campaign[];
  dashboard: Dashboard;
  setup: SetupTemplate | null;
  creativeRequirements: CreativeRequirement[];
  platformOptions: PlatformOption[];
  activationChecklist: string[];
  activeCampaignId: string | null;
  googleAdsIntegrationStatus: GoogleAdsIntegrationStatus | null;
  googleAdsAutoSyncStatus: GoogleAdsAutoSyncStatus | null;
  isPresentationMode: boolean;
  loading: boolean;
  lastSyncAt: string | null;
  error: string | null;
  setApiBaseUrl: (next: string) => void;
  togglePresentationMode: () => void;
  clearError: () => void;
  bootstrap: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
  refreshGoogleAdsStatus: () => Promise<void>;
  launchCampaign: (payload: LaunchCampaignInput) => Promise<Campaign>;
  recordEvent: (campaignId: string, type: "impression" | "click", count?: number) => Promise<void>;
  simulateCampaign: (campaignId: string, cycles?: number) => Promise<void>;
  activateNissanLiveData: (campaignNameContains?: string) => Promise<Campaign>;
  runNissanSyncNow: (campaignNameContains?: string) => Promise<Campaign>;
  setActiveCampaign: (campaignId: string | null) => void;
}

const EMPTY_DASHBOARD: Dashboard = {
  activeCampaigns: 0,
  activeFences: 0,
  totalImpressions: 0,
  totalClicks: 0,
  ctr: 0,
  totalSpend: 0,
  capturedWalkIns: 0,
  leaderboard: [],
  liveFeed: [],
  dsp: {
    eventsIngested: 0,
    devicesQualified: 0,
    audienceActive: 0,
    activationSuccessRate: 0
  }
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

export const useTrueRankStore = create<TrueRankState>((set, get) => ({
  apiBaseUrl: DEFAULT_API_BASE_URL,
  campaigns: [],
  dashboard: EMPTY_DASHBOARD,
  setup: null,
  creativeRequirements: [],
  platformOptions: [],
  activationChecklist: [],
  activeCampaignId: null,
  googleAdsIntegrationStatus: null,
  googleAdsAutoSyncStatus: null,
  isPresentationMode: false,
  loading: false,
  lastSyncAt: null,
  error: null,

  setApiBaseUrl: (next) => {
    set({ apiBaseUrl: normalizeApiBaseUrl(next) });
  },

  togglePresentationMode: () => {
    set((state) => ({ isPresentationMode: !state.isPresentationMode }));
  },

  clearError: () => {
    set({ error: null });
  },

  setActiveCampaign: (campaignId) => {
    set({ activeCampaignId: campaignId });
  },

  bootstrap: async () => {
    set({ loading: true, error: null });

    try {
      const apiBaseUrl = get().apiBaseUrl;
      const [setupResponse, campaignsResponse, dashboardResponse, googleAdsStatusResponse] = await Promise.all([
        apiRequest<BootstrapResponse>("/api/setup-template", {}, apiBaseUrl),
        apiRequest<CampaignsResponse>("/api/campaigns", {}, apiBaseUrl),
        apiRequest<DashboardResponse>("/api/dashboard", {}, apiBaseUrl),
        apiRequest<GoogleAdsStatusResponse>("/api/integrations/google-ads/status", {}, apiBaseUrl).catch(() => null)
      ]);

      set((state) => ({
        setup: setupResponse.setup,
        creativeRequirements: setupResponse.creativeRequirements,
        platformOptions: setupResponse.platformOptions,
        campaigns: campaignsResponse.campaigns,
        dashboard: dashboardResponse.dashboard,
        activeCampaignId:
          state.activeCampaignId || campaignsResponse.campaigns[0]?.id || dashboardResponse.campaigns[0]?.id || null,
        googleAdsIntegrationStatus: googleAdsStatusResponse?.status || state.googleAdsIntegrationStatus,
        googleAdsAutoSyncStatus: googleAdsStatusResponse?.autoSync || state.googleAdsAutoSyncStatus,
        lastSyncAt: new Date().toISOString(),
        loading: false,
        error: null
      }));
    } catch (error) {
      set({ loading: false, error: toErrorMessage(error) });
      throw error;
    }
  },

  refreshDashboard: async () => {
    try {
      const apiBaseUrl = get().apiBaseUrl;
      const [dashboardResponse, googleAdsStatusResponse] = await Promise.all([
        apiRequest<DashboardResponse>("/api/dashboard", {}, apiBaseUrl),
        apiRequest<GoogleAdsStatusResponse>("/api/integrations/google-ads/status", {}, apiBaseUrl).catch(() => null)
      ]);

      set((state) => ({
        dashboard: dashboardResponse.dashboard,
        campaigns: dashboardResponse.campaigns,
        activeCampaignId: state.activeCampaignId || dashboardResponse.campaigns[0]?.id || null,
        googleAdsIntegrationStatus: googleAdsStatusResponse?.status || state.googleAdsIntegrationStatus,
        googleAdsAutoSyncStatus: googleAdsStatusResponse?.autoSync || state.googleAdsAutoSyncStatus,
        lastSyncAt: new Date().toISOString(),
        error: null
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  refreshGoogleAdsStatus: async () => {
    try {
      const apiBaseUrl = get().apiBaseUrl;
      const response = await apiRequest<GoogleAdsStatusResponse>("/api/integrations/google-ads/status", {}, apiBaseUrl);
      set({
        googleAdsIntegrationStatus: response.status,
        googleAdsAutoSyncStatus: response.autoSync,
        error: null
      });
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  launchCampaign: async (payload) => {
    set({ loading: true, error: null });

    try {
      const apiBaseUrl = get().apiBaseUrl;
      const response = await apiRequest<LaunchCampaignResponse>(
        "/api/campaigns",
        {
          method: "POST",
          body: JSON.stringify(payload)
        },
        apiBaseUrl
      );

      set((state) => ({
        loading: false,
        campaigns: [response.campaign, ...state.campaigns],
        activationChecklist: response.activationChecklist,
        activeCampaignId: response.campaign.id,
        error: null
      }));

      await get().refreshDashboard();
      return response.campaign;
    } catch (error) {
      set({ loading: false, error: toErrorMessage(error) });
      throw error;
    }
  },

  recordEvent: async (campaignId, type, count = 1) => {
    try {
      const apiBaseUrl = get().apiBaseUrl;
      const response = await apiRequest<EventResponse>(
        `/api/campaigns/${campaignId}/events`,
        {
          method: "POST",
          body: JSON.stringify({ type, count })
        },
        apiBaseUrl
      );

      set((state) => ({
        dashboard: {
          ...state.dashboard,
          ...response.dashboard,
          dsp: response.dashboard.dsp || state.dashboard.dsp
        },
        activeCampaignId: state.activeCampaignId || campaignId,
        lastSyncAt: new Date().toISOString(),
        error: null
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  simulateCampaign: async (campaignId, cycles = 8) => {
    try {
      const apiBaseUrl = get().apiBaseUrl;
      const response = await apiRequest<EventResponse>(
        `/api/campaigns/${campaignId}/simulate`,
        {
          method: "POST",
          body: JSON.stringify({ cycles })
        },
        apiBaseUrl
      );

      set((state) => ({
        dashboard: {
          ...state.dashboard,
          ...response.dashboard,
          dsp: response.dashboard.dsp || state.dashboard.dsp
        },
        activeCampaignId: state.activeCampaignId || campaignId,
        lastSyncAt: new Date().toISOString(),
        error: null
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  activateNissanLiveData: async (campaignNameContains = "") => {
    set({ loading: true, error: null });

    try {
      const apiBaseUrl = get().apiBaseUrl;
      const response = await apiRequest<ActivateNissanLiveResponse>(
        "/api/integrations/google-ads/nissan/activate",
        {
          method: "POST",
          body: JSON.stringify({ campaignNameContains })
        },
        apiBaseUrl
      );

      set((state) => {
        const filtered = state.campaigns.filter((campaign) => campaign.id !== response.linkedCampaign.id);
        return {
          loading: false,
          campaigns: [response.linkedCampaign, ...filtered],
          dashboard: {
            ...state.dashboard,
            ...response.dashboard,
            dsp: response.dashboard.dsp || state.dashboard.dsp
          },
          activeCampaignId: response.linkedCampaign.id,
          googleAdsAutoSyncStatus: response.autoSync,
          lastSyncAt: new Date().toISOString(),
          error: null
        };
      });

      return response.linkedCampaign;
    } catch (error) {
      set({ loading: false, error: toErrorMessage(error) });
      throw error;
    }
  },

  runNissanSyncNow: async (campaignNameContains = "") => {
    set({ loading: true, error: null });

    try {
      const apiBaseUrl = get().apiBaseUrl;
      const response = await apiRequest<ActivateNissanLiveResponse>(
        "/api/integrations/google-ads/nissan/sync-now",
        {
          method: "POST",
          body: JSON.stringify({ campaignNameContains })
        },
        apiBaseUrl
      );

      set((state) => {
        const filtered = state.campaigns.filter((campaign) => campaign.id !== response.linkedCampaign.id);
        return {
          loading: false,
          campaigns: [response.linkedCampaign, ...filtered],
          dashboard: {
            ...state.dashboard,
            ...response.dashboard,
            dsp: response.dashboard.dsp || state.dashboard.dsp
          },
          activeCampaignId: response.linkedCampaign.id,
          googleAdsAutoSyncStatus: response.autoSync,
          lastSyncAt: new Date().toISOString(),
          error: null
        };
      });

      return response.linkedCampaign;
    } catch (error) {
      set({ loading: false, error: toErrorMessage(error) });
      throw error;
    }
  }
}));
