// Land a generated equity research report as an SPS vault page (file-first).
//
// Reuses the canonical create path (`makePage`) plus the additive vault mirror
// IPC (`spsExportPage` → sps-export-page), so the page survives a blob-mode
// reload AND the vault `.md` + note-index materialize. No new vault IPC.

import { useStore } from "../store";
import { markdownToBlocks } from "../editor/blockMarkdown";
import { pageToMarkdown } from "../editor/pageMarkdown";
import type { EquityReport } from "./reportContract";

const PROFILE = "default";

/**
 * Create a vault page from a full report markdown and return its pageId.
 * `fullMarkdown` is the complete orchestrator output (frontmatter + body).
 */
export async function landReportToVault(
  report: EquityReport,
  fullMarkdown: string,
): Promise<string> {
  const runId = String(report.provenance?.run_id ?? "");
  const suffix = runId ? ` (${runId})` : "";
  const title = `${report.ticker} — Equity Research${suffix}`;
  const info = { icon: "📈", title };

  const blocks = markdownToBlocks(fullMarkdown);
  const pageId = useStore.getState().makePage(info, blocks, null);

  // Mirror to the vault explicitly so blob-mode workspaces also get the file.
  const md = pageToMarkdown({ title, icon: "📈", cover: null }, blocks);
  await window.hermesAPI.spsExportPage(pageId, md, PROFILE);

  useStore.getState().selectPage(pageId);
  return pageId;
}
