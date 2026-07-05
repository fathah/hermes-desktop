import { safeHandle } from "../safe-handle";
import {
  DECK_STUDIO_FOLDER,
  deckProjectToRow,
  parseDeckProjectMarkdown,
  runDeckQa,
  type DeckGenerationInput,
  serializeDeckProjectMarkdown,
  type DeckProject,
} from "../../../shared/deck-studio";
import {
  exportDeckPdf,
  exportDeckPptx,
  generateDeckProject,
  openDeckExport,
} from "../../deck-studio";
import { getSpsNoteIndex } from "../../note-index";
import { resolveSpsVaultDir } from "../../sps-storage";
import { exportRowMarkdownTo, readRowMarkdownFrom } from "../../sps-vault";
import { requireLocalWorkspace } from "../connection-guards";
import {
  assertIpcString,
  assertPathInside,
  normalizeIpcProfile,
} from "../validate";

function spsVaultDirFor(profile?: unknown): string {
  return resolveSpsVaultDir(normalizeIpcProfile(profile));
}

export function registerSpsDeckIpc(): void {
  safeHandle(
    "deck-generate",
    (_event, input: DeckGenerationInput, profile?: unknown) => {
      requireLocalWorkspace();
      return generateDeckProject(input, normalizeIpcProfile(profile));
    },
  );
  safeHandle(
    "deck-save",
    async (_event, project: DeckProject, profile?: unknown) => {
      requireLocalWorkspace();
      const vaultDir = spsVaultDirFor(profile);
      const qa = runDeckQa(project);
      if (!qa.ok) {
        return { ok: false, issues: qa.issues };
      }
      const row = deckProjectToRow({
        ...project,
        updatedAt: new Date().toISOString(),
      });
      const ok = await exportRowMarkdownTo(
        vaultDir,
        row.folder,
        row.rowId,
        serializeDeckProjectMarkdown({
          ...project,
          updatedAt: String(row.props.updatedAt),
        }),
      );
      return { ok, rowId: row.rowId, issues: qa.issues };
    },
  );
  safeHandle("deck-list", async (_event, profile?: unknown) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(normalizeIpcProfile(profile))).query({
      scope: DECK_STUDIO_FOLDER,
      sort: { prop: "updatedAt", dir: "desc" },
      limit: 200,
    });
  });
  safeHandle("deck-read", async (_event, rowId: unknown, profile?: unknown) => {
    requireLocalWorkspace();
    const vaultDir = spsVaultDirFor(profile);
    const safeRowId = assertIpcString(rowId, "row id");
    assertPathInside(
      vaultDir,
      `${DECK_STUDIO_FOLDER}/${safeRowId}.md`,
      "row id",
    );
    const markdown = await readRowMarkdownFrom(
      vaultDir,
      DECK_STUDIO_FOLDER,
      safeRowId,
    );
    return markdown ? parseDeckProjectMarkdown(markdown) : null;
  });
  safeHandle(
    "deck-export-pdf",
    (_event, project: DeckProject, profile?: unknown) => {
      requireLocalWorkspace();
      return exportDeckPdf(project, spsVaultDirFor(profile));
    },
  );
  safeHandle(
    "deck-export-pptx",
    (_event, project: DeckProject, profile?: unknown) => {
      requireLocalWorkspace();
      return exportDeckPptx(project, spsVaultDirFor(profile));
    },
  );
  safeHandle(
    "deck-open-export",
    (_event, filePath: unknown, profile?: unknown) => {
      requireLocalWorkspace();
      return openDeckExport(
        assertIpcString(filePath, "deck export path"),
        spsVaultDirFor(profile),
      );
    },
  );
}
