import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useContext } from "react";
import { profileEditorFixture } from "../../test/profileEditorFixture";
import { ProfileModalProvider } from "./ProfileModalProvider";
import type { ProfileSection } from "./ProfileModalContext";
import { ProfileModalContext } from "./ProfileModalContext";
import type { MemoryData } from "../../screens/Memory/types";

const t = (key: string): string => key;
vi.mock("../useI18n", () => ({ useI18n: () => ({ t }) }));
vi.mock("../modal/AppModal", () => ({
  AppModal: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div role="dialog">{children}</div> : null),
  AppModalTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));
vi.mock("../OrbLoader", () => ({
  OrbLoader: () => <div data-testid="loader" />,
}));

function Openers({
  section = "persona",
}: {
  section?: ProfileSection;
}): React.JSX.Element {
  const modal = useContext(ProfileModalContext)!;
  return (
    <>
      {["a", "b"].map((name) => (
        <button
          key={name}
          onClick={() => modal.openProfile(name, { initialSection: section })}
        >
          Open {name}
        </button>
      ))}
    </>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function flush(ms = 0): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

// @lat: [[profile-editors#Tests#Modal memory completion follows the parent target]]
it("reloads an admitted memory deletion after leaving its pane without refreshing a different target", async () => {
  let deleted = false;
  let resolveDelete!: (value: boolean) => void;
  const data = (content: string): MemoryData => ({
    memory: {
      entries: [{ index: 0, content }],
      content,
      exists: true,
      lastModified: null,
      charCount: content.length,
      charLimit: 2000,
    },
    user: {
      content: "",
      exists: false,
      lastModified: null,
      charCount: 0,
      charLimit: 1000,
    },
    stats: { totalSessions: 0, totalMessages: 0 },
  });
  const fixture = profileEditorFixture("ssh");
  const api = {
    ...fixture.api,
    listProfiles: vi.fn().mockResolvedValue([
      { id: "a", name: "a", provider: "auto", model: "", skillCount: 0 },
      { id: "b", name: "b", provider: "auto", model: "", skillCount: 0 },
    ]),
    readMemory: vi
      .fn()
      .mockImplementation(async (profile) =>
        data(
          profile === "b"
            ? "new target memory"
            : deleted
              ? "entry B"
              : "entry A",
        ),
      ),
    readSoul: vi.fn().mockResolvedValue("persona"),
    removeMemoryEntry: vi
      .fn()
      .mockReturnValue(new Promise((done) => (resolveDelete = done))),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(
    <ProfileModalProvider>
      <Openers section="agentMemory" />
    </ProfileModalProvider>,
  );
  fireEvent.click(screen.getByText("Open a"));
  await flush();
  fireEvent.click(document.querySelectorAll(".memory-entry-actions button")[1]);
  fireEvent.click(screen.getByRole("button", { name: "memory.yes" }));
  fireEvent.click(
    screen.getByRole("button", { name: "agents.sectionPersona" }),
  );
  await flush();
  fireEvent.click(
    screen.getByRole("button", { name: "agents.sectionAgentMemory" }),
  );
  await flush();
  expect(screen.getByRole("button", { name: "memory.edit" })).toBeDisabled();
  expect(api.readMemory).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole("button", { name: "agents.sectionPersona" }),
  );
  await flush();
  await act(async () => {
    deleted = true;
    resolveDelete(true);
  });
  fireEvent.click(
    screen.getByRole("button", { name: "agents.sectionAgentMemory" }),
  );
  await flush();
  expect(screen.queryByText("entry A")).toBeNull();
  expect(screen.getByText("entry B")).toBeInTheDocument();
  expect(api.readMemory).toHaveBeenCalledTimes(2);
  api.removeMemoryEntry.mockReturnValueOnce(
    new Promise((done) => (resolveDelete = done)),
  );
  fireEvent.click(document.querySelectorAll(".memory-entry-actions button")[1]);
  fireEvent.click(screen.getByRole("button", { name: "memory.yes" }));
  fireEvent.click(screen.getByText("Open b"));
  await flush();
  expect(screen.getByText("new target memory")).toBeInTheDocument();
  await act(async () => resolveDelete(true));
  expect(api.readMemory).toHaveBeenCalledTimes(3);
  expect(screen.getByText("new target memory")).toBeInTheDocument();
});

// @lat: [[profile-editors#Tests#Global modal editor lifecycle]]
it("isolates real Soul editors through the global opener and closes them on connection changes", async () => {
  const fixture = profileEditorFixture();
  let resolveOld!: (value: string) => void;
  const old = new Promise<string>((resolve) => {
    resolveOld = resolve;
  });
  const api = {
    ...fixture.api,
    listProfiles: vi.fn().mockResolvedValue(
      ["a", "b"].map((id) => ({
        id,
        name: id,
        provider: "auto",
        model: "",
        skillCount: 0,
        isDefault: false,
      })),
    ),
    readSoul: vi
      .fn()
      .mockImplementation((profile) =>
        profile === "a" ? old : Promise.resolve("B persona"),
      ),
    writeSoul: vi.fn().mockResolvedValue(true),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  const view = render(
    <ProfileModalProvider>
      <Openers />
    </ProfileModalProvider>,
  );
  fireEvent.click(screen.getByText("Open a"));
  await flush();
  fireEvent.click(screen.getByText("Open b"));
  await flush();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "B persona",
  );
  await act(async () => resolveOld("A persona"));
  await flush(1000);
  expect(api.writeSoul).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "B persona",
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "B draft" },
  });
  await act(async () => fixture.change("remote-b", "remote"));
  await flush(1000);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(api.writeSoul).not.toHaveBeenCalled();
  expect(fixture.listeners.size).toBe(1);
  view.unmount();
  expect(fixture.listeners.size).toBe(0);
});

// @lat: [[profile-editors#Tests#Remote modal memory boundary]]
it("keeps global Remote Persona editable without a reset or local memory mutations", async () => {
  vi.useRealTimers();
  const fixture = profileEditorFixture("remote");
  const api = {
    ...fixture.api,
    listProfiles: vi
      .fn()
      .mockResolvedValue([
        { id: "a", name: "a", provider: "auto", model: "", skillCount: 0 },
      ]),
    readSoul: vi.fn().mockResolvedValue("remote persona"),
    writeSoul: vi.fn().mockResolvedValue(true),
    resetSoul: vi.fn(),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(
    <ProfileModalProvider>
      <Openers />
    </ProfileModalProvider>,
  );
  fireEvent.click(screen.getByText("Open a"));
  await waitFor(() =>
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "remote persona",
    ),
  );
  expect(screen.queryByText("soul.reset")).toBeNull();
  expect(api.readSoul).toHaveBeenCalledWith(
    "a",
    expect.objectContaining({ mode: "remote", profile: "a" }),
  );
});

// @lat: [[profile-editors#Tests#Global modal memory hydration]]
it("does not restore old modal entries when the next profile memory read fails", async () => {
  const fixture = profileEditorFixture();
  let resolveOld!: (value: unknown) => void;
  const old = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const api = {
    ...fixture.api,
    listProfiles: vi.fn().mockResolvedValue(
      ["a", "b"].map((id) => ({
        id,
        name: id,
        provider: "auto",
        model: "",
        skillCount: 0,
      })),
    ),
    readMemory: vi
      .fn()
      .mockImplementation((name) =>
        name === "a" ? old : Promise.reject(new Error("B unavailable")),
      ),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(
    <ProfileModalProvider>
      <Openers section="agentMemory" />
    </ProfileModalProvider>,
  );
  fireEvent.click(screen.getByText("Open a"));
  await flush();
  expect(api.readMemory).toHaveBeenCalledWith(
    "a",
    expect.objectContaining({ profile: "a" }),
  );
  fireEvent.click(screen.getByText("Open b"));
  await flush();
  expect(screen.getByText("memory.loadFailed")).toBeTruthy();
  await act(async () =>
    resolveOld({ memory: { entries: [{ index: 0, content: "A memory" }] } }),
  );
  expect(screen.queryByText("A memory")).toBeNull();
  expect(screen.queryByText("memory.addMemory")).toBeNull();
  expect(api.readMemory).toHaveBeenCalledTimes(2);
});
// @lat: [[profile-editors#Tests#Unavailable modal memory is not empty]]
it("shows unavailable Remote memory without mounting empty entry controls", async () => {
  const api = {
    ...profileEditorFixture("remote").api,
    readMemory: vi.fn().mockResolvedValue({
      contentUnavailable: true,
      memory: { entries: [], charCount: 0, charLimit: 2000 },
    }),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(
    <ProfileModalProvider>
      <Openers section="agentMemory" />
    </ProfileModalProvider>,
  );
  fireEvent.click(screen.getByText("Open a"));
  await flush();
  expect(screen.getByRole("note")).toHaveTextContent("unavailable");
  expect(screen.queryByText("memory.noMemoriesYet")).toBeNull();
  expect(document.querySelector(".memory-empty")).toBeNull();
});

// @lat: [[profile-editors#Tests#Modal mutation admission survives profile changes]]
it("waits after reopening the same modal profile until its admitted deletion settles", async () => {
  let deleted = false;
  let resolveDelete!: (value: boolean) => void;
  const data = (first: string, second: string): MemoryData => ({
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
      content: "",
      exists: false,
      lastModified: null,
      charCount: 0,
      charLimit: 1000,
    },
    stats: { totalSessions: 0, totalMessages: 0 },
  });
  const api = {
    ...profileEditorFixture("ssh").api,
    listProfiles: vi.fn().mockResolvedValue(
      ["a", "b"].map((id) => ({
        id,
        name: id,
        provider: "auto",
        model: "",
        skillCount: 0,
      })),
    ),
    readMemory: vi
      .fn()
      .mockImplementation(async (profile) =>
        profile === "b"
          ? data("other A", "other B")
          : deleted
            ? data("entry B", "entry C")
            : data("entry A", "entry B"),
      ),
    removeMemoryEntry: vi
      .fn()
      .mockReturnValue(new Promise((done) => (resolveDelete = done))),
    updateMemoryEntry: vi.fn().mockResolvedValue({ success: true }),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  render(
    <ProfileModalProvider>
      <Openers section="agentMemory" />
    </ProfileModalProvider>,
  );
  fireEvent.click(screen.getByText("Open a"));
  await flush();
  fireEvent.click(document.querySelectorAll(".memory-entry-actions button")[1]);
  fireEvent.click(screen.getByRole("button", { name: "memory.yes" }));
  fireEvent.click(screen.getByText("Open b"));
  await flush();
  expect(screen.getByText("other A")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Open a"));
  await flush();
  expect(
    api.readMemory.mock.calls.filter(([profile]) => profile === "a"),
  ).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "memory.edit" })).toBeNull();
  await act(async () => {
    deleted = true;
    resolveDelete(true);
  });
  fireEvent.click(screen.getAllByRole("button", { name: "memory.edit" })[0]);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "edited entry B" },
  });
  fireEvent.click(screen.getByRole("button", { name: "memory.save" }));
  await flush();
  expect(api.updateMemoryEntry).toHaveBeenCalledExactlyOnceWith(
    0,
    "edited entry B",
    "a",
    expect.objectContaining({ mode: "ssh", profile: "a" }),
  );
});
