import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const SPS_IPC_ROOT = join(ROOT, "src/main/ipc");

function collectSpsIpcSources(): string {
  const paths = [join(SPS_IPC_ROOT, "sps.ts")];
  const leafDir = join(SPS_IPC_ROOT, "sps");
  if (statSync(leafDir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const file of readdirSync(leafDir).sort()) {
      if (file.endsWith(".ts")) paths.push(join(leafDir, file));
    }
  }
  return paths.map((file) => readFileSync(file, "utf-8")).join("\n");
}

function extractChannels(src: string): string[] {
  return [...src.matchAll(/safeHandle\(\s*["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
}

describe("SPS IPC surface", () => {
  it("keeps the existing channel contract stable", () => {
    expect(extractChannels(collectSpsIpcSources()).sort()).toEqual([
      "deck-export-pdf",
      "deck-export-pptx",
      "deck-generate",
      "deck-list",
      "deck-open-export",
      "deck-read",
      "deck-save",
      "sps-active-work-create",
      "sps-active-work-get",
      "sps-active-work-list",
      "sps-active-work-update",
      "sps-apply-import-plan",
      "sps-assistant",
      "sps-build-context-pack",
      "sps-capture",
      "sps-commit-vault-proposal",
      "sps-create-assistant-recipe",
      "sps-create-base-proposal",
      "sps-create-import-plan",
      "sps-create-vault-proposal",
      "sps-curated-brief",
      "sps-delete-assistant-recipe",
      "sps-dismiss-vault-proposal",
      "sps-email-monitor-apply-feedback",
      "sps-email-monitor-get-config",
      "sps-email-monitor-run-now",
      "sps-email-monitor-save-config",
      "sps-email-monitor-status",
      "sps-enable-local-expert-checks",
      "sps-export-local-expert-pack",
      "sps-export-okf-bundle",
      "sps-file-answer",
      "sps-file-research",
      "sps-get-local-expert",
      "sps-get-work-session",
      "sps-health-report",
      "sps-import-clipboard-screenshot",
      "sps-import-local-expert-pack",
      "sps-import-okf-bundle",
      "sps-import-recent-screenshot",
      "sps-ingest-inbox",
      "sps-install-local-expert",
      "sps-lint-wiki",
      "sps-list-assistant-recipe-runs",
      "sps-list-assistant-recipes",
      "sps-list-local-experts",
      "sps-list-recent-screenshots",
      "sps-list-vault-proposals",
      "sps-load",
      "sps-notebooklm-ensure-mcp",
      "sps-notebooklm-status",
      "sps-preview-local-expert-pack",
      "sps-register-deep-links",
      "sps-research-ensure-agent-tool",
      "sps-research-get-config",
      "sps-research-get-work",
      "sps-research-search-works",
      "sps-research-set-config",
      "sps-run-assistant-recipe",
      "sps-run-local-expert-checks",
      "sps-run-piping",
      "sps-run-telos-audit",
      "sps-save",
      "sps-save-assistant-recipe-run",
      "sps-set-work-session",
      "sps-source-study",
      "sps-teach-capture",
      "sps-trigger-action",
      "sps-unfurl",
      "sps-uninstall-local-expert",
      "sps-update-assistant-recipe",
      "sps-update-page-properties",
      "sps-wiki-log-append",
    ]);
  });
});
