# Install gate — vault alias constraint (P1 fix) — diagrams

Diagrams for the install-gate vault-awareness fix (branch `secrets/04`, PR #673).

**The bug (Greptile P1):** when the catalogued provider's expected LLM key (e.g.
`ANTHROPIC_API_KEY`) was not resolved directly from the secrets provider, the gate
fell through to a broad `/(_API_KEY|_TOKEN)$/` scan that accepted **any**
token-shaped vault credential. A user whose vault held only `GITHUB_TOKEN` /
`SLACK_BOT_TOKEN` (and no LLM key) falsely cleared the gate and was shown the chat
screen instead of being routed back through Setup.

**The fix:** when `expectedKey` is known, accept **only** that key or one of its
accepted aliases (`aliasesForEnvKey()` over the single-source-of-truth
`KEY_ALIASES` in `src/shared/url-key-map.ts`). The broad fallback now fires **only**
when `expectedKey` is `null` (uncatalogued provider — no canonical name to match).
This brings `installer.ts` into agreement with `config-health.ts` `resolvedHasKey()`
(same alias-constrained logic). Member of the AIR-026 credential-name-alias class.

## 1. Logical flow — the install-gate vault decision

```mermaid
flowchart TD
  A["checkInstallStatus()<br/>hasApiKey still false, non-env provider"] --> B["resolvedSecrets(profile)<br/>→ resolved map"]
  B --> C["expectedKey = expectedEnvKeyForModel(provider, baseUrl)"]
  C --> D{"expectedKey known?<br/>(catalogued provider)"}
  D -->|"Yes"| E{"resolved[expectedKey] usable<br/>OR any aliasesForEnvKey() usable?"}
  E -->|"Yes"| P["hasApiKey = true → chat"]
  E -->|"No"| F["hasApiKey stays false → Setup"]
  D -->|"No (uncatalogued)"| G{"any /(_API_KEY|_TOKEN)$/ usable?"}
  G -->|"Yes"| P
  G -->|"No"| F

  classDef pass fill:#0b3d0b,stroke:#3fae3f,color:#d6ffd6;
  classDef block fill:#4d0b0b,stroke:#d04f4f,color:#ffd6d6;
  class P pass;
  class F block;
```

The closed hole: a vault holding only `GITHUB_TOKEN` with `expectedKey =
ANTHROPIC_API_KEY` now lands on **F (Setup)**, not **P (chat)** — the broad-scan
branch (G) is unreachable for a known provider.

## 2. SECRET / credential-name workflow — what is matched, what crosses

The "secret" here is the user's LLM credential. The gate never sees or moves the
value across a boundary — it only asks "does a usable value exist under the
expected NAME (or an accepted alias of it)?" Key NAMES are matched; the value is
read only for a non-empty/`usable()` check and never logged or returned.

```mermaid
flowchart TD
  subgraph VAULT["secrets provider (resolvedSecrets map — names + values, in-process)"]
    V1["ANTHROPIC_API_KEY=… (canonical)"]
    V2["ANTHROPIC_TOKEN=… (alias)"]
    V3["CLAUDE_CODE_OAUTH_TOKEN=… (alias)"]
    V4["GITHUB_TOKEN=… (UNRELATED — must NOT satisfy)"]
  end
  subgraph MAP["src/shared/url-key-map.ts (single source of truth)"]
    M["KEY_ALIASES[ANTHROPIC_API_KEY]<br/>= [ANTHROPIC_TOKEN, CLAUDE_CODE_OAUTH_TOKEN]"]
  end
  GATE["vaultResolvedHasKey(resolved, expectedKey)<br/>usable() = string & non-blank"]
  M --> GATE
  V1 -->|"name matches expectedKey"| GATE
  V2 -->|"name matches alias"| GATE
  V3 -->|"name matches alias"| GATE
  V4 -.->|"name NOT in {expectedKey ∪ aliases} → ignored"| GATE
  GATE --> OUT["boolean only → hasApiKey<br/>(no value crosses to renderer)"]

  classDef ok fill:#0b3d0b,stroke:#3fae3f,color:#d6ffd6;
  classDef no fill:#4d0b0b,stroke:#d04f4f,color:#ffd6d6;
  class V1,V2,V3 ok;
  class V4 no;
```

## Verification

- 8/8 regression tests (`tests/installer-vault-gate.test.ts`); bug-repro reds
  against pre-fix code (broad scan returned `true` for `{GITHUB_TOKEN}`).
- Typecheck clean (node + web); semgrep TS rules clean on `installer.ts`.
- AppSec verdict: SHIP (fail-closed on resolver error; no proto-pollution/ReDoS;
  sibling-asymmetry with `config-health.ts` resolved).
