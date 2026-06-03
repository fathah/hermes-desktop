// MockAssistant.ts — the offline provider: a faithful port of the prototype's
// canned generateResponse (agent.jsx). Same typed contract as every other
// provider, so the UI is provider-agnostic.
import { blk } from "../../lib/ids";
import { PEOPLE } from "../../data/seed";
import type { Block, PersonKey } from "../../types";
import type { AssistantProvider, AssistantResult, PageContext } from "../types";

function firstLong(blocks: Block[], min = 40): Block | undefined {
  return blocks.find(
    (b) =>
      b.type === "p" &&
      b.text &&
      b.text.length > min &&
      !b.diff &&
      !b.proposalId,
  );
}
function tighten(text: string): string {
  const s = (text || "").replace(/\s+/g, " ").trim();
  const m = s.match(/^(.*?[.!?])(\s|$)/);
  return m ? m[1] : s.split(" ").slice(0, 16).join(" ") + ".";
}
function nameInPrompt(q: string): PersonKey | null {
  for (const k of Object.keys(PEOPLE)) {
    if (q.includes(k) || q.includes(PEOPLE[k].name.toLowerCase().split(" ")[0]))
      return k;
  }
  return null;
}

export function generateResponse(
  prompt: string,
  blocks: Block[],
): AssistantResult {
  const q = prompt.toLowerCase();

  // database actions
  if (
    /(mark|set|complete|finish).*(done|complete)|all done|mark everything/.test(
      q,
    )
  ) {
    const who = nameInPrompt(q);
    return {
      kind: "db",
      reply: [
        who
          ? `Mark ${PEOPLE[who].name.split(" ")[0]}'s tasks as done?`
          : "Mark every task on the board as done?",
      ],
      label: who
        ? `Complete ${PEOPLE[who].name.split(" ")[0]}'s tasks`
        : "Complete all tasks",
      action: { type: "markDone", who },
    };
  }
  if (/add (a )?task|new task|create task/.test(q)) {
    const title = prompt.replace(/.*task[:\s]*/i, "").trim() || "New task";
    return {
      kind: "db",
      reply: [`Add “${title}” to the board?`],
      label: "Add task",
      action: { type: "addTask", title },
    };
  }
  if (
    /group by|calendar view|board view|gallery view|show.*(calendar|board|gallery)/.test(
      q,
    )
  ) {
    const view = /calendar/.test(q)
      ? "calendar"
      : /gallery/.test(q)
        ? "gallery"
        : "board";
    return {
      kind: "db",
      reply: [`Switch the task database to ${view} view?`],
      label: `Switch to ${view}`,
      action: { type: "view", view },
    };
  }

  // diff (tracked-change rewrite)
  if (/(tighten|rewrite|shorten|clean|polish|fix|trim|condense)/.test(q)) {
    const target = firstLong(blocks);
    if (!target)
      return {
        kind: "chat",
        reply: [
          "There's no long paragraph on this page to tighten. Point me at the text and I'll rework it.",
        ],
      };
    return {
      kind: "diff",
      reply: [
        "I tightened the opening paragraph. Review the tracked change in the page — green is new, struck-through is removed.",
      ],
      label: "Tighten paragraph",
      edits: [{ find: target.text.slice(0, 18), html: tighten(target.text) }],
    };
  }

  // chat (questions)
  if (
    /^(what|why|how|who|when|where|is |are |should |can |explain|summari[sz]e the status|status)/.test(
      q,
    ) &&
    !/next step|draft|plan/.test(q)
  ) {
    if (/summ|recap|status/.test(q))
      return {
        kind: "chat",
        reply: [
          "Status: onboarding redesign is in progress (Maya), analytics migration in progress (Theo), 2.4 changelog and pricing copy still open. Two decisions pending: analytics backfill and pricing sign-off.",
        ],
      };
    return {
      kind: "chat",
      reply: [
        "From what's on this page: the team is mid-cycle on the 2.4 release. I can pull the relevant section into a summary, draft next steps, or open the task board — say which.",
      ],
    };
  }

  // append proposals
  if (/summ|recap|tl;dr/.test(q)) {
    return {
      kind: "append",
      reply: [
        "I read the page and pulled the essentials into a callout, placed up top.",
      ],
      label: "Add summary callout",
      at: "top",
      blocks: [
        blk(
          "callout",
          "This week: ship onboarding to staging, finish the analytics migration, and lock 2.4 scope. Open: analytics backfill and pricing-copy sign-off.",
          { emoji: "🧭" },
        ),
      ],
    };
  }
  if (/next step|draft|plan/.test(q)) {
    return {
      kind: "append",
      reply: [
        "Based on the decisions and open questions, here are next steps. Accept to add them to the page.",
      ],
      label: "Draft next steps",
      at: "bottom",
      blocks: [
        blk("h3", "Next steps"),
        blk("todo", "Confirm staging deploy window with eng (Thursday)", {
          done: false,
        }),
        blk("todo", "Priya circulates the migration guide draft by Friday", {
          done: false,
        }),
        blk("todo", "Decide analytics backfill vs. clean start — Theo", {
          done: false,
        }),
        blk("todo", "Route pricing copy to Sam for sign-off", { done: false }),
      ],
    };
  }
  if (/task|action item|to-?do/.test(q)) {
    return {
      kind: "append",
      reply: [
        "I scanned the notes for commitments and turned them into action items.",
      ],
      label: "New action items",
      at: "bottom",
      blocks: [
        blk("todo", "Backfill decision documented in the roadmap", {
          done: false,
        }),
        blk("todo", "Migration guide draft — Priya, Fri", { done: false }),
        blk("todo", "Pricing copy sign-off — Sam", { done: false }),
      ],
    };
  }
  return {
    kind: "append",
    reply: [
      "I drafted a block you can drop into the page. Want me to expand it or take another angle?",
    ],
    label: "Suggested block",
    at: "bottom",
    blocks: [
      blk(
        "p",
        "Reminder: keep standup blockers to one line, and link the doc rather than pasting screenshots so search stays useful.",
      ),
    ],
  };
}

export class MockAssistant implements AssistantProvider {
  async respond(prompt: string, ctx: PageContext): Promise<AssistantResult> {
    // small delay so the thinking indicator shows, matching the prototype feel
    await new Promise((r) => setTimeout(r, 600));
    return generateResponse(prompt, ctx.blocks);
  }
}
