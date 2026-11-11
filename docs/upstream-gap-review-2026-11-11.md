# Hermes Desktop upstream gap review

Assessment of the independent Hermes Desktop client against Hermes Agent, reviewed on November 11, 2026. This is an evidence snapshot and release-planning input, not a claim of live compatibility certification.

The subsequent [compatibility implementation and acceptance record](compatibility-acceptance-2026-11-11.md) tracks the fixes and validation performed after this review. The findings below preserve the pre-change baseline.

## Baselines

The published desktop, desktop main, sibling Agent checkout, and upstream stable release are different baselines and must be assessed separately.

| Baseline                           | Observed state                                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published Hermes Desktop           | [v0.7.7](https://github.com/fathah/hermes-desktop/releases/tag/v0.7.7), published September 4, 2026: 68 days before this review.                                                                          |
| Desktop source                     | `171024862c849475634d217a5635fedff796360c`, October 13; matches GitHub main at review time. There are 220 commits after v0.7.7, touching 494 files. `package.json` still says 0.7.7.                      |
| Sibling `../hermes-agent` worktree | Clean at `b9ecc727e9`, October 10; nearest tag `v0.21.6+canary.20261010T070026Z`. Its checked-out files are older than the newest available tags.                                                         |
| Latest published Agent stable      | [v0.23.1](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.1), published November 10; commit `3b421578588243f920886e6fe79a6faa87ea026e`. The release body calls it the November 9 release. |
| Agent release history              | Seventeen published stable releases after the desktop release. The latest Agent stable before September 4 was v0.21.0, tagged `v2026.8.31`; Agent and desktop version numbers are independent.            |

The comparison uses local source and Git objects at the named refs, GitHub release metadata, and the upstream v0.22.0/v0.23.0 notes. No checkout was switched, no installed Agent was updated, and no user sessions or credentials were read.

The repository's `hermes-agent` skill guide still describes Agent v0.7.0 from April. Its version-dependent API and feature descriptions were checked against the tagged source rather than used as the current compatibility baseline.

## Confirmed protocol blocker

The desktop accepts a newer Agent contract without implementing its blocking-request protocol, so successful ordinary chat does not establish interactive-tool compatibility.

Our [capability snapshot](../src/shared/agent-capabilities.ts) recommends contract **6** and labels every contract at least 6 `compatible`. Agent v0.23.1 advertises **8** in [tui_gateway/server.py](https://github.com/NousResearch/hermes-agent/blob/v0.23.1/tui_gateway/server.py). Contract 7 changed blocking prompts on September 14, and contract 8 followed the Connectors backend on September 22.

Upstream now uses peer-to-peer JSON-RPC requests, for example:

```json
{
  "jsonrpc": "2.0",
  "id": "srq-012345abcdef",
  "method": "approval",
  "params": {
    "session_id": "review-session",
    "request_id": "review-request",
    "command": "echo review"
  }
}
```

The client must advertise `client.capabilities {server_requests: true}`, return a response with the same `srq-*` ID, process `request.cancel`, and restore unanswered `open_requests` after reconnect. This protocol covers approvals, multi-question clarification, sudo, secrets, vault prompts, MCP consent, onboarding, and desktop browser/terminal bridges. See the [server request transport](https://github.com/NousResearch/hermes-agent/blob/v0.23.1/tui_gateway/server_requests.py) and [typed request contracts](https://github.com/NousResearch/hermes-agent/blob/v0.23.1/tui_gateway/contracts/server_requests.py).

Our renderer [DashboardGatewayClient](../src/renderer/src/screens/Chat/dashboardGatewayClient.ts) normalizes that frame into an event named `approval` and drops its parameters because it reads `params.payload`. The [event adapter](../src/renderer/src/screens/Chat/dashboardEventAdapter.ts) handles `approval.request` instead. The main-process gateway client in [hermes.ts](../src/main/hermes.ts) also only dispatches `event` notifications. Neither transport implements the server-request capability, matching-ID responses, or open-request replay.

Two isolated Node probes transpiled and executed the actual desktop TypeScript without opening a network connection:

| Probe                                             | Observed result                                        |
| ------------------------------------------------- | ------------------------------------------------------ |
| Legacy `event` / `approval.request` frame         | Recognized event name; payload retained.               |
| Current `srq-*` / `approval` frame                | Unrecognized blocking-event name; payload absent.      |
| Snapshot with Agent version 0.23.1 and contract 8 | `compatibility: "compatible"`, recommended contract 6. |

The newer server detects clients that never advertise support and declines to send blocking requests to them. The consequence is unavailable interaction, not proof of automatic approval or a mandatory five-minute hang. Updating the Agent alone does not repair this client protocol gap.

## Installer and runtime boundary

The desktop's reviewed bootstrap pin and runtime-launch assumptions predate the new Agent package manager and need a deliberate compatibility refresh.

Current [POSIX installer code](../src/main/installer-download.ts) pins commit `503d863fcd2cbfc0be5a6d6c536fae2e98aa4204`, dated August 23, and passes it as `--commit` as well as using it to fetch verified script bytes. The [Windows path](../src/main/installer-windows-download.ts) passes the same revision with `-Commit`. This requests an old Agent checkout, not just an old bootstrap script. The pinned installer can ignore the pin when it proves an existing checkout is newer; its ordinary fresh shallow-clone path can still select the old revision. Existing users must not be described as universally pinned to August.

Agent now delegates installation to [hermes pm](https://github.com/NousResearch/hermes-agent/blob/v0.23.1/scripts/install.sh), with managed Python 3.14 and checked dependency generations. The desktop [installer](../src/main/installer.ts) resolves fixed `hermes-agent/venv` interpreter paths. Upstream's [Windows launcher repair](https://github.com/NousResearch/hermes-agent/blob/v0.23.1/hermes_cli/_install_repair.py) explicitly boots the package-manager store interpreter instead. Windows launchers and adopted managed installations therefore need real install/update testing; source inspection alone does not prove every old path is broken.

Local startup still uses `dashboard --isolated` in [dashboard-launch.ts](../src/main/dashboard-launch.ts), and a second gateway path launches `dashboard` in [hermes.ts](../src/main/hermes.ts). Recent upstream provides headless `serve` and [gateway attach](https://github.com/NousResearch/hermes-agent/blob/v0.23.1/hermes_cli/subcommands/gateway.py), while multiplexing conversations through the gateway owner. The old dashboard command still exists, so this is a lifecycle-alignment gap rather than evidence that the command was removed. Ownership, profile routing, reconnect, and app shutdown need checking together.

## Product gaps

Most missing capabilities need desktop presentation and protocol adapters; their execution should remain in Agent, as the existing enhanced-desktop roadmap requires.

| Area                         | Upstream capability                                                                                                 | Current desktop evidence and gap                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway connections          | Simultaneous gateways, shared saved connections, host-owned terminal tabs.                                          | Named connections and stable chat identity exist. [dashboard.ts](../src/main/dashboard.ts) explicitly restricts SSH to one active tunnel; no complete gateway pool or embedded host terminal workspace. Direct Remote chat identity is already scoped, so multi-connection work is partial rather than absent. |
| Queues and reconnect         | Gateway-owned admission, editable queued work, sequenced event replay.                                              | [Chat.tsx](../src/renderer/src/screens/Chat/Chat.tsx) holds a renderer queue. No `session.events.since`/epoch reconciliation or open-request replay was found. Slash-command availability does not establish durable queue integration.                                                                        |
| Hosted Connectors            | App directory, OAuth connection/consent, multiple accounts, managed tools.                                          | Existing Tools/MCP settings cover local and remote MCP servers; no first-class hosted Connectors account or directory surface. New consent requires the blocking-request bridge.                                                                                                                               |
| Plugin catalog and SDK       | Official/Verified/Community plugins, update all, opt-in auto-update, managed compatibility, desktop contributions.  | [Discover](../src/main/registry.ts) uses the separately pinned `fathah/hermes-registry` for agents, MCPs, skills, and workflows. It is not the upstream plugin catalog. Memory plugin support is partial; there is no general upstream plugin lifecycle UI or desktop SDK host.                                |
| Managed local models         | Hardware recommendations, model/engine downloads, pause/resume, managed llama.cpp lifecycle.                        | Provider/model selection exists, including external local endpoints. No managed local-runtime UI was found. Supporting an already-running local server is a different capability.                                                                                                                              |
| Group chats                  | Hosted rooms, cross-machine bots, lead/automatic routing, room notes/purpose, attachments, scheduled room delivery. | [Bot groups](../lat.md/bot-groups.md) is an unreleased experimental, environment-gated, local-only protocol-v2 slice. Mentions, replay, stop and exact approvals exist; SSH/Remote, attachments and scheduling UI are explicitly excluded.                                                                     |
| Browser and computer use     | Bot Screen, human takeover, password-blind vault flows, real browser identity.                                      | Tool enablement and a sandboxed page preview/annotation experience exist. No full Bot Screen takeover or current vault interaction UI was found. Those request types must not be confused with the desktop's API-key secret provider.                                                                          |
| Delegation                   | Selectable backends and model/profile routes.                                                                       | Live child roster, transcript tail, Steer and Stop are already implemented on main. Delegation backend/route settings remain missing.                                                                                                                                                                          |
| MCP costs and skill curation | Paid-tool costs, per-chat spend limits, protected skills.                                                           | [MCP inputs](../src/main/mcp-servers.ts) do not expose `tool_costs`, `spend_limit`, or `cost_unit`; approval rows have only command/description/choices. Some cost text can arrive in descriptions, but structured policy UI is missing. No skill-lock UI was found.                                           |
| Schedules                    | Cancel an active execution, missed-run policies, room delivery.                                                     | Run history/output is implemented for Local and direct Remote, with SSH history explicitly unsupported. The current UI supports pause/resume/run/delete but not active-run cancel or missed-run configuration.                                                                                                 |
| Voice                        | Agent-owned conversational turn-taking and barge-in.                                                                | Dictation, playback and new MiniMax synthesis exist. They do not provide the full conversational voice experience in milestone M8.                                                                                                                                                                             |
| Native workspace             | Artifacts, pop-out windows, Quick Entry/HUD, terminal/Git workspace.                                                | Existing context files, preview and chat tabs are useful foundations. These larger desktop surfaces remain unfinished in the enhanced-desktop roadmap.                                                                                                                                                         |

Upstream feature references: [v0.22.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0), [v0.23.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.0), and [v0.23.1](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.1). Specific implementation seams include [local runtime](https://github.com/NousResearch/hermes-agent/tree/v0.23.1/hermes_cli/local_runtime), [Connectors UI](https://github.com/NousResearch/hermes-agent/tree/v0.23.1/apps/desktop/src/app/capabilities/connectors), [delegation settings](https://github.com/NousResearch/hermes-agent/tree/v0.23.1/apps/desktop/src/app/settings/delegation), and [MCP cost policies](https://github.com/NousResearch/hermes-agent/blob/v0.23.1/tools/mcp_tool_costs.py).

## Work already on main

The unpublished desktop already contains substantial progress, so these areas should be validated and released rather than treated as new implementations.

Changes since v0.7.7 include:

- Required command approvals, clarification cards, approval completion fixes, and preservation of existing sessions after busy refusals. These currently target the legacy prompt protocol.
- In-chat delegated children with tail, steer and stop, and sidebar filtering of child sessions.
- Transcript windowing, scroll-follow repairs, missing-reply-tail recovery, RTL/Persian work, and token/context display.
- Remote profile creation, providers/credential pools, memory/Soul, Kanban, Gateway controls, OAuth fixes, and schedule history.
- External-memory discovery, shared pets, MiniMax speech, additional provider setup, backup consent, shutdown/process fixes, installer verification, and measured update progress.

This is source progress, not release-readiness evidence. The review did not run a full packaged application or the entire test suite.

## What an Agent update supplies

Core Agent fixes should be inherited through a compatible Agent update instead of being copied into Electron.

Reasoning replay, provider retry/fallback improvements, compaction quality and optional prepared summaries, memory/storage fixes, smaller prompts, browser tool internals, cron caching and most messaging-platform improvements belong to Agent. New models may already arrive through discovery or existing custom endpoints; a model not hardcoded in this desktop is not automatically unsupported.

Review integrations that name removed interfaces: browser automation now uses `browser_exec`; several formerly bundled features moved to plugins; `hermes mcp serve` became plugin command `hermes mcp-serve`. Agent v0.23.1 also fixes the live plugin-catalog download size cap, so v0.23.0 is not an ideal new baseline for catalog work. Our package already selects Electron 44; upstream's Electron upgrade itself is not a missing feature here.

## Recommended release order

The next release should establish a current, tested Agent contract before adding broader product surfaces.

1. **Compatibility release:** implement server requests in both chat clients, cancellation and reconnect restoration; replace the misleading newer-contract verdict; select a reviewed Agent revision; validate fresh install/update and managed launcher discovery. Test approvals, multi-question clarify, secret/sudo prompts, and reconnect across Local, SSH and direct Remote.
2. **Gateway and capabilities release:** align with the canonical runtime owner and durable queue/replay contracts, complete connection pooling, then expose upstream plugin management and hosted Connectors through capability-gated adapters.
3. **Product expansion:** managed local models, production group chats, Bot Screen/vault workflows, delegation routing, schedule cancellation/policies and skill/MCP policy controls. Continue artifacts, native windows, coding and conversational voice as separate roadmap slices.

The [August enhanced-desktop roadmap](superpowers/plans/2026-08-23-hermes-agent-enhanced-desktop-roadmap.md) remains useful, but its completed M0 refers to its original contract-6 baseline. It must not be read as certification against November's Agent. This review records gaps without marking unfinished roadmap features complete.

## Verification limits

The two protocol probes demonstrate a concrete client mismatch; the remaining classifications come from inspected source, documented boundaries, and published upstream behavior.

Semantic `lat search` failed because the configured key prefix was unsupported; direct `lat section` lookups provided the architecture context. `lat check` passed before and after the documentation update, and `git diff --check` passed. No paid model calls, installer execution, system gateway changes, or live user-data migrations were performed.
