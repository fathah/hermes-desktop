// sps-wiki-log.ts — append-only wiki-evolution log (Karpathy's `log.md`).
//
// Records each change to the wiki — ingest / file-answer / lint / research /
// digest — as a parseable, chronological line so the wiki's growth is auditable
// and the agent can read its own history. Distinct from audit-log.ts (which
// records APP actions): this logs WIKI evolution and lives inside the vault as a
// normal markdown page so it is indexed and queryable.
//
// log.md is a META page — excluded from orphan lint (see note-index orphans()).
// Best-effort throughout: a failed log write must never block a commit.
import { promises as fs } from "fs";
import { join } from "path";

export type WikiLogOp =
  | "ingest"
  | "file-answer"
  | "lint"
  | "research"
  | "digest";

const META_HEADER = `---\ntitle: "Log"\n---\n# Wiki log\n\n`;

/** Format one append-only log line: `## [YYYY-MM-DD] <op> | <summary>`. Pure so
 *  the date is injected (tests pass a fixed Date). Collapses whitespace so a
 *  multi-line summary stays on one parseable line. */
export function formatWikiLogLine(
  op: WikiLogOp,
  summary: string,
  date: Date,
): string {
  const day = date.toISOString().slice(0, 10);
  const clean = summary.replace(/\s+/g, " ").trim() || "(no summary)";
  return `## [${day}] ${op} | ${clean}`;
}

/** Append a line to `<vaultDir>/log.md`, seeding the page header on first write.
 *  Best-effort; never throws. */
export async function appendWikiLog(
  vaultDir: string,
  op: WikiLogOp,
  summary: string,
): Promise<void> {
  try {
    const line = formatWikiLogLine(op, summary, new Date());
    const path = join(vaultDir, "log.md");
    let existing = "";
    try {
      existing = await fs.readFile(path, "utf-8");
    } catch {
      /* first write — file does not exist yet */
    }
    const prefix = existing.trim() ? "" : META_HEADER;
    await fs.appendFile(path, `${prefix}${line}\n`);
  } catch {
    /* best-effort: logging must never block a commit */
  }
}
