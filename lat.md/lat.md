This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

> **Hermes One** is a community-maintained project. This desktop app is a wrapper around **Hermes Agent** — it is **not affiliated with, endorsed by, or supported by Nous Research**. "Hermes One" is the name of this community project; "Hermes"/"Hermes Agent" refer to the upstream agent it builds on.

- [[chat-commands]] — how typed slash commands are routed through the gateway's `slash.exec`/`command.dispatch` pipeline instead of being sent as prompt text.
- [[chat-performance]] — how chat rendering stays responsive through contained transcript rows, batched textarea resizing, and fixed-row slash-command virtualization.
- [[model-context]] — the per-model context-window override that drives the context gauge and the agent's auto-compaction.
- [[model-selection]] — the session-scoped in-chat model override that switches the model (and provider) for one conversation without touching the global default.
- [[web-preview]] — the in-app split-screen webview and the `partition`-based gate that lets only it load remote HTTPS while staying sandboxed.
- [[code-blocks]] — collapsible long code blocks, and why expansion state is keyed on source position to survive react-markdown's streaming remounts.
- [[window-chrome]] — the browser-style title bar where open-conversation tabs sit on top of the window drag region, clickable while empty space still drags.
- [[desktop-updates]] — GitHub release checks, startup upgrade button behavior, and the Settings auto-upgrade preference.
- [[sidebar-navigation]] — the recent-sessions list under the Chat nav item, capped at five with a "Show more" button that opens the full session list in a modal.
- [[context-folder]] — the per-session linked working folder, persisted in a desktop-owned state.db table so a re-opened conversation restores its folder.
- [[main-process]] — the Electron main-process entrypoint, app lifecycle modules, and centralized IPC registry.
- [[provider-setup]] — the first-run provider picker; its top grid mirrors the agent's native `CANONICAL_PROVIDERS` while OpenAI-compatible endpoints route through the Local presets.
- [[hermes-account-login]] — desktop sign-in to a Hermes account via the RFC 8628 device grant; secure token storage, IPC, and the Providers-screen entry point.
- [[agent-sync]] — bidirectional sync of desktop profiles with the signed-in account's cloud agents (persona, memory, color, model/provider) via the backend's `/api/agents`; hash-based per-part conflict handling, no deletion propagation.
- [[kanban]] — the JIRA-style multi-agent board tab; a thin client over the `hermes kanban` CLI with canonical status columns, an archived toggle, and focus/poll refresh.
- [[analytics]] — privacy-first, opt-out usage analytics that POST anonymous events to the in-house Hermes analytics service, keyed by a per-install localStorage UUID; replaces the former PostHog integration.
- [[wallet-token-balances]] — profile-scoped Base mainnet wallets with encrypted recovery phrases, and on-chain ERC-20 token balance reads via ethers v6.
