import { ipcMain } from "electron";
import { existsSync } from "fs";
import {
  spsUnfurl,
  spsAssistant,
  spsIngestInbox,
  spsFileAnswer,
  spsLoad,
  spsSave,
  type PageContext as SpsPageContext,
} from "../sps-agent";
import { spsGetWorkSession, spsSetWorkSession } from "../sps-work-sessions";
import { appendWikiLog, type WikiLogOp } from "../sps-wiki-log";
import { resolveSpsVaultDir } from "../sps-storage";
import { runTelosAudit, runPipingPattern } from "../telos-auditor";
import {
  oaSearchWorks,
  oaGetWork,
  getResearchConfig,
  getPublicResearchConfig,
  setResearchConfig,
} from "../openalex";
import type { SearchOpts } from "../../shared/openalex/core";
import {
  hasMcpServer,
  openAlexMcpServerPath,
  writeMcpServerEntry,
} from "../installer";

export function registerSpsIpc(): void {
  // SPS Agent workspace (unfurl / assistant / persistence)
  ipcMain.handle("sps-unfurl", (_event, url: string) => spsUnfurl(url));
  ipcMain.handle(
    "sps-assistant",
    (
      _event,
      prompt: string,
      ctx: SpsPageContext,
      profile?: string,
      groundInWorkspace?: boolean,
    ) => spsAssistant(prompt, ctx, profile, groundInWorkspace),
  );
  ipcMain.handle("sps-ingest-inbox", (_event, profile?: string) =>
    spsIngestInbox(profile),
  );
  ipcMain.handle(
    "sps-file-answer",
    (_event, question: string, answer: string, profile?: string) =>
      spsFileAnswer(question, answer, profile),
  );
  ipcMain.handle(
    "sps-wiki-log-append",
    (_event, op: WikiLogOp, summary: string, profile?: string) =>
      appendWikiLog(resolveSpsVaultDir(profile), op, summary),
  );
  ipcMain.handle("sps-load", (_event, profile?: string) => spsLoad(profile));
  ipcMain.handle("sps-save", (_event, ws: unknown, profile?: string) =>
    spsSave(ws, profile),
  );
  ipcMain.handle("sps-run-telos-audit", (_event, profile?: string) =>
    runTelosAudit(profile),
  );
  ipcMain.handle(
    "sps-run-piping",
    (_event, text: string, pattern: string, profile?: string) =>
      runPipingPattern(text, pattern, profile),
  );

  // Resumable /work session map
  ipcMain.handle(
    "sps-get-work-session",
    (_event, pageId: string, profile?: string) =>
      spsGetWorkSession(pageId, profile),
  );
  ipcMain.handle(
    "sps-set-work-session",
    (_event, pageId: string, sessionId: string, profile?: string) =>
      spsSetWorkSession(pageId, sessionId, profile),
  );

  // Research (OpenAlex)
  ipcMain.handle(
    "sps-research-search-works",
    (_event, q: string, opts?: SearchOpts, profile?: string) =>
      oaSearchWorks(q, opts ?? {}, profile),
  );
  ipcMain.handle(
    "sps-research-get-work",
    (_event, id: string, profile?: string) => oaGetWork(id, profile),
  );
  ipcMain.handle("sps-research-get-config", () => getPublicResearchConfig());
  ipcMain.handle(
    "sps-research-set-config",
    (_event, mailto: string, apiKey?: string) => {
      setResearchConfig(mailto, apiKey);
      return getPublicResearchConfig();
    },
  );
  ipcMain.handle("sps-research-ensure-agent-tool", (_event, profile?: string) =>
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
