import { profileEditorFixture } from "../../test/profileEditorFixture";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string): string => key }),
}));
vi.mock("../Soul/Soul", () => ({
  default: (): React.JSX.Element => <div data-testid="soul" />,
}));

import Memory from "./Memory";

function memoryData(extra: Record<string, unknown> = {}): unknown {
  return {
    memory: {
      content: "a",
      exists: true,
      lastModified: null,
      entries: [{ index: 0, content: "a" }],
      charCount: 1,
      charLimit: 2200,
    },
    user: {
      content: "",
      exists: false,
      lastModified: null,
      charCount: 0,
      charLimit: 1375,
    },
    stats: { totalSessions: 0, totalMessages: 0 },
    ...extra,
  };
}

function mockApi(data: unknown): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      ...profileEditorFixture().api,
      readMemory: vi.fn().mockResolvedValue(data),
      getConfig: vi.fn().mockResolvedValue(null),
      discoverMemoryProviders: vi.fn().mockResolvedValue([]),
    },
  });
}

describe("Memory screen read-only (remote) mode", () => {
  beforeEach(() => {
    mockApi(memoryData());
  });

  it("disables every control in the entries tab via a disabled fieldset and says why", async () => {
    render(<Memory readOnly />);
    const addButton = await screen.findByText("memory.addMemory");
    expect(addButton.closest("fieldset")?.disabled).toBe(true);
    expect(addButton.closest("button")?.matches(":disabled")).toBe(true);
    expect(screen.getByRole("note").textContent).toMatch(/read-only/);
  });

  it("explains that contents are not exposed when the server refuses file reads", async () => {
    mockApi(memoryData({ contentUnavailable: true }));
    render(<Memory readOnly />);
    await waitFor(() =>
      expect(screen.getByRole("note").textContent).toMatch(
        /does not expose the contents/,
      ),
    );
  });

  it("leaves the controls enabled and shows no notice in local mode", async () => {
    render(<Memory />);
    const addButton = await screen.findByText("memory.addMemory");
    expect(addButton.closest("fieldset")?.disabled).toBe(false);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows the error and a retry instead of spinning forever when the read fails", async () => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        ...profileEditorFixture().api,
        readMemory: vi.fn().mockRejectedValue(new Error("Sign-in expired")),
        getConfig: vi.fn().mockResolvedValue(null),
        discoverMemoryProviders: vi.fn().mockResolvedValue([]),
      },
    });
    render(<Memory readOnly />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Sign-in expired",
    );
    expect(screen.queryByText("memory.addMemory")).toBeNull();
  });

  it("does not present default limits or a zero session count as the server's values", async () => {
    mockApi(memoryData({ limitsUnknown: true, statsUnknown: true }));
    render(<Memory readOnly />);
    await screen.findByText("memory.addMemory");
    // No capacity bar with an invented limit, and no "0 sessions" footer.
    expect(document.querySelector(".memory-capacity-unknown")).not.toBeNull();
    expect(screen.queryByText("0 memory.sessions")).toBeNull();
    expect(screen.queryByText(/memory\.sessions/)).toBeNull();
  });

  it("does not keep the previous profile's entries on screen when the next profile fails to load", async () => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        ...profileEditorFixture().api,
        readMemory: vi.fn().mockImplementation(async (profile?: string) => {
          if (profile === "work") throw new Error("offline");
          return memoryData();
        }),
        getConfig: vi.fn().mockResolvedValue(null),
        discoverMemoryProviders: vi.fn().mockResolvedValue([]),
      },
    });
    const { rerender } = render(<Memory profile="default" />);
    expect(await screen.findByText("memory.addMemory")).toBeTruthy();
    rerender(<Memory profile="work" />);
    expect((await screen.findByRole("alert")).textContent).toContain("offline");
    // The default profile's entry controls are gone, not left editable.
    expect(screen.queryByText("memory.addMemory")).toBeNull();
  });
});

// @lat: [[profile-editors#Tests#Delayed Memory hydration]]
it("keeps a failed new profile read disabled after the old profile resolves late", async () => {
  let resolveOld!: (value: unknown) => void;
  const old = new Promise((resolve) => {
    resolveOld = resolve;
  });
  mockApi(memoryData());
  vi.mocked(window.hermesAPI.readMemory).mockImplementation((profile) =>
    profile === "a"
      ? (old as ReturnType<typeof window.hermesAPI.readMemory>)
      : Promise.reject(new Error("B offline")),
  );
  const view = render(<Memory profile="a" />);
  await waitFor(() => expect(window.hermesAPI.readMemory).toHaveBeenCalled());
  view.rerender(<Memory profile="b" />);
  await screen.findByText("B offline");
  await act(async () => resolveOld(memoryData()));
  expect(screen.queryByText("memory.addMemory")).toBeNull();
  expect(screen.getByText("B offline")).toBeTruthy();
});

// @lat: [[profile-editors#Tests#Memory drafts follow their target]]
it("drops a local entry draft and enables only read-only controls after a same-ID mode change", async () => {
  const fixture = profileEditorFixture();
  mockApi(memoryData());
  Object.assign(window.hermesAPI, fixture.api, {
    addMemoryEntry: vi.fn().mockResolvedValue({ success: true }),
  });
  render(<Memory profile="work" />);
  fireEvent.click(await screen.findByText("memory.addMemory"));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "desktop draft" },
  });
  await act(async () => fixture.change("local", "remote"));
  const add = await screen.findByText("memory.addMemory");
  expect(add.closest("button")?.matches(":disabled")).toBe(true);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(window.hermesAPI.addMemoryEntry).not.toHaveBeenCalled();
});

// @lat: [[profile-editors#Tests#Late memory mutation results]]
it("does not refresh or surface an old entry mutation after a profile switch", async () => {
  let rejectOld!: (reason: Error) => void;
  const old = new Promise<{ success: boolean }>((_resolve, reject) => {
    rejectOld = reject;
  });
  mockApi(memoryData());
  Object.assign(window.hermesAPI, {
    addMemoryEntry: vi.fn().mockReturnValue(old),
  });
  const view = render(<Memory profile="a" />);
  fireEvent.click(await screen.findByText("memory.addMemory"));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "A entry" },
  });
  fireEvent.click(screen.getByText("Save"));
  expect(window.hermesAPI.addMemoryEntry).toHaveBeenCalledWith(
    "A entry",
    "a",
    expect.objectContaining({ profile: "a" }),
  );
  view.rerender(<Memory profile="b" />);
  await screen.findByText("memory.addMemory");
  await act(async () => rejectOld(new Error("A write failed")));
  expect(screen.queryByText("A write failed")).toBeNull();
  expect(window.hermesAPI.readMemory).toHaveBeenCalledTimes(2);
});
