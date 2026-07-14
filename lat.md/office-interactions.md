# Office Space Interactions

Space representatives: staff NPCs in the Office tab's buildings that agents do business with. Clicking a bank teller opens an action menu — account status, balances, account creation — executed against the hermes-one backend for the chosen agent.

The bank is the first transaction space; future spaces (car showroom sales, building space) reuse the same pieces: a registry entry, an [[src/renderer/src/screens/Office/office3d/objects/Interactable.tsx#Interactable]] hookup in the interior, and action wiring in the panel. "Send money to an agent" is registered but disabled (coming soon) — the backend transfer endpoint exists, but the desktop confirmation flow for moving real funds is a later phase.

## Representative Registry

Identity and menu contents of every representative, decoupled from the 3D scene: id, space, i18n label keys, and the ordered action list.

[[src/renderer/src/screens/Office/office3d/interactions/registry.ts#REPRESENTATIVES]] holds the entries ("bank-teller" today) and [[src/renderer/src/screens/Office/office3d/interactions/registry.ts#getRepresentative]] resolves one by id. Actions carry a `disabled` flag so not-yet-executable options (send money) still render with a "coming soon" badge. The 3D side of a representative is the interior's [[src/renderer/src/screens/Office/office3d/objects/StaffPerson.tsx#StaffPerson]] wrapped in an Interactable — see [[office-3d-interiors#Office 3D Interiors#Interactables]].

## Teller Interactable

Inside the bank interior each teller is hover/click interactive; clicking any of the three opens the representative menu up in the Office screen.

[[src/renderer/src/screens/Office/office3d/objects/Bank.tsx#BankTellers]] wraps each StaffPerson in an Interactable (enabled only in interior mode, like the ATMs). The hover label is pre-translated in Office.tsx and threaded down as `tellerLabel` because the i18n context doesn't cross the r3f Canvas boundary. `onTellerActivate` bubbles Bank → Office3D → Office.tsx, which sets the active rep id; entering/exiting a building clears it.

## Interaction Panel

A right-side overlay (same styling as the agent details sidebar, which hides while it is open) listing the representative's actions for a chosen agent.

[[src/renderer/src/screens/Office/RepInteractionPanel.tsx#RepInteractionPanel]] takes the rep, the agent list, and an initial agent (the selected agent, else a picker). Bank wiring: **account status** lists the linked cloud agent's wallets via the existing `syncWallets` IPC with transactable/receive-only badges; **check balance** finds the first transactable cloud wallet and renders its backend portfolio (token rows + USD total); **create account** provisions a backend wallet, mapping the 409 "already provisioned" reply to a friendly notice; **send money** is disabled with a coming-soon badge. Signed-out, unlinked, and foreign states (the agent's cloud link belongs to a different Hermes account) render hints instead of errors. Results are guarded by a per-request token: switching the agent picker invalidates any in-flight action, so a late response can never render one agent's wallets under another.

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
