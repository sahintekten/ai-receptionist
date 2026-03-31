import type {
  Business,
  IntegrationConfig,
  IntegrationType,
} from "@prisma/client";

// ─── Integration Config Types ────────────────────────────

export interface CalcomEventType {
  id: number;
  name: string;
  duration_minutes: number;
  service_type: string;
  doctor_name?: string;
}

export interface CalcomConfig {
  event_types: CalcomEventType[];
  availability_mode: string;
  gcal_calendar_id?: string;
}

/** @deprecated GHL replaced by Twenty CRM in V1. Kept for backward compat. */
export interface GhlConfig {
  location_id: string;
  contact_search_enabled: boolean;
}

export interface TwentyConfig {
  api_key: string;
}

export interface RetellConfig {
  agent_id: string;
  webhook_url: string;
}

export interface AnthropicConfig {
  model_id: string;
  max_tokens: number;
  temperature: number;
}

export type IntegrationConfigMap = {
  calcom: CalcomConfig;
  ghl: GhlConfig;
  twenty: TwentyConfig;
  retell: RetellConfig;
  anthropic: AnthropicConfig;
};

// ─── Resolved Business Config ────────────────────────────

export interface ResolvedIntegration {
  id: string;
  type: IntegrationType;
  config: CalcomConfig | GhlConfig | TwentyConfig | RetellConfig | AnthropicConfig | Record<string, unknown>;
  isEnabled: boolean;
}

export interface ResolvedBusinessConfig {
  business: Business;
  integrations: ResolvedIntegration[];
}

// Re-export Prisma types for convenience
export type { Business, IntegrationConfig, IntegrationType };
