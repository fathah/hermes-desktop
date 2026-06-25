// AssistantProvider.ts — provider selection. The interface lives in ./types.
// Selected by env: VITE_ASSISTANT_PROVIDER = "mock" (default, offline) | "hermes".
import type { AssistantProvider } from "./types";
import { MockAssistant } from "./providers/MockAssistant";
import { HermesAssistant } from "./providers/HermesAssistant";

let _provider: AssistantProvider | null = null;

export function getAssistantProvider(): AssistantProvider {
  if (_provider) return _provider;
  const which = (
    import.meta.env.VITE_ASSISTANT_PROVIDER || "mock"
  ).toLowerCase();
  _provider = which === "hermes" ? new HermesAssistant() : new MockAssistant();
  return _provider;
}

export type { AssistantProvider };
