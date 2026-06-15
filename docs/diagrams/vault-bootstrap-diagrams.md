# Vault Bootstrap — Diagrams

Diagrams for the first-run vault-bootstrap / secrets-provider onboarding feature.
All three are Mermaid (render natively on GitHub) and were validated to parse via
`mermaid.parse()` before commit.

---

## 1. Logical component / data flow

How the renderer, the main-process IPC layer, the bootstrap module, and the
external tools relate. Note the trust boundary: the renderer only ever receives
NAMES / paths / booleans / counts — never a secret value.

```mermaid
flowchart TD
  subgraph Renderer["Renderer (untrusted)"]
    SetupUI["Setup wizard / Settings - SecretsProviders"]
  end

  subgraph Preload["Preload bridge"]
    API["window.api: vault-detect-existing, vault-create,\nsecrets-provider-can-write, -write, -delete"]
  end

  subgraph Main["Main process (trusted)"]
    IPC["ipcMain handlers (re-check gates server-side)"]
    Boot["vaultBootstrap.ts\ndetect / create / seal / tool-check"]
    Write["commandProviderWrite.ts\nwrite / delete via sh helper"]
    Gate["config.ts: secretsProviderCanWrite\n-> decideCanWrite (fail-closed)"]
    Resolve["secrets/index.ts\nproviderListSafe / resolvedSecretMap"]
  end

  subgraph External["External (OS)"]
    KP["keepassxc-cli / keepassxc.cli"]
    TPM["systemd-creds --with-key=tpm2"]
    FS["vault .kdbx + key-file (0600)"]
    TMPFS["tmpfs dump\n$XDG_RUNTIME_DIR/hermes-secrets.env"]
  end

  SetupUI -->|invoke| API --> IPC
  IPC --> Boot
  IPC --> Write
  IPC --> Gate
  Gate --> Resolve
  Boot -->|spawn, timeout-bounded| KP
  Boot -->|opt-in seal| TPM
  Boot -->|chmod 0600 / 0700| FS
  Boot -->|read NAMES only| TMPFS
  Resolve -->|raw vault list| KP
  IPC -.->|NAMES / paths / booleans only\nNEVER a value| API
```

---

## 2. First-run onboarding state machine

The "assume nothing exists" flow — every detect path has a matching create path,
and a missing dependency surfaces an install hint rather than a dead end.

```mermaid
stateDiagram-v2
  [*] --> Detect: first run
  Detect --> Found: tmpfs dump OR vault file on disk
  Detect --> NotFound: nothing resolvable

  Found --> Prefill: suggest read command (UID-safe)
  Prefill --> ModelStep: provider resolves the model key -> hide key field

  NotFound --> ToolCheck: checkToolAvailability()
  ToolCheck --> CanCreate: keepassxc-cli present
  ToolCheck --> InstallHint: CLI missing
  InstallHint --> Detect: user installs, retry

  CanCreate --> Create: createVault()
  Create --> CreateOk: kdbx + key 0600, command returned
  Create --> CreateFail: vault-already-exists / db-create-failed
  CreateFail --> ToolCheck: surface honest error

  CreateOk --> SealChoice: offer opt-in TPM seal
  SealChoice --> Sealed: systemd-creds ok -> sealed=true
  SealChoice --> Fallback: polkit/no-tpm -> sealed=false, 0600 stands
  Sealed --> ModelStep
  Fallback --> ModelStep

  ModelStep --> [*]: provider configured, setup complete
```

---

## 3. SECRET workflow (security-critical)

How a secret VALUE and a KEY NAME move through the system, and exactly where each
is gated. This is the diagram that encodes the threat-model controls: the VALUE
never crosses to the renderer and never enters argv / the shell string / the
process env; the KEY NAME is validated before it touches a helper; writes are
fail-closed against a locked vault.

```mermaid
flowchart TD
  Start([User edits/reads a secret in the UI]) --> Which{Read or Write?}

  %% READ / DETECT path
  Which -->|Detect/Read NAMES| RIPC["IPC: vault-detect-existing"]
  RIPC --> RParse["envKeyNames(): regex ^[A-Za-z_][A-Za-z0-9_]*=\nKEEP name, DROP value"]
  RParse --> RNames["return NAMES + paths only"]
  RNames -.->|NEVER a value| UIback([Renderer shows key names])

  %% WRITE path
  Which -->|Write/Delete| WGate{"secretsProviderCanWrite()\ndecideCanWrite: provider==command\nAND providerListSafe count > 0 (unlocked)\nAND helper configured"}
  WGate -->|fail-closed| Deny[/"return write-not-permitted\n(locked vault / no helper)"/]
  WGate -->|permitted| KeyVal{"VALID_KEY_NAME test\n^[A-Za-z_][A-Za-z0-9_]*$"}
  KeyVal -->|bad name| BadKey[/"return bad-key\n(blocks KEY=VALUE / newline injection)"/]
  KeyVal -->|valid| Spawn["execFileSync /bin/sh -c <user helper>"]

  subgraph Spawnenv["how the secret crosses to the helper"]
    direction TB
    EnvName["KEY NAME -> HERMES_SECRET_KEY env (inert data)"]
    Stdin["VALUE -> helper STDIN ONLY\nnot argv, not shell string, not env"]
  end
  Spawn --> EnvName
  Spawn --> Stdin
  EnvName --> Vault[("vault .kdbx")]
  Stdin --> Vault

  Spawn --> Result{exit code?}
  Result -->|ok| OkR["return ok:true\ninvalidate caches"]
  Result -->|fail| FailR["return coarse reason\nexit-N / timeout\nstderr piped+discarded\nVALUE never logged"]
  OkR -.->|booleans only| UIback
  FailR -.->|coarse reason only| UIback
```
