# Spec — Scheduled Research

> Status: draft v1 · Author: design session 2026-06-09 · Feature builds on the
> shipped research-to-KB feature (main commits `6863828` → `aa24cbf`).

## 1. Context & goal

The research feature is **manual**: open the Research modal, type a topic, and a
cited page is synthesized into the Knowledge Base (`Wiki/`). The user is the
trigger every time.

**Scheduled research** lets a user set a topic + cadence once, and the system
re-researches it on a timer and keeps a **living KB page** current — a
self-updating second brain. Example: _"Every Monday, research 'UK SIA
guarding-licence changes' and update my note; ping me on Telegram if something
changed."_

**Goal:** turn the existing one-shot research run into a recurring, low-noise,
reviewable update loop that reuses the cron, agent, `_inbox`/ingest, and
messaging machinery the app already ships.

## 2. Locked product decisions (from design session)

1. **Update model = smart-merge in place.** One living `Wiki/<topic>.md` per
   scheduled topic. Each run produces an `op:"update"` that rewrites the page to
   stay current and appends a dated line to a `## Updates` changelog. (Not
   append-only sections; not new-page-per-run.)
2. **Save only on meaningful change.** A run compares new findings to the
   existing page; if nothing materially changed it writes nothing and logs
   "no new info." (Not always-save.)
3. **Surfacing = Inbox digest item + optional Telegram push.** Every change-
   producing run lands a reviewable item in the existing **Inbox** surface.
   Additionally, push to Telegram **iff** a Telegram channel is configured **and**
   the schedule's `telegramPush` toggle is on. (No generic OS notification.)

## 3. User stories (EARS)

- WHEN a scheduled topic's cadence fires THE SYSTEM SHALL run a web-grounded
  research turn for that topic using the agent's `web`/`x_search` tools.
- WHILE comparing a run's findings to the existing living page THE SYSTEM SHALL
  produce a KB write **only** if the findings materially change or extend it.
- WHEN a run produces a change THE SYSTEM SHALL (a) queue a smart-merge into the
  Inbox as a digest item, and (b) IF a Telegram channel is configured AND the
  schedule's `telegramPush` toggle is on, send a one-line Telegram summary.
- IF a run finds no meaningful change THEN THE SYSTEM SHALL record "no new info"
  in the schedule's run history and write nothing to the KB or Telegram.
- IF the gateway is unreachable or returns no sources THEN THE SYSTEM SHALL skip
  the run, record the failure reason, and retry on the next cadence (no partial
  or uncited write — same guard as manual research).
- WHERE a schedule has `autoApply` enabled THE SYSTEM SHALL apply the smart-merge
  without manual review; otherwise the merge waits in the Inbox for one click.

## 4. Architecture

### 4.1 The load-bearing constraint: storage mode

In the **default `blob` mode**, the renderer's workspace blob (Electron
`userData` localStorage) is authoritative and `vault/<id>.md` is a **write-only
mirror that is never read back**. Therefore a background job that writes
`vault/<id>.md` directly would **not** appear in the user's workspace. The KB
write must go through the renderer commit path (`commitChangeset` →
`ingestCommitPage`) so both modes stay consistent.

`vault/_inbox/` captures are the **mode-agnostic intake**: the desktop's ingest
reads them on open regardless of storage mode. So scheduled runs deposit their
result as an `_inbox` capture and let the existing ingest/apply path perform the
actual KB write. This is the keystone decision.

### 4.2 Execution model — gateway cron produces, desktop ingest commits

```
Hermes gateway cron (server-side, runs even with the desktop app CLOSED)
  └─ per schedule, on cadence:
       1. research turn (web/x_search) on the topic           [agent, tools]
       2. read the existing living page (file/obsidian tool)   [agent reads vault/<id>.md]
       3. decide: materially changed vs not                    [agent + hash guard]
       4. if changed → write an _inbox capture tagged with     [agent file write]
          {target pageId, op:update, changelog line, sources}
       5. if changed AND telegramPush AND channel configured → [agent messaging tool]
          send a one-line Telegram summary
       6. append the run outcome to scheduled-research history  [jsonl]

Desktop (when open, or on next launch — catch-up)
  └─ Inbox surface shows the capture as a digest item
  └─ apply (manual, or auto if schedule.autoApply):
       commitChangeset(op:"update") → smart-merge the living page
       + append "## Updates" changelog + spsAppendWikiLog("research", …)
       + ensureIndexCoverage()
```

**Why gateway cron, not a desktop-main-process timer:** the gateway is already a
long-running process (observed listening on `127.0.0.1:8642` with the desktop
app closed) and already has a cron subsystem (`src/main/cronjobs.ts`,
`src/main/ipc/automation.ts`: `create/pause/resume/trigger-cron-job`) plus the
`web`/`x_search`/`messaging` toolsets. Running research server-side means
schedules fire overnight without the app open; the desktop only needs to
register the schedule and surface/apply results. A desktop-main timer would only
run while the app is open — defeating "wake up to fresh notes."

**Trade-off (documented):** the KB does not visibly update until the desktop
opens and the capture is ingested. That is acceptable for daily/weekly cadences
and preserves blob-mode correctness + the propose→review→apply keystone. True
app-closed KB mutation would require `vault`-authoritative mode (a later option).

### 4.3 A scheduled-research job = a Hermes cron job + SPS metadata

Reuse `create-cron-job` (gateway cron) with a generated **prompt** that encodes
the research+merge+notify instructions, plus a sidecar metadata record the
desktop owns (so the UI can list/edit schedules without parsing prompts).

## 5. Data model

`<profileHome>/sps-agent/scheduled-research.json` — desktop-owned registry:

```jsonc
{
  "schedules": [{
    "id": "sr_uk-guarding",
    "topic": "UK SIA guarding-licence changes",
    "pageId": "uk-guarding-regs",        // the living Wiki page (slug)
    "cadence": "0 8 * * 1",              // cron expr (Mon 08:00)
    "cronJobId": "<hermes cron job id>",  // link to the gateway cron job
    "autoApply": false,                   // default: review in Inbox
    "telegramPush": true,                 // gated on a configured channel
    "lastRunAt": 1718000000000,
    "lastChangeHash": "sha256:…",         // content hash for change detection
    "enabled": true
  }]
}
```

Run history: append-only `<profileHome>/sps-agent/scheduled-research.jsonl`
(mirrors the equity-alerts pattern) — `{scheduleId, ts, outcome:
"changed"|"no-change"|"error", summary, sources}`.

`_inbox` capture format (extends the existing capture): frontmatter carries
`source: "scheduled-research"`, `pageId: <slug>`, `op: "update"`, and the body
is the new synthesized page + `## Sources`. The ingest reads `pageId`/`op` to
target the smart-merge instead of guessing.

## 6. Reusable building blocks (cite, don't rebuild)

| Need | Reuse |
|------|-------|
| Schedule firing, server-side | `src/main/cronjobs.ts`, `src/main/ipc/automation.ts` (`create/pause/resume/remove/trigger-cron-job`), `src/main/cron-quality.ts` |
| Research turn (forced web search, cite, cap) | `buildResearchPrompt` + `capResearchBrief` (`assistant/prompts.ts`); the agent's `web`/`x_search` tools |
| Synthesize → changeset (preserve `## Sources`) | `RESEARCH_FILE_SYSTEM_PROMPT` + `buildResearchFileMessages` + `spsFileResearch` (`sps-ingest.ts`, `sps-agent.ts`) with `max_tokens`+retry |
| Intake without renderer | `vault/_inbox/` captures, `readUnprocessedCaptures`, `INBOX_FOLDER` (`sps-ingest.ts`) |
| Smart-merge commit (`op:"update"`) | `commitChangeset` (`inbox/ingestApply.ts`) → `ingestCommitPage` (`workspace.ts`) → `spsAppendWikiLog` + `ensureIndexCoverage` |
| Inbox digest UI | `InboxSurface.tsx` (already a review queue) |
| Notification → renderer/OS | equity-alerts pattern (`src/main/equity-alerts.ts`: jsonl watch + `webContents.send` + `Notification`) |
| Telegram push | Hermes `messaging` toolset + the configured channel (`~/.hermes/channel_directory.json`) — the agent sends it in-prompt |
| Gateway auth for any direct fetch | `getRemoteAuthHeader()` (now sends the local API key — `3d12b9c`) |

## 7. Smart-merge mechanics

The `_inbox` capture is tagged `op:"update"` + `pageId`. At apply time,
`commitChangeset` already supports create/update; the update path rewrites the
living page body and the ingest synthesis is instructed to:
- keep one current synthesis at the top,
- preserve/refresh the `## Sources` section,
- append a single dated bullet to a `## Updates` section (the changelog),
- cross-link with `[[wikilinks]]` as today.

`## Updates` is the human-visible "what changed when." `log.md` records the
machine-readable `research` op as it already does.

## 8. Change detection ("only on meaningful change")

Two layers, cheap-first:
1. **Heuristic gate (desktop/agent):** hash the normalized new synthesis; if it
   equals `lastChangeHash`, declare no-change and stop.
2. **Semantic gate (agent):** the cron prompt instructs the agent to read the
   existing page and answer "is there anything materially new vs this page?"
   before writing a capture. If "no," it writes nothing and logs `no-change`.

Only a passed semantic gate produces an `_inbox` capture, a Telegram push, and a
new `lastChangeHash`.

## 9. Surfacing

- **Inbox digest:** each change → one `_inbox` capture → appears in
  `InboxSurface` as "🔬 `<topic>` · updated · `<when>`" with Open/Apply/Dismiss.
  This is the existing review queue; no new surface needed for MVP.
- **Telegram:** the cron prompt's final step sends a one-liner via the agent's
  `messaging` tool **iff** (a) a Telegram channel exists in the channel directory
  AND (b) `schedule.telegramPush` is true. The desktop UI greys out the Telegram
  toggle when no channel is configured (with a "set up Telegram" deep-link).

## 10. UX

- **Entry point:** a "Schedule…" affordance in the Research modal — after a
  manual run on a topic, "Research this weekly →" creates a schedule pre-filled
  with that topic + the just-created `pageId`.
- **Management surface:** a "Scheduled" list (new small surface or a tab in the
  existing Insights/Health area): rows of `{topic, cadence, last run outcome,
  toggles}` with add / edit / pause / run-now / delete. "Run now" maps to
  `trigger-cron-job`.
- **Cadence picker:** presets (daily / weekdays / weekly / monthly) → cron expr;
  advanced = raw cron.

## 11. Security & safety

- **Unattended web content** is higher-risk than manual research (no human in the
  loop at fetch time). Mitigations: the `## Sources`-mandatory + injection-fenced
  research prompt (already shipped); **default `autoApply: false`** so a human
  reviews the merge in the Inbox before it enters the KB; `autoApply` is opt-in
  per schedule for trusted topics.
- **Cost/runaway guard:** cap concurrent schedules (e.g. ≤ 25), enforce a minimum
  cadence (≥ hourly), and a per-schedule run lock so an overrunning run can't
  stack. Surface estimated token cost when creating a schedule.
- **Telegram exfiltration:** only send the one-line summary to a *user-configured*
  channel; never auto-create channels; gate strictly on the toggle.
- **SSRF / fetch:** unchanged — all web access is via the gateway toolset; no new
  outbound fetch surface in the desktop.

## 12. Edge cases

- Living page deleted by the user → next run recreates it (op falls back to
  create) and logs it; or pause the schedule if `pageId` is gone (decision flag).
- App closed for days → captures accumulate in `_inbox`; on open the Inbox shows
  them oldest-first (the ingest already handles a batch). Optional: coalesce
  multiple runs of the same topic into the latest.
- Gateway down at fire time → cron records error; retry next cadence.
- No sources / no web access → skip + log (same guard as manual research).
- Two schedules targeting the same `pageId` → disallow at creation.

## 13. Phasing

**MVP (must-have)**
- [ ] Schedule registry + create/edit/pause/delete (desktop) wired to a gateway
      cron job per schedule.
- [ ] Cron prompt template: research → read existing page → semantic change gate
      → write tagged `_inbox` capture (or nothing).
- [ ] Ingest understands `source: scheduled-research` + `pageId`/`op:update` →
      smart-merge with `## Updates` changelog.
- [ ] Inbox shows scheduled-research captures (digest); manual apply.
- [ ] Run history jsonl + a minimal "Scheduled" list UI with run-now.

**v2 (should-have)**
- [ ] `autoApply` toggle (skip Inbox review for trusted schedules).
- [ ] Telegram push (gated on channel + toggle).
- [ ] "Schedule this weekly" entry point from the Research modal.
- [ ] Coalesce missed runs; cost estimate on create.

**Later (won't-have now)**
- [ ] `vault`-authoritative mode so the KB updates with the app fully closed.
- [ ] Multi-topic "briefing" schedules that compose several topics into one digest
      page.
- [ ] Per-schedule source allow/deny lists.

## 14. Verification

- Unit (vitest, pure): schedule record (de)serialize; `_inbox` capture
  frontmatter parse for `pageId`/`op`; change-detection hash; cron-expr ↔ preset
  mapping. Builders stay pure/testable like `buildResearchFileMessages`.
- Index proof (`verify:note-index`): a smart-merge update keeps the page indexed
  and `[[wikilinks]]` resolved; `## Updates` survives the round-trip serializer.
- Live smoke (extend `scripts/sps-research-smoke.mjs`): create a schedule with a
  1-minute cadence + `trigger-cron-job`, assert a tagged `_inbox` capture appears,
  apply it, assert the living page gained a `## Updates` line and the second run
  on unchanged input writes nothing (`no-change`).
- Full gate per `docs/STORAGE.md` before shipping substrate changes.

## 15. Open questions

1. **Auto-apply default** — spec recommends `false` (review-first) given
   unattended web content; confirm vs the user's preference for "just keep it
   current."
2. **Living-page deletion policy** — recreate vs auto-pause the schedule.
3. **Cron ownership** — one gateway cron job per schedule (simple, maps 1:1) vs a
   single desktop scheduler that fans out (more control, but app-open-only).
   Spec picks per-schedule gateway cron for app-closed support.
4. **Telegram channel model** — is the existing `channel_directory.json` /
   messaging gateway sufficient to send to a user's Telegram from a cron prompt,
   or is a dedicated send path needed? (Validate before v2.)
