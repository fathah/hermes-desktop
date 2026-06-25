import { app } from "electron";
import { safeHandle } from "../safe-handle";
import {
  spsUnfurl,
  spsAssistant,
  spsCuratedBrief,
  spsTeachCapture,
  spsSourceStudy,
  spsIngestInbox,
  spsFileAnswer,
  spsFileResearch,
  spsLintWiki,
  spsLoad,
  spsSave,
  type PageContext as SpsPageContext,
} from "../../sps-agent";

export function registerSpsCoreIpc(): void {
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
  safeHandle(
    "sps-teach-capture",
    (
      _event,
      input: { captureId: string; title?: string; corpusDescription: string },
      profile?: string,
    ) => spsTeachCapture(input, profile),
  );
  safeHandle(
    "sps-curated-brief",
    (_event, topic: string, corpusDescription?: string, profile?: string) =>
      spsCuratedBrief(topic, corpusDescription, profile),
  );
  safeHandle("sps-ingest-inbox", (_event, profile?: string) =>
    spsIngestInbox(profile),
  );
  safeHandle("sps-register-deep-links", () =>
    app.setAsDefaultProtocolClient("sps"),
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
  safeHandle("sps-lint-wiki", (_event, staleDays?: number, profile?: string) =>
    spsLintWiki(profile, { staleDays }),
  );
  safeHandle("sps-load", (_event, profile?: string) => spsLoad(profile));
  safeHandle(
    "sps-save",
    (_event, ws: unknown, profile?: string, baseRev?: number) =>
      spsSave(ws, profile, baseRev),
  );
}
