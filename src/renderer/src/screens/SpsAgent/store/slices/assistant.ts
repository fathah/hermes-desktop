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
  buildResearchPrompt,
  capResearchBrief,
  aiActionLabel,
  serializePlanBlocks,
} from "../../assistant/prompts";
import { TASKS } from "../../data/seed";
import { commitChangeset } from "../../inbox/ingestApply";
import { buildResearchReachPromptHint } from "../../../../../../shared/research-reach";
import {
  enqueueApproval,
  initApprovalState,
  remainingSeconds,
  resolveApproval,
} from "../../../../lib/approval";
import type { AgentMessage } from "../../assistant/types";
import type { Block } from "../../types";
import type { Store, AssistantSlice, Conversation } from "../storeTypes";

const SEED_GREETING = [
  "I'm your workspace assistant. I can read this page, rewrite text as tracked changes, answer questions, and act on the task board. Try a suggestion below.",
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

function activeCriteriaFromBlocks(
  blocks: Block[],
): Array<{ text: string; done: boolean }> {
  return blocks
    .filter((b) => b.type === "todo" && b.text.trim())
    .map((b) => ({ text: b.text.trim(), done: Boolean(b.done) }));
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
    workApprovals: initApprovalState(),
    workApprovalTimeout: 0,
    workApprovalNow: Date.now(),

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
      // Private notes the user pinned to text on this page (unarchived). Fed to
      // the agent as authoritative intent — see PageContext.notes.
      const notes = s.comments
        .filter((c) => (!c.page || c.page === s.page) && !c.resolved)
        .map((c) => {
          const body = c.messages
            .map((m) => m.text)
            .filter(Boolean)
            .join(" ");
          return c.quote ? `On “${c.quote}”: ${body}` : body;
        })
        .filter(Boolean);
      getAssistantProvider()
        .respond(prompt, { blocks, pageTitle, notes })
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
          if (resp.kind === "append") {
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
            return;
          }
          if (resp.kind === "page") {
            const pageId = get().makePage(
              { icon: "📄", title: resp.title },
              [{ id: uid("b"), type: "p", text: "" }],
              get().page,
            );
            get().selectPage(pageId);
            addMsg(convId, {
              id: uid("m"),
              role: "bot",
              text: resp.reply,
              pageAction: { title: resp.title, template: resp.template },
              label: resp.label,
              status: "applied",
              context: resp.context,
            });
            return;
          }
          if (resp.kind === "ssh") {
            addMsg(convId, {
              id: uid("m"),
              role: "bot",
              text: resp.reply,
              sshAction: { action: resp.action },
              label: resp.label,
              status: "pending",
              context: resp.context,
            });
            return;
          }
          if (resp.kind === "config") {
            addMsg(convId, {
              id: uid("m"),
              role: "bot",
              text: resp.reply,
              configAction: { provider: resp.provider, key: resp.key },
              label: resp.label,
              status: "pending",
              context: resp.context,
            });
            return;
          }
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
    //
    // NOTE: no trust chip here (unlike runAgent). This path streams the full
    // tool-using agent via sendMessage, where grounding (memory/USER.md/rules) is
    // applied server-side and the desktop never receives a notes/memory/rules
    // count. A chip would have to fabricate one — so provenance is surfaced as the
    // visible tool stream (onChatToolProgress) instead. Don't bolt on a fake count.
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
      let activeWorkId: string | null = null;

      get().openPanelTab("assistant");
      const userLabel = resumeId
        ? "Resume work on this plan"
        : "Work this plan";
      addMsg(convId, { id: uid("m"), role: "user", text: [userLabel] });
      maybeTitle(convId, `Work: ${meta.title}`);
      setConvThinking(convId, true);
      set({ workApprovals: initApprovalState() });
      window.hermesAPI
        .getConfig("approval.timeout_seconds", undefined)
        .then((v) =>
          get().setWorkApprovalTimeout(
            Math.max(0, parseInt(v || "0", 10) || 0),
          ),
        )
        .catch(() => get().setWorkApprovalTimeout(0));

      const botId = uid("m");
      addMsg(convId, { id: botId, role: "bot", text: [""] });
      let acc = "";
      let tool: string | null = null;
      const render = (): void => {
        const note = tool ? `\n\n_running ${tool}…_` : "";
        updateMsg(convId, botId, { text: [acc + note] });
      };

      try {
        const active = await window.hermesAPI.spsCreateActiveWorkRun({
          source: "sps-work",
          title: `Work: ${meta.title}`,
          goal: `Execute the plan "${meta.title}"`,
          pageId,
          pageTitle: meta.title,
          sessionId: resumeId,
          clientRunId: runId,
          criteria: activeCriteriaFromBlocks(blocks),
        });
        activeWorkId = active.id;
      } catch {
        activeWorkId = null;
      }

      const cleanups = [
        window.hermesAPI.onChatChunk((chunk, rid) => {
          if (rid !== runId) return;
          acc += chunk;
          render();
        }),
        window.hermesAPI.onChatToolProgress((t, rid) => {
          if (rid !== runId) return;
          tool = t;
          if (activeWorkId) {
            void window.hermesAPI.spsUpdateActiveWorkRun(activeWorkId, {
              lastTool: t,
              lastHeartbeatAt: Date.now(),
            });
          }
          render();
        }),
        window.hermesAPI.onChatApprovalRequest((req, rid) => {
          if (rid !== runId) return;
          get().enqueueWorkApproval(req);
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
        if (activeWorkId) {
          void window.hermesAPI.spsUpdateActiveWorkRun(activeWorkId, {
            sessionId: result.sessionId,
            status: "completed",
            summary: acc.slice(0, 500),
            completedAt: Date.now(),
            lastTool: null,
            artifacts: [
              {
                id: uid("artifact"),
                kind: "page",
                label: meta.title,
                ref: pageId,
                createdAt: Date.now(),
              },
              ...(result.sessionId
                ? [
                    {
                      id: uid("artifact"),
                      kind: "session" as const,
                      label: "Assistant session",
                      ref: result.sessionId,
                      createdAt: Date.now(),
                    },
                  ]
                : []),
            ],
          });
        }
      } catch (err) {
        acc += `\n\nError: ${err instanceof Error ? err.message : "work failed"}.`;
        tool = null;
        render();
        if (activeWorkId) {
          void window.hermesAPI.spsUpdateActiveWorkRun(activeWorkId, {
            status: "failed",
            error: err instanceof Error ? err.message : "work failed",
            completedAt: Date.now(),
            lastTool: null,
          });
        }
      } finally {
        cleanups.forEach((off) => off());
        setConvThinking(convId, false);
      }
    },

    enqueueWorkApproval: (req) => {
      set((s) => {
        const { state, autoResponse } = enqueueApproval(s.workApprovals, {
          ...req,
          enqueuedAt: req.enqueuedAt ?? Date.now(),
        });
        if (autoResponse) {
          void window.hermesAPI.respondApproval(
            autoResponse.id,
            autoResponse.choice,
            undefined,
          );
        }
        return { workApprovals: state };
      });
    },

    respondWorkApproval: (id, choice) => {
      set((s) => {
        const { state, response } = resolveApproval(
          s.workApprovals,
          id,
          choice,
        );
        void window.hermesAPI.respondApproval(
          response.id,
          response.choice,
          undefined,
        );
        return { workApprovals: state };
      });
    },

    tickWorkApprovalTimeouts: (now) => {
      set((s) => {
        if (s.workApprovalTimeout <= 0 || s.workApprovals.queue.length === 0) {
          return { workApprovalNow: now };
        }
        let next = s.workApprovals;
        for (const req of s.workApprovals.queue) {
          if (
            remainingSeconds(req.enqueuedAt, now, s.workApprovalTimeout) !== 0
          ) {
            continue;
          }
          const { state, response } = resolveApproval(next, req.id, "deny");
          next = state;
          void window.hermesAPI.respondApproval(
            response.id,
            response.choice,
            undefined,
          );
        }
        return { workApprovalNow: now, workApprovals: next };
      });
    },

    setWorkApprovalTimeout: (seconds) =>
      set({ workApprovalTimeout: Math.max(0, seconds) }),

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

    applySshAction: async (mid, action) => {
      try {
        let ok = false;
        if (action === "start") {
          ok = await window.hermesAPI.startSshTunnel();
        } else {
          ok = await window.hermesAPI.stopSshTunnel();
        }
        set((s) => ({
          conversations: s.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === mid ? { ...m, status: ok ? "applied" : "rejected" } : m,
            ),
          })),
        }));
        get().flash(
          ok ? `SSH tunnel ${action}ed` : `Failed to ${action} SSH tunnel`,
          ok ? undefined : { tone: "warn" },
        );
      } catch (err) {
        get().flash(
          `SSH error: ${err instanceof Error ? err.message : String(err)}`,
          { tone: "warn" },
        );
      }
    },

    applyConfigAction: async (mid, provider, key) => {
      try {
        // MED-2: route through the allowlisted provider-key IPC (validates the
        // provider and maps to the env var server-side) instead of the generic
        // set-env, so this path can't write arbitrary env.
        const ok = await window.hermesAPI.setProviderKey(provider, key);
        set((s) => ({
          conversations: s.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === mid
                ? {
                    ...m,
                    status: ok ? "applied" : "rejected",
                    // MED-2: scrub the raw key so it never persists into the
                    // conversation transcript / workspace.json.
                    configAction: m.configAction
                      ? { ...m.configAction, key: "••••" }
                      : m.configAction,
                  }
                : m,
            ),
          })),
        }));
        get().flash(
          ok
            ? `Saved key for ${provider}`
            : `Failed to save key for ${provider}`,
          ok ? undefined : { tone: "warn" },
        );
      } catch (err) {
        get().flash(
          `Config error: ${err instanceof Error ? err.message : String(err)}`,
          { tone: "warn" },
        );
      }
    },
    fileAnswerToWiki: async (messageId) => {
      // Find the bot answer and the user question that produced it (the nearest
      // preceding user turn). Message ids are globally unique, so search every
      // tab. SPS is single-profile, so profile is left undefined (like runAgent).
      let answer = "";
      let question = "";
      for (const c of get().conversations) {
        const idx = c.messages.findIndex((m) => m.id === messageId);
        if (idx < 0) continue;
        answer = c.messages[idx].text.join("\n\n").trim();
        for (let i = idx - 1; i >= 0; i--) {
          if (c.messages[i].role === "user") {
            question = c.messages[i].text.join(" ").trim();
            break;
          }
        }
        break;
      }
      if (!answer) return { ok: false, error: "Nothing to file." };
      try {
        const res = await window.hermesAPI.spsFileAnswer?.(question, answer);
        if (!res?.ok || !res.changeset) {
          return { ok: false, error: res?.error ?? "Filing is unavailable." };
        }
        const { pages } = await commitChangeset(
          res.changeset,
          get().ingestCommitPage,
        );
        // Phase 3a: record the wiki's growth in the append-only log.md.
        await window.hermesAPI.spsAppendWikiLog?.(
          "file-answer",
          res.changeset.summary,
        );
        return { ok: true, pages, summary: res.changeset.summary };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "file error",
        };
      }
    },

    // `Research` (research-that-compounds): research ANY topic on the live web
    // (a headless streaming, tool-using turn — NOT a visible chat tab), then
    // synthesize the cited brief into a durable wiki page and auto-commit it to
    // the knowledge base. Returns an `undo` closure so the modal can offer a
    // one-click reversal. SPS is single-profile, so profile is left undefined.
    runResearch: async (topic, handlers, intent = "all") => {
      const trimmed = topic.trim();
      if (!trimmed) return { ok: false, error: "Enter a topic to research." };
      const runId = uid("run");
      let acc = "";
      const cleanups = [
        window.hermesAPI.onChatChunk((chunk, rid) => {
          if (rid !== runId) return;
          acc += chunk;
          handlers?.onChunk?.(acc);
        }),
        window.hermesAPI.onChatToolProgress((tool, rid) => {
          if (rid !== runId) return;
          handlers?.onTool?.(tool);
        }),
      ];

      let markdown = "";
      try {
        let sourceHint = "";
        try {
          const reach = await window.hermesAPI.getResearchReachStatus?.();
          sourceHint = buildResearchReachPromptHint(reach, intent);
        } catch {
          sourceHint = "";
        }

        const result = await window.hermesAPI.sendMessage(
          buildResearchPrompt(trimmed, { sourceHint }),
          undefined, // profile
          undefined, // resumeSessionId
          undefined, // history
          undefined, // attachments
          undefined, // contextFolder
          undefined, // groundInWorkspace
          runId, // clientRunId
        );
        markdown = (result.response || acc).trim();
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Research failed.",
        };
      } finally {
        cleanups.forEach((off) => off());
        handlers?.onTool?.(null);
      }

      // Hallucination guard: a real web-research turn ends with a "## Sources"
      // section listing at least one http(s) link. No sources ⇒ the agent had no
      // live web access (or refused) — do NOT pollute the KB with unverified
      // synthesis. The renderer surfaces this as a warning instead of committing.
      const hasSourcesHeading = /^#{1,6}\s*sources\b/im.test(markdown);
      const hasSourceLink = /\]\(https?:\/\//i.test(markdown);
      if (!markdown) return { ok: false, error: "no-result" };
      if (!hasSourcesHeading || !hasSourceLink) {
        return { ok: false, error: "no-sources" };
      }

      try {
        // Cap what the file-synthesis pass has to read/reproduce so its JSON
        // output can't be truncated — keeping the full "## Sources" section.
        const brief = capResearchBrief(markdown);
        const res = await window.hermesAPI.spsFileResearch?.(trimmed, brief);
        if (!res?.ok || !res.changeset) {
          return { ok: false, error: res?.error ?? "Filing is unavailable." };
        }
        // Snapshot affected pages BEFORE commit so undo can reverse create
        // (→ trash) or update (→ restore prior doc + meta).
        const snapshots = res.changeset.pages.map((p) => {
          const existedBefore =
            !!get().docs[p.pageId] || !!get().meta[p.pageId];
          return {
            pageId: p.pageId,
            existedBefore,
            priorBlocks: get().docs[p.pageId],
            priorMeta: get().meta[p.pageId],
          };
        });
        await commitChangeset(res.changeset, get().ingestCommitPage);
        await window.hermesAPI.spsAppendWikiLog?.(
          "research",
          res.changeset.summary,
        );
        const firstPageId = res.changeset.pages[0]?.pageId;
        if (firstPageId) get().selectPage(firstPageId);
        const undo = (): void => {
          for (const snap of snapshots) {
            if (!snap.existedBefore) {
              get().deletePage(snap.pageId); // created → move to trash
            } else if (snap.priorBlocks) {
              get().setPageDoc(snap.pageId, snap.priorBlocks); // update → restore
              if (snap.priorMeta)
                get().setPageMeta(snap.pageId, snap.priorMeta);
            }
          }
        };
        return {
          ok: true,
          summary: res.changeset.summary,
          pageId: firstPageId,
          undo,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "research-file error",
        };
      }
    },
    saveStudyToWiki: async (focus, answer) => {
      const question = focus.trim();
      const markdown = answer.trim();
      if (!markdown) return { ok: false, error: "Nothing to file." };

      try {
        const res = await window.hermesAPI.spsFileAnswer?.(question, markdown);
        if (!res?.ok || !res.changeset) {
          return { ok: false, error: res?.error ?? "Filing is unavailable." };
        }
        const snapshots = res.changeset.pages.map((p) => {
          const existedBefore =
            !!get().docs[p.pageId] || !!get().meta[p.pageId];
          return {
            pageId: p.pageId,
            existedBefore,
            priorBlocks: get().docs[p.pageId],
            priorMeta: get().meta[p.pageId],
          };
        });
        await commitChangeset(res.changeset, get().ingestCommitPage);
        await window.hermesAPI.spsAppendWikiLog?.(
          "file-answer",
          res.changeset.summary,
        );
        const firstPageId = res.changeset.pages[0]?.pageId;
        if (firstPageId) get().selectPage(firstPageId);
        const undo = (): void => {
          for (const snap of snapshots) {
            if (!snap.existedBefore) {
              get().deletePage(snap.pageId);
            } else if (snap.priorBlocks) {
              get().setPageDoc(snap.pageId, snap.priorBlocks);
              if (snap.priorMeta)
                get().setPageMeta(snap.pageId, snap.priorMeta);
            }
          }
        };
        return {
          ok: true,
          summary: res.changeset.summary,
          pageId: firstPageId,
          undo,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "file error",
        };
      }
    },
  };
};
