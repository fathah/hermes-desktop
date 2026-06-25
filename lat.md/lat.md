This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

- [[chat-commands]] — how typed slash commands are routed through the gateway's `slash.exec`/`command.dispatch` pipeline instead of being sent as prompt text.
- [[chat-performance]] — how the message list keeps typing fast in long conversations: `content-visibility` on off-screen rows, block flow for a correct `scrollHeight`, and a once-per-value textarea resize.
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
- [[kanban]] — the JIRA-style multi-agent board tab; a thin client over the `hermes kanban` CLI with canonical status columns, an archived toggle, and focus/poll refresh.
- [[analytics]] — privacy-first, opt-out usage analytics that POST anonymous events to the in-house Hermes analytics service, keyed by a per-install localStorage UUID; replaces the former PostHog integration.
- [[wallet-token-balances]] — profile-scoped Base mainnet wallets with encrypted recovery phrases, and on-chain ERC-20 token balance reads via ethers v6.
