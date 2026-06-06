// assistant.ts — chat messages + the orchestration that applies assistant results
// to the page (proposals, diffs, db actions). Ported from app.jsx:117-194.
// `runAgent` / `askAbout` are wired to a real AssistantProvider in Phase 8.
import type { StateCreator } from "zustand";
import { blk, uid } from "../../lib/ids";
import { escapeHtml, stripHtml } from "../../lib/html";
import { scrollToProposal } from "../../lib/scroll";
import { getAssistantProvider } from "../../assistant/AssistantProvider";
import {
  buildAiActionPrompt,
  buildPlanPrompt,
  buildWorkPrompt,
  aiActionLabel,
  serializePlanBlocks,
} from "../../assistant/prompts";
import { TASKS } from "../../data/seed";
import type { Block } from "../../types";
import type { Store, AssistantSlice } from "../storeTypes";

const SEED_GREETING = [
  "Hi Maya — I'm your workspace assistant. I can read this page, rewrite text as tracked changes, answer questions, and act on the task board. Try a suggestion below.",
];

export const createAssistantSlice: StateCreator<
  Store,
  [],
  [],
  AssistantSlice
> = (set, get) => ({
  messages: [{ id: uid("m"), role: "bot", text: SEED_GREETING }],
  thinking: false,

  setThinking: (v) => set({ thinking: v }),

  pushUser: (text) =>
    set((s) => ({
      messages: [...s.messages, { id: uid("m"), role: "user", text: [text] }],
    })),

  pushBot: (msg) =>
    set((s) => ({
      messages: [...s.messages, { id: uid("m"), role: "bot", ...msg }],
    })),

  // Send a prompt to the active AssistantProvider and route the typed result onto
  // the page (chat / db-action card / tracked diff / appended proposal).
  // Ported from app.jsx runAgent.
  runAgent: (prompt, displayText) => {
    const s = get();
    s.pushUser(displayText ?? prompt);
    s.setThinking(true);
    const blocks = s.docs[s.page] || [];
    const pageTitle = (s.meta[s.page] || { title: "Untitled" }).title;
    getAssistantProvider()
      .respond(prompt, { blocks, pageTitle })
      .then((resp) => {
        get().setThinking(false);
        if (resp.kind === "chat") {
          get().pushBot({ text: resp.reply });
          return;
        }
        if (resp.kind === "db") {
          get().pushBot({
            text: resp.reply,
            dbAction: resp.action,
            label: resp.label,
            status: "pending",
          });
          return;
        }
        if (resp.kind === "diff") {
          const pid = uid("prop");
          let any = false;
          get().setBlocks((bs) =>
            bs.map((b) => {
              const hit = resp.edits.find(
                (e) =>
                  b.text &&
                  b.text.toLowerCase().includes(e.find.toLowerCase()) &&
                  !b.diff,
              );
              if (hit && !any) {
                any = true;
                return {
                  ...b,
                  diff: {
                    proposalId: pid,
                    oldHtml: b.html != null ? b.html : escapeHtml(b.text),
                    newHtml: hit.html,
                    label: resp.label,
                  },
                };
              }
              return b;
            }),
          );
          get().pushBot({
            text: resp.reply,
            proposalId: pid,
            label: resp.label,
            status: "pending",
            diff: true,
          });
          requestAnimationFrame(() => scrollToProposal(pid));
          return;
        }
        // append
        const pid = uid("prop");
        const tagged: Block[] = resp.blocks.map((b) => ({
          ...b,
          id: uid("pb"),
          proposalId: pid,
          proposalLabel: resp.label,
        }));
        get().setBlocks((bs) => {
          const next = [...bs];
          if (resp.at === "top") next.splice(1, 0, ...tagged);
          else {
            let idx = next.length;
            if (
              next[idx - 1] &&
              next[idx - 1].type === "p" &&
              !next[idx - 1].text
            )
              idx -= 1;
            next.splice(idx, 0, ...tagged);
          }
          return next;
        });
        get().pushBot({
          text: resp.reply,
          proposalId: pid,
          label: resp.label,
          status: "pending",
        });
        requestAnimationFrame(() => scrollToProposal(pid));
      });
  },

  // Selection "Ask AI" → open the assistant and ask it to explain the snippet.
  askAbout: (text) => {
    get().openPanelTab("assistant");
    const snippet = text.slice(0, 60) + (text.length > 60 ? "…" : "");
    get().runAgent(`About “${snippet}” — explain this.`);
  },

  // Inline co-author affordance (Milestone 1D): TLDR / eli5 / rewrite / summarize
  // / why over a selection. Routes through the same provider + result orchestration
  // as runAgent; only the prompt and the chat-bubble label differ.
  aiAction: (kind, text) => {
    get().openPanelTab("assistant");
    const prompt = buildAiActionPrompt(kind, text);
    get().runAgent(prompt, aiActionLabel(kind, text));
  },

  // `/plan` (Milestone 1B): produce a structured, vault-grounded plan as its OWN
  // page — Problem / Approach / Steps / Acceptance criteria (as todos) / References.
  // A dedicated page makes the plan a first-class artifact (it joins the vault +
  // note-index + graph and becomes the durable `/work` checkpoint) instead of
  // burying the plan in whatever page you happened to be on.
  runPlan: (idea, opts) => {
    const trimmed = idea.trim();
    const title =
      trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed || "Plan";
    // New plan page nested under the current page for context, then switch to it
    // so the appended plan blocks land in the new page.
    const pageId = get().makePage(
      { icon: "🧭", title },
      [blk("p", "")],
      get().page,
    );
    get().selectPage(pageId);
    get().openPanelTab("assistant");
    const prompt = buildPlanPrompt(idea, opts);
    get().runAgent(prompt, trimmed ? `Plan: ${trimmed}` : "Plan this page");
  },

  // `/work` (Milestone 1C): execute the plan on the current page over the
  // STREAMING, RESUMABLE Hermes session path (`sendMessage` SSE) — not the
  // single-shot assistant fetch. The page's Hermes session id is captured on the
  // first run and reused on later runs so a context blow-up doesn't lose progress;
  // the plan page is the durable checkpoint. Tokens stream live into one bot bubble.
  //
  // Streaming events are correlated by a per-run `clientRunId`: this run only
  // consumes its own tokens, so it never cross-talks with the Hermes admin Chat
  // (which owns the uncorrelated stream) or a concurrent run.
  runWork: async () => {
    const s = get();
    const pageId = s.page;
    const blocks = s.docs[pageId] || [];
    const meta = s.meta[pageId] || { title: "Untitled" };
    // Resume id: prefer the in-memory meta (fast path), else the durable sidecar
    // (survives reload in vault mode, where meta is rebuilt from frontmatter).
    const resumeId =
      meta.workSessionId ??
      (await window.hermesAPI.spsGetWorkSession(pageId)) ??
      undefined;
    const runId = uid("run");

    const planText = serializePlanBlocks(blocks);
    const message = `${buildWorkPrompt()}\n\n--- PLAN: ${meta.title} ---\n${planText}`;

    get().openPanelTab("assistant");
    s.pushUser(resumeId ? "Resume work on this plan" : "Work this plan");
    s.setThinking(true);

    // One growing bot bubble fed by the live token stream.
    const botId = uid("m");
    set((st) => ({
      messages: [...st.messages, { id: botId, role: "bot", text: [""] }],
    }));
    let acc = "";
    let tool: string | null = null;
    const render = (): void => {
      const note = tool ? `\n\n_running ${tool}…_` : "";
      set((st) => ({
        messages: st.messages.map((m) =>
          m.id === botId ? { ...m, text: [acc + note] } : m,
        ),
      }));
    };

    const cleanups = [
      window.hermesAPI.onChatChunk((chunk, rid) => {
        if (rid !== runId) return;
        acc += chunk;
        render();
      }),
      window.hermesAPI.onChatToolProgress((t, rid) => {
        if (rid !== runId) return;
        tool = t;
        render();
      }),
      window.hermesAPI.onChatApprovalAuto((req, rid) => {
        if (rid !== runId) return;
        // Audit trail: note each auto-approved command inline so scoped
        // autonomy is never fully silent.
        acc += `\n\n_✓ auto-approved: ${req.command ?? req.toolName ?? "command"}_`;
        render();
      }),
    ];

    try {
      const result = await window.hermesAPI.sendMessage(
        message,
        undefined,
        resumeId,
        undefined,
        undefined,
        undefined,
        runId,
      );
      if (result.response && !acc) acc = result.response;
      tool = null;
      render();
      // Persist the session id onto THIS plan page (the user may have navigated
      // away mid-run) so the next `/work` resumes the same agent session.
      if (result.sessionId) {
        const sessionId = result.sessionId;
        set((st) => ({
          meta: {
            ...st.meta,
            [pageId]: { ...st.meta[pageId], workSessionId: sessionId },
          },
        }));
        // Durable copy so resume survives a reload in either storage mode.
        void window.hermesAPI.spsSetWorkSession(pageId, sessionId);
      }
    } catch (err) {
      acc += `\n\nError: ${err instanceof Error ? err.message : "work failed"}.`;
      tool = null;
      render();
    } finally {
      cleanups.forEach((off) => off());
      get().setThinking(false);
    }
  },

  decideProposal: (pid, accept) => {
    get().setBlocks((bs) => {
      let out = bs.map((b) => {
        if (b.diff && b.diff.proposalId === pid) {
          if (accept)
            return {
              ...b,
              html: b.diff.newHtml,
              text: stripHtml(b.diff.newHtml),
              diff: undefined,
            };
          return { ...b, diff: undefined };
        }
        return b;
      });
      out = accept
        ? out.map((b) =>
            b.proposalId === pid
              ? { ...b, proposalId: undefined, proposalLabel: undefined }
              : b,
          )
        : out.filter((b) => b.proposalId !== pid);
      return out;
    });
    set((s) => ({
      messages: s.messages.map((m) =>
        m.proposalId === pid
          ? { ...m, status: accept ? "applied" : "rejected" }
          : m,
      ),
    }));
    get().flash(accept ? "Change applied" : "Suggestion discarded");
  },

  applyDbAction: (mid, action) => {
    get().setBlocks((bs) =>
      bs.map((b) => {
        if (b.type !== "database") return b;
        const rows = b.rows || TASKS;
        let next = rows;
        if (action.type === "markDone")
          next = rows.map((r) =>
            (action.who ? r.who === action.who : true)
              ? { ...r, status: "done" as const }
              : r,
          );
        else if (action.type === "addTask")
          next = [
            ...rows,
            {
              id: uid("t"),
              title: action.title,
              status: "todo" as const,
              prio: "med" as const,
              who: "maya",
              due: "Jun 6",
              est: "1d",
            },
          ];
        return {
          ...b,
          rows: next,
          view: action.type === "view" ? action.view : b.view,
        };
      }),
    );
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === mid ? { ...m, status: "applied" } : m,
      ),
    }));
    get().flash("Board updated");
  },

  dismissDbAction: (mid) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === mid ? { ...m, status: "rejected" } : m,
      ),
    })),
});
