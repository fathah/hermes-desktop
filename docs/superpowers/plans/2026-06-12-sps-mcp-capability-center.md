# SPS MCP Capability Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn MCP from raw config inventory into a curated, scoped **Capabilities** product surface where employees can grant, limit, and revoke what My Assistant can use.

**Architecture:** Reuse Hermes MCP config as the source of truth and add a thin SPS capability layer over it. Parse and edit `mcp_servers` with the existing `yaml` package, expose profile-scoped IPC for listing/toggling per-server and per-tool policy, and render a new SPS **Capabilities** surface under **My Assistant**. Keep installation scope small: v1 curates app-owned MCPs and safely inventories unknown MCPs; broader Nous catalog installation can follow once revoke/filter UI is in place.

**Tech Stack:** Electron main/preload IPC, React 19, Zustand SPS store, TypeScript shared types, `yaml`, Vitest/jsdom.

---

## Product Decisions

- Employee-facing surface name: **Capabilities**.
- Employee-facing model: “what My Assistant can access and use,” not “MCP server config.”
- Sidebar placement: under **My Assistant**, near **Learn This** and **Active Work**.
- Settings → Application Health remains a summary, not the main control plane.
- MCPs are disabled or tightly filtered by default where SPS owns the entry.
- Unknown/unreviewed MCPs are visible but treated as **Advanced** and **Unreviewed**.
- Internal naming remains unchanged: `mcp_servers`, Hermes config paths, `window.hermesAPI`, bundled MCP server names, and existing IPC names remain stable.

## V1 Scope

Build the safety/control layer before adding a large marketplace:

- Parse installed MCP servers with enabled state, transport type, detail, env keys, and tool policy.
- Represent MCP entries as capability cards with risk labels and trust status.
- Include a small curated SPS catalog for app-owned MCPs:
  - `openalex`: read-only research search/get-work.
  - `external-context`: read-only search over indexed external sessions, with private-context warning.
- Show unknown MCPs from `config.yaml` as **Advanced / Unreviewed**.
- Let users enable/disable an installed MCP server.
- Let users edit per-tool allowlist for tools known from the curated catalog.
- Let users enable/disable resource and prompt utility wrappers where applicable.
- Wire existing install paths for app-owned MCPs:
  - OpenAlex through existing `sps-research-ensure-agent-tool`.
  - External Context through existing `external-context-ensure-mcp`.
- Update Settings capability summary to link users to **Capabilities** instead of saying “go find Skills / Tools.”

## Out Of Scope For V1

- No arbitrary community MCP install from the UI.
- No direct network download, `git clone`, `npm install`, or `pip install` from the desktop UI.
- No OAuth flow implementation beyond existing Hermes behavior.
- No live MCP server probe in v1; curated tool lists come from local metadata.
- No direct SQLite or Hermes internal registry reads.
- No editing secrets or credential values from the Capabilities surface.
- No deletion of unknown config entries. V1 can disable, not erase.

## File Structure

Create:

- `src/shared/mcp-capabilities.ts`  
  Shared types for capability cards, risk labels, tool policy, and update inputs.

- `src/shared/mcp-catalog.ts`  
  Local curated metadata for SPS-owned MCP capabilities. Pure data, no Electron imports.

- `src/main/mcp-capabilities.ts`  
  Main-process list/update helpers. Reads/writes profile `config.yaml` using `yaml`, combines installed config with curated metadata, and preserves unknown entries.

- `tests/mcp-capabilities.test.ts`  
  Unit tests for parsing, risk labeling, enable/disable, tool allowlist writes, and unknown MCP handling.

- `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.tsx`  
  New SPS product surface for capability cards and scoped controls.

- `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.test.tsx`  
  Renderer tests for cards, risk labels, install/configure buttons, per-tool toggles, and disable flow.

Modify:

- `src/main/installer/mcp.ts`  
  Keep existing exported helpers, but make `listMcpServers` use the new parser or delegate to `listMcpCapabilityConfigs` so the old summary remains compatible.

- `src/main/ipc/system.ts`  
  Register `list-mcp-capabilities`, `set-mcp-server-enabled`, and `set-mcp-tool-policy`.

- `src/preload/bridges/toolsmisc.ts` and `src/preload/index.d.ts`  
  Expose the new capability APIs.

- `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`  
  Add `"capabilities"` to the `Surface` union.

- `src/renderer/src/screens/SpsAgent/App.tsx`  
  Render `CapabilitiesSurface`.

- `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx`  
  Add **Capabilities** under **My Assistant**.

- `src/renderer/src/screens/Settings/CapabilitySummary.tsx`  
  Update copy to point to the new surface and use richer risk summary where possible.

- `tests/preload-api-surface.test.ts`  
  Add new preload API parity expectations.

## Shared Types

Add `src/shared/mcp-capabilities.ts`:

```ts
export type McpCapabilityRisk =
  | "read_only"
  | "writes_data"
  | "deletes_data"
  | "sends_messages"
  | "uses_money"
  | "reads_private_files"
  | "runs_code"
  | "shares_outside_sps"
  | "advanced";

export type McpCapabilityTrust = "sps_curated" | "nous_curated" | "unreviewed";

export interface McpToolInfo {
  name: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  risks: McpCapabilityRisk[];
}

export interface McpToolPolicy {
  include?: string[];
  exclude?: string[];
  prompts?: boolean;
  resources?: boolean;
}

export interface McpCapability {
  name: string;
  displayName: string;
  description: string;
  installed: boolean;
  enabled: boolean;
  type: "stdio" | "http";
  detail: string;
  trust: McpCapabilityTrust;
  sourceUrl?: string;
  envKeys: string[];
  risks: McpCapabilityRisk[];
  tools: McpToolInfo[];
  policy: McpToolPolicy;
  canInstall: boolean;
  installAction?: "openalex" | "external-context";
}

export interface McpCapabilityConfig {
  name: string;
  type: "stdio" | "http";
  enabled: boolean;
  detail: string;
  envKeys: string[];
  policy: McpToolPolicy;
}

export interface SetMcpToolPolicyInput {
  name: string;
  include?: string[];
  exclude?: string[];
  prompts?: boolean;
  resources?: boolean;
}
```

Add `src/shared/mcp-catalog.ts`:

```ts
import type { McpCapability } from "./mcp-capabilities";

export const SPS_MCP_CATALOG: Record<
  string,
  Pick<
    McpCapability,
    | "name"
    | "displayName"
    | "description"
    | "trust"
    | "sourceUrl"
    | "risks"
    | "tools"
    | "canInstall"
    | "installAction"
  >
> = {
  openalex: {
    name: "openalex",
    displayName: "Research Papers",
    description: "Search scholarly works and fetch publication details.",
    trust: "sps_curated",
    risks: ["read_only", "shares_outside_sps"],
    canInstall: true,
    installAction: "openalex",
    tools: [
      {
        name: "search_works",
        label: "Search works",
        description: "Search OpenAlex for scholarly works.",
        defaultEnabled: true,
        risks: ["read_only", "shares_outside_sps"],
      },
      {
        name: "get_work",
        label: "Get work",
        description: "Fetch details for one OpenAlex work.",
        defaultEnabled: true,
        risks: ["read_only", "shares_outside_sps"],
      },
    ],
  },
  "external-context": {
    name: "external-context",
    displayName: "External Sessions",
    description: "Search redacted sessions from connected AI tools.",
    trust: "sps_curated",
    risks: ["read_only", "reads_private_files"],
    canInstall: true,
    installAction: "external-context",
    tools: [
      {
        name: "search_sessions",
        label: "Search sessions",
        description: "Search indexed external sessions.",
        defaultEnabled: true,
        risks: ["read_only", "reads_private_files"],
      },
      {
        name: "read_session",
        label: "Read session",
        description: "Read a selected redacted session excerpt.",
        defaultEnabled: false,
        risks: ["read_only", "reads_private_files"],
      },
    ],
  },
};
```

## Task 1: Main Capability Parser Tests

**Files:**
- Create: `tests/mcp-capabilities.test.ts`
- Create later: `src/shared/mcp-capabilities.ts`
- Create later: `src/shared/mcp-catalog.ts`
- Create later: `src/main/mcp-capabilities.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/mcp-capabilities.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  listMcpCapabilityConfigs,
  listMcpCapabilities,
  setMcpServerEnabled,
  setMcpToolPolicy,
} from "../src/main/mcp-capabilities";

let home: string;
const PROFILE = "default";

function configPath(): string {
  return join(home, "profiles", PROFILE, "config.yaml");
}

function writeConfig(yaml: string): void {
  mkdirSync(join(home, "profiles", PROFILE), { recursive: true });
  writeFileSync(configPath(), yaml, "utf-8");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sps-mcp-cap-"));
  process.env.HERMES_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("mcp capability config parsing", () => {
  it("returns [] when config has no mcp_servers block", () => {
    writeConfig("model:\n  default: test\n");
    expect(listMcpCapabilityConfigs(PROFILE)).toEqual([]);
  });

  it("parses stdio, env keys, enabled state, and tool policy", () => {
    writeConfig(`mcp_servers:
  github:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "secret"
    enabled: false
    tools:
      include:
        - list_issues
        - create_issue
      prompts: false
      resources: false
`);

    expect(listMcpCapabilityConfigs(PROFILE)).toEqual([
      {
        name: "github",
        type: "stdio",
        enabled: false,
        detail: "npx",
        envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
        policy: {
          include: ["list_issues", "create_issue"],
          prompts: false,
          resources: false,
        },
      },
    ]);
  });

  it("parses http servers as enabled by default", () => {
    writeConfig(`mcp_servers:
  linear:
    url: "https://mcp.linear.app/mcp"
    auth: oauth
`);

    expect(listMcpCapabilityConfigs(PROFILE)).toEqual([
      {
        name: "linear",
        type: "http",
        enabled: true,
        detail: "https://mcp.linear.app/mcp",
        envKeys: [],
        policy: {},
      },
    ]);
  });
});

describe("mcp capabilities", () => {
  it("merges installed config with the SPS curated catalog", () => {
    writeConfig(`mcp_servers:
  openalex:
    command: "/Applications/SPS.app/Contents/MacOS/SPS"
    args:
      - "/resources/openalex-mcp.cjs"
    enabled: true
    tools:
      include:
        - search_works
`);

    const caps = listMcpCapabilities(PROFILE);
    const openalex = caps.find((c) => c.name === "openalex");
    expect(openalex).toMatchObject({
      displayName: "Research Papers",
      installed: true,
      enabled: true,
      trust: "sps_curated",
      policy: { include: ["search_works"] },
    });
    expect(openalex?.risks).toContain("read_only");
  });

  it("shows unknown installed servers as unreviewed advanced capabilities", () => {
    writeConfig(`mcp_servers:
  unknown:
    url: "https://mcp.example.test"
    enabled: true
`);

    const unknown = listMcpCapabilities(PROFILE).find((c) => c.name === "unknown");
    expect(unknown).toMatchObject({
      name: "unknown",
      displayName: "unknown",
      installed: true,
      enabled: true,
      trust: "unreviewed",
      risks: ["advanced"],
      canInstall: false,
    });
  });

  it("includes curated entries even when not installed", () => {
    writeConfig("model:\n  default: test\n");
    const openalex = listMcpCapabilities(PROFILE).find((c) => c.name === "openalex");
    expect(openalex).toMatchObject({
      installed: false,
      enabled: false,
      canInstall: true,
    });
  });
});

describe("mcp capability updates", () => {
  it("toggles an installed server enabled flag", () => {
    writeConfig(`mcp_servers:
  openalex:
    command: "node"
    enabled: true
`);

    expect(setMcpServerEnabled("openalex", false, PROFILE)).toBe(true);
    expect(readFileSync(configPath(), "utf-8")).toContain("enabled: false");
    expect(listMcpCapabilityConfigs(PROFILE)[0].enabled).toBe(false);
  });

  it("returns false when toggling a missing server", () => {
    writeConfig("mcp_servers:\n");
    expect(setMcpServerEnabled("missing", false, PROFILE)).toBe(false);
  });

  it("writes include policy and utility toggles", () => {
    writeConfig(`mcp_servers:
  openalex:
    command: "node"
    enabled: true
`);

    expect(
      setMcpToolPolicy(
        {
          name: "openalex",
          include: ["search_works"],
          prompts: false,
          resources: false,
        },
        PROFILE,
      ),
    ).toBe(true);

    const yaml = readFileSync(configPath(), "utf-8");
    expect(yaml).toContain("tools:");
    expect(yaml).toContain("search_works");
    expect(yaml).toContain("prompts: false");
    expect(yaml).toContain("resources: false");
  });

  it("does not create a config file when updating a missing server", () => {
    expect(setMcpToolPolicy({ name: "missing", include: [] }, PROFILE)).toBe(false);
    expect(existsSync(configPath())).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx vitest run tests/mcp-capabilities.test.ts
```

Expected: FAIL because `src/main/mcp-capabilities.ts` does not exist.

## Task 2: Shared Types And Curated Catalog

**Files:**
- Create: `src/shared/mcp-capabilities.ts`
- Create: `src/shared/mcp-catalog.ts`
- Test: `tests/mcp-capabilities.test.ts`

- [ ] **Step 1: Add shared types**

Create `src/shared/mcp-capabilities.ts` with the exact content from the **Shared Types** section.

- [ ] **Step 2: Add local curated SPS catalog**

Create `src/shared/mcp-catalog.ts` with the exact content from the **Shared Types** section.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
npx vitest run tests/mcp-capabilities.test.ts
```

Expected: still FAIL because main helpers are not implemented yet.

## Task 3: Main MCP Capability Helpers

**Files:**
- Create: `src/main/mcp-capabilities.ts`
- Modify later: `src/main/installer/mcp.ts`
- Test: `tests/mcp-capabilities.test.ts`

- [ ] **Step 1: Implement YAML-backed helpers**

Create `src/main/mcp-capabilities.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Document, isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import { profileHome } from "./utils";
import { SPS_MCP_CATALOG } from "../shared/mcp-catalog";
import type {
  McpCapability,
  McpCapabilityConfig,
  McpCapabilityRisk,
  McpToolPolicy,
  SetMcpToolPolicyInput,
} from "../shared/mcp-capabilities";

function configPath(profile?: string): string {
  return join(profileHome(profile), "config.yaml");
}

function readConfig(profile?: string): { doc: Document.Parsed; exists: boolean } {
  const p = configPath(profile);
  if (!existsSync(p)) return { doc: parseDocument(""), exists: false };
  return { doc: parseDocument(readFileSync(p, "utf-8")), exists: true };
}

function scalarString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function scalarBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

function mapToPolicy(raw: unknown): McpToolPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const policy: McpToolPolicy = {};
  const include = stringArray(obj.include);
  const exclude = stringArray(obj.exclude);
  const prompts = scalarBoolean(obj.prompts);
  const resources = scalarBoolean(obj.resources);
  if (include) policy.include = include;
  if (exclude) policy.exclude = exclude;
  if (prompts !== undefined) policy.prompts = prompts;
  if (resources !== undefined) policy.resources = resources;
  return policy;
}

function riskUnion(a: McpCapabilityRisk[], b: McpCapabilityRisk[]): McpCapabilityRisk[] {
  return [...new Set([...a, ...b])];
}

function getServerMap(doc: Document.Parsed): YAMLMap | null {
  const node = doc.get("mcp_servers", true);
  return isMap(node) ? node : null;
}

function findServerMap(doc: Document.Parsed, name: string): YAMLMap | null {
  const servers = getServerMap(doc);
  const node = servers?.get(name, true);
  return isMap(node) ? node : null;
}

function ensureToolsMap(doc: Document.Parsed, server: YAMLMap): YAMLMap {
  const existing = server.get("tools", true);
  if (isMap(existing)) return existing;
  const tools = new YAMLMap();
  server.set("tools", tools);
  return tools;
}

function seqFromStrings(values: string[]): YAMLSeq {
  const seq = new YAMLSeq();
  for (const value of values) seq.add(value);
  return seq;
}

export function listMcpCapabilityConfigs(profile?: string): McpCapabilityConfig[] {
  const { doc } = readConfig(profile);
  const servers = getServerMap(doc);
  if (!servers) return [];

  const out: McpCapabilityConfig[] = [];
  for (const item of servers.items) {
    const name = String(item.key?.toJSON?.() ?? "");
    if (!name || !isMap(item.value)) continue;

    const raw = item.value.toJSON() as Record<string, unknown>;
    const url = scalarString(raw.url);
    const command = scalarString(raw.command);
    const env = raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
      ? (raw.env as Record<string, unknown>)
      : {};
    out.push({
      name,
      type: url ? "http" : "stdio",
      enabled: raw.enabled === false ? false : true,
      detail: url || command || "",
      envKeys: Object.keys(env),
      policy: mapToPolicy(raw.tools),
    });
  }
  return out;
}

export function listMcpCapabilities(profile?: string): McpCapability[] {
  const installed = listMcpCapabilityConfigs(profile);
  const byName = new Map(installed.map((cfg) => [cfg.name, cfg]));
  const names = [...new Set([...Object.keys(SPS_MCP_CATALOG), ...installed.map((i) => i.name)])];

  return names.map((name) => {
    const cfg = byName.get(name);
    const catalog = SPS_MCP_CATALOG[name];
    if (catalog) {
      const policy = cfg?.policy ?? {};
      const enabledTools = policy.include
        ? catalog.tools.filter((tool) => policy.include?.includes(tool.name))
        : catalog.tools.filter((tool) => tool.defaultEnabled);
      const policyRisks = enabledTools.reduce<McpCapabilityRisk[]>(
        (acc, tool) => riskUnion(acc, tool.risks),
        [],
      );
      return {
        ...catalog,
        installed: Boolean(cfg),
        enabled: Boolean(cfg?.enabled),
        type: cfg?.type ?? "stdio",
        detail: cfg?.detail ?? "",
        envKeys: cfg?.envKeys ?? [],
        policy,
        risks: riskUnion(catalog.risks, policyRisks),
      };
    }
    return {
      name,
      displayName: name,
      description: "Configured outside SPS. Review before granting access.",
      installed: true,
      enabled: Boolean(cfg?.enabled),
      type: cfg?.type ?? "stdio",
      detail: cfg?.detail ?? "",
      trust: "unreviewed",
      envKeys: cfg?.envKeys ?? [],
      risks: ["advanced"],
      tools: [],
      policy: cfg?.policy ?? {},
      canInstall: false,
    };
  });
}

export function setMcpServerEnabled(
  name: string,
  enabled: boolean,
  profile?: string,
): boolean {
  const { doc, exists } = readConfig(profile);
  if (!exists) return false;
  const server = findServerMap(doc, name);
  if (!server) return false;
  server.set("enabled", enabled);
  writeFileSync(configPath(profile), String(doc), "utf-8");
  return true;
}

export function setMcpToolPolicy(
  input: SetMcpToolPolicyInput,
  profile?: string,
): boolean {
  const { doc, exists } = readConfig(profile);
  if (!exists) return false;
  const server = findServerMap(doc, input.name);
  if (!server) return false;
  const tools = ensureToolsMap(doc, server);

  if (input.include !== undefined) {
    if (input.include.length === 0) tools.delete("include");
    else tools.set("include", seqFromStrings(input.include));
  }
  if (input.exclude !== undefined) {
    if (input.exclude.length === 0) tools.delete("exclude");
    else tools.set("exclude", seqFromStrings(input.exclude));
  }
  if (input.prompts !== undefined) tools.set("prompts", input.prompts);
  if (input.resources !== undefined) tools.set("resources", input.resources);

  writeFileSync(configPath(profile), String(doc), "utf-8");
  return true;
}
```

- [ ] **Step 2: Run tests**

Run:

```bash
npx vitest run tests/mcp-capabilities.test.ts
```

Expected: PASS. If TypeScript complains about `Document.Parsed`, replace it with the project-compatible `ReturnType<typeof parseDocument>` type and rerun.

## Task 4: Preserve Old MCP Inventory API

**Files:**
- Modify: `src/main/installer/mcp.ts`
- Test: `tests/installer-utils.test.ts`, `tests/openalex-mcp-config.test.ts`, `tests/mcp-capabilities.test.ts`

- [ ] **Step 1: Delegate `listMcpServers` to the new parser**

In `src/main/installer/mcp.ts`, import:

```ts
import { listMcpCapabilityConfigs } from "../mcp-capabilities";
```

Replace only `listMcpServers` with:

```ts
export function listMcpServers(
  profile?: string,
): Array<{ name: string; type: string; enabled: boolean; detail: string }> {
  return listMcpCapabilityConfigs(profile).map((server) => ({
    name: server.name,
    type: server.type,
    enabled: server.enabled,
    detail: server.detail,
  }));
}
```

Do not change `renderMcpServerEntry`, `upsertMcpServerInYaml`, `writeMcpServerEntry`, `hasMcpServer`, `openAlexMcpServerPath`, or `externalContextMcpServerPath`.

- [ ] **Step 2: Run related tests**

Run:

```bash
npx vitest run tests/mcp-capabilities.test.ts tests/openalex-mcp-config.test.ts tests/installer-utils.test.ts
```

Expected: PASS. If `tests/installer-utils.test.ts` contains a local simulated parser, leave it unchanged; it is not asserting the production parser.

## Task 5: IPC And Preload APIs

**Files:**
- Modify: `src/main/ipc/system.ts`
- Modify: `src/preload/bridges/toolsmisc.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `tests/preload-api-surface.test.ts`

- [ ] **Step 1: Add IPC handlers**

In `src/main/ipc/system.ts`, import:

```ts
import {
  listMcpCapabilities,
  setMcpServerEnabled,
  setMcpToolPolicy,
} from "../mcp-capabilities";
import type { SetMcpToolPolicyInput } from "../../shared/mcp-capabilities";
```

Near the existing `list-mcp-servers` handler, add:

```ts
safeHandle("list-mcp-capabilities", (_event, profile?: string) =>
  listMcpCapabilities(profile),
);
safeHandle(
  "set-mcp-server-enabled",
  (_event, name: string, enabled: boolean, profile?: string) =>
    setMcpServerEnabled(name, enabled, profile),
);
safeHandle(
  "set-mcp-tool-policy",
  (_event, input: SetMcpToolPolicyInput, profile?: string) =>
    setMcpToolPolicy(input, profile),
);
```

- [ ] **Step 2: Add preload bridge methods**

In `src/preload/bridges/toolsmisc.ts`, import:

```ts
import type {
  McpCapability,
  SetMcpToolPolicyInput,
} from "../../shared/mcp-capabilities";
```

Add methods after `listMcpServers`:

```ts
listMcpCapabilities: (profile?: string): Promise<McpCapability[]> =>
  ipcRenderer.invoke("list-mcp-capabilities", profile),
setMcpServerEnabled: (
  name: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> =>
  ipcRenderer.invoke("set-mcp-server-enabled", name, enabled, profile),
setMcpToolPolicy: (
  input: SetMcpToolPolicyInput,
  profile?: string,
): Promise<boolean> => ipcRenderer.invoke("set-mcp-tool-policy", input, profile),
```

- [ ] **Step 3: Update preload types**

In `src/preload/index.d.ts`, import:

```ts
import type {
  McpCapability,
  SetMcpToolPolicyInput,
} from "../shared/mcp-capabilities";
```

Add:

```ts
listMcpCapabilities: (profile?: string) => Promise<McpCapability[]>;
setMcpServerEnabled: (
  name: string,
  enabled: boolean,
  profile?: string,
) => Promise<boolean>;
setMcpToolPolicy: (
  input: SetMcpToolPolicyInput,
  profile?: string,
) => Promise<boolean>;
```

- [ ] **Step 4: Update preload API surface test**

In `tests/preload-api-surface.test.ts`, extend the MCP test:

```ts
expect(preloadMethods).toContain("listMcpCapabilities");
expect(typeMethods).toContain("listMcpCapabilities");
expect(preloadMethods).toContain("setMcpServerEnabled");
expect(typeMethods).toContain("setMcpServerEnabled");
expect(preloadMethods).toContain("setMcpToolPolicy");
expect(typeMethods).toContain("setMcpToolPolicy");
```

- [ ] **Step 5: Validate IPC/preload**

Run:

```bash
npx vitest run tests/preload-api-surface.test.ts tests/ipc-handlers.test.ts tests/mcp-capabilities.test.ts
npm run typecheck
```

Expected: PASS.

## Task 6: Capabilities Surface Shell

**Files:**
- Create: `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`
- Modify: `src/renderer/src/screens/SpsAgent/App.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Add surface type**

In `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`, add `"capabilities"` to the existing `Surface` union.

- [ ] **Step 2: Create surface component**

Create `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import type {
  McpCapability,
  McpCapabilityRisk,
} from "../../../../../shared/mcp-capabilities";

const RISK_LABELS: Record<McpCapabilityRisk, string> = {
  read_only: "Read only",
  writes_data: "Writes data",
  deletes_data: "Deletes data",
  sends_messages: "Sends messages",
  uses_money: "Uses money",
  reads_private_files: "Reads private files",
  runs_code: "Runs code",
  shares_outside_sps: "Shares outside SPS",
  advanced: "Advanced",
};

function trustLabel(cap: McpCapability): string {
  if (cap.trust === "sps_curated") return "SPS curated";
  if (cap.trust === "nous_curated") return "Nous reviewed";
  return "Unreviewed";
}

export function CapabilitiesSurface() {
  const [items, setItems] = useState<McpCapability[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    try {
      setError("");
      setItems(await window.hermesAPI.listMcpCapabilities());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load capabilities.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const activeCount = useMemo(
    () => items.filter((item) => item.installed && item.enabled).length,
    [items],
  );

  async function toggleServer(cap: McpCapability): Promise<void> {
    if (!cap.installed) return;
    setBusy(cap.name);
    try {
      await window.hermesAPI.setMcpServerEnabled(cap.name, !cap.enabled);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function toggleTool(cap: McpCapability, toolName: string): Promise<void> {
    const current =
      cap.policy.include ??
      cap.tools.filter((tool) => tool.defaultEnabled).map((tool) => tool.name);
    const next = current.includes(toolName)
      ? current.filter((name) => name !== toolName)
      : [...current, toolName];
    setBusy(cap.name);
    try {
      await window.hermesAPI.setMcpToolPolicy({
        name: cap.name,
        include: next,
        prompts: cap.policy.prompts,
        resources: cap.policy.resources,
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function installCurated(cap: McpCapability): Promise<void> {
    if (!cap.installAction) return;
    setBusy(cap.name);
    try {
      if (cap.installAction === "openalex") {
        await window.hermesAPI.spsResearchEnsureAgentTool();
      } else if (cap.installAction === "external-context") {
        await window.hermesAPI.externalContextEnsureMcp();
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="surface capabilities-surface">
      <div className="surface-head">
        <div>
          <h1>Capabilities</h1>
          <p>
            Grant, limit, or revoke what My Assistant can access and use.
          </p>
        </div>
        <div className="cap-count">{activeCount} active</div>
      </div>

      {error && (
        <div className="settings-field-hint" style={{ color: "var(--danger, #c00)" }}>
          {error}
        </div>
      )}

      <div className="capability-grid">
        {items.map((cap) => {
          const selectedTools =
            cap.policy.include ??
            cap.tools.filter((tool) => tool.defaultEnabled).map((tool) => tool.name);
          return (
            <article key={cap.name} className="capability-card">
              <header className="capability-card-head">
                <div>
                  <h2>{cap.displayName}</h2>
                  <p>{cap.description}</p>
                </div>
                <span className={`capability-trust is-${cap.trust}`}>
                  {trustLabel(cap)}
                </span>
              </header>

              <div className="capability-risk-row">
                {cap.risks.map((risk) => (
                  <span key={risk} className={`capability-risk is-${risk}`}>
                    {RISK_LABELS[risk]}
                  </span>
                ))}
              </div>

              <div className="capability-meta">
                <span>{cap.installed ? "Installed" : "Not installed"}</span>
                <span>{cap.enabled ? "Enabled" : "Disabled"}</span>
                <span>{cap.type}</span>
              </div>

              {cap.tools.length > 0 && cap.installed && (
                <div className="capability-tools">
                  {cap.tools.map((tool) => (
                    <label key={tool.name} className="capability-tool-row">
                      <input
                        type="checkbox"
                        checked={selectedTools.includes(tool.name)}
                        disabled={busy === cap.name || !cap.enabled}
                        onChange={() => void toggleTool(cap, tool.name)}
                      />
                      <span>
                        <strong>{tool.label}</strong>
                        <small>{tool.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {cap.trust === "unreviewed" && (
                <div className="settings-field-hint">
                  This was configured outside SPS. Review its command, URL, and credentials before enabling it.
                </div>
              )}

              <footer className="capability-actions">
                {!cap.installed && cap.canInstall ? (
                  <button
                    className="cover-btn"
                    disabled={busy === cap.name}
                    onClick={() => void installCurated(cap)}
                  >
                    <Icon name="plus" size={14} /> Add capability
                  </button>
                ) : (
                  <button
                    className="cover-btn"
                    disabled={busy === cap.name || !cap.installed}
                    onClick={() => void toggleServer(cap)}
                  >
                    {cap.enabled ? "Revoke" : "Grant"}
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
```

If `Icon` has no `plus` icon in this repo, use an existing icon from `iconPaths` and do not add icon infrastructure in this task.

- [ ] **Step 3: Render the surface**

In `src/renderer/src/screens/SpsAgent/App.tsx`, import:

```ts
import { CapabilitiesSurface } from "./capabilities/CapabilitiesSurface";
```

Add:

```tsx
{surface === "capabilities" && <CapabilitiesSurface />}
```

- [ ] **Step 4: Add sidebar item**

In `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx`, add under **My Assistant**:

```tsx
<button
  type="button"
  className={`nav-item ${surface === "capabilities" ? "active" : ""}`}
  onClick={() => setSurface("capabilities")}
  title="Grant, limit, or revoke what My Assistant can use"
  style={{ paddingLeft: 24 }}
>
  <Icon name="checkbox" size={17} />
  <span className="nav-label">Capabilities</span>
</button>
```

- [ ] **Step 5: Update sidebar test**

In `src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx`, assert:

```ts
expect(screen.getByText("Capabilities")).toBeInTheDocument();
```

- [ ] **Step 6: Validate shell**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 7: Capabilities Surface Tests

**Files:**
- Create: `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.test.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.tsx`

- [ ] **Step 1: Add renderer tests**

Create `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilitiesSurface } from "./CapabilitiesSurface";
import type { McpCapability } from "../../../../../shared/mcp-capabilities";

const capabilities: McpCapability[] = [
  {
    name: "openalex",
    displayName: "Research Papers",
    description: "Search scholarly works.",
    installed: true,
    enabled: true,
    type: "stdio",
    detail: "node",
    trust: "sps_curated",
    envKeys: [],
    risks: ["read_only", "shares_outside_sps"],
    canInstall: true,
    installAction: "openalex",
    policy: { include: ["search_works"] },
    tools: [
      {
        name: "search_works",
        label: "Search works",
        description: "Search papers.",
        defaultEnabled: true,
        risks: ["read_only"],
      },
      {
        name: "get_work",
        label: "Get work",
        description: "Fetch one paper.",
        defaultEnabled: true,
        risks: ["read_only"],
      },
    ],
  },
  {
    name: "unknown",
    displayName: "unknown",
    description: "Configured outside SPS.",
    installed: true,
    enabled: false,
    type: "http",
    detail: "https://example.test",
    trust: "unreviewed",
    envKeys: [],
    risks: ["advanced"],
    canInstall: false,
    policy: {},
    tools: [],
  },
];

beforeEach(() => {
  window.hermesAPI = {
    ...window.hermesAPI,
    listMcpCapabilities: vi.fn().mockResolvedValue(capabilities),
    setMcpServerEnabled: vi.fn().mockResolvedValue(true),
    setMcpToolPolicy: vi.fn().mockResolvedValue(true),
    spsResearchEnsureAgentTool: vi.fn().mockResolvedValue({ registered: true }),
    externalContextEnsureMcp: vi.fn().mockResolvedValue({ registered: true }),
  } as typeof window.hermesAPI;
});

describe("CapabilitiesSurface", () => {
  it("renders curated and unreviewed capability cards with risk labels", async () => {
    render(<CapabilitiesSurface />);

    expect(await screen.findByText("Research Papers")).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.getByText("Shares outside SPS")).toBeInTheDocument();
    expect(screen.getByText("Unreviewed")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
  });

  it("revokes an enabled capability", async () => {
    render(<CapabilitiesSurface />);

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(window.hermesAPI.setMcpServerEnabled).toHaveBeenCalledWith(
        "openalex",
        false,
      );
    });
  });

  it("writes a narrowed tool allowlist", async () => {
    render(<CapabilitiesSurface />);

    const getWork = await screen.findByLabelText(/Get work/);
    fireEvent.click(getWork);

    await waitFor(() => {
      expect(window.hermesAPI.setMcpToolPolicy).toHaveBeenCalledWith({
        name: "openalex",
        include: ["search_works", "get_work"],
      });
    });
  });
});
```

If `window.hermesAPI` is readonly in the test setup, use the existing project mocking pattern from nearby SPS surface tests instead of direct assignment.

- [ ] **Step 2: Run tests**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.test.tsx
```

Expected: PASS. If the third test receives `prompts: undefined` or `resources: undefined`, update `toggleTool` to omit undefined fields before calling `setMcpToolPolicy`.

## Task 8: Install Buttons For Curated App-Owned MCPs

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.test.tsx`
- Verify existing preload methods:
  - `spsResearchEnsureAgentTool`
  - `externalContextEnsureMcp`

- [ ] **Step 1: Add install test**

Append to `CapabilitiesSurface.test.tsx`:

```tsx
it("installs a curated capability through its existing ensure action", async () => {
  window.hermesAPI.listMcpCapabilities = vi.fn().mockResolvedValue([
    {
      ...capabilities[0],
      installed: false,
      enabled: false,
    },
  ]);

  render(<CapabilitiesSurface />);
  fireEvent.click(await screen.findByRole("button", { name: /Add capability/ }));

  await waitFor(() => {
    expect(window.hermesAPI.spsResearchEnsureAgentTool).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify component already satisfies test**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.test.tsx
```

Expected: PASS because Task 6 already added `installCurated`.

- [ ] **Step 3: If missing preload type names differ, align component**

Search:

```bash
rg -n "spsResearchEnsureAgentTool|externalContextEnsureMcp" src/preload src/renderer/src
```

If the existing method names differ, update `CapabilitiesSurface.tsx` to use the actual preload names and rerun the renderer test.

## Task 9: Utility Wrapper Controls

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.test.tsx`

- [ ] **Step 1: Add test for prompt/resource toggles**

Append:

```tsx
it("can disable MCP prompt and resource utility wrappers", async () => {
  render(<CapabilitiesSurface />);

  fireEvent.click(await screen.findByLabelText("Allow prompt utilities"));
  fireEvent.click(screen.getByLabelText("Allow resource utilities"));

  await waitFor(() => {
    expect(window.hermesAPI.setMcpToolPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "openalex",
        prompts: false,
      }),
    );
    expect(window.hermesAPI.setMcpToolPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "openalex",
        resources: false,
      }),
    );
  });
});
```

- [ ] **Step 2: Add controls**

Inside installed capability card, under tool rows, add:

```tsx
<div className="capability-tools capability-utilities">
  <label className="capability-tool-row">
    <input
      type="checkbox"
      aria-label="Allow prompt utilities"
      checked={cap.policy.prompts !== false}
      disabled={busy === cap.name || !cap.enabled}
      onChange={() =>
        void updatePolicy(cap, { prompts: cap.policy.prompts === false })
      }
    />
    <span>
      <strong>Prompt utilities</strong>
      <small>Let My Assistant list or load prompts exposed by this capability.</small>
    </span>
  </label>
  <label className="capability-tool-row">
    <input
      type="checkbox"
      aria-label="Allow resource utilities"
      checked={cap.policy.resources !== false}
      disabled={busy === cap.name || !cap.enabled}
      onChange={() =>
        void updatePolicy(cap, { resources: cap.policy.resources === false })
      }
    />
    <span>
      <strong>Resource utilities</strong>
      <small>Let My Assistant list or read resources exposed by this capability.</small>
    </span>
  </label>
</div>
```

Add helper before `toggleTool`:

```tsx
async function updatePolicy(
  cap: McpCapability,
  patch: { include?: string[]; prompts?: boolean; resources?: boolean },
): Promise<void> {
  setBusy(cap.name);
  try {
    await window.hermesAPI.setMcpToolPolicy({
      name: cap.name,
      include: patch.include ?? cap.policy.include,
      prompts: patch.prompts ?? cap.policy.prompts,
      resources: patch.resources ?? cap.policy.resources,
    });
    await refresh();
  } finally {
    setBusy(null);
  }
}
```

Then simplify `toggleTool` to call:

```tsx
await updatePolicy(cap, { include: next });
```

- [ ] **Step 3: Run renderer tests**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.test.tsx
```

Expected: PASS.

## Task 10: Settings Summary Link

**Files:**
- Modify: `src/renderer/src/screens/Settings/CapabilitySummary.tsx`

- [ ] **Step 1: Update copy**

Change the hint at lines currently saying “Disable anything you don’t recognize…” to:

```tsx
Everything My Assistant can currently access and use. Manage scoped grants and MCP tool access from the SPS Capabilities surface.
```

- [ ] **Step 2: Use richer capability API when available**

Replace `const loadMcp = window.hermesAPI.listMcpServers(profile);` with:

```ts
const loadMcp = window.hermesAPI.listMcpCapabilities
  ? window.hermesAPI.listMcpCapabilities(profile)
  : window.hermesAPI.listMcpServers(profile);
```

Update the local `McpServer` interface to tolerate both shapes:

```ts
interface McpServer {
  name: string;
  type: string;
  enabled: boolean;
  displayName?: string;
  risks?: string[];
}
```

Render active MCP names with display name if present:

```tsx
{activeMcp.map((m) => `${m.displayName || m.name} (${m.type})`).join(", ")}
```

- [ ] **Step 3: Validate**

Run:

```bash
npm run typecheck
npx eslint --quiet src/renderer/src/screens/Settings/CapabilitySummary.tsx
```

Expected: PASS.

## Task 11: Styling

**Files:**
- Modify the smallest existing SPS stylesheet that owns surface/card styles. Inspect before editing.

- [ ] **Step 1: Locate stylesheet**

Run:

```bash
rg -n "ck-card|surface-head|cap-summary|settings-section|nav-item" src/renderer/src/screens/SpsAgent/styles src/renderer/src/assets/main.css
```

Expected: identify the stylesheet already used by SPS surfaces.

- [ ] **Step 2: Add minimal styles**

Add:

```css
.capabilities-surface {
  padding: 24px;
}

.capability-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}

.capability-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-1);
  padding: 12px;
  display: grid;
  gap: 10px;
}

.capability-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.capability-card h2 {
  margin: 0 0 4px;
  font-size: 16px;
}

.capability-card p {
  margin: 0;
  color: var(--tx-3);
  font-size: 13px;
}

.capability-trust,
.capability-risk {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 11px;
  white-space: nowrap;
}

.capability-risk-row,
.capability-meta,
.capability-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.capability-meta {
  color: var(--tx-3);
  font-size: 12px;
}

.capability-tools {
  display: grid;
  gap: 6px;
}

.capability-tool-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
}

.capability-tool-row span {
  display: grid;
  gap: 2px;
}

.capability-tool-row small {
  color: var(--tx-3);
}
```

- [ ] **Step 3: Validate styling did not affect TypeScript**

Run:

```bash
npm run typecheck
```

Expected: PASS.

## Task 12: End-To-End Validation

**Files:** no edits unless validation exposes a real defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/mcp-capabilities.test.ts tests/openalex-mcp-config.test.ts tests/preload-api-surface.test.ts tests/ipc-handlers.test.ts src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.test.tsx src/renderer/src/screens/SpsAgent/sidebar/Sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run changed-file lint**

Run:

```bash
npx eslint --quiet src/shared/mcp-capabilities.ts src/shared/mcp-catalog.ts src/main/mcp-capabilities.ts src/main/installer/mcp.ts src/main/ipc/system.ts src/preload/bridges/toolsmisc.ts src/preload/index.d.ts src/renderer/src/screens/SpsAgent/capabilities/CapabilitiesSurface.tsx src/renderer/src/screens/SpsAgent/App.tsx src/renderer/src/screens/SpsAgent/sidebar/Sidebar.tsx src/renderer/src/screens/Settings/CapabilitySummary.tsx
```

Expected: PASS. If repo-wide `npm run lint` fails on unrelated existing files, report that separately.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Smoke**

Run after build:

```bash
node scripts/sps-smoke.mjs
```

Expected: PASS. Also manually verify that **Capabilities** appears under **My Assistant**, shows curated entries, labels unknown MCPs as unreviewed, and allows revoke/grant on installed entries.

## Acceptance Criteria

- **Capabilities** appears under **My Assistant**.
- The surface explains capabilities as grants My Assistant can use, not MCP config.
- Curated SPS MCPs appear even before install.
- Installed MCPs from `config.yaml` appear with enabled state, transport type, and detail.
- Unknown MCPs appear as **Unreviewed** with **Advanced** risk.
- Risk labels are visible on each card.
- Installed servers can be granted/revoked by writing `enabled: true/false`.
- Curated tools can be narrowed through `tools.include`.
- Prompt/resource wrappers can be disabled through `tools.prompts: false` and `tools.resources: false`.
- Existing `listMcpServers` API remains backward-compatible.
- Existing OpenAlex and External Context registration flows still work.
- No arbitrary community MCP install is introduced in v1.
- No secrets are displayed in the UI; only env key names may be shown.
- No Hermes internal names or storage paths are renamed.

## Follow-On Slice After V1

After the control plane is stable, add a true curated marketplace:

- Read Nous catalog manifests from local `optional-mcps` when available.
- Render manifest source URL, bootstrap commands, credential requirements, and default tool selection before install.
- Add credential prompt flow for API-key entries.
- Add OAuth status handoff for remote entries.
- Add an admin-only “Install from manifest” path for trusted technical users.
- Add audit log entries for grant/revoke/tool-policy changes.

## Self-Review

- Spec coverage: curated marketplace direction is represented through curated cards and a follow-on manifest slice; strict scoping is covered through per-server enable and per-tool allowlists; trust warnings and risk labels are present; credential secrecy is protected by env-key-only display.
- Placeholder scan: every v1 task has concrete files, code snippets, and validation commands. The follow-on slice is explicitly separated from v1 and is not required for acceptance.
- Type consistency: `McpCapability`, `McpCapabilityConfig`, `McpToolPolicy`, and `SetMcpToolPolicyInput` are used consistently across shared, main, preload, and renderer tasks.

