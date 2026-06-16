# Substack Radar Browser Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a user-approved Substack Radar flow that uses browser automation to discover public, human-visible Substack publications by category, then converts approved sources into durable RSS subscriptions.

**Architecture:** Browser automation is used only for discovery and verification of public visible pages. RSS/Atom remains the durable ingestion path for posts. The app stores discovery candidates, confidence signals, and user decisions separately from subscribed feeds so brittle browser data never becomes the source of truth.

**Tech Stack:** Electron main process, React 19 renderer, preload IPC bridge, Vitest, Electron `BrowserWindow`/`webContents` for controlled public-page rendering, existing RSS reader/storage paths, existing Research Reach prompt hints.

---

## Scope And Product Boundary

This plan assumes the Substack RSS flow from `codex/substack-feed-flow` has landed first:

- `src/shared/substack.ts`
- `src/main/rss-discovery.ts`
- `sps-rss-discover-substack`
- RSS Reader modal with Substack find/add/sync

If those files are not present, land that branch before starting this work.

Do not add Twitter, Reddit, Facebook, cookies, account scraping, credential reuse, or background scraping. This feature is public Substack discovery only.

## Acceptance Criteria

- User can enter one or more categories/keywords such as `AI agents`, `markets`, `longevity`.
- Hermes opens a controlled public discovery run against Substack Explore/Search pages.
- Hermes extracts only visible publication/post-card data from rendered pages.
- Hermes shows source URL, title, description, visible signals, and extraction timestamp.
- User explicitly approves candidates before any feed is added.
- Approved candidates are validated through existing `/feed` discovery, then added to RSS feeds.
- Ongoing post ingestion uses RSS, not repeated browser scraping.
- Tests cover extraction, scoring, IPC/preload parity, and renderer approval flow.

## File Structure

- Create `src/shared/substack-radar.ts`
  - Shared types and pure scoring helpers.
- Create `src/shared/substack-radar.test.ts`
  - Tests for category normalization, score calculation, and candidate dedupe.
- Create `src/main/substack-radar-browser.ts`
  - Electron browser automation wrapper that loads public pages and extracts visible cards.
- Create `src/main/substack-radar-browser.test.ts`
  - Pure tests for HTML extraction helpers; no live network.
- Create `src/main/ipc/substack-radar.ts`
  - IPC handlers for discovery runs, candidate list, approve/reject, and add approved feeds.
- Modify `src/main/index.ts`
  - Register the new IPC module.
- Create `src/preload/bridges/substack-radar.ts`
  - Expose the new IPC methods.
- Modify `src/preload/index.d.ts`
  - Add type declarations for the new API surface.
- Create `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx`
  - Category input, discovery run button, candidate review, approve/add actions.
- Create `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx`
  - Renderer tests for run, review, approve, and add flow.
- Modify `src/renderer/src/screens/SpsAgent/research/RssReaderDashboard.tsx`
  - Add a `Discover Substacks` entry point near Add Feed.
- Modify `src/renderer/src/screens/SpsAgent/styles/health-rss.css`
  - Style the Radar panel using existing RSS surface conventions.
- Add `docs/substack-radar.md`
  - User-facing behavior notes and safety boundaries.

## Data Model

Use file-backed JSON first unless the existing RSS DB schema is already being expanded in the active branch. Keep the discovery cache rebuildable and profile-local.

Path:

```txt
<profileHome>/sps-agent/substack-radar/discovery-runs.json
```

Shape:

```ts
export interface SubstackRadarRun {
  id: string;
  query: string;
  categories: string[];
  status: "running" | "complete" | "failed";
  startedAt: number;
  finishedAt?: number;
  sourceUrls: string[];
  candidates: SubstackRadarCandidate[];
  error?: string;
}

export interface SubstackRadarCandidate {
  id: string;
  publicationUrl: string;
  feedUrl?: string;
  title: string;
  description: string;
  author?: string;
  category: string;
  visibleSignals: {
    subscriberText?: string;
    badgeText?: string;
    postCountText?: string;
    recommendationText?: string;
  };
  sourcePageUrl: string;
  discoveredAt: number;
  score: number;
  status: "new" | "approved" | "rejected" | "added";
}
```

## Task 1: Shared Radar Types And Scoring

**Files:**
- Create: `src/shared/substack-radar.ts`
- Create: `src/shared/substack-radar.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/shared/substack-radar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildSubstackRadarCandidateId,
  normalizeSubstackRadarCategories,
  scoreSubstackRadarCandidate,
} from "./substack-radar";

describe("normalizeSubstackRadarCategories", () => {
  it("trims, dedupes, and drops empty categories", () => {
    expect(
      normalizeSubstackRadarCategories([" AI agents ", "", "ai agents", "Markets"]),
    ).toEqual(["AI agents", "Markets"]);
  });
});

describe("buildSubstackRadarCandidateId", () => {
  it("creates a stable id from the publication URL", () => {
    expect(
      buildSubstackRadarCandidateId("https://example.substack.com/?utm_source=x"),
    ).toBe("substack-radar:https://example.substack.com/");
  });
});

describe("scoreSubstackRadarCandidate", () => {
  it("scores visible signals without requiring hidden metrics", () => {
    expect(
      scoreSubstackRadarCandidate({
        title: "Agent Notes",
        description: "Deep writing about AI agents.",
        visibleSignals: {
          subscriberText: "12K subscribers",
          badgeText: "Bestseller",
        },
      }),
    ).toBe(92);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/shared/substack-radar.test.ts
```

Expected: fail because `src/shared/substack-radar.ts` does not exist.

- [ ] **Step 3: Implement shared helpers**

Create `src/shared/substack-radar.ts`:

```ts
export interface SubstackRadarVisibleSignals {
  subscriberText?: string;
  badgeText?: string;
  postCountText?: string;
  recommendationText?: string;
}

export interface SubstackRadarScoreInput {
  title: string;
  description: string;
  visibleSignals: SubstackRadarVisibleSignals;
}

export function normalizeSubstackRadarCategories(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function buildSubstackRadarCandidateId(publicationUrl: string): string {
  const url = new URL(publicationUrl);
  url.search = "";
  url.hash = "";
  return `substack-radar:${url.toString()}`;
}

function parseVisibleCount(text: string | undefined): number {
  if (!text) return 0;
  const match = text.match(/([\d.]+)\s*([kKmM])?/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const suffix = match[2]?.toLowerCase();
  if (suffix === "m") return value * 1_000_000;
  if (suffix === "k") return value * 1_000;
  return value;
}

export function scoreSubstackRadarCandidate(input: SubstackRadarScoreInput): number {
  let score = 50;
  if (input.title.trim()) score += 8;
  if (input.description.trim().length > 40) score += 10;
  const subscribers = parseVisibleCount(input.visibleSignals.subscriberText);
  if (subscribers >= 100_000) score += 24;
  else if (subscribers >= 10_000) score += 18;
  else if (subscribers >= 1_000) score += 10;
  if (/bestseller|recommended|featured/i.test(input.visibleSignals.badgeText || "")) {
    score += 6;
  }
  return Math.max(0, Math.min(100, score));
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
npx vitest run src/shared/substack-radar.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/substack-radar.ts src/shared/substack-radar.test.ts
git commit -m "feat: add Substack radar scoring helpers"
```

## Task 2: Browser Extraction Helper

**Files:**
- Create: `src/main/substack-radar-browser.ts`
- Create: `src/main/substack-radar-browser.test.ts`

- [ ] **Step 1: Write failing extraction tests**

Create `src/main/substack-radar-browser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractSubstackVisibleCards } from "./substack-radar-browser";

const html = `
  <main>
    <a href="https://agentnotes.substack.com">
      <h3>Agent Notes</h3>
      <p>Deep field notes about AI agents and workflows.</p>
      <span>12K subscribers</span>
      <span>Bestseller</span>
    </a>
    <a href="/@writer">
      <h3>Ignored relative profile</h3>
    </a>
  </main>
`;

describe("extractSubstackVisibleCards", () => {
  it("extracts public Substack publication cards from visible HTML", () => {
    expect(extractSubstackVisibleCards(html, "AI agents", "https://substack.com/explore")).toEqual([
      {
        publicationUrl: "https://agentnotes.substack.com/",
        title: "Agent Notes",
        description: "Deep field notes about AI agents and workflows.",
        author: "",
        category: "AI agents",
        visibleSignals: {
          subscriberText: "12K subscribers",
          badgeText: "Bestseller",
        },
        sourcePageUrl: "https://substack.com/explore",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/main/substack-radar-browser.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement pure extraction plus browser runner skeleton**

Create `src/main/substack-radar-browser.ts`:

```ts
import { BrowserWindow } from "electron";
import { buildSubstackRadarCandidateId, scoreSubstackRadarCandidate } from "../shared/substack-radar";

export interface ExtractedSubstackCard {
  publicationUrl: string;
  title: string;
  description: string;
  author: string;
  category: string;
  visibleSignals: {
    subscriberText?: string;
    badgeText?: string;
    postCountText?: string;
    recommendationText?: string;
  };
  sourcePageUrl: string;
}

function normalizePublicationUrl(raw: string): string | null {
  try {
    const url = new URL(raw, "https://substack.com");
    if (!url.hostname.endsWith("substack.com") && !url.hostname.includes(".")) return null;
    if (url.hostname === "substack.com") return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function visibleText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractSubstackVisibleCards(
  html: string,
  category: string,
  sourcePageUrl: string,
): ExtractedSubstackCard[] {
  const cards: ExtractedSubstackCard[] = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html))) {
    const publicationUrl = normalizePublicationUrl(match[1]);
    if (!publicationUrl) continue;
    const body = match[2];
    const title = visibleText(body.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1]?.replace(/<[^>]+>/g, " ") || "");
    const description = visibleText(body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]+>/g, " ") || "");
    if (!title) continue;
    const text = visibleText(body.replace(/<[^>]+>/g, " "));
    const subscriberText = text.match(/\b[\d.]+\s*[kKmM]?\s+subscribers?\b/)?.[0];
    const badgeText = text.match(/\b(Bestseller|Recommended|Featured)\b/i)?.[0];
    cards.push({
      publicationUrl,
      title,
      description,
      author: "",
      category,
      visibleSignals: { subscriberText, badgeText },
      sourcePageUrl,
    });
  }
  return cards;
}

export async function discoverSubstackCardsWithBrowser(
  category: string,
  sourceUrl: string,
): Promise<Array<ExtractedSubstackCard & { id: string; score: number; discoveredAt: number }>> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await win.loadURL(sourceUrl);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const html = await win.webContents.executeJavaScript("document.body.innerHTML", true);
    return extractSubstackVisibleCards(String(html), category, sourceUrl).map((card) => ({
      ...card,
      id: buildSubstackRadarCandidateId(card.publicationUrl),
      score: scoreSubstackRadarCandidate(card),
      discoveredAt: Date.now(),
    }));
  } finally {
    win.destroy();
  }
}
```

- [ ] **Step 4: Run the extraction test**

Run:

```bash
npx vitest run src/main/substack-radar-browser.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/substack-radar-browser.ts src/main/substack-radar-browser.test.ts
git commit -m "feat: extract visible Substack discovery cards"
```

## Task 3: Main-Process Radar Store And IPC

**Files:**
- Create: `src/main/ipc/substack-radar.ts`
- Modify: `src/main/index.ts`
- Test: `tests/preload-api-surface.test.ts`

- [ ] **Step 1: Add failing IPC contract test**

Add expectations to `tests/preload-api-surface.test.ts`:

```ts
it("has Substack radar APIs", () => {
  for (const method of [
    "spsSubstackRadarRun",
    "spsSubstackRadarListRuns",
    "spsSubstackRadarSetCandidateStatus",
    "spsSubstackRadarAddApprovedFeeds",
  ]) {
    expect(preloadMethods).toContain(method);
    expect(typeMethods).toContain(method);
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run tests/preload-api-surface.test.ts
```

Expected: fail because methods are not exposed yet.

- [ ] **Step 3: Implement IPC**

Create `src/main/ipc/substack-radar.ts`:

```ts
import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { discoverSubstackCardsWithBrowser } from "../substack-radar-browser";
import { discoverSubstackFeed } from "../rss-discovery";
import { profileHome } from "../utils";
import { safeHandle } from "./safe-handle";

interface RadarRunFile {
  runs: Array<Record<string, unknown>>;
}

function storePath(profile = "default"): string {
  return join(profileHome(profile), "sps-agent", "substack-radar", "discovery-runs.json");
}

function readRuns(profile?: string): RadarRunFile {
  const path = storePath(profile);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RadarRunFile;
  } catch {
    return { runs: [] };
  }
}

function writeRuns(profile: string | undefined, file: RadarRunFile): void {
  const path = storePath(profile);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
}

export function registerSubstackRadarIpc(): void {
  safeHandle("sps-substack-radar-run", async (_event, ...args) => {
    const input = args[0] as { categories?: string[]; profile?: string };
    const profile = input.profile || "default";
    const categories = (input.categories || []).map((c) => c.trim()).filter(Boolean);
    const run = {
      id: randomUUID(),
      query: categories.join(", "),
      categories,
      status: "running",
      startedAt: Date.now(),
      sourceUrls: categories.map((c) => `https://substack.com/search/${encodeURIComponent(c)}`),
      candidates: [],
    };
    const file = readRuns(profile);
    file.runs.unshift(run);
    writeRuns(profile, file);

    try {
      const candidates = [];
      for (const category of categories) {
        const sourceUrl = `https://substack.com/search/${encodeURIComponent(category)}`;
        candidates.push(...(await discoverSubstackCardsWithBrowser(category, sourceUrl)));
      }
      run.status = "complete";
      run.finishedAt = Date.now();
      run.candidates = candidates.map((candidate) => ({
        ...candidate,
        status: "new",
      }));
    } catch (err) {
      run.status = "failed";
      run.finishedAt = Date.now();
      run.error = err instanceof Error ? err.message : String(err);
    }

    writeRuns(profile, file);
    return run;
  });

  safeHandle("sps-substack-radar-list-runs", async (_event, ...args) => {
    const profile = String(args[0] || "default");
    return readRuns(profile).runs;
  });

  safeHandle("sps-substack-radar-set-candidate-status", async (_event, ...args) => {
    const input = args[0] as { runId: string; candidateId: string; status: "approved" | "rejected"; profile?: string };
    const file = readRuns(input.profile);
    for (const run of file.runs) {
      if (run.id !== input.runId || !Array.isArray(run.candidates)) continue;
      for (const candidate of run.candidates as Array<Record<string, unknown>>) {
        if (candidate.id === input.candidateId) candidate.status = input.status;
      }
    }
    writeRuns(input.profile, file);
    return { ok: true };
  });

  safeHandle("sps-substack-radar-add-approved-feeds", async (_event, ...args) => {
    const input = args[0] as { runId: string; profile?: string };
    const file = readRuns(input.profile);
    const run = file.runs.find((r) => r.id === input.runId);
    if (!run || !Array.isArray(run.candidates)) return { added: 0 };
    const approved = (run.candidates as Array<Record<string, unknown>>).filter((c) => c.status === "approved");
    const feeds = [];
    for (const candidate of approved) {
      const result = await discoverSubstackFeed(String(candidate.publicationUrl || ""));
      if (result.ok) feeds.push({ candidateId: candidate.id, feed: result });
    }
    return { added: feeds.length, feeds };
  });
}
```

Add to `src/main/index.ts` near other IPC registration:

```ts
import { registerSubstackRadarIpc } from "./ipc/substack-radar";

registerSubstackRadarIpc();
```

- [ ] **Step 4: Run IPC/preload parity test**

Run:

```bash
npx vitest run tests/preload-api-surface.test.ts
```

Expected: still fails until preload methods are added in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/substack-radar.ts src/main/index.ts tests/preload-api-surface.test.ts
git commit -m "feat: add Substack radar IPC"
```

## Task 4: Preload API Surface

**Files:**
- Create: `src/preload/bridges/substack-radar.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add bridge methods**

Create `src/preload/bridges/substack-radar.ts`:

```ts
import { ipcRenderer } from "electron";

type JsonRecord = Record<string, unknown>;

export const substackRadarBridge = {
  spsSubstackRadarRun: (
    input: { categories: string[]; profile?: string },
  ): Promise<JsonRecord> => ipcRenderer.invoke("sps-substack-radar-run", input),
  spsSubstackRadarListRuns: (profile?: string): Promise<JsonRecord[]> =>
    ipcRenderer.invoke("sps-substack-radar-list-runs", profile),
  spsSubstackRadarSetCandidateStatus: (
    input: {
      runId: string;
      candidateId: string;
      status: "approved" | "rejected";
      profile?: string;
    },
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("sps-substack-radar-set-candidate-status", input),
  spsSubstackRadarAddApprovedFeeds: (
    input: { runId: string; profile?: string },
  ): Promise<{ added: number; feeds: JsonRecord[] }> =>
    ipcRenderer.invoke("sps-substack-radar-add-approved-feeds", input),
};
```

Modify `src/preload/index.ts`:

```ts
import { substackRadarBridge } from "./bridges/substack-radar";

const api = {
  ...substackRadarBridge,
};
```

- [ ] **Step 2: Add declarations**

Add to `src/preload/index.d.ts` inside `interface HermesAPI`:

```ts
spsSubstackRadarRun: (input: {
  categories: string[];
  profile?: string;
}) => Promise<Record<string, unknown>>;
spsSubstackRadarListRuns: (
  profile?: string,
) => Promise<Array<Record<string, unknown>>>;
spsSubstackRadarSetCandidateStatus: (input: {
  runId: string;
  candidateId: string;
  status: "approved" | "rejected";
  profile?: string;
}) => Promise<{ ok: boolean }>;
spsSubstackRadarAddApprovedFeeds: (input: {
  runId: string;
  profile?: string;
}) => Promise<{ added: number; feeds: Array<Record<string, unknown>> }>;
```

- [ ] **Step 3: Run parity test**

Run:

```bash
npx vitest run tests/preload-api-surface.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/preload/bridges/substack-radar.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: expose Substack radar preload APIs"
```

## Task 5: Renderer Discovery Panel

**Files:**
- Create: `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx`
- Create: `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/research/RssReaderDashboard.tsx`

- [ ] **Step 1: Write renderer test**

Create `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubstackRadarPanel } from "./SubstackRadarPanel";

const api = {
  spsSubstackRadarRun: vi.fn(),
  spsSubstackRadarSetCandidateStatus: vi.fn(),
  spsSubstackRadarAddApprovedFeeds: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
  api.spsSubstackRadarRun.mockResolvedValue({
    id: "run-1",
    status: "complete",
    candidates: [
      {
        id: "candidate-1",
        title: "Agent Notes",
        description: "Deep field notes about AI agents.",
        publicationUrl: "https://agentnotes.substack.com/",
        category: "AI agents",
        score: 92,
        status: "new",
        visibleSignals: { subscriberText: "12K subscribers" },
      },
    ],
  });
  api.spsSubstackRadarSetCandidateStatus.mockResolvedValue({ ok: true });
  api.spsSubstackRadarAddApprovedFeeds.mockResolvedValue({ added: 1, feeds: [] });
});

describe("SubstackRadarPanel", () => {
  it("runs discovery and approves a candidate", async () => {
    render(<SubstackRadarPanel />);
    fireEvent.change(screen.getByLabelText(/categories/i), {
      target: { value: "AI agents, markets" },
    });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));

    expect(await screen.findByText("Agent Notes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    fireEvent.click(screen.getByRole("button", { name: /add approved feeds/i }));

    await waitFor(() => {
      expect(api.spsSubstackRadarRun).toHaveBeenCalledWith({
        categories: ["AI agents", "markets"],
      });
      expect(api.spsSubstackRadarSetCandidateStatus).toHaveBeenCalledWith({
        runId: "run-1",
        candidateId: "candidate-1",
        status: "approved",
      });
      expect(api.spsSubstackRadarAddApprovedFeeds).toHaveBeenCalledWith({
        runId: "run-1",
      });
    });
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx
```

Expected: fail because component does not exist.

- [ ] **Step 3: Implement panel**

Create `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx`:

```tsx
import React, { useState } from "react";

interface Candidate {
  id: string;
  title: string;
  description: string;
  publicationUrl: string;
  category: string;
  score: number;
  status: "new" | "approved" | "rejected" | "added";
  visibleSignals?: { subscriberText?: string; badgeText?: string };
}

interface RunResult {
  id: string;
  status: string;
  candidates: Candidate[];
}

function parseCategories(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SubstackRadarPanel(): React.JSX.Element {
  const [categories, setCategories] = useState("");
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function discover(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const result = (await window.hermesAPI.spsSubstackRadarRun({
        categories: parseCategories(categories),
      })) as unknown as RunResult;
      setRun(result);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(candidateId: string, status: "approved" | "rejected"): Promise<void> {
    if (!run) return;
    await window.hermesAPI.spsSubstackRadarSetCandidateStatus({
      runId: run.id,
      candidateId,
      status,
    });
    setRun({
      ...run,
      candidates: run.candidates.map((candidate) =>
        candidate.id === candidateId ? { ...candidate, status } : candidate,
      ),
    });
  }

  async function addApproved(): Promise<void> {
    if (!run) return;
    const result = await window.hermesAPI.spsSubstackRadarAddApprovedFeeds({
      runId: run.id,
    });
    setMessage(`Added ${result.added} feeds.`);
  }

  return (
    <section className="substack-radar-panel">
      <div className="log-input-group">
        <label htmlFor="substack-radar-categories">Categories</label>
        <input
          id="substack-radar-categories"
          value={categories}
          onChange={(event) => setCategories(event.target.value)}
          placeholder="AI agents, markets, longevity"
        />
      </div>
      <button className="log-submit-btn save-journal-entry-btn" disabled={busy} onClick={discover}>
        {busy ? "Discovering..." : "Discover"}
      </button>
      {run?.candidates.map((candidate) => (
        <article className="substack-radar-candidate" key={candidate.id}>
          <div className="substack-radar-candidate-score">{candidate.score}</div>
          <div>
            <h4>{candidate.title}</h4>
            <p>{candidate.description}</p>
            <div>{candidate.publicationUrl}</div>
            {candidate.visibleSignals?.subscriberText && (
              <div>{candidate.visibleSignals.subscriberText}</div>
            )}
          </div>
          <button onClick={() => setStatus(candidate.id, "approved")}>Approve</button>
          <button onClick={() => setStatus(candidate.id, "rejected")}>Reject</button>
        </article>
      ))}
      {run && (
        <button className="log-submit-btn save-journal-entry-btn" onClick={addApproved}>
          Add Approved Feeds
        </button>
      )}
      {message && <div className="substack-radar-message">{message}</div>}
    </section>
  );
}
```

- [ ] **Step 4: Add entry point to RSS reader**

Modify `src/renderer/src/screens/SpsAgent/research/RssReaderDashboard.tsx`:

```tsx
import { SubstackRadarPanel } from "./SubstackRadarPanel";

const [showRadarPanel, setShowRadarPanel] = useState(false);

<button
  className="log-submit-btn refresh-btn-style"
  onClick={() => setShowRadarPanel((value) => !value)}
>
  Discover Substacks
</button>

{showRadarPanel && <SubstackRadarPanel />}
```

- [ ] **Step 5: Run renderer test**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx src/renderer/src/screens/SpsAgent/research/RssReaderDashboard.tsx
git commit -m "feat: add Substack radar review panel"
```

## Task 6: Add Approved Feeds Through Existing RSS Flow

**Files:**
- Modify: `src/main/ipc/substack-radar.ts`
- Modify: `src/main/ipc/health-rss.ts` if needed to expose an internal `addRssFeed` helper
- Test: `src/main/substack-radar-ipc.test.ts`

- [ ] **Step 1: Extract internal add-feed helper**

In `src/main/ipc/health-rss.ts`, extract the body of `sps-rss-add-feed` into:

```ts
export function addRssFeedRecord(feedData: Record<string, unknown>): string {
  const db = getSharedDb(false);
  if (!db) throw new Error("Database not available");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO rss_feeds (id, url, title, site_url, description, category, last_fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    feedData.url,
    feedData.title || "Untitled Feed",
    feedData.site_url || "",
    feedData.description || "",
    feedData.category || "Uncategorized",
    Date.now(),
  );
  return id;
}
```

Then make the IPC handler call:

```ts
return addRssFeedRecord(feedData || {});
```

- [ ] **Step 2: Use helper in Radar IPC**

In `src/main/ipc/substack-radar.ts`, after `discoverSubstackFeed` succeeds:

```ts
const feedId = addRssFeedRecord({
  url: result.feedUrl,
  site_url: result.siteUrl,
  title: result.title,
  description: result.description,
  category: "Substack",
});
candidate.status = "added";
candidate.feedId = feedId;
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run src/main/rss-discovery.test.ts tests/preload-api-surface.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/health-rss.ts src/main/ipc/substack-radar.ts
git commit -m "feat: add approved Substack radar feeds"
```

## Task 7: Styling And Empty/Error States

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/styles/health-rss.css`
- Modify: `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx`

- [ ] **Step 1: Add states to component**

Add these states:

```tsx
const [error, setError] = useState("");

if (!parseCategories(categories).length) {
  setError("Add at least one category.");
  return;
}
```

Render:

```tsx
{error && <div className="substack-radar-error">{error}</div>}
{run?.candidates.length === 0 && (
  <div className="rss-empty-text">No visible Substack candidates found for this run.</div>
)}
```

- [ ] **Step 2: Add CSS**

Add to `src/renderer/src/screens/SpsAgent/styles/health-rss.css`:

```css
.sps-scope .substack-radar-panel {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 16px;
}

.sps-scope .substack-radar-candidate {
  display: grid;
  grid-template-columns: 44px 1fr auto auto;
  gap: 12px;
  align-items: start;
  padding: 12px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sps-scope .substack-radar-candidate-score {
  border-radius: 6px;
  padding: 6px;
  background: rgba(96, 165, 250, 0.14);
  color: #dbeafe;
  text-align: center;
  font-weight: 700;
}

.sps-scope .substack-radar-error {
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(127, 29, 29, 0.18);
  color: #fecaca;
  font-size: 12px;
}

.sps-scope .substack-radar-message {
  color: #bbf7d0;
  font-size: 12px;
}
```

- [ ] **Step 3: Run renderer test and typecheck**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/screens/SpsAgent/styles/health-rss.css src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx
git commit -m "feat: polish Substack radar states"
```

## Task 8: Documentation And Safety Notes

**Files:**
- Create: `docs/substack-radar.md`

- [ ] **Step 1: Add docs**

Create `docs/substack-radar.md`:

```md
# Substack Radar

Substack Radar discovers public Substack publications from user-supplied categories, shows candidates for review, and converts approved publications into RSS feed subscriptions.

## Boundaries

- Uses browser automation only for public, visible discovery pages.
- Does not read browser cookies or reuse Substack login sessions.
- Does not import private, subscriber-only, or paywalled content.
- Does not promise exact follower ranking unless that information is visibly present on the page.
- Uses RSS/Atom for ongoing article sync after a source is approved.

## Recommended Workflow

1. Enter categories such as `AI agents`, `markets`, or `longevity`.
2. Review discovered publications and visible signals.
3. Approve sources worth tracking.
4. Add approved feeds.
5. Read ongoing posts in the RSS Reader.
```

- [ ] **Step 2: Commit**

```bash
git add docs/substack-radar.md
git commit -m "docs: document Substack radar boundaries"
```

## Task 9: Verification Gate

**Files:**
- No edits unless verification fails.

- [ ] **Step 1: Run focused unit tests**

```bash
npx vitest run \
  src/shared/substack-radar.test.ts \
  src/main/substack-radar-browser.test.ts \
  src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx \
  tests/preload-api-surface.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Run touched-file lint**

```bash
npx eslint \
  src/shared/substack-radar.ts \
  src/shared/substack-radar.test.ts \
  src/main/substack-radar-browser.ts \
  src/main/substack-radar-browser.test.ts \
  src/main/ipc/substack-radar.ts \
  src/preload/bridges/substack-radar.ts \
  src/preload/index.d.ts \
  src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx \
  src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx
```

Expected: no errors or warnings in touched files.

- [ ] **Step 4: Run production build**

```bash
npm run build
```

Expected: pass. If OCR asset download fails from sandbox DNS, rerun with network approval.

- [ ] **Step 5: Optional live smoke**

Run the app and test one category:

```bash
npm run dev
```

Manual check:

- Open SPS RSS Reader.
- Click `Discover Substacks`.
- Enter `AI agents`.
- Run discovery.
- Confirm visible candidates appear.
- Approve one candidate.
- Add approved feeds.
- Confirm the feed appears in RSS folders and syncs through RSS.

## Risk Controls

- Rate-limit discovery to one browser run at a time.
- Do not persist rendered page HTML by default.
- Persist source URLs and extracted visible text only.
- Show the source page URL for every candidate.
- Require user approval before adding feeds.
- Keep browser discovery out of background sync.
- Treat missing subscriber/follower counts as unknown, not zero.
- Use score labels like `strong match`, not `top followed`, unless visible follower data exists.

## Final Self-Review Checklist

- All user-visible copy says `Substack Radar` or `Discover Substacks`, not scraping.
- No login/cookie/session code is introduced.
- Browser extraction does not run on an interval.
- Approved sources become RSS feeds.
- Tests cover extraction, scoring, preload parity, and UI approval.
- Production build passes.
