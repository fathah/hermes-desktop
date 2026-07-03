# Settings Simplification Implementation Plan

> **Status: IMPLEMENTED (verified 2026-07-03).** All artifacts this plan describes exist on `main` — `normalizeAdminView` in `src/renderer/src/lib/openSettings.ts`, `ControlCenterOverview.tsx` (+ test), the flattened nav groups, and the sectioned `Settings.tsx` via `settingsSections.ts`. The checkboxes below were never ticked; treat this as a historical design doc, not open work. See `docs/IMPROVEMENT-REPORT-2026-07-03.md` §5.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lower-left gear settings overlay understandable to a normal SPS user by replacing the nested admin taxonomy with a task-based Control Center.

**Architecture:** Keep the existing Electron/React overlay and IPC contracts. Flatten the Control Center information architecture, add a first-stop overview, split the dense Settings screen into focused sections, and preserve old deep links through a normalization layer so existing status chips and onboarding links do not break.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, i18next, Vitest, Playwright-Electron smoke harness.

---

## Steelmanned Request

The gear icon should not expose Hermes internals as the primary experience. A user should be able to open settings and immediately answer five questions:

1. Is my AI connected?
2. Which model is My Assistant using?
3. Where do I personalize My Assistant?
4. Where is my data/privacy stored and exported?
5. Where do I go when something is broken?

Everything else belongs behind an explicit Advanced or Troubleshooting label. Words like "Gateway", "Prompt Budget", "Credential Pool", "API_SERVER_KEY", "debug dump", and "Hermes Agent" may still exist, but not as first-run navigation labels.

## Current Problems Found

- The lower-left gear opens `src/renderer/src/App.tsx`'s admin overlay, which renders `src/renderer/src/screens/Layout/Layout.tsx`.
- The overlay side nav has top-level tabs for Providers, Models, Gateway, and Settings.
- The Settings tab then has another five-tab subnav: General, Connection, Application Health, Data, Advanced in `src/renderer/src/screens/Settings/Settings.tsx`.
- Some user goals are split across screens: provider key and active model are in Providers, saved models are in Models, remote/local connection is in Settings, messaging connections are in Gateway.
- Some support-only content is too prominent: prompt budget, security audit, logs, debug dump, network proxy, developer mode.
- The adjacent sun button already controls appearance, so the gear should not feel like a second appearance control.

## Target Information Architecture

Replace the current nested model with one flat Control Center nav:

1. **Overview**
   - Status summary and cards for the most common tasks.
   - Default gear destination unless a missing API key requires AI Setup.
2. **AI Setup**
   - Provider/API key, active provider, active model, base URL.
   - Primary user copy: "Connect the AI that powers My Assistant."
3. **Models**
   - Saved model library and custom model management.
   - Secondary path, not the first thing a normal user must understand.
4. **Personalization**
   - Short explanation plus a button that closes the overlay and opens `My Advisor -> My Alignment`.
   - Do not duplicate the `YouSurface`; make the route obvious.
5. **Preferences**
   - Language, appearance, and day-to-day assistant behavior.
   - Keep appearance here as a complete settings route, while the adjacent sun button remains the fast shortcut.
6. **Data & Privacy**
   - Analytics toggle, export/import backup, vault health, and clear storage locations.
7. **Connected Apps**
   - Existing Gateway functionality renamed for users.
   - Label "Messaging & Apps" in the page header; keep the internal component name unchanged in this plan.
8. **Troubleshooting**
   - Config health, app/engine versions, doctor, logs, prompt budget, security scan.
9. **Advanced**
   - Remote/SSH connection mode, network proxy, developer mode, API server key guidance.

Keep the nav visually grouped:

- **Start:** Overview, AI Setup, Personalization
- **Workspace:** Preferences, Data & Privacy, Connected Apps
- **Power User:** Models, Troubleshooting, Advanced

## Acceptance Criteria

- Opening the lower-left gear shows **Overview**, except when the install check reports no API key; then it deep-links to **AI Setup**.
- There is no second-level tab strip inside Settings.
- Every visible top-level nav item is a user goal, not an implementation noun.
- A user can find personalization from the gear in one click and lands in the existing `My Alignment` surface.
- Health checks, logs, prompt budget, debug dump, network proxy, and developer mode are not visible on the default Overview.
- Existing callers of `openSettings("providers")`, `openSettings("models")`, `openSettings("gateway")`, and `openSettings("settings")` still work.
- Keyboard navigation still works in the overlay side nav.
- Focus remains trapped in the overlay and returns to the workspace trigger after close.
- `npm run typecheck`, focused Vitest tests, and `node scripts/sps-smoke.mjs` pass after a build.

## File Structure

- Modify `src/renderer/src/lib/openSettings.ts`
  - Add the new view union, legacy alias normalization, and last-view migration.
- Modify `src/renderer/src/App.tsx`
  - Default to Overview; pass an overlay close handler into `Layout`.
- Modify `src/renderer/src/screens/Layout/Layout.tsx`
  - Replace current nav groups with task-based groups.
  - Render the new overview and the sectioned settings pages.
- Create `src/renderer/src/screens/Layout/ControlCenterOverview.tsx`
  - First-stop dashboard cards.
- Modify `src/renderer/src/screens/Settings/Settings.tsx`
  - Replace internal tab state with a required `section` prop.
  - Render only one section at a time.
- Create `src/renderer/src/screens/Settings/settingsSections.ts`
  - Shared section ids, labels, and title/copy metadata.
- Modify `src/renderer/src/screens/Providers/Providers.tsx`
  - Rename user-facing header/copy to AI Setup; preserve component name initially.
- Modify `src/renderer/src/screens/Gateway/Gateway.tsx`
  - Rename user-facing header/copy to Connected Apps / Messaging & Apps.
- Modify `src/shared/i18n/locales/en/navigation.ts`
  - Add new nav labels.
- Modify `src/shared/i18n/locales/en/settings.ts`
  - Add simplified section labels and overview copy.
- Modify non-English `src/shared/i18n/locales/*/navigation.ts` and `settings.ts`
  - Add English fallback strings for new keys so untranslated locales do not show raw keys.
- Modify `src/renderer/src/assets/main.css`
  - Add overview cards and remove styling assumptions for the Settings subnav.
- Add `src/renderer/src/lib/openSettings.test.ts`
  - Test normalization and persisted last-view behavior.
- Add or update `src/shared/i18n/index.test.ts`
  - Assert new SPS-first settings labels.
- Add `src/renderer/src/screens/Layout/ControlCenterOverview.test.tsx`
  - Smoke-render overview cards and personalization action.

---

### Task 1: Add Stable Control Center View Normalization

**Files:**
- Modify: `src/renderer/src/lib/openSettings.ts`
- Add: `src/renderer/src/lib/openSettings.test.ts`

- [ ] **Step 1: Add the new view types and legacy alias map**

In `src/renderer/src/lib/openSettings.ts`, replace the current `AdminView` block with this shape:

```ts
export type AdminView =
  | "overview"
  | "aiSetup"
  | "models"
  | "personalization"
  | "preferences"
  | "dataPrivacy"
  | "connectedApps"
  | "troubleshooting"
  | "advanced"
  // Legacy deep-link aliases. Keep these accepted until all callers migrate.
  | "providers"
  | "gateway"
  | "settings"
  | "spsAgent";

export type NormalizedAdminView = Exclude<
  AdminView,
  "providers" | "gateway" | "settings" | "spsAgent"
>;

const VIEW_ALIASES: Record<string, NormalizedAdminView> = {
  overview: "overview",
  aiSetup: "aiSetup",
  providers: "aiSetup",
  models: "models",
  personalization: "personalization",
  preferences: "preferences",
  dataPrivacy: "dataPrivacy",
  connectedApps: "connectedApps",
  gateway: "connectedApps",
  troubleshooting: "troubleshooting",
  advanced: "advanced",
  settings: "overview",
  spsAgent: "overview",
};

export function normalizeAdminView(view?: AdminView | string): NormalizedAdminView {
  if (!view) return "overview";
  return VIEW_ALIASES[view] ?? "overview";
}
```

- [ ] **Step 2: Update last-view helpers to store normalized views**

Change `readLastAdminView()` to return `NormalizedAdminView`, and `writeLastAdminView(view)` to persist `normalizeAdminView(view)`. This prevents an old stored `"settings"` value from reopening the complicated legacy page.

- [ ] **Step 3: Add tests**

Create `src/renderer/src/lib/openSettings.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_LAST_VIEW_KEY,
  normalizeAdminView,
  readLastAdminView,
  writeLastAdminView,
} from "./openSettings";

describe("openSettings view normalization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("maps legacy settings routes to the new user-facing destinations", () => {
    expect(normalizeAdminView("providers")).toBe("aiSetup");
    expect(normalizeAdminView("gateway")).toBe("connectedApps");
    expect(normalizeAdminView("settings")).toBe("overview");
    expect(normalizeAdminView("spsAgent")).toBe("overview");
  });

  it("falls back to overview for unknown stored values", () => {
    localStorage.setItem(ADMIN_LAST_VIEW_KEY, "not-real");
    expect(readLastAdminView()).toBe("overview");
  });

  it("stores normalized last views", () => {
    writeLastAdminView("providers");
    expect(localStorage.getItem(ADMIN_LAST_VIEW_KEY)).toBe("aiSetup");
    expect(readLastAdminView()).toBe("aiSetup");
  });
});
```

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run src/renderer/src/lib/openSettings.test.ts`

Expected: all three tests pass.

---

### Task 2: Flatten the Overlay Navigation

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Modify: `src/shared/i18n/locales/en/navigation.ts`
- Modify: `src/shared/i18n/locales/*/navigation.ts`

- [ ] **Step 1: Make the gear default to Overview**

In `src/renderer/src/App.tsx`, change the default admin state to the normalized type:

```ts
const [adminInitialView, setAdminInitialView] =
  useState<NormalizedAdminView>("overview");
```

Then update `defaultAdminView()`:

```ts
const defaultAdminView = useCallback(
  (): NormalizedAdminView =>
    hasApiKey === false ? "aiSetup" : readLastAdminView(),
  [hasApiKey],
);
```

Import `normalizeAdminView` and use it inside `openAdmin(view)`:

```ts
setAdminInitialView(normalizeAdminView(view));
```

- [ ] **Step 2: Pass overlay close into Layout**

In the `Layout` render call in `App.tsx`, add:

```tsx
onClose={() => setAdminOpen(false)}
```

- [ ] **Step 3: Replace Layout nav groups**

In `src/renderer/src/screens/Layout/Layout.tsx`, replace `View = AdminView` with `View = NormalizedAdminView`, import `normalizeAdminView`, and replace `NAV_GROUPS` with:

```ts
const NAV_GROUPS: NavGroup[] = [
  {
    id: "start",
    headerKey: "navigation.groupStart",
    items: [
      { view: "overview", icon: Home, labelKey: "navigation.overview" },
      { view: "aiSetup", icon: KeyRound, labelKey: "navigation.aiSetup" },
      {
        view: "personalization",
        icon: Wand2,
        labelKey: "navigation.personalization",
      },
    ],
  },
  {
    id: "workspace",
    headerKey: "navigation.groupWorkspace",
    items: [
      {
        view: "preferences",
        icon: SlidersHorizontal,
        labelKey: "navigation.preferences",
      },
      {
        view: "dataPrivacy",
        icon: Shield,
        labelKey: "navigation.dataPrivacy",
      },
      {
        view: "connectedApps",
        icon: Signal,
        labelKey: "navigation.connectedApps",
      },
    ],
  },
  {
    id: "power",
    headerKey: "navigation.groupPowerUser",
    items: [
      { view: "models", icon: Layers, labelKey: "navigation.models" },
      {
        view: "troubleshooting",
        icon: Activity,
        labelKey: "navigation.troubleshooting",
      },
      { view: "advanced", icon: SettingsIcon, labelKey: "navigation.advanced" },
    ],
  },
];
```

Use lucide icons already available through `lucide-react`: `Home`, `Wand2`, `SlidersHorizontal`, `Shield`, and `Activity`.

- [ ] **Step 4: Normalize event deep links**

In the `OPEN_SETTINGS_EVENT` listener inside `Layout.tsx`, normalize incoming views:

```ts
const target = normalizeAdminView(e.detail?.view);
goTo(target);
```

- [ ] **Step 5: Add English labels**

In `src/shared/i18n/locales/en/navigation.ts`, add:

```ts
overview: "Overview",
aiSetup: "AI Setup",
personalization: "Personalization",
preferences: "Preferences",
dataPrivacy: "Data & Privacy",
connectedApps: "Connected Apps",
troubleshooting: "Troubleshooting",
advanced: "Advanced",
groupStart: "Start",
groupWorkspace: "Workspace",
groupPowerUser: "Power User",
```

Keep existing `providers`, `gateway`, and `settings` keys for compatibility.

- [ ] **Step 6: Add non-English fallbacks**

For each non-English `navigation.ts`, add the same English strings. This is intentionally better than raw i18n keys and can be translated in a separate localization pass.

- [ ] **Step 7: Run validation**

Run: `npm run typecheck`

Expected: both node and web typechecks pass.

---

### Task 3: Add the Control Center Overview

**Files:**
- Create: `src/renderer/src/screens/Layout/ControlCenterOverview.tsx`
- Add: `src/renderer/src/screens/Layout/ControlCenterOverview.test.tsx`
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Modify: `src/renderer/src/assets/main.css`

- [ ] **Step 1: Create overview cards**

Create `ControlCenterOverview.tsx` with cards for:

- AI Setup
- Personalization
- Preferences
- Data & Privacy
- Connected Apps
- Troubleshooting

Each card should have:

- a short plain-English title
- one sentence describing the job
- one primary action
- optional small status text

The personalization card should call:

```ts
useSpsStore.getState().setSurface("you");
onClose();
```

This routes the user to the existing My Alignment surface instead of duplicating personalization controls.

- [ ] **Step 2: Render Overview in Layout**

In `Layout.tsx`, render the overview pane when `view === "overview"`:

```tsx
{visitedViews.has("overview") && (
  <div style={paneStyle("overview")}>
    <ControlCenterOverview
      profile={activeProfile}
      onNavigate={goTo}
      onClose={onClose}
    />
  </div>
)}
```

Initialize visited views with `"overview"` instead of `"settings"`.

- [ ] **Step 3: Add overview CSS**

Add CSS near the existing settings styles in `src/renderer/src/assets/main.css`:

```css
.control-center-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.control-center-card {
  border: 1px solid var(--hair);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-1);
  padding: 18px;
}

.control-center-card h2 {
  margin: 0 0 6px;
  font-size: 16px;
  line-height: 1.25;
  color: var(--text-primary);
}

.control-center-card p {
  margin: 0 0 14px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.45;
}
```

- [ ] **Step 4: Test the overview**

Create a simple render test that verifies the cards exist and the Personalization action calls `setSurface("you")` and `onClose`.

Run: `npx vitest run src/renderer/src/screens/Layout/ControlCenterOverview.test.tsx`

Expected: overview renders and personalization action passes.

---

### Task 4: Split Settings Into Focused Sections

**Files:**
- Create: `src/renderer/src/screens/Settings/settingsSections.ts`
- Modify: `src/renderer/src/screens/Settings/Settings.tsx`
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Modify: `src/renderer/src/assets/main.css`

- [ ] **Step 1: Create section metadata**

Create `settingsSections.ts`:

```ts
export type SettingsSection =
  | "preferences"
  | "dataPrivacy"
  | "troubleshooting"
  | "advanced";

export const SETTINGS_SECTION_COPY: Record<
  SettingsSection,
  { title: string; subtitle: string }
> = {
  preferences: {
    title: "Preferences",
    subtitle: "Language, appearance, and simple assistant behavior.",
  },
  dataPrivacy: {
    title: "Data & Privacy",
    subtitle: "Analytics, backups, vault health, and where your workspace lives.",
  },
  troubleshooting: {
    title: "Troubleshooting",
    subtitle: "Health checks, logs, versions, and diagnostics.",
  },
  advanced: {
    title: "Advanced",
    subtitle: "Remote connection, SSH, network proxy, and developer controls.",
  },
};
```

- [ ] **Step 2: Replace Settings internal tab state**

In `Settings.tsx`, remove `SettingsTab`, `SETTINGS_TABS`, and `activeTab`. Add:

```ts
import type { SettingsSection } from "./settingsSections";
import { SETTINGS_SECTION_COPY } from "./settingsSections";

function Settings({
  profile,
  section,
}: {
  profile?: string;
  section: SettingsSection;
}): React.JSX.Element {
  const sectionCopy = SETTINGS_SECTION_COPY[section];
```

Render:

```tsx
<h1 className="settings-header">{sectionCopy.title}</h1>
<p className="models-subtitle" style={{ marginBottom: 16 }}>
  {sectionCopy.subtitle}
</p>
```

- [ ] **Step 3: Replace `data-section-tab` fencing**

Change the old section attributes:

- `general` sections -> render only when `section === "preferences"`, except privacy goes to `dataPrivacy`.
- `data` sections -> `section === "dataPrivacy"`.
- `agenthealth` sections -> `section === "troubleshooting"`.
- `advanced` sections -> `section === "advanced"`.
- Connection mode section -> `section === "advanced"`.

Use simple conditional rendering rather than CSS tab fencing. For example, wrap the existing Appearance, Language, and Automation JSX blocks in `section === "preferences"` checks without changing their handlers or state variables.

- [ ] **Step 4: Move content to the correct user goal**

Use this mapping:

- Preferences:
  - Appearance
  - Language
  - Automation controls that affect day-to-day assistant behavior
- Data & Privacy:
  - Analytics
  - Export/import backup
  - Vault Health
- Troubleshooting:
  - ConfigHealth
  - SPS engine/app versions
  - Run Diagnosis
  - Debug Dump
  - Prompt Budget Breakdown
  - Supply-Chain Security Audit
  - Logs
  - CapabilitySummary and ResearchReachSummary
- Advanced:
  - Local/remote/SSH connection mode
  - `API_SERVER_KEY` guidance
  - Network proxy
  - Force IPv4
  - Developer mode

- [ ] **Step 5: Remove Settings subnav CSS**

Keep the CSS if other screens use `.settings-subnav`, but remove the Settings-specific comment that frames it as the way Settings is chunked. Do not delete the class if `LearningSurface` still uses it.

- [ ] **Step 6: Render sectioned Settings from Layout**

In `Layout.tsx`, render:

```tsx
{visitedViews.has("dataPrivacy") && (
  <div style={paneStyle("dataPrivacy")}>
    <Settings profile={activeProfile} section="dataPrivacy" />
  </div>
)}

{visitedViews.has("preferences") && (
  <div style={paneStyle("preferences")}>
    <Settings profile={activeProfile} section="preferences" />
  </div>
)}

{visitedViews.has("troubleshooting") && (
  <div style={paneStyle("troubleshooting")}>
    <Settings profile={activeProfile} section="troubleshooting" />
  </div>
)}

{visitedViews.has("advanced") && (
  <div style={paneStyle("advanced")}>
    <Settings profile={activeProfile} section="advanced" />
  </div>
)}
```

- [ ] **Step 7: Run focused validation**

Run: `npm run typecheck`

Expected: no TS errors from the Settings prop split.

---

### Task 5: Rename User-Facing Technical Labels

**Files:**
- Modify: `src/renderer/src/screens/Providers/Providers.tsx`
- Modify: `src/renderer/src/screens/Gateway/Gateway.tsx`
- Modify: `src/shared/i18n/locales/en/providers.ts`
- Modify: `src/shared/i18n/locales/en/gateway.ts`
- Modify: `src/shared/i18n/locales/en/settings.ts`
- Modify: `src/shared/i18n/index.test.ts`

- [ ] **Step 1: Rename Providers page copy**

Keep the component named `Providers`, but make the visible title "AI Setup". Change subtitle copy to:

```ts
"Connect the provider and model that power My Assistant."
```

Keep advanced labels like credential pool lower on the page.

- [ ] **Step 2: Rename Gateway page copy**

Keep the component named `Gateway`, but make visible labels:

- Header: "Connected Apps"
- Main section: "Messaging & Apps"
- Status hint: "Let My Assistant communicate through approved channels."

Keep the underlying gateway terminology in hints where needed for technical accuracy.

- [ ] **Step 3: Rewrite confusing Settings labels**

In English settings copy:

- "Application Health" -> "Troubleshooting"
- "Prompt Budget Breakdown" -> "Context Window"
- "Supply-Chain Security Audit" -> "Dependency Security Scan"
- "Debug Dump" -> "Create Debug Report"
- "Run Diagnosis" -> "Run Health Check"
- "Connection" -> "Remote Access"
- "Server Configuration" -> "Remote Server Setup"

- [ ] **Step 4: Add i18n assertions**

Update `src/shared/i18n/index.test.ts`:

```ts
expect(t("navigation.aiSetup")).toBe("AI Setup");
expect(t("navigation.connectedApps")).toBe("Connected Apps");
expect(t("navigation.troubleshooting")).toBe("Troubleshooting");
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/shared/i18n/index.test.ts`

Expected: shared i18n tests pass.

---

### Task 6: Make AI Setup the One Obvious Place to Connect the Assistant

**Files:**
- Modify: `src/renderer/src/screens/Providers/Providers.tsx`
- Modify: `src/renderer/src/screens/Models/Models.tsx`
- Modify: `src/renderer/src/screens/Layout/ControlCenterOverview.tsx`

- [ ] **Step 1: Add an AI Setup summary at the top of Providers**

At the top of `Providers.tsx`, show:

- active provider
- active model
- whether the needed provider key exists
- base URL when custom or remote

Use existing state already loaded in `Providers.tsx`: `modelProvider`, `modelName`, `modelBaseUrl`, and `env`.

- [ ] **Step 2: Make the primary action clear**

If no key exists for the selected provider, the primary call to action should be "Add API key". If a key exists but no model is selected, use "Choose model". If both exist, show "AI is ready".

- [ ] **Step 3: Demote credential pool**

Leave credential pool in Providers but move it behind a collapsed "Advanced key rotation" disclosure. It is not a first-run concept.

- [ ] **Step 4: Link to Model Library**

Add a secondary button from Providers to `onNavigate("models")` or dispatch `openSettings("models")`. Do not force users to understand the model library before setting the active model.

- [ ] **Step 5: Verify with a screenshot**

Run the app after build and capture the AI Setup screen in both states:

- no API key configured
- existing key and active model configured

Expected: the screen reads like a setup flow, not a config editor.

---

### Task 7: Visual Cleanup and Accessibility

**Files:**
- Modify: `src/renderer/src/assets/main.css`
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Modify: `src/renderer/src/screens/Settings/Settings.tsx`

- [ ] **Step 1: Reduce card nesting and dense chrome**

Keep `.settings-section` as the single card boundary for a group. Do not put repeated nested cards inside Settings unless they are list items, modals, or repeated provider entries.

- [ ] **Step 2: Improve labels and hints**

Every toggle/input should follow:

```text
Label: human action or preference
Hint: what changes, where it applies, and whether it is local/profile-wide
```

Avoid hints that start with implementation names unless the setting is in Advanced.

- [ ] **Step 3: Check tap targets and focus**

Ensure new nav buttons and overview actions are at least 44px high. Preserve the existing arrow-key nav behavior in `Layout.tsx`.

- [ ] **Step 4: Check overflow**

Use desktop and narrow window widths. The overlay must not clip bottom nav items, and settings sections must scroll inside the content pane only.

- [ ] **Step 5: Screenshot QA**

After building, run the app and capture:

- lower-left gear opening Overview
- AI Setup
- Data & Privacy
- Troubleshooting
- Advanced

Expected: no overlapping text, no duplicate tab strip, no first-screen debug clutter.

---

### Task 8: Full Verification

**Files:**
- No new source files unless earlier tasks require fixes.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run src/renderer/src/lib/openSettings.test.ts src/shared/i18n/index.test.ts src/renderer/src/screens/Layout/ControlCenterOverview.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: both node and web typechecks pass.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: electron-vite build completes.

- [ ] **Step 4: Run SPS smoke**

Run:

```bash
node scripts/sps-smoke.mjs
```

Expected: workspace launches, lower-left gear opens the Control Center, legacy deep links still open the expected destination, and no onboarding/setup regressions appear.

---

## Deliberately Left Alone

- No storage substrate changes.
- No provider/gateway IPC changes.
- No keychain or secret storage changes.
- No removal of advanced features.
- No redesign of the separate SPS appearance/tweaks panel beyond avoiding duplicate default settings paths.

## Rollout Notes

Implement this as two commits:

1. `refactor: flatten control center navigation`
2. `polish: simplify settings labels and overview`

Stop after the first commit if behavior changes unexpectedly; the alias layer should make the navigation flattening independently testable.
