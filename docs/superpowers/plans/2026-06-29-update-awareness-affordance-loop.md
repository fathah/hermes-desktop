# Update Awareness and Feature Affordances Implementation Plan

> **Status: IMPLEMENTED (verified 2026-07-03).** All artifacts this plan describes exist on `main` — `src/shared/update-affordances.ts`, `src/main/desktop-update-routine.ts`, `src/renderer/src/screens/SpsAgent/updates/` (WhatsNewPanel + useWhatsNew + tests), the IPC/preload/Settings wiring, and the release-notes modal in `Layout.tsx` (commits `7908f729`, `23adda4b`, `a9484b20`). The checkboxes below were never ticked; treat this as a historical design doc, not open work. The engine-side successor is `2026-07-03-upstream-capture-and-exposure.md`. See `docs/IMPROVEMENT-REPORT-2026-07-03.md` §5.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a nightly, app-owned update-awareness loop that checks Desktop and Hermes Agent updates, records what changed, and exposes newly available SPS capabilities as visible, dismissible affordances.

**Architecture:** Keep Desktop binary updates, Hermes Agent engine updates, and feature discovery as separate concerns. Reuse the existing main-process scheduler for nightly checks while the app is open, and add a static release-affordance registry compiled into each Desktop release so the UI can route users to real capabilities after an update.

**Tech Stack:** Electron main IPC, `electron-updater`, React 19, Zustand, localStorage, desktop config JSON, Vitest.

---

## Current Repo Facts

- Desktop updates already use `electron-updater` with GitHub release metadata in `src/main/index.ts`, `src/main/ipc/system.ts`, `src/preload/bridges/system.ts`, and `electron-builder.yml`.
- Hermes Agent engine updates already have a daily 4:00 AM local routine through `src/main/hermes-agent-updates.ts`, `src/main/config/desktop-store.ts`, and `src/main/scheduler.ts`.
- SPS affordances are static code surfaces: `Surface`, `SpsAgent/App.tsx`, `Sidebar.tsx`, `CommandPalette.tsx`, `GetStarted.tsx`, and Settings/Providers panels.
- There is no semantic feature registry today. Release notes may be displayed by GitHub/electron-updater, but the app does not map release contents to clickable in-app affordances.

## File Structure

- Create `src/shared/update-affordances.ts`: app-version comparison, typed feature-affordance registry, and pure filtering helpers.
- Create `src/renderer/src/screens/SpsAgent/updates/WhatsNewPanel.tsx`: dismissible "What's new" UI and CTA routing.
- Create `src/renderer/src/screens/SpsAgent/updates/useWhatsNew.ts`: renderer hook for current/last-seen version, filtering, dismissal, and localStorage persistence.
- Modify `src/renderer/src/screens/SpsAgent/App.tsx`: render the "What's new" panel near the existing onboarding area.
- Modify `src/renderer/src/screens/SpsAgent/components/CommandPalette.tsx`: add "What's new" as a searchable action when unseen update affordances exist.
- Create `src/main/desktop-update-routine.ts`: nightly Desktop app update check state, due calculation, and check runner.
- Modify `src/main/scheduler.ts`: call `maybeRunDesktopUpdateRoutine()` on scheduler ticks.
- Modify `src/main/ipc/system.ts`, `src/preload/bridges/system.ts`, `src/preload/bridges/system.types.ts`, and `src/preload/index.d.ts`: expose Desktop update routine state, settings, and manual run.
- Modify `src/renderer/src/screens/Settings/Settings.tsx`: show Desktop app update status, nightly schedule, last result, and "Run now".
- Modify `src/renderer/src/screens/Layout/Layout.tsx`: preserve release notes from `update-available` and show a release-notes modal before download.
- Modify i18n files under `src/shared/i18n/locales/en/`: add labels for Desktop update routine and "What's new".
- Add/extend tests listed in each task.

## Task 1: Shared Release-Affordance Registry

**Files:**
- Create: `src/shared/update-affordances.ts`
- Test: `tests/update-affordances.test.ts`

- [ ] **Step 1: Write failing tests for semver comparison and unseen affordances**

```ts
import { describe, expect, it } from "vitest";
import {
  compareAppVersions,
  releaseAffordancesSince,
  type ReleaseAffordance,
} from "../src/shared/update-affordances";

const fixtures: ReleaseAffordance[] = [
  {
    id: "capture-pdf",
    introducedIn: "0.5.5",
    title: "Capture PDFs",
    body: "Import PDFs into Capture and review the extracted content.",
    cta: "Open Capture",
    action: { kind: "surface", surface: "inbox" },
  },
  {
    id: "deck-studio",
    introducedIn: "0.5.6",
    title: "Deck Studio",
    body: "Draft and export slide decks from workspace material.",
    cta: "Open Deck Studio",
    action: { kind: "surface", surface: "deckStudio" },
  },
];

describe("update affordances", () => {
  it("compares dotted app versions numerically", () => {
    expect(compareAppVersions("0.5.10", "0.5.6")).toBeGreaterThan(0);
    expect(compareAppVersions("0.5.6", "0.5.6")).toBe(0);
    expect(compareAppVersions("0.5.5", "0.5.6")).toBeLessThan(0);
  });

  it("returns only features introduced after the last seen version", () => {
    expect(releaseAffordancesSince("0.5.4", "0.5.6", fixtures).map((a) => a.id))
      .toEqual(["capture-pdf", "deck-studio"]);
    expect(releaseAffordancesSince("0.5.5", "0.5.6", fixtures).map((a) => a.id))
      .toEqual(["deck-studio"]);
    expect(releaseAffordancesSince("0.5.6", "0.5.6", fixtures)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run tests/update-affordances.test.ts`

Expected: FAIL because `src/shared/update-affordances.ts` does not exist.

- [ ] **Step 3: Implement the shared registry and helpers**

```ts
// Keep this file renderer-free. The renderer owns the final routing cast to its
// local `Surface` union.
export type ReleaseSurfaceTarget =
  | "doc"
  | "dashboard"
  | "chats"
  | "ask"
  | "work"
  | "journal"
  | "personal-health"
  | "rss-reader"
  | "contentStudio"
  | "deckStudio"
  | "cockpit"
  | "insights"
  | "memory"
  | "you"
  | "learning"
  | "activeWork"
  | "inbox"
  | "review"
  | "health"
  | "graph"
  | "equity"
  | "obsidian-note";

export type ReleasePlatform = "darwin" | "linux" | "win32";

export type ReleaseAffordanceAction =
  | { kind: "surface"; surface: ReleaseSurfaceTarget }
  | { kind: "settings"; view: "providers" | "settings" | "gateway" | "connectedApps" }
  | { kind: "modal"; modal: "research" | "scheduled" | "templates" | "palette" };

export interface ReleaseAffordance {
  id: string;
  introducedIn: string;
  title: string;
  body: string;
  cta: string;
  action: ReleaseAffordanceAction;
  platforms?: ReleasePlatform[];
  requiresApi?: string;
}

export const RELEASE_AFFORDANCES: ReleaseAffordance[] = [
  {
    id: "capture-pdf",
    introducedIn: "0.5.5",
    title: "PDFs in Capture",
    body: "Import PDFs into Capture and route extracted notes through review.",
    cta: "Open Capture",
    action: { kind: "surface", surface: "inbox" },
  },
  {
    id: "work-review",
    introducedIn: "0.5.5",
    title: "Work review queue",
    body: "Review tasks, delegated goals, scheduled rules, and pending changes from one surface.",
    cta: "Open Work",
    action: { kind: "surface", surface: "work" },
  },
  {
    id: "desktop-updates",
    introducedIn: "0.5.5",
    title: "Nightly update checks",
    body: "Hermes can check for Desktop and Agent updates every night while the app is open.",
    cta: "Open Settings",
    action: { kind: "settings", view: "settings" },
  },
];

function versionParts(version: string): number[] {
  return version.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

export function compareAppVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function releaseAffordancesSince(
  lastSeenVersion: string | null,
  currentVersion: string,
  affordances = RELEASE_AFFORDANCES,
): ReleaseAffordance[] {
  if (!lastSeenVersion) return [];
  return affordances.filter(
    (item) =>
      compareAppVersions(item.introducedIn, lastSeenVersion) > 0 &&
      compareAppVersions(item.introducedIn, currentVersion) <= 0,
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/update-affordances.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/update-affordances.ts tests/update-affordances.test.ts
git commit -m "feat: add update affordance registry"
```

## Task 2: Renderer "What's New" State and Panel

**Files:**
- Create: `src/renderer/src/screens/SpsAgent/updates/useWhatsNew.ts`
- Create: `src/renderer/src/screens/SpsAgent/updates/WhatsNewPanel.tsx`
- Test: `src/renderer/src/screens/SpsAgent/updates/WhatsNewPanel.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNewPanel } from "./WhatsNewPanel";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("hermes-desktop-last-seen-version", "0.5.4");
  vi.stubGlobal("electron", { process: { platform: "darwin" } });
  vi.stubGlobal("hermesAPI", {
    getAppVersion: vi.fn().mockResolvedValue("0.5.5"),
  });
});

describe("WhatsNewPanel", () => {
  it("shows unseen affordances after an app version change", async () => {
    render(<WhatsNewPanel onRunAction={vi.fn()} />);

    expect(await screen.findByText("PDFs in Capture")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Capture" })).toBeInTheDocument();
  });

  it("persists dismissal at the current version", async () => {
    render(<WhatsNewPanel onRunAction={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss what's new" }));

    await waitFor(() =>
      expect(localStorage.getItem("hermes-desktop-last-seen-version")).toBe("0.5.5"),
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run src/renderer/src/screens/SpsAgent/updates/WhatsNewPanel.test.tsx`

Expected: FAIL because the files do not exist.

- [ ] **Step 3: Implement the hook**

```ts
import { useEffect, useMemo, useState } from "react";
import {
  RELEASE_AFFORDANCES,
  releaseAffordancesSince,
  type ReleaseAffordance,
  type ReleasePlatform,
} from "../../../../../shared/update-affordances";

const LAST_SEEN_KEY = "hermes-desktop-last-seen-version";

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* non-fatal UI memory */
  }
}

export function useWhatsNew(): {
  currentVersion: string | null;
  items: ReleaseAffordance[];
  dismiss: () => void;
} {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(() => readLastSeen());

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .getAppVersion()
      .then((version) => {
        if (cancelled) return;
        setCurrentVersion(version);
        if (!readLastSeen()) {
          writeLastSeen(version);
          setLastSeen(version);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => {
    if (!currentVersion) return [];
    const platform = window.electron?.process?.platform as
      | ReleasePlatform
      | undefined;
    return releaseAffordancesSince(lastSeen, currentVersion, RELEASE_AFFORDANCES).filter(
      (item) => {
        if (item.platforms && platform && !item.platforms.includes(platform)) return false;
        if (item.requiresApi && !(item.requiresApi in window.hermesAPI)) return false;
        return true;
      },
    );
  }, [currentVersion, lastSeen]);

  return {
    currentVersion,
    items,
    dismiss: () => {
      if (!currentVersion) return;
      writeLastSeen(currentVersion);
      setLastSeen(currentVersion);
    },
  };
}
```

- [ ] **Step 4: Implement the panel**

```tsx
import { Icon } from "../components/Icon";
import type {
  ReleaseAffordance,
  ReleaseAffordanceAction,
} from "../../../../../shared/update-affordances";
import { useWhatsNew } from "./useWhatsNew";

interface Props {
  onRunAction: (action: ReleaseAffordanceAction) => void;
}

export function WhatsNewPanel({ onRunAction }: Props): React.JSX.Element | null {
  const { currentVersion, items, dismiss } = useWhatsNew();
  if (!currentVersion || items.length === 0) return null;

  return (
    <section className="ob-checklist whats-new-panel" aria-label="What's new">
      <div className="ob-checklist-head">
        <span className="ob-checklist-title">What's new in v{currentVersion}</span>
        <button
          type="button"
          className="ob-checklist-dismiss"
          onClick={dismiss}
          aria-label="Dismiss what's new"
          title="Dismiss what's new"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="ob-checklist-steps">
        {items.map((item: ReleaseAffordance) => (
          <article key={item.id} className="ob-step-card">
            <div className="ob-step-body">
              <div className="ob-step-title">{item.title}</div>
              <div className="ob-step-desc">{item.body}</div>
            </div>
            <button
              type="button"
              className="ob-step-action"
              onClick={() => onRunAction(item.action)}
            >
              {item.cta}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/renderer/src/screens/SpsAgent/updates/WhatsNewPanel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/SpsAgent/updates src/shared/update-affordances.ts
git commit -m "feat: show whats new affordances"
```

## Task 3: Route New Feature CTAs Through SPS Surfaces

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/App.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/components/CommandPalette.tsx`
- Test: `src/renderer/src/screens/SpsAgent/components/CommandPalette.test.tsx`

- [ ] **Step 1: Add a CTA router in `SpsAgent/App.tsx`**

Add imports:

```ts
import { WhatsNewPanel } from "./updates/WhatsNewPanel";
import type { ReleaseAffordanceAction } from "../../../../shared/update-affordances";
import type { Surface } from "./store/storeTypes";
import { openSettings } from "../../../lib/openSettings";
```

Inside `SpsAgentApp`, read existing setters:

```ts
const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
const setResearchOpen = useStore((s) => s.setResearchOpen);
const setScheduledOpen = useStore((s) => s.setScheduledOpen);
const setPaletteOpen = useStore((s) => s.setPaletteOpen);
```

Add the router:

```ts
function runReleaseAffordance(action: ReleaseAffordanceAction): void {
  if (action.kind === "surface") {
    setSurface(action.surface as Surface);
    return;
  }
  if (action.kind === "settings") {
    openSettings(action.view);
    return;
  }
  if (action.modal === "research") setResearchOpen(true);
  else if (action.modal === "scheduled") setScheduledOpen(true);
  else if (action.modal === "templates") setTemplatesOpen({ parent: null });
  else setPaletteOpen(true);
}
```

Render after `OnboardingChecklist`:

```tsx
<OnboardingChecklist />
<WhatsNewPanel onRunAction={runReleaseAffordance} />
```

- [ ] **Step 2: Add a command palette action**

In `CommandPalette.tsx`, import `useWhatsNew`:

```ts
import { useWhatsNew } from "../updates/useWhatsNew";
```

Inside `CommandPalette`, call the hook:

```ts
const whatsNew = useWhatsNew();
```

Add this action near the top of `actions` when `whatsNew.items.length > 0`:

```ts
...(whatsNew.items.length > 0
  ? [
      {
        kind: "action" as const,
        id: "whats-new",
        icon: "sparkle" as const,
        label: "What's new",
        desc: `Review ${whatsNew.items.length} new capability${whatsNew.items.length === 1 ? "" : "ies"} in this update.`,
        run: () => setSurface("doc"),
      },
    ]
  : []),
```

- [ ] **Step 3: Extend command palette tests**

Add a test that stubs `getAppVersion`, seeds `localStorage` with `0.5.4`, opens the palette, and expects `What's new` to be searchable.

Run: `npx vitest run src/renderer/src/screens/SpsAgent/components/CommandPalette.test.tsx`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/screens/SpsAgent/App.tsx src/renderer/src/screens/SpsAgent/components/CommandPalette.tsx src/renderer/src/screens/SpsAgent/components/CommandPalette.test.tsx
git commit -m "feat: route update affordances in SPS"
```

## Task 4: Desktop App Nightly Update Routine

**Files:**
- Create: `src/main/desktop-update-routine.ts`
- Modify: `src/main/config/desktop-store.ts`
- Modify: `src/main/scheduler.ts`
- Test: `tests/desktop-update-routine.test.ts`
- Test: `tests/scheduler.test.ts`

- [ ] **Step 1: Write failing routine tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  isDesktopUpdateRoutineDue,
  runDesktopUpdateRoutine,
} from "../src/main/desktop-update-routine";

describe("Desktop update routine", () => {
  it("runs once per local day after 4:15 AM", () => {
    expect(
      isDesktopUpdateRoutineDue(
        { enabled: true, lastCheckedAt: null },
        new Date("2026-06-20T04:10:00"),
      ),
    ).toBe(false);
    expect(
      isDesktopUpdateRoutineDue(
        { enabled: true, lastCheckedAt: null },
        new Date("2026-06-20T04:16:00"),
      ),
    ).toBe(true);
  });

  it("records update availability without downloading", async () => {
    const checkForUpdates = vi.fn().mockResolvedValue({
      updateInfo: { version: "0.5.6", releaseNotes: "New Capture affordance" },
    });
    const result = await runDesktopUpdateRoutine({
      now: new Date("2026-06-20T04:16:00"),
      isPackaged: true,
      isPortable: false,
      platform: "darwin",
      checkForUpdates,
    });

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("available");
    expect(result.availableVersion).toBe("0.5.6");
  });
});
```

- [ ] **Step 2: Implement the routine**

Create types mirroring Hermes Agent update state, but for the Desktop app:

```ts
export type DesktopUpdateRoutineStatus =
  | "current"
  | "available"
  | "skipped"
  | "error";

export interface DesktopUpdateRoutineResult {
  checkedAt: string;
  status: DesktopUpdateRoutineStatus;
  message: string;
  availableVersion?: string;
  releaseNotes?: string | null;
  reason?: "not-packaged" | "portable" | "windows-unsigned" | "check-failed";
}
```

Use a 4:15 AM local schedule:

```ts
const DESKTOP_UPDATE_HOUR = 4;
const DESKTOP_UPDATE_MINUTE = 15;
export const DESKTOP_UPDATE_SCHEDULE = "15 4 * * *";
```

Implement `isDesktopUpdateRoutineDue()` like `isHermesAgentUpdateRoutineDue()`, using local calendar day and `enabled !== false`.

Implement `runDesktopUpdateRoutine()` with injected dependencies for tests:

```ts
export async function runDesktopUpdateRoutine(options: {
  now?: Date;
  isPackaged: boolean;
  isPortable: boolean;
  platform: NodeJS.Platform;
  checkForUpdates: () => Promise<{ updateInfo?: { version?: string; releaseNotes?: unknown } } | null>;
}): Promise<DesktopUpdateRoutineResult> {
  const now = options.now || new Date();
  const checkedAt = now.toISOString();
  if (!options.isPackaged) {
    return { checkedAt, status: "skipped", message: "Skipped because the app is not packaged.", reason: "not-packaged" };
  }
  if (options.isPortable) {
    return { checkedAt, status: "skipped", message: "Skipped for portable builds.", reason: "portable" };
  }
  if (options.platform === "win32") {
    return { checkedAt, status: "skipped", message: "Skipped on unsigned Windows builds.", reason: "windows-unsigned" };
  }
  try {
    const result = await options.checkForUpdates();
    const version = result?.updateInfo?.version || null;
    if (!version) {
      return { checkedAt, status: "current", message: "Hermes Desktop is already current." };
    }
    return {
      checkedAt,
      status: "available",
      message: `Hermes Desktop ${version} is available.`,
      availableVersion: version,
      releaseNotes:
        typeof result?.updateInfo?.releaseNotes === "string"
          ? result.updateInfo.releaseNotes
          : null,
    };
  } catch (err) {
    return {
      checkedAt,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      reason: "check-failed",
    };
  }
}
```

- [ ] **Step 3: Persist routine state in desktop config**

Add `DesktopUpdateRoutineState` beside existing Hermes Agent update routine config. Persist:

- `enabled`, default `true`
- `lastCheckedAt`
- `lastResult`
- `nextCheckAt`
- fixed `schedule: "15 4 * * *"`
- `timezone`

Do not add `autoApply`; Desktop app downloads and restarts only after user action.

- [ ] **Step 4: Wire scheduler**

In `src/main/scheduler.ts`, import `maybeRunDesktopUpdateRoutine` and call it after `maybeRunHermesAgentUpdateRoutine`:

```ts
void maybeRunDesktopUpdateRoutine(new Date(), activeProfile).catch((err) => {
  console.error("[SCHEDULER] Error checking Hermes Desktop update:", err);
});
```

The routine should record state only once per local day, even though `tickScheduler()` runs every 10 seconds.

- [ ] **Step 5: Extend scheduler tests**

Add a mock for `maybeRunDesktopUpdateRoutine` and assert `tickScheduler("test-profile")` calls it with a `Date` and profile.

Run:

```bash
npx vitest run tests/desktop-update-routine.test.ts tests/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/desktop-update-routine.ts src/main/config/desktop-store.ts src/main/scheduler.ts tests/desktop-update-routine.test.ts tests/scheduler.test.ts
git commit -m "feat: add nightly desktop update checks"
```

## Task 5: IPC, Preload, and Settings Controls

**Files:**
- Modify: `src/main/ipc/system.ts`
- Modify: `src/preload/bridges/system.ts`
- Modify: `src/preload/bridges/system.types.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/screens/Settings/Settings.tsx`
- Modify: `src/shared/i18n/locales/en/settings.ts`
- Test: `tests/preload-api-surface.test.ts`
- Test: `tests/ipc-handlers.test.ts`

- [ ] **Step 1: Add IPC handlers**

Register:

- `get-desktop-update-routine`
- `set-desktop-update-routine`
- `run-desktop-update-check`

`run-desktop-update-check` must call the same routine as the scheduler, record the result, and not download the update.

- [ ] **Step 2: Add preload methods and types**

Expose:

```ts
getDesktopUpdateRoutine: () => Promise<DesktopUpdateRoutineState>;
setDesktopUpdateRoutine: (
  settings: Partial<{ enabled: boolean }>,
) => Promise<DesktopUpdateRoutineState>;
runDesktopUpdateCheck: () => Promise<DesktopUpdateRoutineResult>;
```

Update `tests/preload-api-surface.test.ts` so preload and `.d.ts` parity stays pinned.

- [ ] **Step 3: Add Settings UI**

In `Settings.tsx`, under the existing Hermes Agent version area, add a "Hermes Desktop Updates" section with:

- enabled checkbox: "Nightly check"
- schedule value: next 4:15 AM local check
- last attempted
- last result
- "Run now" button
- result message

Keep auto-download out of this section. The existing update button in the sidebar remains the install/download path.

- [ ] **Step 4: Run IPC and preload tests**

```bash
npx vitest run tests/preload-api-surface.test.ts tests/ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/system.ts src/preload/bridges/system.ts src/preload/bridges/system.types.ts src/preload/index.d.ts src/renderer/src/screens/Settings/Settings.tsx src/shared/i18n/locales/en/settings.ts tests/preload-api-surface.test.ts tests/ipc-handlers.test.ts
git commit -m "feat: expose desktop update routine"
```

## Task 6: Release Notes Before Download

**Files:**
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Modify: `src/shared/i18n/locales/en/common.ts`
- Test: add or extend renderer test for `Layout` if one exists; otherwise add `src/renderer/src/screens/Layout/Layout.update.test.tsx`.

- [ ] **Step 1: Preserve release notes in state**

Add:

```ts
const [updateReleaseNotes, setUpdateReleaseNotes] = useState<string | null>(null);
const [showAppUpdateModal, setShowAppUpdateModal] = useState(false);
```

In `onUpdateAvailable`:

```ts
setUpdateReleaseNotes(typeof info.releaseNotes === "string" ? info.releaseNotes : null);
```

- [ ] **Step 2: Change available-state click behavior**

When `updateState === "available"`, clicking the sidebar update button should open a modal. The modal shows:

- available version
- release notes if present
- fallback text if release notes are empty
- "Download update"
- "Not now"

Only `Download update` calls `downloadUpdate()`.

- [ ] **Step 3: Keep ready-state behavior unchanged**

When `updateState === "ready"`, clicking the button still calls `installUpdate()`.

- [ ] **Step 4: Test the modal**

Stub `window.hermesAPI.onUpdateAvailable`, emit `{ version: "0.5.6", releaseNotes: "New Work surface" }`, click the update button, and assert release notes appear before `downloadUpdate` is called.

Run the focused renderer test.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/screens/Layout/Layout.tsx src/shared/i18n/locales/en/common.ts
git commit -m "feat: show release notes before desktop update"
```

## Task 7: Final Verification

**Files:**
- No new source files.

- [ ] **Step 1: Run focused tests**

```bash
npx vitest run tests/update-affordances.test.ts tests/desktop-update-routine.test.ts tests/scheduler.test.ts tests/preload-api-surface.test.ts tests/ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run renderer-focused tests**

```bash
npx vitest run src/renderer/src/screens/SpsAgent/updates/WhatsNewPanel.test.tsx src/renderer/src/screens/SpsAgent/components/CommandPalette.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Manual app-open nightly check sanity**

Run the app in dev and open Settings:

```bash
npm run dev
```

Expected:

- Desktop update routine shows skipped/not packaged in dev.
- Hermes Agent update routine remains visible and unchanged.
- "What's new" does not show on a first install because the current version is recorded as already seen.
- If `localStorage.setItem("hermes-desktop-last-seen-version", "0.5.4")` is run in devtools and the app reloads, the "What's new" panel appears with CTA buttons.

- [ ] **Step 6: Commit verification-only fixes if needed**

If verification required code fixes, commit only those files:

```bash
git add <changed-files>
git commit -m "test: verify update affordance loop"
```

## Acceptance Criteria

- Desktop app update checks run nightly at 4:15 AM local time while the app is open or in tray, record last/next check state, and never auto-download or auto-restart.
- Hermes Agent update behavior remains separate and continues to use the existing 4:00 AM routine.
- A manual "Run now" exists for Desktop app update checks.
- App update release notes are visible before download.
- After a Desktop version change, SPS shows a dismissible "What's new" panel with CTAs that route to real existing surfaces.
- First-time installs do not show stale "new feature" cards.
- Feature affordances are defined in code, typed, tested, platform/API-gated, and not inferred from arbitrary release-note prose.
- Preload and IPC parity tests pin the new API surface.

## Explicit Non-Goals

- Do not add an OS-level LaunchAgent, daemon, or background updater that runs after the app is fully quit.
- Do not auto-download Desktop updates or auto-restart the app.
- Do not parse GitHub release notes into feature affordances.
- Do not auto-enable optional SPS workspace packs.
- Do not change Hermes Agent update auto-apply defaults.
