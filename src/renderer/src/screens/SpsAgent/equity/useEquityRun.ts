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

      const prompt = `Use the india-equity-research skill to produce a full report for ${symbol} (NSE), depth ${depth}. Return the canonical markdown report.`;
      void window.hermesAPI
        .sendMessage(prompt, PROFILE)
        .then((res) => {
          // Final response also carries the full text; prefer it if longer.
          if (res?.response && res.response.length > bufferRef.current.length) {
            bufferRef.current = res.response;
            setTranscript(res.response);
          }
          setStatus("done");
        })
        .catch((e: unknown) => {
          setError(String(e));
          setStatus("error");
        });
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
