import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { profileEditorFixture } from "../../test/profileEditorFixture";
const t = (key: string): string => key;
vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t }) }));
import Memory from "./Memory";
import type { MemoryData, MemoryProviderInfo } from "./types";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
// @lat: [[profile-editors#Tests#Same target refresh preserves Soul drafts]]
it.each(["local", "remote"] as const)(
  "keeps a real %s Soul draft and pending autosave mounted during Memory refresh",
  async (mode) => {
    const data = {
      memory: {
        entries: [],
        content: "",
        exists: false,
        charCount: 0,
        charLimit: 2000,
      },
      user: { content: "", exists: false, charCount: 0, charLimit: 1000 },
      stats: { totalSessions: 0, totalMessages: 0 },
    };
    let resolveRefresh!: (value: typeof data) => void;
    const api = {
      ...profileEditorFixture(mode).api,
      readMemory: vi
        .fn()
        .mockResolvedValueOnce(data)
        .mockReturnValueOnce(
          new Promise((done) => {
            resolveRefresh = done;
          }),
        ),
      getConfig: vi.fn().mockResolvedValue(null),
      discoverMemoryProviders: vi.fn().mockResolvedValue([]),
      readSoul: vi.fn().mockResolvedValue("old Soul"),
      writeSoul: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: api,
    });
    render(<Memory profile="work" />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole("button", { name: "soul.title" }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "my pending Soul draft" } });
    fireEvent.click(document.querySelector(".memory-header button")!);
    expect(screen.getByRole("textbox")).toBe(editor);
    expect((editor as HTMLTextAreaElement).value).toBe("my pending Soul draft");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(api.writeSoul).toHaveBeenCalledWith(
      "my pending Soul draft",
      "work",
      expect.objectContaining({ mode, profile: "work" }),
    );
    await act(async () => resolveRefresh(data));
    expect(screen.getByRole("textbox")).toBe(editor);
    expect(api.readSoul).toHaveBeenCalledTimes(1);
  },
);

const memoryData = (first: string, second: string): MemoryData => ({
  memory: {
    entries: [
      { index: 0, content: first },
      { index: 1, content: second },
    ],
    content: `${first}\n${second}`,
    exists: true,
    lastModified: null,
    charCount: first.length + second.length,
    charLimit: 2000,
  },
  user: {
    content: `profile ${first}`,
    exists: true,
    lastModified: null,
    charCount: first.length + 8,
    charLimit: 1000,
  },
  stats: { totalSessions: 0, totalMessages: 0 },
});

// @lat: [[profile-editors#Tests#Refresh resets positional entry drafts]]
it("discards an old entry draft before enabling edits on reordered refreshed entries", async () => {
  const original = memoryData("entry A", "entry B");
  const refreshed = memoryData("entry B", "entry A");
  let resolveRefresh!: (value: MemoryData) => void;
  const api = {
    ...profileEditorFixture().api,
    readMemory: vi
      .fn()
      .mockResolvedValue(refreshed)
      .mockResolvedValueOnce(original)
      .mockReturnValueOnce(new Promise((done) => (resolveRefresh = done))),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([]),
    updateMemoryEntry: vi.fn().mockResolvedValue({ success: true }),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(screen.getAllByRole("button", { name: "memory.edit" })[0]);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "edited entry A" },
  });
  fireEvent.click(document.querySelector(".memory-header button")!);
  expect(screen.getByRole("button", { name: "memory.save" })).toBeDisabled();
  await act(async () => resolveRefresh(refreshed));
  const staleSave = screen.queryByRole("button", { name: "memory.save" });
  if (staleSave) {
    fireEvent.click(staleSave);
    await act(async () => vi.advanceTimersByTimeAsync(0));
  }
  expect(api.updateMemoryEntry).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "memory.save" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "memory.edit" })[0]);
  expect(screen.getByRole("textbox")).toHaveValue("entry B");
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "edited entry B" },
  });
  fireEvent.click(screen.getByRole("button", { name: "memory.save" }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.updateMemoryEntry).toHaveBeenCalledWith(
    0,
    "edited entry B",
    "work",
    expect.objectContaining({ profile: "work" }),
  );
});

// @lat: [[profile-editors#Tests#Refresh replaces memory tab state]]
it.each(["profile", "providers"] as const)(
  "replaces %s draft and initial state with refreshed data",
  async (tab) => {
    const provider = (active: boolean): MemoryProviderInfo => ({
      name: "mem0",
      description: "mem0 description",
      installed: true,
      active,
      envVars: ["MEM0_API_KEY"],
    });
    const api = {
      ...profileEditorFixture().api,
      readMemory: vi
        .fn()
        .mockResolvedValueOnce(memoryData("old", "other"))
        .mockResolvedValue(memoryData("refreshed", "other")),
      getConfig: vi.fn().mockResolvedValueOnce(null).mockResolvedValue("mem0"),
      discoverMemoryProviders: vi
        .fn()
        .mockResolvedValueOnce([provider(false)])
        .mockResolvedValue([provider(true)]),
    };
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: api,
    });
    render(<Memory profile="work" />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(
      screen.getByRole("button", {
        name:
          tab === "profile" ? "memory.userProfile" : "memory.providersTitle",
      }),
    );
    if (tab === "profile") {
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "stale profile draft" },
      });
    } else {
      fireEvent.change(document.querySelector("input")!, {
        target: { value: "stale provider draft" },
      });
    }
    fireEvent.click(document.querySelector(".memory-header button")!);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    if (tab === "profile") {
      expect(screen.getByRole("textbox")).toHaveValue("profile refreshed");
      expect(
        screen.queryByRole("button", { name: "memory.saveProfile" }),
      ).toBeNull();
    } else {
      expect(document.querySelector("input")).toHaveValue("");
      expect(
        screen.getByRole("button", { name: "memory.deactivate" }),
      ).toBeEnabled();
      expect(document.querySelector(".memory-provider-active")).not.toBeNull();
    }
  },
);
