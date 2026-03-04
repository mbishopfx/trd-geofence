import { create } from "zustand";
import { apiRequest, DEFAULT_API_BASE_URL, normalizeApiBaseUrl } from "./api";

export type CampaignStatus = "active" | "paused" | "draft";

export interface Fence {
  id: string;
  type: "home" | "competitor";
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
  fences: Fence[];
  missingInputs: string[];
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
    locationName: string;
    address: string;
    radiusFeet: number;
    dwellTimeMin: number;
    velocityMax: number;
    isEVMode: boolean;
    coordinates: Array<{ lat: number; lng: number }>;
  }>;
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

interface TrueRankState {
  apiBaseUrl: string;
  campaigns: Campaign[];
  dashboard: Dashboard;
  setup: SetupTemplate | null;
  creativeRequirements: CreativeRequirement[];
  platformOptions: PlatformOption[];
  activationChecklist: string[];
  activeCampaignId: string | null;
  isPresentationMode: boolean;
  loading: boolean;
  lastSyncAt: string | null;
  error: string | null;
  setApiBaseUrl: (next: string) => void;
  togglePresentationMode: () => void;
  clearError: () => void;
  bootstrap: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
  launchCampaign: (payload: LaunchCampaignInput) => Promise<Campaign>;
  recordEvent: (campaignId: string, type: "impression" | "click", count?: number) => Promise<void>;
  simulateCampaign: (campaignId: string, cycles?: number) => Promise<void>;
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
  liveFeed: []
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
      const [setupResponse, campaignsResponse, dashboardResponse] = await Promise.all([
        apiRequest<BootstrapResponse>("/api/setup-template", {}, apiBaseUrl),
        apiRequest<CampaignsResponse>("/api/campaigns", {}, apiBaseUrl),
        apiRequest<DashboardResponse>("/api/dashboard", {}, apiBaseUrl)
      ]);

      set((state) => ({
        setup: setupResponse.setup,
        creativeRequirements: setupResponse.creativeRequirements,
        platformOptions: setupResponse.platformOptions,
        campaigns: campaignsResponse.campaigns,
        dashboard: dashboardResponse.dashboard,
        activeCampaignId:
          state.activeCampaignId || campaignsResponse.campaigns[0]?.id || dashboardResponse.campaigns[0]?.id || null,
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
      const dashboardResponse = await apiRequest<DashboardResponse>("/api/dashboard", {}, apiBaseUrl);

      set((state) => ({
        dashboard: dashboardResponse.dashboard,
        campaigns: dashboardResponse.campaigns,
        activeCampaignId: state.activeCampaignId || dashboardResponse.campaigns[0]?.id || null,
        lastSyncAt: new Date().toISOString(),
        error: null
      }));
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
        dashboard: response.dashboard,
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
        dashboard: response.dashboard,
        activeCampaignId: state.activeCampaignId || campaignId,
        lastSyncAt: new Date().toISOString(),
        error: null
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  }
}));
