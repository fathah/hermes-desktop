# Wallet & Token Balances

Profile-scoped Ethereum wallets on Base mainnet, with on-chain token balance reads.

## Wallet Store

Profile wallets are stored per-profile in `wallets.json` alongside profile metadata. Keys and recovery phrases never leave the main process.

[[src/main/wallet-store.ts]] provides create, import, rename, delete, and list operations. Recovery phrases are encrypted via Electron `safeStorage` and stripped by [[src/main/wallet-store.ts#publicWallet]] before any data crosses IPC. The per-profile cap is 10 wallets ([[src/main/wallet-store.ts#MAX_WALLETS_PER_PROFILE]]).

Wallet metadata types live in [[src/shared/wallets.ts]]: `ProfileWallet` (public shape), `WalletMutationResult` (one-time recovery phrase on create/import), and `ImportWalletInput`.

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
- [[src/main/wallet-balances.test.ts]] — formatTokenBalance edge cases and big-balance precision, `withTimeout`, getTokenBalances with mocked RPC including timeout handling
- [[src/renderer/src/components/profile/ProfileWalletPane.test.tsx]] — balance-chip rendering: one symbol label per token, icon only for known tokens
