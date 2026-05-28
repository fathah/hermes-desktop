export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
}

export interface ToolsetState {
  key: string;
  enabled: boolean;
}

export interface ChannelState {
  name: string;
  enabled: boolean;
  token?: string;
}

export interface ModelSettings {
  temperature?: number;
  max_tokens?: number;
}

export interface WizardState {
  profileName: string;
  templateId: string;
  primaryProvider: string;
  primaryBaseUrl: string;
  primaryApiKey: string;
  fallbackProvider?: string;
  fallbackBaseUrl?: string;
  fallbackApiKey?: string;
  selectedModels: string[];
  modelSettings?: Record<string, ModelSettings>;
  toolsets: ToolsetState[];
  firecrawlApiKey?: string;
  falApiKey?: string;
  browserbaseApiKey?: string;
  soulContent: string;
  channels: ChannelState[];
  activateAfterCreate?: boolean;
}

export interface StepValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ProfileTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  defaultProvider: ProviderConfig;
  fallbackProvider?: ProviderConfig;
  toolsets: string[];
  requiredSecrets: string[];
  soulTemplate: string;
  suggestedChannels: string[];
  configOverrides?: {
    model?: ModelSettings;
  };
}

export interface WizardCreateResult {
  success: boolean;
  profilePath?: string;
  error?: string;
}

export interface ProfileListItem {
  name: string;
  path: string;
  isActive: boolean;
}

export interface MigrationProfileInfo {
  name: string;
  keyCount: number;
  envPath: string;
}

export interface MigrationResult {
  name: string;
  imported: boolean;
  vaultEntries: number;
  error?: string;
}
