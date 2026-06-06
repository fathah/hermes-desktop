// contextChip.ts — pure label for the assistant "trust chip". Given what the
// reply was grounded in (notes / memory / rules), produce a short human summary.
// Order: rules first (the user's explicit standing instructions), then memory,
// then workspace notes. Pure + unit-tested.
import type { AssistantContext } from "./types";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "2 rules · 1 memory item · 3 notes" — empty string when nothing was used. */
export function contextChipLabel(ctx: AssistantContext): string {
  const parts: string[] = [];
  if (ctx.rules > 0) parts.push(plural(ctx.rules, "rule"));
  if (ctx.memory > 0) parts.push(plural(ctx.memory, "memory item"));
  if (ctx.notes > 0) parts.push(plural(ctx.notes, "note"));
  return parts.join(" · ");
}
