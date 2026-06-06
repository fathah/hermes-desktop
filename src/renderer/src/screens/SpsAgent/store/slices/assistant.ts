// assistant.ts — assistant conversations + the orchestration that applies results
// to the page (proposals, diffs, db actions).
//
// Milestone 3 (#5): the panel now holds MULTIPLE conversations as tabs so several
// agent runs can proceed at once — one planning, one working, one researching.
// State is `conversations[]` + `activeConvId`; async flows (runAgent/runWork)
// CAPTURE their conversation id at start and write only to it, so switching tabs
// mid-run never lands tokens in the wrong tab. Streaming runs are already isolated
// on the wire by `clientRunId`; this isolates them in the UI too. Proposal/db
// decisions search across all conversations (a message id is globally unique).
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
import type { AgentMessage } from "../../assistant/types";
import type { Block } from "../../types";
import type { Store, AssistantSlice, Conversation } from "../storeTypes";

const SEED_GREETING = [
  "Hi Maya — I'm your workspace assistant. I can read this page, rewrite text as tracked changes, answer questions, and act on the task board. Try a suggestion below.",
];

const DEFAULT_TITLE_RE = /^(Chat|New chat)( \d+)?$/;

function freshConversation(title = "Chat"): Conversation {
  return {
    id: uid("conv"),
    title,
    messages: [{ id: uid("m"), role: "bot", text: SEED_GREETING }],
    thinking: false,
  };
}

export const createAssistantSlice: StateCreator<
  Store,
  [],
  [],
  AssistantSlice
> = (set, get) => {
  // ── conversation-targeted writers (used by the async flows) ──
  const addMsg = (convId: string, msg: AgentMessage): void =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, msg] } : c,
      ),
    }));
  const setConvThinking = (convId: string, v: boolean): void =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, thinking: v } : c,
      ),
    }));
  const updateMsg = (
    convId: string,
    msgId: string,
    patch: Partial<AgentMessage>,
  ): void =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, ...patch } : m,
              ),
            }
          : c,
      ),
    }));
  // Title a conversation from its first real prompt (if still on a default title).
  const maybeTitle = (convId: string, text: string): void =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== convId || !DEFAULT_TITLE_RE.test(c.title)) return c;
        const t = text.trim();
        return {
          ...c,
          title: t.length > 32 ? `${t.slice(0, 32)}…` : t || c.title,
        };
      }),
    }));

  const seed = freshConversation();

  return {
    conversations: [seed],
    activeConvId: seed.id,

    // ── tabs ──
    newConversation: () =>
      set((s) => {
        const conv = freshConversation(`Chat ${s.conversations.length + 1}`);
        return {
          conversations: [...s.conversations, conv],
          activeConvId: conv.id,
        };
      }),
    selectConversation: (id) => set({ activeConvId: id }),
    closeConversation: (id) =>
      set((s) => {
        if (s.conversations.length <= 1) return s; // always keep one tab
        const remaining = s.conversations.filter((c) => c.id !== id);
        const activeConvId =
          s.activeConvId === id
            ? remaining[remaining.length - 1].id
            : s.activeConvId;
        return { conversations: remaining, activeConvId };
      }),

    // ── active-conversation writers (synchronous callers) ──
    setThinking: (v) => setConvThinking(get().activeConvId, v),
    pushUser: (text) =>
      addMsg(get().activeConvId, { id: uid("m"), role: "user", text: [text] }),
    pushBot: (msg) =>
      addMsg(get().activeConvId, { id: uid("m"), role: "bot", ...msg }),

    // Send a prompt to the active AssistantProvider and route the typed result onto
    // the page (chat / db-action card / tracked diff / appended proposal).
    runAgent: (prompt, displayText) => {
      const convId = get().activeConvId; // capture: result lands in THIS tab
      const s = get();
      addMsg(convId, {
        id: uid("m"),
        role: "user",
        text: [displayText ?? prompt],
      });
      maybeTitle(convId, displayText ?? prompt);
      setConvThinking(convId, true);
      const blocks = s.docs[s.page] || [];
      const pageTitle = (s.meta[s.page] || { title: "Untitled" }).title;
      getAssistantProvider()
        .respond(prompt, { blocks, pageTitle })
        .then((resp) => {
          setConvThinking(convId, false);
          if (resp.kind === "chat") {
            addMsg(convId, {
              id: uid("m"),
              role: "bot",
              text: resp.reply,
              context: resp.context,
            });
            return;
          }
          if (resp.kind === "db") {
            addMsg(convId, {
              id: uid("m"),
              role: "bot",
              text: resp.reply,
              dbAction: resp.action,
              label: resp.label,
              status: "pending",
              context: resp.context,
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
            addMsg(convId, {
              id: uid("m"),
              role: "bot",
              text: resp.reply,
              proposalId: pid,
              label: resp.label,
              status: "pending",
              diff: true,
              context: resp.context,
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
          addMsg(convId, {
            id: uid("m"),
            role: "bot",
            text: resp.reply,
            proposalId: pid,
            label: resp.label,
            status: "pending",
            context: resp.context,
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
    // / why over a selection. Routes through the same provider + result orchestration.
    aiAction: (kind, text) => {
      get().openPanelTab("assistant");
      const prompt = buildAiActionPrompt(kind, text);
      get().runAgent(prompt, aiActionLabel(kind, text));
    },

    // `/plan` (Milestone 1B): produce a structured, vault-grounded plan as its OWN
    // page — Problem / Approach / Steps / Acceptance criteria (as todos) / References.
    runPlan: (idea, opts) => {
      const trimmed = idea.trim();
      const title =
        trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed || "Plan";
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

    // `/work` (Milestone 1C): execute the plan over the STREAMING, RESUMABLE Hermes
    // session path. Captures its conversation id so live tokens land in the right
    // tab even if the user switches tabs mid-run.
    runWork: async () => {
      const convId = get().activeConvId;
      const s = get();
      const pageId = s.page;
      const blocks = s.docs[pageId] || [];
      const meta = s.meta[pageId] || { title: "Untitled" };
      const resumeId =
        meta.workSessionId ??
        (await window.hermesAPI.spsGetWorkSession(pageId)) ??
        undefined;
      const runId = uid("run");

      const planText = serializePlanBlocks(blocks);
      const message = `${buildWorkPrompt()}\n\n--- PLAN: ${meta.title} ---\n${planText}`;

      get().openPanelTab("assistant");
      const userLabel = resumeId
        ? "Resume work on this plan"
        : "Work this plan";
      addMsg(convId, { id: uid("m"), role: "user", text: [userLabel] });
      maybeTitle(convId, `Work: ${meta.title}`);
      setConvThinking(convId, true);

      const botId = uid("m");
      addMsg(convId, { id: botId, role: "bot", text: [""] });
      let acc = "";
      let tool: string | null = null;
      const render = (): void => {
        const note = tool ? `\n\n_running ${tool}…_` : "";
        updateMsg(convId, botId, { text: [acc + note] });
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
          acc += `\n\n_✓ auto-approved: ${req.command ?? req.toolName ?? "command"}_`;
          render();
        }),
      ];

      try {
        const result = await window.hermesAPI.sendMessage(
          message,
          undefined, // profile
          resumeId,
          undefined, // history
          undefined, // attachments
          undefined, // contextFolder
          undefined, // groundInWorkspace
          runId, // clientRunId
        );
        if (result.response && !acc) acc = result.response;
        tool = null;
        render();
        if (result.sessionId) {
          const sessionId = result.sessionId;
          set((st) => ({
            meta: {
              ...st.meta,
              [pageId]: { ...st.meta[pageId], workSessionId: sessionId },
            },
          }));
          void window.hermesAPI.spsSetWorkSession(pageId, sessionId);
        }
      } catch (err) {
        acc += `\n\nError: ${err instanceof Error ? err.message : "work failed"}.`;
        tool = null;
        render();
      } finally {
        cleanups.forEach((off) => off());
        setConvThinking(convId, false);
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
      // The proposal message may live in any tab — update wherever it is.
      set((s) => ({
        conversations: s.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.proposalId === pid
              ? { ...m, status: accept ? "applied" : "rejected" }
              : m,
          ),
        })),
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
        conversations: s.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === mid ? { ...m, status: "applied" } : m,
          ),
        })),
      }));
      get().flash("Board updated");
    },

    dismissDbAction: (mid) =>
      set((s) => ({
        conversations: s.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === mid ? { ...m, status: "rejected" } : m,
          ),
        })),
      })),
  };
};
