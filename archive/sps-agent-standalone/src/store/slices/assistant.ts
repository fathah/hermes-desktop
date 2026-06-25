// assistant.ts — chat messages + the orchestration that applies assistant results
// to the page (proposals, diffs, db actions). Ported from app.jsx:117-194.
// `runAgent` / `askAbout` are wired to a real AssistantProvider in Phase 8.
import type { StateCreator } from "zustand";
import { uid } from "../../lib/ids";
import { escapeHtml, stripHtml } from "../../lib/html";
import { scrollToProposal } from "../../lib/scroll";
import { getAssistantProvider } from "../../assistant/AssistantProvider";
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
  runAgent: (prompt) => {
    const s = get();
    s.pushUser(prompt);
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
