import type { RegistryModel } from "../shared/registry";

// @lat: [[provider-setup#Provider setup#MiniMax text model choices]]
export const MINIMAX_TEXT_MODELS = ["MiniMax-M3.1-Flash", "MiniMax-M3"];

// Hermes Agent's OAuth catalog explicitly supports M3. Do not infer OAuth
// entitlement (including the China region) from the public API model list.
export const MINIMAX_OAUTH_MODELS = ["MiniMax-M3"];

/** Only curated choices pass through this filter, never saved/custom models. */
export function currentMiniMaxChoices(models: string[]): string[] {
  const isText = (id: string): boolean =>
    /^(?:minimax(?:ai)?\/)?minimax-(?:m\d|text-|01(?:$|:))/i.test(id);
  const current = (id: string): boolean =>
    /^(?:minimax(?:ai)?\/)?minimax-m3(?:\.1-flash)?(?::free|-free)?$/i.test(id);
  const flash = (id: string): boolean =>
    /^(?:minimax(?:ai)?\/)?minimax-m3\.1-flash(?::free|-free)?$/i.test(id);
  const choices = models.filter((id) => !isText(id) || current(id));
  // Preserve other providers' relative order while putting Flash before M3.
  const positions = choices.flatMap((id, index) =>
    current(id) ? [index] : [],
  );
  const miniMax = positions.map((index) => choices[index]);
  miniMax.sort((a, b) => Number(flash(b)) - Number(flash(a)));
  positions.forEach((index, i) => {
    choices[index] = miniMax[i];
  });
  return choices;
}

export function miniMaxRegistryModels(oauth = false): RegistryModel[] {
  return (oauth ? MINIMAX_OAUTH_MODELS : MINIMAX_TEXT_MODELS).map((name) => ({
    name,
    context: 1_000_000,
    modalities: { input: ["text", "image", "video"], output: ["text"] },
    capabilities: ["tools", "reasoning", "streaming"],
  }));
}
