import { existsSync } from "fs";
import { safeHandle } from "../safe-handle";
import {
  oaSearchWorks,
  oaGetWork,
  getResearchConfig,
  getPublicResearchConfig,
  setResearchConfig,
} from "../../openalex";
import type { SearchOpts } from "../../../shared/openalex/core";
import {
  hasMcpServer,
  openAlexMcpServerPath,
  writeMcpServerEntry,
} from "../../installer";

export function registerSpsResearchIpc(): void {
  safeHandle(
    "sps-research-search-works",
    (_event, q: string, opts?: SearchOpts, profile?: string) =>
      oaSearchWorks(q, opts ?? {}, profile),
  );
  safeHandle("sps-research-get-work", (_event, id: string, profile?: string) =>
    oaGetWork(id, profile),
  );
  safeHandle("sps-research-get-config", () => getPublicResearchConfig());
  safeHandle(
    "sps-research-set-config",
    (_event, mailto: string, apiKey?: string) => {
      setResearchConfig(mailto, apiKey);
      return getPublicResearchConfig();
    },
  );
  safeHandle("sps-research-ensure-agent-tool", (_event, profile?: string) =>
    ensureResearchMcpRegistered(profile),
  );
}

function ensureResearchMcpRegistered(profile?: string): {
  registered: boolean;
  alreadyPresent: boolean;
} {
  const name = "openalex";
  if (hasMcpServer(name, profile)) {
    return { registered: true, alreadyPresent: true };
  }
  const serverPath = openAlexMcpServerPath();
  if (!existsSync(serverPath)) {
    return { registered: false, alreadyPresent: false };
  }
  const { mailto, apiKey } = getResearchConfig();
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
  if (mailto) env.HERMES_OPENALEX_MAILTO = mailto;
  if (apiKey) env.HERMES_OPENALEX_API_KEY = apiKey;
  writeMcpServerEntry(
    name,
    { command: process.execPath, args: [serverPath], env, enabled: true },
    profile,
  );
  return { registered: true, alreadyPresent: false };
}
