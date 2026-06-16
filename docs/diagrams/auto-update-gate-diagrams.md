# Auto-update opt-out gate — diagrams

Diagrams for the `desktop.auto_update` opt-out feature (branch `secrets/04`).
Auto-update is **ENABLED BY DEFAULT**; only an explicit `desktop.auto_update: false`
(or `0`) in `config.yaml` disables it. The opt-out exists so a user running a
locally-built or patched `/opt` artifact can stop electron-updater from
re-downloading the public release and overwriting their build on quit
(`autoInstallOnAppQuit`).

## 1. Logical flow — the opt-out decision and the updater gate

```mermaid
flowchart TD
  A["App launch → setupUpdater()"] --> B{"app.isPackaged<br/>AND not portable build?"}
  B -->|"No (dev / portable)"| Z["Register no-op IPC handlers<br/>return — no autoDownload wiring"]
  B -->|"Yes (packaged install)"| C["getConfigValue('desktop.auto_update')<br/>→ string | null"]
  C --> D["isAutoUpdateDisabled(raw)<br/>shared single source of truth"]
  D --> E{"normalized value<br/>=== 'false' or '0' ?"}
  E -->|"Yes (explicit opt-out)"| Z
  E -->|"No — null / unset / empty / garbage<br/>(fail-safe to upstream default)"| Y["Wire electron-updater:<br/>autoDownload + autoInstallOnAppQuit"]
  Z --> ZZ["Updates never auto-installed<br/>local/patched build preserved"]
  Y --> YY["Auto-update ON (community default)"]

  classDef safe fill:#0b3d0b,stroke:#3fae3f,color:#d6ffd6;
  classDef on fill:#0b2d4d,stroke:#3f8fd0,color:#d6ecff;
  class Z,ZZ safe;
  class Y,YY on;
```

## 2. SECRET / overwrite-gate workflow — what crosses each boundary

The "secret" being protected here is the user's **local build integrity** (their
patched `/opt` artifact). The gate decides whether the auto-updater is allowed to
overwrite it. Only NAMES/booleans cross the IPC boundary to the renderer — never
the artifact or any credential.

```mermaid
flowchart TD
  subgraph CFG["config.yaml (operator-controlled, local FS)"]
    K["key: desktop.auto_update<br/>value: false | 0 | (unset)"]
  end

  subgraph MAIN["Electron main process"]
    G["isAutoUpdateDisabled()<br/>(../shared/auto-update-gate)"]
    GATE{"fail-CLOSED to<br/>upstream default?"}
    UPD["electron-updater<br/>autoDownload / autoInstallOnAppQuit"]
  end

  subgraph RND["Renderer (Settings toggle)"]
    T["'Automatic updates' toggle<br/>shows ENABLED / DISABLED"]
  end

  ART["Local /opt build artifact<br/>(the asset being protected)"]

  K -->|"raw string value"| G
  G --> GATE
  GATE -->|"explicit false/0 → DISABLED"| BLOCK["updater short-circuited<br/>artifact NOT overwritten"]
  GATE -->|"anything else → ENABLED (safe default)"| UPD
  UPD -.->|"may overwrite on quit"| ART
  BLOCK -. protects .-> ART

  G -. "boolean only (no secret)" .-> T
  T -->|"writes 'true'/'false' via setConfig"| K

  classDef boundary fill:#1a1a2e,stroke:#888,color:#eee;
  classDef danger fill:#4d0b0b,stroke:#d05f5f,color:#ffd6d6;
  classDef safe fill:#0b3d0b,stroke:#3fae3f,color:#d6ffd6;
  class CFG,MAIN,RND boundary;
  class UPD danger;
  class BLOCK safe;
```

**Controls depicted:**
- The decision is computed in ONE place (`isAutoUpdateDisabled`, shared) and
  consumed identically by the main-process gate and the renderer toggle — they
  cannot drift (pinned by `autoUpdateGateParity.test.ts`).
- The gate **fails CLOSED to the upstream default (ENABLED)**: a typo / empty /
  garbage config value can never silently disable security updates.
- Only a boolean crosses the IPC boundary to the renderer; no artifact bytes and
  no secret values traverse it.
