# Office Space Interactions

Interactables in the Office tab's bank that agents do business with. Clicking the bank teller or the self-service ATM opens a shared action modal (balances, account status, and more) run against the hermes-one backend for the chosen agent.

The bank is the first transaction space; future spaces (car showroom sales, building space) reuse the same pieces: a registry entry, an [[src/renderer/src/screens/Office/office3d/objects/Interactable.tsx#Interactable]] hookup in the interior, and action wiring in the panel. Coming-soon actions (the ATM's withdraw/deposit) are registered with a `disabled` flag and render as muted "Soon" chips until their flows land.

## Representative Registry

Identity and menu contents of every representative, decoupled from the 3D scene: id, space, i18n label keys, and the ordered action list.

[[src/renderer/src/screens/Office/office3d/interactions/registry.ts#REPRESENTATIVES]] holds the entries — **bank-teller** (check-balance / account-status / create-account) and **atm** (check-balance / account-status / withdraw+deposit as disabled coming-soon) — and [[src/renderer/src/screens/Office/office3d/interactions/registry.ts#getRepresentative]] resolves one by id. Actions carry a `disabled` flag so a not-yet-executable option renders as a muted "Soon" chip; the `RepActionId` type also keeps `sendMoney` ("Send to agent"), intentionally omitted from every registry entry until its transfer flow lands. The 3D side of a teller is the interior's [[src/renderer/src/screens/Office/office3d/objects/StaffPerson.tsx#StaffPerson]] wrapped in an Interactable — see [[office-3d-interiors#Office 3D Interiors#Interactables]]; the ATM is the interior's ATM mesh wrapped the same way.

## Teller Interactable

Inside the bank interior each teller and each ATM is hover/click interactive; activating one opens the representative modal in the Office screen.

[[src/renderer/src/screens/Office/office3d/objects/Bank.tsx#BankTellers]] wraps each StaffPerson in an Interactable and [[src/renderer/src/screens/Office/office3d/objects/Bank.tsx#BankATMs]] wraps each ATM mesh (both enabled only in interior mode). The teller's hover label is pre-translated in Office.tsx and threaded down as `tellerLabel` because the i18n context doesn't cross the r3f Canvas boundary; the ATM's is a static "ATM". `onTellerActivate` / `onAtmActivate` bubble Bank → Office3D → Office.tsx, which sets the active rep id (`bank-teller` or `atm`); entering/exiting a building clears it. The ATM previously opened the profile modal's wallet section — it now opens the `atm` representative instead.

## Interaction Panel

A centered modal shared by every representative (bank teller, ATM): a dimmed backdrop with a themed card — hero panel, agent-picker chip, and wrapping action chips. Flat, theme CSS variables only, no gradients.

[[src/renderer/src/screens/Office/RepInteractionPanel.tsx#RepInteractionPanel]] takes the rep, the agent list, and an initial agent. Office passes `selectedId ?? defaultAgentId`, where `defaultAgentId` is the active profile (the `profile` prop, matched by agent id) or the first agent — so the picker opens pre-selected on the current profile instead of an empty "Choose an agent…". It renders a fixed inset-0 backdrop (dismiss on backdrop click or Escape) centering the card; the card fades/scales in on mount and its layout is self-contained inline styles (not Tailwind classes) so positioning can't break. The header identity is per-representative: a `REP_ICONS` glyph (bank landmark for the teller, card for the ATM), the rep's name, a live status line with a green dot (teller "Open · serving {agent}", ATM "Online · {agent}") and an agent-picker chip (an avatar + native `<select>` so it stays keyboard-accessible). A hero card morphs with the latest action outcome — total-balance figure with a decorative flat sparkline ([[src/renderer/src/screens/Office/RepInteractionPanel.tsx#BalanceSparkline]], carries no data since the backend has no price history), a loading skeleton, a success card (address · Base), an error card with a **Retry** button that re-runs the last action, a warning hint, or the dedicated empty-wallet card (`$0.00`, "no funds in this account yet" — no create prompt, since reaching a balance means the account exists) when a loaded balance is zero. Below it, token rows (round symbol badge, name, amount, USD) render on a loaded balance and account-status rows render transactable/receive-only badges. Money figures (the total, token amounts, and USD values) render in Space Grotesk via the `--font-numeric` token — a self-hosted `@font-face` in `src/renderer/src/assets/main.css` (`fonts/SpaceGrotesk-Variable.ttf`), no CDN.

Actions render as flex-wrapping chips (`visibleActions`) rather than a fixed grid, so a variable set always lays out cleanly with no empty cells: **check balance** (primary/accent chip) reads the cached transactable wallet id when present — otherwise looks it up via `syncWallets` — and renders its backend portfolio; **account status** lists the linked cloud agent's wallets via `syncWallets`; **create account** (teller only) provisions a backend wallet, mapping the 409 "already provisioned" reply to a friendly notice. Disabled actions — the ATM's **withdraw** and **deposit** — render as muted chips with a "Soon" badge. Because an agent has exactly one account, **create account is dropped once the agent is known to have one** ([[src/renderer/src/screens/Office/RepInteractionPanel.tsx#rememberBank]]'s `hasAccount`). Signed-out, unlinked, and foreign states (the agent's cloud link belongs to a different Hermes account) render hints instead of errors. Results are guarded by a per-request token: switching the agent picker invalidates any in-flight action, so a late response can never render one agent's wallets under another.

### Session cache

Each agent's bank state (its one wallet + last portfolio + `hasAccount`) is cached in an in-memory `Map`, keyed by `${signed-in account id}::${agent id}` so reopening avoids a re-fetch while cached financial data never crosses a sign-out or relink.

The cache is [[src/renderer/src/screens/Office/RepInteractionPanel.tsx#bankCache]], read via [[src/renderer/src/screens/Office/RepInteractionPanel.tsx#readBank]] and written via [[src/renderer/src/screens/Office/RepInteractionPanel.tsx#rememberBank]] — in-memory only, no cloud wallet data persisted to disk, keeping the [[wallet-token-balances#Wallet Sync]] "never persist cloud wallets" principle. The panel resolves the signed-in account id (`getAccount`, app-wide) and composes it into the cache key via `cacheKey`; a null id (unresolved or signed out) makes every lookup miss and every write a no-op, so no financial data is served or stored without a known account. If the same local profile is relinked to a different Hermes account mid-session, the account half of the key changes and the previous account's portfolio and wallet id are never read back. On mount, when the agent picker changes, or once the account id resolves, the panel rehydrates from this cache: a known portfolio renders the balance instantly (no fetch) and a known account hides "Create account"; a cold agent (or unknown account) falls back to idle. Cache writes are keyed by the request's own account + agent, so a late-arriving result still caches the correct entry even after the picker moved on.

The account id is re-resolved every time the Office tab becomes visible, not just on mount, because the panel can stay mounted (Office is only hidden, never unmounted — see [[office-3d-walk-mode]]) while the user changes the Hermes account elsewhere. The `visible` prop threads Office's shown-state down; while hidden the panel forgets the resolved account (`accountId → null`) so a stale balance can never flash on return before the re-check lands, and returning re-runs `getAccount` so a changed account yields a fresh key and a cache miss.

## Backend Wallet Actions

Main-process calls to the hermes-one backend for the panel's actions — the desktop holds no keys and reads no chain state locally for these flows.

[[src/main/wallet-actions.ts#getWalletPortfolio]] wraps `GET /api/wallets/:id/portfolio` (requires a transactable wallet — the backend authenticates reads with the wallet's stored key) and [[src/main/wallet-actions.ts#provisionAgentWallet]] wraps `POST /api/wallets` with `kind: "bankr"`, surfacing the backend's idempotency 409 as `status: "exists"`. Both reuse [[src/main/wallet-sync.ts#resolveLinkedAgent]] — the account/token/linked-agent-id preamble extracted from the wallet sync flow (see [[wallet-token-balances#Wallet Sync]]). Exposed to the renderer as `getWalletPortfolio`/`provisionCloudWallet` via the `wallet-portfolio` and `wallet-provision` IPC channels; result shapes (`WalletPortfolioResult`, `ProvisionWalletResult`) live in [[src/shared/wallets.ts]].

## Tests

Vitest suites covering the registry's shape and the backend wallet calls.

- [[src/renderer/src/screens/Office/office3d/interactions/registry.test.ts]] — every rep has labels and ≥1 executable action, ids unique, bank teller registered with its bank actions
- [[src/main/wallet-actions.test.ts]] — portfolio: signed-out short-circuit, token mapping, malformed-row defaults, backend error strings, network failure; provisioning: request body, 409 → exists, unlinked after failed auto-sync, HTTP error
- [[src/renderer/src/screens/Office/RepInteractionPanel.test.tsx]] — the panel's agent-context guarantees, specced below

### Panel follows the Office selection

The panel stays mounted while the Office selection changes; its agent picker follows a new non-null selection and keeps its own choice when the selection clears, so actions never silently run for an agent the rest of the UI left.

### Drops stale action results

An action started for agent A whose response lands after the picker moved to agent B is discarded — B's context never shows A's wallets — while re-running the action for B renders B's data.

### Wallet cache is account-scoped

A balance cached under one signed-in account is not re-shown after the same profile is relinked to another account: reopening renders the neutral placeholder, never the prior account's figure, since the cache key includes the account id.

### Account scope refreshes on re-show

An account change while the panel stays mounted (Office hidden then re-shown, never unmounted) is picked up: re-showing re-resolves the account, so a balance cached under the previous account gives way to the placeholder instead of surfacing.
