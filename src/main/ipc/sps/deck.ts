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

export function registerSpsDeckIpc(): void {
  safeHandle(
    "deck-generate",
    (_event, input: DeckGenerationInput, profile?: string) => {
      requireLocalWorkspace();
      return generateDeckProject(input, profile);
    },
  );
  safeHandle(
    "deck-save",
    async (_event, project: DeckProject, profile?: string) => {
      requireLocalWorkspace();
      const qa = runDeckQa(project);
      if (!qa.ok) {
        return { ok: false, issues: qa.issues };
      }
      const row = deckProjectToRow({
        ...project,
        updatedAt: new Date().toISOString(),
      });
      const ok = await exportRowMarkdownTo(
        resolveSpsVaultDir(profile),
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
  safeHandle("deck-list", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).query({
      scope: DECK_STUDIO_FOLDER,
      sort: { prop: "updatedAt", dir: "desc" },
      limit: 200,
    });
  });
  safeHandle("deck-read", async (_event, rowId: string, profile?: string) => {
    requireLocalWorkspace();
    const markdown = await readRowMarkdownFrom(
      resolveSpsVaultDir(profile),
      DECK_STUDIO_FOLDER,
      rowId,
    );
    return markdown ? parseDeckProjectMarkdown(markdown) : null;
  });
  safeHandle(
    "deck-export-pdf",
    (_event, project: DeckProject, profile?: string) => {
      requireLocalWorkspace();
      return exportDeckPdf(project, resolveSpsVaultDir(profile));
    },
  );
  safeHandle(
    "deck-export-pptx",
    (_event, project: DeckProject, profile?: string) => {
      requireLocalWorkspace();
      return exportDeckPptx(project, resolveSpsVaultDir(profile));
    },
  );
  safeHandle(
    "deck-open-export",
    (_event, filePath: string, profile?: string) => {
      requireLocalWorkspace();
      return openDeckExport(filePath, resolveSpsVaultDir(profile));
    },
  );
}
