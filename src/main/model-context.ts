export interface ActiveModelContextConfig {
  model: string;
  contextLength?: number;
}

/**
 * Resolve a connection-owned context override before falling back to provider
 * discovery. Matching the model id prevents a delayed remote response from
 * applying the previous model's context window after the user switches.
 */
// @lat: [[model-context#Model context window#Gauge resolution order]]
export async function resolveActiveModelContextWindow(
  requestedModel: string,
  readActiveModel: () =>
    | ActiveModelContextConfig
    | Promise<ActiveModelContextConfig>,
  fallback: () => Promise<number | null>,
): Promise<number | null> {
  const active = await readActiveModel();
  const contextLength = active.contextLength;
  if (
    active.model.trim() === requestedModel.trim() &&
    typeof contextLength === "number" &&
    Number.isFinite(contextLength) &&
    contextLength > 0
  ) {
    return Math.floor(contextLength);
  }
  return fallback();
}
