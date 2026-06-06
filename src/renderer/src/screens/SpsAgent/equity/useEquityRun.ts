// Owns one India equity research run: drives the orchestrator skill via the
// existing chat send path, buffers the streamed markdown, and exposes the live
// delegation tree (reusing the Chat signal hook). The run IS a chat turn that
// invokes the `india-equity-research` skill — no new IPC is introduced.

import { useCallback, useEffect, useRef, useState } from "react";
import { useChatSignals } from "../../Chat/useChatSignals";
import { parseEquityReport, type EquityReport } from "./reportContract";

export type RunStatus = "idle" | "running" | "done" | "error";

export interface EquityRunState {
  status: RunStatus;
  ticker: string;
  transcript: string;
  toolProgress: string | null;
  report: EquityReport | null;
  error: string | null;
  delegationTree: ReturnType<typeof useChatSignals>["delegationTree"];
  start: (ticker: string, depth?: "full" | "quick") => void;
}

const PROFILE = "default";

// Load the orchestrator SKILL.md once and prepend it to the run prompt, so the
// in-app run operates strictly per the skill instead of relying on the agent
// auto-discovering it. Best-effort: falls back to a plain directive if unreadable.
let cachedSkillMd: string | null = null;
async function loadOrchestratorSkill(): Promise<string> {
  if (cachedSkillMd !== null) return cachedSkillMd;
  cachedSkillMd = "";
  try {
    const api = window.hermesAPI;
    const skills = api.listInstalledSkills
      ? await api.listInstalledSkills(PROFILE)
      : [];
    const orch = skills.find((s) => s.name === "india-equity-research");
    if (orch?.path && api.getSkillContent) {
      cachedSkillMd = (await api.getSkillContent(orch.path)) || "";
    }
  } catch {
    /* best-effort — plain directive still drives the skill via auto-discovery */
  }
  return cachedSkillMd;
}

export function useEquityRun(): EquityRunState {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [ticker, setTicker] = useState("");
  const [transcript, setTranscript] = useState("");
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bufferRef = useRef("");

  const { delegationTree } = useChatSignals(PROFILE);

  // Subscribe to the streamed chat signals for the lifetime of the surface.
  useEffect(() => {
    const offChunk = window.hermesAPI.onChatChunk((chunk: string) => {
      bufferRef.current += chunk;
      setTranscript(bufferRef.current);
    });
    const offTool = window.hermesAPI.onChatToolProgress((tool: string) => {
      setToolProgress(tool);
    });
    const offDone = window.hermesAPI.onChatDone(() => {
      setStatus("done");
      setToolProgress(null);
    });
    return () => {
      offChunk();
      offTool();
      offDone();
    };
  }, []);

  const start = useCallback(
    (nextTicker: string, depth: "full" | "quick" = "full") => {
      const symbol = nextTicker.trim().toUpperCase();
      if (!symbol) return;
      bufferRef.current = "";
      setTranscript("");
      setError(null);
      setToolProgress(null);
      setTicker(symbol);
      setStatus("running");

      void (async () => {
        const skillMd = await loadOrchestratorSkill();
        const lanes =
          depth === "quick"
            ? "Quick mode (3 lanes: fundamentals, technical, risk)"
            : "Full depth (5-specialist council + red-team)";
        const directive = `${lanes} india-equity-research report for ${symbol} (NSE ticker: ${symbol}).
Use ONE evidence_id. Call india-equity-data.fetch for quote, fundamentals AND history (history returns value['price_series']); put the real bars into price_series. NSE 403 is expected — degrade and record a data gap. Cite ONLY real evidence_refs returned by fetch(). Assemble with report_builder.build_report, then PERSIST it by path-importing india-equity-research/scripts/vault_row.py and calling vault_row.save_report(report, markdown) — this writes the canonical row to vault/equity-research/${symbol.toLowerCase()}.md. Finally reply with exactly: SAVED ${symbol}.`;
        const prompt = skillMd
          ? `Operate strictly per the india-equity-research skill below.\n\n${skillMd}\n\n---\n\n${directive}`
          : `Use the india-equity-research skill. ${directive}`;
        try {
          const res = await window.hermesAPI.sendMessage(prompt, PROFILE);
          // Final response also carries the full text; prefer it if longer.
          if (res?.response && res.response.length > bufferRef.current.length) {
            bufferRef.current = res.response;
            setTranscript(res.response);
          }
          setStatus("done");
        } catch (e) {
          setError(String(e));
          setStatus("error");
        }
      })();
    },
    [],
  );

  const report = parseEquityReport(transcript);

  return {
    status,
    ticker,
    transcript,
    toolProgress,
    report,
    error,
    delegationTree,
    start,
  };
}
