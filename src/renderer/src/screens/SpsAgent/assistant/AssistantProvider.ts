// AssistantProvider.ts — provider selection. In the Electron app the default is the
// main-process bridge (real Hermes gateway). MockAssistant is the offline fallback
// when the bridge isn't present (e.g. unit tests / standalone web).
import type { AssistantProvider } from "./types";
import { MockAssistant } from "./providers/MockAssistant";
import { BridgeAssistant } from "./providers/BridgeAssistant";

let _provider: AssistantProvider | null = null;

export function getAssistantProvider(): AssistantProvider {
  if (_provider) return _provider;
  const hasBridge =
    typeof window !== "undefined" && !!window.hermesAPI?.spsAssistant;
  _provider = hasBridge ? new BridgeAssistant() : new MockAssistant();
  return _provider;
}

export type { AssistantProvider };
