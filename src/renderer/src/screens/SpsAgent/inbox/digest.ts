// digest.ts — pure grouping for the newsletter digest lane. Captures flagged
// digest: true by the email monitor (bulk/low-priority mail under an account's
// digestBulk toggle) are folded into one collapsible "Newsletters (N)" card;
// everything else renders as individual inbox cards.
import type { VaultRow } from "../hooks/useNoteIndex";

export interface DigestSplit {
  normal: VaultRow[];
  digest: VaultRow[];
}

export function splitDigestRows(rows: VaultRow[]): DigestSplit {
  const normal: VaultRow[] = [];
  const digest: VaultRow[] = [];
  for (const row of rows) {
    // Frontmatter booleans can round-trip through the index as true or "true".
    const flagged = row.props.digest === true || row.props.digest === "true";
    if (flagged) digest.push(row);
    else normal.push(row);
  }
  return { normal, digest };
}
