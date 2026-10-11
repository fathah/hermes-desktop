import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

// @lat: [[profile-editors#Tests#Refresh waits for admitted memory mutations]]
it("waits for a pending SSH deletion before refreshing and editing the new entry positions", async () => {
  let deleted = false;
  let resolveDelete!: (result: boolean) => void;
  const original = memoryData("entry A", "entry B");
  const refreshed = memoryData("entry B", "entry C");
  const api = {
    ...profileEditorFixture("ssh").api,
    readMemory: vi
      .fn()
      .mockImplementation(async () => (deleted ? refreshed : original)),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([]),
    removeMemoryEntry: vi
      .fn()
      .mockReturnValue(new Promise((done) => (resolveDelete = done))),
    updateMemoryEntry: vi.fn().mockResolvedValue({ success: true }),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(document.querySelectorAll(".memory-entry-actions button")[1]);
  fireEvent.click(screen.getByRole("button", { name: "memory.yes" }));
  fireEvent.click(document.querySelector(".memory-header button")!);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const readsDuringWrite = api.readMemory.mock.calls.length;
  await act(async () => {
    deleted = true;
    resolveDelete(true);
  });
  const entryB = screen.getByText("entry B").closest(".memory-entry-card")!;
  fireEvent.click(
    within(entryB as HTMLElement).getByRole("button", { name: "memory.edit" }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "edited entry B" },
  });
  fireEvent.click(screen.getByRole("button", { name: "memory.save" }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.updateMemoryEntry).toHaveBeenCalledWith(
    0,
    "edited entry B",
    "work",
    expect.objectContaining({ mode: "ssh", profile: "work" }),
  );
  expect(readsDuringWrite).toBe(1);
  expect(screen.queryByText("entry A")).toBeNull();
});

it("retains a failed write's explanation and releases mutation controls for retry", async () => {
  let rejectDelete!: (reason: Error) => void;
  const api = {
    ...profileEditorFixture("ssh").api,
    readMemory: vi.fn().mockResolvedValue(memoryData("entry A", "entry B")),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([]),
    removeMemoryEntry: vi
      .fn()
      .mockReturnValue(new Promise((_done, reject) => (rejectDelete = reject))),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(document.querySelectorAll(".memory-entry-actions button")[1]);
  fireEvent.click(screen.getByRole("button", { name: "memory.yes" }));
  expect(document.querySelector(".memory-header button")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "memory.userProfile" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "memory.yes" })).toBeDisabled();
  await act(async () => rejectDelete(new Error("SSH deletion failed")));
  expect(screen.getByText("SSH deletion failed")).toBeInTheDocument();
  expect(document.querySelector(".memory-header button")).toBeEnabled();
  expect(screen.getByRole("button", { name: "memory.yes" })).toBeEnabled();
  expect(api.readMemory).toHaveBeenCalledTimes(1);
});

// @lat: [[profile-editors#Tests#Failed refresh cannot enable old positions]]
it("keeps old positional controls disabled after a successful delete until its refresh succeeds", async () => {
  const api = {
    ...profileEditorFixture("ssh").api,
    readMemory: vi
      .fn()
      .mockResolvedValueOnce(memoryData("entry A", "entry B"))
      .mockRejectedValueOnce(new Error("refresh offline"))
      .mockResolvedValue(memoryData("entry B", "entry C")),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([]),
    removeMemoryEntry: vi.fn().mockResolvedValue(true),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(document.querySelectorAll(".memory-entry-actions button")[1]);
  fireEvent.click(screen.getByRole("button", { name: "memory.yes" }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole("alert")).toHaveTextContent("refresh offline");
  expect(
    screen.getAllByRole("button", { name: "memory.edit" })[0],
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "memory.addMemory" }),
  ).toBeDisabled();
  expect(document.querySelector(".memory-header button")).toBeEnabled();
  fireEvent.click(document.querySelector(".memory-header button")!);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.queryByText("entry A")).toBeNull();
  expect(
    screen.getAllByRole("button", { name: "memory.edit" })[0],
  ).toBeEnabled();
  expect(screen.queryByRole("alert")).toBeNull();
});

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

// @lat: [[profile-editors#Tests#Memory mutation admission survives remounts]]
it("waits across work→other→work for an admitted deletion before editing the new positions", async () => {
  let deleted = false;
  let resolveDelete!: (result: boolean) => void;
  const api = {
    ...profileEditorFixture("ssh").api,
    readMemory: vi
      .fn()
      .mockImplementation(async (profile) =>
        profile === "other"
          ? memoryData("other A", "other B")
          : deleted
            ? memoryData("entry B", "entry C")
            : memoryData("entry A", "entry B"),
      ),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([]),
    removeMemoryEntry: vi
      .fn()
      .mockReturnValue(new Promise((done) => (resolveDelete = done))),
    updateMemoryEntry: vi.fn().mockResolvedValue({ success: true }),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  const view = render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(document.querySelectorAll(".memory-entry-actions button")[1]);
  fireEvent.click(screen.getByRole("button", { name: "memory.yes" }));
  view.rerender(<Memory profile="other" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("other A")).toBeInTheDocument();
  view.rerender(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(
    api.readMemory.mock.calls.filter(([profile]) => profile === "work"),
  ).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "memory.edit" })).toBeNull();
  await act(async () => {
    deleted = true;
    resolveDelete(true);
  });
  const entryB = screen.getByText("entry B").closest(".memory-entry-card")!;
  fireEvent.click(
    within(entryB as HTMLElement).getByRole("button", { name: "memory.edit" }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "edited entry B" },
  });
  fireEvent.click(screen.getByRole("button", { name: "memory.save" }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.updateMemoryEntry).toHaveBeenCalledExactlyOnceWith(
    0,
    "edited entry B",
    "work",
    expect.objectContaining({ mode: "ssh", profile: "work" }),
  );
});

// @lat: [[profile-editors#Tests#Sibling snapshots cannot admit old positions]]
it("reloads a sibling's stale entry snapshot instead of writing its old position", async () => {
  let deleted = false;
  const fixture = profileEditorFixture("ssh");
  const api = {
    ...fixture.api,
    readMemory: vi
      .fn()
      .mockImplementation(async () =>
        deleted
          ? memoryData("entry B", "entry C")
          : memoryData("entry A", "entry B"),
      ),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([]),
    removeMemoryEntry: vi.fn().mockImplementation(async () => {
      deleted = true;
      return true;
    }),
    updateMemoryEntry: vi.fn().mockResolvedValue({ success: true }),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  const first = render(<Memory profile="work" />);
  const second = render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(
    first.container.querySelectorAll(".memory-entry-actions button")[1],
  );
  fireEvent.click(
    within(first.container).getByRole("button", { name: "memory.yes" }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const staleB = within(second.container)
    .getByText("entry B")
    .closest(".memory-entry-card")!;
  fireEvent.click(
    within(staleB as HTMLElement).getByRole("button", { name: "memory.edit" }),
  );
  fireEvent.change(within(second.container).getByRole("textbox"), {
    target: { value: "stale edit B" },
  });
  fireEvent.click(
    within(second.container).getByRole("button", { name: "memory.save" }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.updateMemoryEntry).not.toHaveBeenCalled();
  expect(within(second.container).queryByText("entry A")).toBeNull();
  expect(within(second.container).queryByRole("textbox")).toBeNull();
  fireEvent.click(
    within(second.container).getAllByRole("button", { name: "memory.edit" })[0],
  );
  fireEvent.change(within(second.container).getByRole("textbox"), {
    target: { value: "current edit B" },
  });
  fireEvent.click(
    within(second.container).getByRole("button", { name: "memory.save" }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.updateMemoryEntry).toHaveBeenCalledExactlyOnceWith(
    0,
    "current edit B",
    "work",
    expect.objectContaining({ profile: "work" }),
  );
});

// @lat: [[profile-editors#Tests#Reads overtaken by sibling mutations]]
it("discards a read overtaken by a sibling deletion and waits for its new snapshot", async () => {
  let deleted = false;
  let resolveDelete!: (result: boolean) => void;
  let resolveRead!: (data: MemoryData) => void;
  const original = memoryData("entry A", "entry B");
  const api = {
    ...profileEditorFixture("ssh").api,
    readMemory: vi
      .fn()
      .mockImplementation(async () =>
        deleted ? memoryData("entry B", "entry C") : original,
      ),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([]),
    removeMemoryEntry: vi
      .fn()
      .mockReturnValue(new Promise((done) => (resolveDelete = done))),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  const first = render(<Memory profile="work" />);
  const second = render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  api.readMemory.mockReturnValueOnce(
    new Promise((done) => (resolveRead = done)),
  );
  fireEvent.click(second.container.querySelector(".memory-header button")!);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(
    first.container.querySelectorAll(".memory-entry-actions button")[1],
  );
  fireEvent.click(
    within(first.container).getByRole("button", { name: "memory.yes" }),
  );
  await act(async () => resolveRead(original));
  expect(
    within(second.container).getAllByRole("button", { name: "memory.edit" })[0],
  ).toBeDisabled();
  expect(api.readMemory).toHaveBeenCalledTimes(3);
  await act(async () => {
    deleted = true;
    resolveDelete(true);
  });
  expect(within(second.container).queryByText("entry A")).toBeNull();
  expect(
    within(second.container).getAllByRole("button", { name: "memory.edit" })[0],
  ).toBeEnabled();
});

const memoryProvider: MemoryProviderInfo = {
  name: "mem0",
  description: "mem0 description",
  installed: true,
  active: false,
  envVars: ["MEM0_API_KEY"],
};

// @lat: [[profile-editors#Tests#Credential blur preserves activation clicks]]
it.each(["local", "ssh"] as const)(
  "delivers the %s provider Activate click after blur and awaits the credential save",
  async (mode) => {
    let resolveSave!: (value: boolean) => void;
    const api = {
      ...profileEditorFixture(mode).api,
      readMemory: vi.fn().mockResolvedValue(memoryData("entry A", "entry B")),
      getConfig: vi.fn().mockResolvedValue(null),
      discoverMemoryProviders: vi.fn().mockResolvedValue([memoryProvider]),
      setEnv: vi
        .fn()
        .mockReturnValue(new Promise((done) => (resolveSave = done))),
      setConfig: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: api,
    });
    render(<Memory profile="work" />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(
      screen.getByRole("button", { name: "memory.providersTitle" }),
    );
    const input = document.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "new credential" } });
    const activate = screen.getByRole("button", { name: "memory.activate" });
    fireEvent.mouseDown(activate);
    fireEvent.blur(input);
    expect(activate).toBeEnabled();
    fireEvent.mouseUp(activate);
    fireEvent.click(activate);
    expect(
      screen.getByRole("button", { name: "memory.activating" }),
    ).toBeDisabled();
    expect(api.setConfig).not.toHaveBeenCalled();
    await act(async () => resolveSave(true));
    expect(api.setEnv).toHaveBeenCalledExactlyOnceWith(
      "MEM0_API_KEY",
      "new credential",
      "work",
      expect.objectContaining({ mode, profile: "work" }),
    );
    expect(api.setConfig).toHaveBeenCalledExactlyOnceWith(
      "memory.provider",
      "mem0",
      "work",
      expect.objectContaining({ mode, profile: "work" }),
    );
  },
);

// @lat: [[profile-editors#Tests#Credential blur preserves tab clicks]]
it("allows a tab click following credential blur without late save UI in the other pane", async () => {
  let resolveSave!: (value: boolean) => void;
  const api = {
    ...profileEditorFixture("ssh").api,
    readMemory: vi.fn().mockResolvedValue(memoryData("entry A", "entry B")),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([memoryProvider]),
    setEnv: vi
      .fn()
      .mockReturnValue(new Promise((done) => (resolveSave = done))),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(
    screen.getByRole("button", { name: "memory.providersTitle" }),
  );
  const input = document.querySelector("input")!;
  fireEvent.change(input, { target: { value: "new credential" } });
  const tab = screen.getByRole("button", { name: "memory.agentMemory" });
  fireEvent.mouseDown(tab);
  fireEvent.blur(input);
  expect(tab).toBeEnabled();
  fireEvent.mouseUp(tab);
  fireEvent.click(tab);
  expect(screen.getByText("entry A")).toBeInTheDocument();
  await act(async () => resolveSave(true));
  expect(screen.queryByText("common.saved")).toBeNull();
  expect(screen.getByText("entry A")).toBeInTheDocument();
});

// @lat: [[profile-editors#Tests#Queued activation checks target ownership]]
it("refuses activation after its awaited credential save belongs to a superseded target", async () => {
  let resolveSave!: (value: boolean) => void;
  const fixture = profileEditorFixture("ssh");
  const api = {
    ...fixture.api,
    readMemory: vi.fn().mockResolvedValue(memoryData("entry A", "entry B")),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([memoryProvider]),
    setEnv: vi
      .fn()
      .mockReturnValue(new Promise((done) => (resolveSave = done))),
    setConfig: vi.fn().mockResolvedValue(true),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(
    screen.getByRole("button", { name: "memory.providersTitle" }),
  );
  const input = document.querySelector("input")!;
  fireEvent.change(input, { target: { value: "old credential" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "memory.activate" }));
  await act(async () => fixture.change("new-connection", "ssh"));
  await act(async () => resolveSave(true));
  expect(api.setConfig).not.toHaveBeenCalled();
  expect(screen.queryByText("common.saved")).toBeNull();
  expect(screen.getByText("entry A")).toBeInTheDocument();
});

// @lat: [[profile-editors#Tests#Failed credentials block activation]]
it("keeps failed credential saves from activating until a new blur save succeeds", async () => {
  let rejectSave!: (reason: Error) => void;
  const api = {
    ...profileEditorFixture("ssh").api,
    readMemory: vi.fn().mockResolvedValue(memoryData("entry A", "entry B")),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([memoryProvider]),
    setEnv: vi
      .fn()
      .mockReturnValueOnce(
        new Promise((_done, reject) => (rejectSave = reject)),
      )
      .mockResolvedValue(true),
    setConfig: vi.fn().mockResolvedValue(true),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(
    screen.getByRole("button", { name: "memory.providersTitle" }),
  );
  const input = document.querySelector("input")!;
  fireEvent.change(input, { target: { value: "first credential" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "memory.activate" }));
  await act(async () => rejectSave(new Error("Credential save rejected")));
  expect(api.setConfig).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Credential save rejected",
  );
  fireEvent.click(screen.getByRole("button", { name: "memory.activate" }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.setConfig).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "replacement credential" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "memory.activate" }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.setConfig).toHaveBeenCalledExactlyOnceWith(
    "memory.provider",
    "mem0",
    "work",
    expect.objectContaining({ profile: "work" }),
  );
  expect(api.setEnv.mock.calls[1][1]).toBe("replacement credential");
});

// @lat: [[profile-editors#Tests#Untouched credential blur keeps saved keys]]
it("does not clear an existing credential when an untouched blank input blurs before Activate", async () => {
  const api = {
    ...profileEditorFixture("ssh").api,
    readMemory: vi.fn().mockResolvedValue(memoryData("entry A", "entry B")),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([memoryProvider]),
    setEnv: vi.fn().mockResolvedValue(true),
    setConfig: vi.fn().mockResolvedValue(true),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(
    screen.getByRole("button", { name: "memory.providersTitle" }),
  );
  fireEvent.focus(document.querySelector("input")!);
  fireEvent.blur(document.querySelector("input")!);
  fireEvent.click(screen.getByRole("button", { name: "memory.activate" }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.setEnv).not.toHaveBeenCalled();
  expect(api.setConfig).toHaveBeenCalledOnce();
});

// @lat: [[profile-editors#Tests#Credential saves survive pane remounts]]
it("serializes SSH credential saves across Providers pane remounts and waits for the newest before activation", async () => {
  let resolveOld!: (value: boolean) => void;
  let resolveNew!: (value: boolean) => void;
  const api = {
    ...profileEditorFixture("ssh").api,
    readMemory: vi.fn().mockResolvedValue(memoryData("entry A", "entry B")),
    getConfig: vi.fn().mockResolvedValue(null),
    discoverMemoryProviders: vi.fn().mockResolvedValue([memoryProvider]),
    setEnv: vi
      .fn()
      .mockReturnValueOnce(new Promise((done) => (resolveOld = done)))
      .mockReturnValueOnce(new Promise((done) => (resolveNew = done))),
    setConfig: vi.fn().mockResolvedValue(true),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(<Memory profile="work" />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(
    screen.getByRole("button", { name: "memory.providersTitle" }),
  );
  fireEvent.change(document.querySelector("input")!, {
    target: { value: "older key" },
  });
  fireEvent.blur(document.querySelector("input")!);
  fireEvent.click(screen.getByRole("button", { name: "memory.agentMemory" }));
  fireEvent.click(
    screen.getByRole("button", { name: "memory.providersTitle" }),
  );
  fireEvent.change(document.querySelector("input")!, {
    target: { value: "newer key" },
  });
  fireEvent.blur(document.querySelector("input")!);
  fireEvent.click(screen.getByRole("button", { name: "memory.activate" }));
  expect(api.setEnv).toHaveBeenCalledTimes(1);
  expect(api.setConfig).not.toHaveBeenCalled();
  await act(async () => resolveOld(true));
  expect(api.setEnv.mock.calls.map(([, value]) => value)).toEqual([
    "older key",
    "newer key",
  ]);
  expect(api.setConfig).not.toHaveBeenCalled();
  await act(async () => resolveNew(true));
  expect(api.setConfig).toHaveBeenCalledExactlyOnceWith(
    "memory.provider",
    "mem0",
    "work",
    expect.objectContaining({ mode: "ssh", profile: "work" }),
  );
});

// @lat: [[profile-editors#Tests#Queued credentials follow the parent target]]
it.each(["pane exit", "connection change"] as const)(
  "continues admitted credentials after %s only while the parent target remains current",
  async (transition) => {
    let resolveOld!: (value: boolean) => void;
    const fixture = profileEditorFixture("ssh");
    const api = {
      ...fixture.api,
      readMemory: vi.fn().mockResolvedValue(memoryData("entry A", "entry B")),
      getConfig: vi.fn().mockResolvedValue(null),
      discoverMemoryProviders: vi.fn().mockResolvedValue([memoryProvider]),
      setEnv: vi
        .fn()
        .mockReturnValueOnce(new Promise((done) => (resolveOld = done)))
        .mockResolvedValue(true),
    };
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: api,
    });
    render(<Memory profile="work" />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(
      screen.getByRole("button", { name: "memory.providersTitle" }),
    );
    fireEvent.change(document.querySelector("input")!, {
      target: { value: "older key" },
    });
    fireEvent.blur(document.querySelector("input")!);
    fireEvent.click(screen.getByRole("button", { name: "memory.agentMemory" }));
    fireEvent.click(
      screen.getByRole("button", { name: "memory.providersTitle" }),
    );
    fireEvent.change(document.querySelector("input")!, {
      target: { value: "newer key" },
    });
    fireEvent.blur(document.querySelector("input")!);
    fireEvent.click(screen.getByRole("button", { name: "memory.agentMemory" }));
    if (transition === "connection change") {
      await act(async () => fixture.change("other-connection", "ssh"));
    }
    expect(api.setEnv).toHaveBeenCalledTimes(1);
    await act(async () => resolveOld(true));
    expect(api.setEnv.mock.calls.map(([, value]) => value)).toEqual(
      transition === "pane exit" ? ["older key", "newer key"] : ["older key"],
    );
    expect(screen.queryByText("common.saved")).toBeNull();
    expect(screen.getByText("entry A")).toBeInTheDocument();
  },
);
