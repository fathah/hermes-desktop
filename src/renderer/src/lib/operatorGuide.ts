// operatorGuide.ts — the in-app operator checklists, distilled from the Hermes
// Desktop operating guide (daily ops, automation trust, capability install).
// One content source feeding two surfaces: the cockpit "guide" widget and the
// `/guide` chat command. Pure data + a markdown serializer — no imports, no
// side effects — so both Chat and SpsAgent can use it without coupling.

export interface GuideSection {
  title: string;
  items: string[];
}

export const OPERATOR_GUIDE: GuideSection[] = [
  {
    title: "Daily operator checklist",
    items: [
      "Am I in the right profile?",
      "Is this the right session, or should I start fresh?",
      "Is the selected model appropriate for the task's value and cost?",
      "Is the reasoning level necessary?",
      "Is context usage healthy? (watch the context gauge)",
      "Are only the needed tools / skills / MCP servers enabled?",
      "Should this task require approval?",
      "Should outputs become artifacts, memory, skills — or none of these?",
    ],
  },
  {
    title: "Before trusting an automation",
    items: [
      "The cron exists and is visible in Schedules.",
      "Schedule, timezone, and delivery target are correct.",
      "Freshness window and source rules are explicit.",
      "The first run was reviewed manually before trusting it.",
      "Failure behavior is defined — say when nothing happened; don't invent updates.",
      "Model choice and run frequency are cost-appropriate.",
      "High-risk actions still require approval.",
      "Outputs land somewhere you can audit them.",
    ],
  },
  {
    title: "Before installing a skill / plugin / MCP server",
    items: [
      "I know why this capability is needed.",
      "It is scoped to the correct profile.",
      "I reviewed the instructions / code / install steps.",
      "It does not require unnecessary secrets or filesystem access.",
      "I know how to disable or remove it.",
      "I tested it with a harmless task first.",
    ],
  },
];

/** Render the full guide as chat markdown for the `/guide` command. */
export function operatorGuideMarkdown(): string {
  const parts: string[] = ["**Operator guide**"];
  for (const section of OPERATOR_GUIDE) {
    parts.push(`\n**${section.title}**`);
    for (const item of section.items) {
      parts.push(`- [ ] ${item}`);
    }
  }
  parts.push(
    "\n_These mirror the controls in the gear (⌘,) overlay — Schedules, " +
      "Skills, Tools, Providers, and the context gauge._",
  );
  return parts.join("\n");
}
