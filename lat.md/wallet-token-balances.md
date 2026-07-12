# Wallet & Token Balances

Profile-scoped Ethereum wallets on Base mainnet, with on-chain token balance reads.

## Wallet Store

Profile wallets are stored per-profile in `wallets.json` alongside profile metadata. Keys and recovery phrases never leave the main process.

[[src/main/wallet-store.ts]] provides create, import, rename, delete, and list operations. Recovery phrases are encrypted via Electron `safeStorage` and stripped by [[src/main/wallet-store.ts#publicWallet]] before any data crosses IPC. The per-profile cap is 10 wallets ([[src/main/wallet-store.ts#MAX_WALLETS_PER_PROFILE]]).

Wallet metadata types live in [[src/shared/wallets.ts]]: `ProfileWallet` (public shape), `WalletMutationResult` (one-time recovery phrase on create/import), and `ImportWalletInput`.

Local **creation/import is being retired** in favour of backend-provisioned wallets (see [[wallet-token-balances#Wallet Sync]]). The store's `createWallet`/`importWallet` and their IPC channels are retained for now, but the wallet pane no longer exposes a create/import UI.

## Wallet Sync

Wallets provisioned by the Hermes One backend for a profile's linked cloud agent are fetched and shown read-only alongside local ones, so the desktop stops minting wallets itself.

[[src/main/wallet-sync.ts#syncWalletsForProfile]] resolves the signed-in account and linked cloud-agent id through [[src/main/wallet-sync.ts#resolveLinkedAgent]] — which finds the account ([[src/main/account-store.ts#findAccountProfile]]) and the agent id via [[src/main/agent-sync.ts#getLinkedAgentId]], auto-running [[src/main/agent-sync.ts#syncAgents]] once when the profile has never synced — then GETs `/api/wallets?agentId=…` (bearer + `x-api-key` via [[src/main/hermes-account.ts#apiHeaders]]). Rows are mapped by the pure [[src/main/wallet-sync.ts#mapCloudWallet]] into the shared `WalletView`; rows without an EVM address are dropped. No wallet secret ever reaches the device — these are receive/tracked addresses, matching the backend `docs/agent-sync.md` "Wallets per agent" intent. `resolveLinkedAgent` is shared with the Office's backend wallet actions ([[office-interactions#Office Space Interactions#Backend Wallet Actions]]). It also enforces link ownership ([[src/main/agent-sync.ts#getLinkedAgentAccountId]]): a link recording a different account resolves as `foreign` without any backend call, and a legacy untagged link first gets one sync pass — which stamps the owner when the agent belongs to this account — then resolves as `foreign` if still unowned, so a stale agent id is never sent under a new account's token. The wallet pane / bank panel show a "linked to a different account" note — see [[agent-sync#Cloud agent sync#Sync engine]].

The `wallet-sync` IPC channel (registered in [[src/main/ipc/register.ts#registerIpcHandlers]]) exposes it as `syncWallets` on `window.hermesAPI`. [[src/renderer/src/components/profile/ProfileWalletPane.tsx]] renders local (`wallets.json`) and cloud wallets in one list, each tagged with a Local/Cloud badge; delete is offered only for local wallets, copy/balance for both. Signed-out, never-synced, or foreign-linked profiles show a hint instead of an error.

## Token Balances

On-chain balance reads for Base mainnet ERC-20 tokens, fetched via ethers v6 `JsonRpcProvider`.

[[src/main/wallet-balances.ts#getTokenBalances]] takes a wallet address and returns a `TokenBalancesResponse` containing native ETH plus all configured ERC-20 token balances. Uses `Promise.allSettled()` so one token RPC failure does not block others — each failed token gets an `error` field.

Each RPC read is wrapped in [[src/main/wallet-balances.ts#withTimeout]] (10s default; ethers v6 has no per-request timeout) so a hung endpoint surfaces as a per-token timeout error instead of a chip that spins forever.

Token metadata (contract address, symbol, decimals) lives in [[src/shared/tokens.ts]] as `BASE_TOKENS`. Currently tracks ETH (native) and $HD (`0xfda75f77a22b4f4b783bbbb21915ef64d149bba3`), both 18 decimals. $H1 is held back for a future release.

### Balance formatting

[[src/shared/tokens.ts#formatTokenBalance]] converts raw BigInt strings to compact form: zero → "0", ≥1M → "1.5M", ≥1K → "10.5K", tiny non-zero → "< 0.0001", otherwise up to 4 significant digits. [[src/shared/tokens.ts#formatTokenBalanceFull]] produces the same without K/M suffixes — used for tooltip display of exact amounts.

### IPC & UI

The `get-token-balances` IPC channel exposes balance reads to the renderer. Balances auto-fetch when the wallet pane loads; previously cached balances display immediately while fresh ones load, then update in place.

Balance data is cached at module level (keyed by wallet address) so it survives tab switches — when the component remounts, it hydrates from the cache instantly and refreshes in the background. Each balance renders as a chip: token icon (only when a known icon is mapped) + symbol label (exactly once) + compact amount (K/M). Hovering a chip shows a native tooltip with the full amount via `formattedFull`. Wallet deletion uses a confirmation modal with red warnings.

## Tests

Vitest test suites for wallet store and balance reads.

- [[src/main/wallet-store.test.ts]] — wallet CRUD, rename/delete, encryption, dedup, caps, and import error distinction (invalid phrase vs. secure-storage failure)
- [[src/main/wallet-sync.test.ts]] — `mapCloudWallet` mapping (default name, addressless drop) and `syncWalletsForProfile` paths: signed-out, linked-agent fetch, auto-sync-then-fetch when unlinked, HTTP error, and the ownership gate (foreign link refused with no backend call; matching owner proceeds; legacy untagged links adopt via one sync pass or refuse as foreign)
- [[src/main/wallet-balances.test.ts]] — formatTokenBalance edge cases and big-balance precision, `withTimeout`, getTokenBalances with mocked RPC including timeout handling
- [[src/renderer/src/components/profile/ProfileWalletPane.test.tsx]] — balance-chip rendering: one symbol label per token, icon only for known tokens
