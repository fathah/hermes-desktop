/**
 * LOCAL-ONLY PROVIDERS - NOT COMMITTED TO GITHUB
 * These providers are available only in your local development environment
 * 
 * This file is gitignored and contains your private local configurations
 */

export interface LocalProvider {
  id: string;
  name: string;
  desc: string;
  tag: string;
  envKey: string;
  url: string;
  placeholder: string;
  configProvider: string;
  baseUrl: string;
  needsKey: boolean;
}

// NVIDIA NIM Provider - Local deployment only
export const NVIDIA_NIM_PROVIDER: LocalProvider = {
  id: "nvidia-nim",
  name: "NVIDIA NIM (Local)",
  desc: "Local NVIDIA NIM deployment with Qwen3.5 models",
  tag: "Local Only",
  envKey: "NVIDIA_API_KEY",
  url: "http://localhost:8000",
  placeholder: "Optional API Key",
  configProvider: "nvidia-nim",
  baseUrl: "http://localhost:8000/v1",
  needsKey: false,
};

// Add to provider options
export const LOCAL_PROVIDER_OPTION = {
  value: "nvidia-nim",
  label: "NVIDIA NIM (Local)",
};

// Local model presets
export const LOCAL_MODEL_PRESETS = [
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    port: "8000",
  },
];
