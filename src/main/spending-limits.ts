import { readDesktopConfig, writeDesktopConfig, setModelConfig, getModelConfig } from "./config";
import { getUsageStats } from "./usage-store";

export interface SpendingCapConfig {
  maxSpendingLimit: number; // in USD, default 10.0
  spendingCapAction: "block" | "rotate-to-local" | "rotate-to-gemini-free";
}

const DEFAULT_CONFIG: SpendingCapConfig = {
  maxSpendingLimit: 10.0,
  spendingCapAction: "block",
};

/**
 * Get the spending cap config from desktop.json.
 */
export function getSpendingCapConfig(): SpendingCapConfig {
  const config = readDesktopConfig();
  return {
    maxSpendingLimit: typeof config.maxSpendingLimit === "number" ? config.maxSpendingLimit : DEFAULT_CONFIG.maxSpendingLimit,
    spendingCapAction: (config.spendingCapAction as SpendingCapConfig["spendingCapAction"]) || DEFAULT_CONFIG.spendingCapAction,
  };
}

/**
 * Save spending cap settings to desktop.json.
 */
export function setSpendingCapConfig(settings: Partial<SpendingCapConfig>): void {
  const config = readDesktopConfig();
  if (settings.maxSpendingLimit !== undefined) {
    config.maxSpendingLimit = settings.maxSpendingLimit;
  }
  if (settings.spendingCapAction !== undefined) {
    config.spendingCapAction = settings.spendingCapAction;
  }
  writeDesktopConfig(config);
}

/**
 * Check if the active profile's spend has exceeded the spending limit,
 * and execute rotation if configured.
 *
 * Returns an status object indicating if the query is blocked.
 */
export async function enforceSpendingLimit(
  profile?: string
): Promise<{ blocked: boolean; cost: number; limit: number; rotated: boolean; rotatedTo?: string }> {
  const settings = getSpendingCapConfig();
  const usageStats = getUsageStats({ profile });
  const totalCost = usageStats.totals.cost || 0;

  if (totalCost < settings.maxSpendingLimit) {
    return { blocked: false, cost: totalCost, limit: settings.maxSpendingLimit, rotated: false };
  }

  // Cap exceeded! Execute cap action
  const currentModel = getModelConfig(profile);

  // If the user is already on a local or free model, don't block/rotate further
  if (
    currentModel.provider === "ollama" ||
    (currentModel.provider === "google" && currentModel.model === "gemini-1.5-flash")
  ) {
    return { blocked: false, cost: totalCost, limit: settings.maxSpendingLimit, rotated: false };
  }

  if (settings.spendingCapAction === "rotate-to-local") {
    console.log(`[SPENDING LIMIT] Cap of $${settings.maxSpendingLimit} exceeded (Current: $${totalCost.toFixed(4)}). Rotating to Ollama (local).`);
    setModelConfig("ollama", "qwen3.5:9b", "http://localhost:11434/v1", profile);
    return { blocked: false, cost: totalCost, limit: settings.maxSpendingLimit, rotated: true, rotatedTo: "ollama" };
  }

  if (settings.spendingCapAction === "rotate-to-gemini-free") {
    console.log(`[SPENDING LIMIT] Cap of $${settings.maxSpendingLimit} exceeded (Current: $${totalCost.toFixed(4)}). Rotating to Gemini (free).`);
    setModelConfig("google", "gemini-1.5-flash", "", profile);
    return { blocked: false, cost: totalCost, limit: settings.maxSpendingLimit, rotated: true, rotatedTo: "google" };
  }

  // Default action: block paid requests
  console.warn(`[SPENDING LIMIT] Cap of $${settings.maxSpendingLimit} exceeded (Current: $${totalCost.toFixed(4)}). Blocking paid request.`);
  return { blocked: true, cost: totalCost, limit: settings.maxSpendingLimit, rotated: false };
}
