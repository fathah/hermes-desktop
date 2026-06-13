import { safeHandle } from "./safe-handle";
import { existsSync } from "fs";
import { exec } from "child_process";
import http from "http";
import https from "https";
import {
  spsUnfurl,
  spsAssistant,
  spsSourceStudy,
  spsIngestInbox,
  spsFileAnswer,
  spsFileResearch,
  spsLintWiki,
  spsLoad,
  spsSave,
  type PageContext as SpsPageContext,
} from "../sps-agent";
import { spsGetWorkSession, spsSetWorkSession } from "../sps-work-sessions";
import { appendWikiLog, type WikiLogOp } from "../sps-wiki-log";
import { ensureIndexCoverage } from "../sps-ingest";
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
  notebookLmMcpCommand,
  openAlexMcpServerPath,
  writeMcpServerEntry,
} from "../installer";

export function registerSpsIpc(): void {
  // SPS Agent workspace (unfurl / assistant / persistence)
  safeHandle("sps-unfurl", (_event, url: string) => spsUnfurl(url));
  safeHandle(
    "sps-assistant",
    (
      _event,
      prompt: string,
      ctx: SpsPageContext,
      profile?: string,
      groundInWorkspace?: boolean,
    ) => spsAssistant(prompt, ctx, profile, groundInWorkspace),
  );
  safeHandle(
    "sps-source-study",
    (_event, focus: string, corpusDescription?: string, profile?: string) =>
      spsSourceStudy(focus, corpusDescription, profile),
  );
  safeHandle("sps-ingest-inbox", (_event, profile?: string) =>
    spsIngestInbox(profile),
  );
  safeHandle(
    "sps-file-answer",
    (_event, question: string, answer: string, profile?: string) =>
      spsFileAnswer(question, answer, profile),
  );
  safeHandle(
    "sps-file-research",
    (_event, topic: string, researchedMarkdown: string, profile?: string) =>
      spsFileResearch(topic, researchedMarkdown, profile),
  );
  safeHandle(
    "sps-wiki-log-append",
    async (_event, op: WikiLogOp, summary: string, profile?: string) => {
      // After any wiki change: record it in the append-only log AND refresh the
      // LLM-Wiki catalog so index.md always covers every page.
      const vaultDir = resolveSpsVaultDir(profile);
      await appendWikiLog(vaultDir, op, summary);
      await ensureIndexCoverage(vaultDir);
    },
  );
  safeHandle("sps-lint-wiki", (_event, staleDays?: number, profile?: string) =>
    spsLintWiki(profile, { staleDays }),
  );
  safeHandle("sps-load", (_event, profile?: string) => spsLoad(profile));
  safeHandle(
    "sps-save",
    (_event, ws: unknown, profile?: string, baseRev?: number) =>
      spsSave(ws, profile, baseRev),
  );
  safeHandle("sps-run-telos-audit", (_event, profile?: string) =>
    runTelosAudit(profile),
  );
  safeHandle(
    "sps-run-piping",
    (_event, text: string, pattern: string, profile?: string) =>
      runPipingPattern(text, pattern, profile),
  );

  // Resumable /work session map
  safeHandle(
    "sps-get-work-session",
    (_event, pageId: string, profile?: string) =>
      spsGetWorkSession(pageId, profile),
  );
  safeHandle(
    "sps-set-work-session",
    (_event, pageId: string, sessionId: string, profile?: string) =>
      spsSetWorkSession(pageId, sessionId, profile),
  );

  // Research (OpenAlex)
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
  safeHandle("sps-notebooklm-ensure-mcp", (_event, profile?: string) =>
    ensureNotebookLmMcpRegistered(profile),
  );

  safeHandle(
    "sps-trigger-action",
    async (
      _event,
      action: {
        type: "shell" | "api";
        command?: string;
        url?: string;
        headers?: string;
      },
      profile?: string,
    ): Promise<{ success: boolean; output?: string; error?: string }> => {
      if (action.type === "shell") {
        if (!action.command || !action.command.trim()) {
          return { success: false, error: "Empty command string" };
        }
        const vaultDir = resolveSpsVaultDir(profile);
        return new Promise((resolve) => {
          exec(
            action.command!,
            {
              cwd: vaultDir,
              timeout: 15000,
            },
            (error, stdout, stderr) => {
              if (error) {
                resolve({
                  success: false,
                  output: stdout.toString(),
                  error: stderr.toString() || error.message,
                });
              } else {
                resolve({
                  success: true,
                  output: stdout.toString(),
                });
              }
            },
          );
        });
      } else if (action.type === "api") {
        if (!action.url || !action.url.trim()) {
          return { success: false, error: "Empty API URL string" };
        }
        return new Promise((resolve) => {
          let parsedHeaders: Record<string, string> = {};
          if (action.headers) {
            try {
              parsedHeaders = JSON.parse(action.headers);
            } catch (err) {
              return resolve({
                success: false,
                error: `Invalid JSON in headers: ${(err as Error).message}`,
              });
            }
          }
          const requester = action.url!.startsWith("https") ? https : http;
          const req = requester.request(
            action.url!,
            {
              method: "GET",
              headers: parsedHeaders,
              timeout: 15000,
            },
            (res) => {
              let body = "";
              res.on("data", (chunk) => {
                body += chunk.toString();
              });
              res.on("end", () => {
                if ((res.statusCode ?? 500) < 400) {
                  resolve({ success: true, output: body });
                } else {
                  resolve({
                    success: false,
                    output: body,
                    error: `Gateway returned status code ${res.statusCode}`,
                  });
                }
              });
            },
          );
          req.on("error", (e) => {
            resolve({ success: false, error: e.message });
          });
          req.on("timeout", () => {
            req.destroy();
            resolve({ success: false, error: "Request timed out" });
          });
          req.end();
        });
      } else {
        return { success: false, error: `Unsupported action type: ${action.type}` };
      }
    },
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

function ensureNotebookLmMcpRegistered(profile?: string): {
  registered: boolean;
  alreadyPresent: boolean;
} {
  const name = "notebooklm-mcp";
  if (hasMcpServer(name, profile)) {
    return { registered: true, alreadyPresent: true };
  }
  const command = notebookLmMcpCommand();
  if (command !== "notebooklm-mcp" && !existsSync(command)) {
    return { registered: false, alreadyPresent: false };
  }
  writeMcpServerEntry(
    name,
    { command, args: [], env: {}, enabled: true },
    profile,
  );
  return { registered: true, alreadyPresent: false };
}
