// handoff.ts — the `/compact` handoff-brief instruction (doc ch.6.2 / 15.2).
// `/compact [focus]` is rewritten into this explicit prompt and sent to the
// agent with the full conversation in context, so it produces a portable brief
// to carry into a fresh session — regardless of backend command support. Pure.

export function buildHandoffPrompt(focus?: string): string {
  const trimmed = (focus ?? "").trim();
  const focusLine = trimmed ? `\n\nFocus the brief on: ${trimmed}.` : "";
  return (
    "Compress this conversation into a handoff brief I can paste into a new " +
    "session. Preserve, as concise bullet points: the goal; key decisions made; " +
    "active constraints; options considered and rejected (and why); open " +
    "questions; important file names, commands, and links; and the next 1–3 " +
    "actions. Omit greetings and chit-chat. If something is unknown, say so " +
    "plainly rather than guessing." +
    focusLine
  );
}
