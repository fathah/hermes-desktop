# Content Studio Source Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let existing `Save as content idea` actions continue directly into Content Studio with the captured idea prefilled for scoring, run creation, and variant generation.

**Architecture:** Keep the existing row-backed Content Studio storage as the source of durable truth. Add only a transient SPS UI handoff state that carries the just-saved `ContentIdea` into `ContentStudioSurface`, where the existing local scoring/run form is hydrated from it. Do not add new IPC, new storage folders, or a second assistant path.

**Tech Stack:** React 19, Zustand SPS store, Vitest + Testing Library, existing `ContentIdea` row helpers, existing `spsRunAssistantRecipe` / `spsSaveAssistantRecipeRun` IPC.

---

## Current-State Decision

This feature still needs a small build.

Already present:
- `ResearchModal` writes a `ContentIdea` row in `saveResearchAsContentIdea`.
- `SourceIntakePanel` writes `ContentIdea` rows from URL preview, multi-source review, and study results.
- `SubstackRadarPanel` writes `ContentIdea` rows from one candidate or approved candidates.
- `ContentStudioSurface` already has score, run, assistant variant, review queue, evidence, publish, and analytics flows.

Missing:
- The save paths stop at "saved" messaging.
- No save path switches `surface` to `contentStudio`.
- No save path passes the just-captured idea into Content Studio.
- `ContentStudioSurface` reads persisted rows only for dashboard counts; its score/run form is local component state and starts empty.

Smallest safe implementation:
- Add one transient store field and two actions: `pendingContentStudioIdea`, `openContentStudioIdea(idea)`, and `clearPendingContentStudioIdea()`.
- Call `openContentStudioIdea(idea)` immediately after each existing successful `saveContentIdea(idea)`.
- Hydrate the existing `ContentIdeaPanel` state from `pendingContentStudioIdea` in `ContentStudioSurface`, then clear the pending value.

## Acceptance Criteria

- Saving from `ResearchModal` closes the modal and opens Content Studio with the saved idea title, source URLs, audience, angle, rubric, and low-score override prefilled.
- Saving from `SourceIntakePanel` opens Content Studio with the saved URL preview or study idea prefilled.
- Saving from `SubstackRadarPanel` opens Content Studio with the saved candidate or approved-source idea prefilled.
- The existing `Score idea`, `Start content run`, `Generate variants`, and `Save assistant result to Review Queue` actions work from the prefilled state.
- Existing row persistence remains unchanged: save actions still write `content-ideas` rows.
- No new durable schema, IPC, or assistant route is introduced.

## Files

- Modify: `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`
  - Add `ContentIdea` import and UI handoff fields/actions.
- Modify: `src/renderer/src/screens/SpsAgent/store/slices/ui.ts`
  - Initialize and update the transient handoff state.
- Modify: `src/renderer/src/screens/SpsAgent/content/ContentStudioSurface.tsx`
  - Consume pending idea and hydrate existing score/run form state.
- Modify: `src/renderer/src/screens/SpsAgent/research/SourceIntakePanel.tsx`
  - Call store handoff after existing saves.
- Modify: `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx`
  - Call store handoff after existing saves.
- Modify: `src/renderer/src/screens/SpsAgent/modals/ResearchModal.tsx`
  - Call store handoff after existing save.
- Modify: `src/renderer/src/screens/SpsAgent/content/ContentStudioSurface.test.tsx`
  - Cover prefilled handoff into scoring/run/variants.
- Modify: `src/renderer/src/screens/SpsAgent/research/SourceIntakePanel.test.tsx`
  - Cover handoff dispatch from a URL preview save.
- Modify: `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx`
  - Cover handoff dispatch from approved candidate save.
- Create if cheap, otherwise skip with note: `src/renderer/src/screens/SpsAgent/modals/ResearchModal.test.tsx`
  - Cover research modal save handoff only if mounting the modal does not require broad unrelated mocks.

---

### Task 1: Add A Transient Content Studio Handoff To The SPS Store

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`
- Modify: `src/renderer/src/screens/SpsAgent/store/slices/ui.ts`
- Test: `tests/sps-surface.test.ts`

- [ ] **Step 1: Add the failing store test**

Append this test to `tests/sps-surface.test.ts`:

```ts
it("opens Content Studio with a pending captured idea", () => {
  const idea = {
    id: "idea-source",
    title: "Captured source idea",
    sourceUrls: ["https://example.com/source"],
    audience: "operators",
    angle: "A source-backed angle",
    createdAt: "2026-06-17",
    updatedAt: "2026-06-17",
    status: "captured" as const,
    capturedFrom: "source-preview",
    rubric: {
      bookmarkability: 1,
      proof: 1,
      immediateUse: 0,
      audienceClarity: 1,
      reproducibility: 0,
      hookStrength: 0,
      originality: 1,
    },
  };

  useStore.getState().openContentStudioIdea(idea);

  expect(useStore.getState().surface).toBe("contentStudio");
  expect(useStore.getState().pendingContentStudioIdea).toEqual(idea);

  useStore.getState().clearPendingContentStudioIdea();
  expect(useStore.getState().pendingContentStudioIdea).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/sps-surface.test.ts
```

Expected: FAIL because `openContentStudioIdea`, `clearPendingContentStudioIdea`, and `pendingContentStudioIdea` do not exist.

- [ ] **Step 3: Add the store type fields**

In `src/renderer/src/screens/SpsAgent/store/storeTypes.ts`, add this import near the existing shared imports:

```ts
import type { ContentIdea } from "../../../../../shared/content-studio";
```

Inside `UiSlice`, add:

```ts
  pendingContentStudioIdea: ContentIdea | null;
```

Near `setSurface`, add:

```ts
  openContentStudioIdea: (idea: ContentIdea) => void;
  clearPendingContentStudioIdea: () => void;
```

- [ ] **Step 4: Implement the store action**

In `src/renderer/src/screens/SpsAgent/store/slices/ui.ts`, add this initial state beside the other transient fields:

```ts
  pendingContentStudioIdea: null,
```

Add the actions beside `setSurface`:

```ts
  openContentStudioIdea: (idea) =>
    set({
      surface: "contentStudio",
      pendingContentStudioIdea: idea,
      researchOpen: false,
    }),
  clearPendingContentStudioIdea: () =>
    set({ pendingContentStudioIdea: null }),
```

- [ ] **Step 5: Run the store test**

Run:

```bash
npx vitest run tests/sps-surface.test.ts
```

Expected: PASS.

### Task 2: Hydrate Content Studio From The Pending Captured Idea

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/content/ContentStudioSurface.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/content/ContentStudioSurface.test.tsx`

- [ ] **Step 1: Add failing Content Studio handoff test**

Update the hoisted store in `ContentStudioSurface.test.tsx` to include:

```ts
pendingContentStudioIdea: null as import("../../../../../shared/content-studio").ContentIdea | null,
clearPendingContentStudioIdea: vi.fn(),
```

Reset those values in `beforeEach`:

```ts
store.pendingContentStudioIdea = null;
store.clearPendingContentStudioIdea.mockReset();
```

Add this test:

```ts
it("prefills scoring and run generation from a captured source handoff", async () => {
  store.pendingContentStudioIdea = {
    id: "idea-prefilled-source",
    title: "Prefilled source idea",
    sourceUrls: ["https://example.com/source"],
    audience: "founders",
    angle: "Turn this source into a concrete operator checklist.",
    createdAt: "2026-06-17",
    updatedAt: "2026-06-17",
    status: "captured",
    capturedFrom: "source-preview",
    rubric: {
      bookmarkability: 2,
      proof: 2,
      immediateUse: 2,
      audienceClarity: 2,
      reproducibility: 1,
      hookStrength: 1,
      originality: 1,
    },
  };

  render(<ContentStudioSurface />);

  expect(await screen.findByDisplayValue("Prefilled source idea")).toBeInTheDocument();
  expect(screen.getByDisplayValue("https://example.com/source")).toBeInTheDocument();
  expect(screen.getByDisplayValue("founders")).toBeInTheDocument();
  expect(
    screen.getByDisplayValue("Turn this source into a concrete operator checklist."),
  ).toBeInTheDocument();
  expect(await screen.findByText(/Score: 11\/14/)).toBeInTheDocument();
  expect(store.clearPendingContentStudioIdea).toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Start content run" }));

  await waitFor(() =>
    expect(api.spsExportRow).toHaveBeenCalledWith(
      "content-runs",
      expect.stringContaining("content-run-run-prefilled-source-idea"),
      expect.stringContaining("https://example.com/source"),
    ),
  );

  fireEvent.click(screen.getByRole("button", { name: "Generate variants" }));

  await waitFor(() =>
    expect(api.spsRunAssistantRecipe).toHaveBeenCalledWith(
      "recipe-content",
      expect.stringContaining("Prefilled source idea"),
      "default",
    ),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/content/ContentStudioSurface.test.tsx
```

Expected: FAIL because the pending idea is not consumed and the form remains empty.

- [ ] **Step 3: Read handoff state in `ContentStudioSurface`**

In `ContentStudioSurface.tsx`, add:

```ts
  const pendingContentStudioIdea = useStore((s) => s.pendingContentStudioIdea);
  const clearPendingContentStudioIdea = useStore(
    (s) => s.clearPendingContentStudioIdea,
  );
```

- [ ] **Step 4: Add the hydration effect**

Add this effect after the existing dashboard-row loading effect:

```ts
  useEffect(() => {
    if (!pendingContentStudioIdea) return;
    setIdeaTitle(pendingContentStudioIdea.title);
    setSourceUrlsText(pendingContentStudioIdea.sourceUrls.join("\n"));
    setAudience(pendingContentStudioIdea.audience);
    setAngle(pendingContentStudioIdea.angle);
    setRubric(pendingContentStudioIdea.rubric);
    setOverrideLowScore(Boolean(pendingContentStudioIdea.overrideLowScore));
    setCurrentIdea(pendingContentStudioIdea);
    setCurrentRun(null);
    setRunMessage("");
    setVariantMessage("");
    setLastAssistantRunId("");
    setDraftVariants([]);
    setActivePanel("ideas");
    clearPendingContentStudioIdea();
  }, [clearPendingContentStudioIdea, pendingContentStudioIdea]);
```

- [ ] **Step 5: Run the Content Studio test**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/content/ContentStudioSurface.test.tsx
```

Expected: PASS.

### Task 3: Wire Source Intake Saves Into The Handoff

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/research/SourceIntakePanel.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/research/SourceIntakePanel.test.tsx`

- [ ] **Step 1: Mock the store in the Source Intake test**

At the top of `SourceIntakePanel.test.tsx`, add:

```ts
const store = vi.hoisted(() => ({
  openContentStudioIdea: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));
```

In `beforeEach`, add:

```ts
store.openContentStudioIdea.mockReset();
```

- [ ] **Step 2: Extend the existing preview-save test**

In the test named `"saves a preview as a Content Studio idea"`, after the `spsExportRow` assertion, add:

```ts
expect(store.openContentStudioIdea).toHaveBeenCalledWith(
  expect.objectContaining({
    title: "Example Page",
    sourceUrls: ["https://example.com/page"],
    capturedFrom: "source-preview",
  }),
);
```

- [ ] **Step 3: Extend the multi-source test**

In the test named `"creates one Content Studio idea from multiple reviewed sources"`, add:

```ts
expect(store.openContentStudioIdea).toHaveBeenCalledWith(
  expect.objectContaining({
    title: "Combined source idea",
    sourceUrls: ["https://one.example/page", "https://two.example/page"],
    capturedFrom: "sources",
  }),
);
```

- [ ] **Step 4: Extend the study-save test**

In the test named `"saves a Study sources result as one Content Studio idea with corpus URLs"`, add:

```ts
expect(store.openContentStudioIdea).toHaveBeenCalledWith(
  expect.objectContaining({
    title: "Source-backed workflows",
    sourceUrls: ["https://one.example/study", "https://two.example/study"],
    capturedFrom: "source-study",
  }),
);
```

- [ ] **Step 5: Run the test to verify it fails**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/research/SourceIntakePanel.test.tsx
```

Expected: FAIL because Source Intake saves do not call the handoff action.

- [ ] **Step 6: Import the store and action**

In `SourceIntakePanel.tsx`, add:

```ts
import { useStore } from "../store";
```

Inside the component, add:

```ts
  const openContentStudioIdea = useStore((s) => s.openContentStudioIdea);
```

- [ ] **Step 7: Call the handoff after each successful save**

In `saveAsContentIdea`, replace the current body after `const idea = ...` with:

```ts
    await saveContentIdea(idea);
    openContentStudioIdea(idea);
    setMessage("Saved as content idea.");
```

In `createContentIdeaFromSources`, hold the built idea before saving:

```ts
      const idea = buildContentIdeaFromSources({
        id: `idea-sources-${Date.now().toString(36)}`,
        title: ideaTitle.trim() || ideaSources[0]?.title,
        sources: ideaSources,
        capturedFrom: "sources",
      });
      await saveContentIdea(idea);
      openContentStudioIdea(idea);
      setMessage("Created Content Studio idea.");
```

In `saveStudyAsContentIdea`, hold the built idea before saving:

```ts
      const idea = buildContentIdeaFromSources({
        id: `idea-study-${Date.now().toString(36)}`,
        title: studyFocus.trim(),
        sources: urls.map((sourceUrl) => ({ url: sourceUrl })),
        angle: studyResult,
        capturedFrom: "source-study",
        rubric: { proof: urls.length ? 1 : 0, originality: 1 },
      });
      await saveContentIdea(idea);
      openContentStudioIdea(idea);
      setMessage("Saved study as content idea.");
```

- [ ] **Step 8: Run the Source Intake test**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/research/SourceIntakePanel.test.tsx
```

Expected: PASS.

### Task 4: Wire Substack Radar Saves Into The Handoff

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx`
- Modify: `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx`

- [ ] **Step 1: Mock the store in the Substack Radar test**

At the top of `SubstackRadarPanel.test.tsx`, add:

```ts
const store = vi.hoisted(() => ({
  openContentStudioIdea: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));
```

In `beforeEach`, add:

```ts
store.openContentStudioIdea.mockReset();
```

- [ ] **Step 2: Extend the approved-candidates test**

In the test named `"creates one Content Studio idea from approved and added candidates"`, add:

```ts
expect(store.openContentStudioIdea).toHaveBeenCalledWith(
  expect.objectContaining({
    title: "Approved Substack sources",
    sourceUrls: ["https://example.substack.com", "https://substack.com/discover/ai-agents", "https://second.substack.com", "https://substack.com/discover/markets"],
    capturedFrom: "substack-radar",
  }),
);
```

- [ ] **Step 3: Add single-candidate save coverage if missing**

If no current test clicks the per-candidate `Save as content idea` button, add:

```ts
it("opens Content Studio from a saved radar candidate", async () => {
  api.spsSubstackRadarListRuns.mockResolvedValue([latestRun]);

  render(<SubstackRadarPanel />);

  fireEvent.click(await screen.findByRole("button", { name: /save as content idea/i }));

  await waitFor(() =>
    expect(store.openContentStudioIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Example Letters",
        sourceUrls: [
          "https://example.substack.com",
          "https://substack.com/discover/ai-agents",
        ],
        capturedFrom: "substack-radar",
      }),
    ),
  );
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx
```

Expected: FAIL because Substack Radar saves do not call the handoff action.

- [ ] **Step 5: Import and call the handoff**

In `SubstackRadarPanel.tsx`, add:

```ts
import { useStore } from "../store";
```

Inside the component, add:

```ts
  const openContentStudioIdea = useStore((s) => s.openContentStudioIdea);
```

After each `await saveContentIdea(idea);`, add:

```ts
    openContentStudioIdea(idea);
```

- [ ] **Step 6: Run the Substack Radar test**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx
```

Expected: PASS.

### Task 5: Wire Research Modal Saves Into The Handoff

**Files:**
- Modify: `src/renderer/src/screens/SpsAgent/modals/ResearchModal.tsx`
- Create or modify: `src/renderer/src/screens/SpsAgent/modals/ResearchModal.test.tsx`

- [ ] **Step 1: Update the modal store selectors**

In `ResearchModal.tsx`, add:

```ts
  const openContentStudioIdea = useStore((s) => s.openContentStudioIdea);
```

- [ ] **Step 2: Call the handoff after save**

In `saveResearchAsContentIdea`, after `await saveContentIdea(idea);`, add:

```ts
    openContentStudioIdea(idea);
```

Keep the existing flash:

```ts
    flash("Saved research as a Content Studio idea.");
```

Because `openContentStudioIdea` sets `researchOpen: false`, this also closes the modal.

- [ ] **Step 3: Add focused test only if cheap to mount**

If `ResearchModal` can be mounted without broad unrelated setup, create `ResearchModal.test.tsx` with:

```ts
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchModal } from "./ResearchModal";

const store = vi.hoisted(() => ({
  setResearchOpen: vi.fn(),
  setScheduledOpen: vi.fn(),
  importResearchWork: vi.fn(),
  runResearch: vi.fn(),
  saveStudyToWiki: vi.fn(),
  flash: vi.fn(),
  openContentStudioIdea: vi.fn(),
}));

const api = vi.hoisted(() => ({
  spsResearchEnsureAgentTool: vi.fn(),
  getToolsets: vi.fn(),
  getResearchReachStatus: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
  store.runResearch.mockResolvedValue({
    ok: true,
    markdown:
      "Sourced summary for operators.\n\n## Sources\n- https://example.com/research",
  });
  api.getToolsets.mockResolvedValue([{ key: "web", enabled: true }]);
  api.getResearchReachStatus.mockResolvedValue({ installed: false, channels: [] });
});

describe("ResearchModal", () => {
  it("opens Content Studio from saved research", async () => {
    render(<ResearchModal />);

    fireEvent.change(screen.getByLabelText(/topic/i), {
      target: { value: "Research-backed content idea" },
    });
    fireEvent.click(screen.getByRole("button", { name: /research/i }));

    expect(await screen.findByText(/sourced summary/i)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /save as content idea/i }),
    );

    await waitFor(() =>
      expect(store.openContentStudioIdea).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Research-backed content idea",
          capturedFrom: "research-reach",
        }),
      ),
    );
  });
});
```

If the modal requires heavy unrelated mocks, do not widen the task. Instead, rely on the store action test plus existing save-flow inspection and note the gap in the final validation.

### Task 6: Run Focused And Relevant Validation

**Files:**
- No edits unless validation finds a root cause in touched code.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/sps-surface.test.ts src/renderer/src/screens/SpsAgent/content/ContentStudioSurface.test.tsx src/renderer/src/screens/SpsAgent/research/SourceIntakePanel.test.tsx src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run ResearchModal test if added**

Run:

```bash
npx vitest run src/renderer/src/screens/SpsAgent/modals/ResearchModal.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Optional smoke gate if implementation changes are accepted for shipping**

Run only after `npm run build` succeeds:

```bash
npm run build
node scripts/sps-smoke.mjs
```

Expected: PASS, including existing Content Studio smoke steps.

## Deliberately Left Alone

- Do not add row-index reload by id for the handoff; the just-saved `ContentIdea` is already in memory and durable persistence remains covered by `saveContentIdea`.
- Do not change the Content Studio dashboard query model.
- Do not add new assistant IPC or bypass `spsRunAssistantRecipe`.
- Do not expose Crawl4AI or other source infrastructure in this UX.
- Do not auto-run the assistant after save. The user lands in a prefilled scoring/run flow and still chooses when to start a content run and generate variants.

## Root Cause vs Workaround

Root-cause fix: the missing behavior is navigation and state handoff, not storage. The correct fix is a small transient handoff between existing save actions and the existing Content Studio scoring/run form.

Workaround avoided: adding another persisted queue or reading the newly saved row back from the index would add latency and new failure modes without solving a durable-data problem.
