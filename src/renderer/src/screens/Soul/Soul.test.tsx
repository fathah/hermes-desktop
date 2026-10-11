import { profileEditorFixture } from "../../test/profileEditorFixture";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stableT = (key: string): string => key;
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: stableT }),
}));
vi.mock("../../components/OrbLoader", () => ({
  OrbLoader: (): React.JSX.Element => <div data-testid="loader" />,
}));

import Soul from "./Soul";

function installApi(overrides: Record<string, unknown> = {}): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      ...profileEditorFixture().api,
      readSoul: vi.fn().mockResolvedValue("be kind"),
      writeSoul: vi.fn().mockResolvedValue(true),
      resetSoul: vi.fn().mockResolvedValue("default"),
      ...overrides,
    },
  });
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Soul", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("shows the error and never autosaves when the initial read fails", async () => {
    installApi({ readSoul: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<Soul profile="work" />);
    await flush(0);
    expect(screen.getByText("offline")).toBeTruthy();
    // Even if the user types into the (empty) editor afterwards, nothing is
    // written until a load has succeeded: it would overwrite the real file.
    fireEvent.change(screen.getByPlaceholderText("soul.placeholder"), {
      target: { value: "x" },
    });
    await flush(2000);
    expect(window.hermesAPI.writeSoul).not.toHaveBeenCalled();
  });

  it("surfaces a failed save instead of showing Saved", async () => {
    installApi({
      writeSoul: vi.fn().mockRejectedValue(new Error("read-only fs")),
    });
    render(<Soul />);
    await flush(400); // loaded flag flips after 300 ms
    fireEvent.change(screen.getByPlaceholderText("soul.placeholder"), {
      target: { value: "new text" },
    });
    await flush(700);
    expect(window.hermesAPI.writeSoul).toHaveBeenCalledWith(
      "new text",
      "default",
      expect.objectContaining({ profile: "default", mode: "local" }),
    );
    expect(screen.getByText("read-only fs")).toBeTruthy();
    expect(screen.queryByText("common.saved")).toBeNull();
  });

  it("offers Reset only when allowed", async () => {
    installApi();
    const { unmount } = render(<Soul />);
    await flush(0);
    expect(screen.getByText("soul.reset")).toBeTruthy();
    unmount();

    installApi();
    render(<Soul allowReset={false} />);
    await flush(0);
    expect(screen.queryByText("soul.reset")).toBeNull();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("Soul editor target lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // @lat: [[profile-editors#Tests#Delayed Soul hydration]]
  it("never hydrates or autosaves the previous profile after the next profile loads", async () => {
    const old = deferred<string>();
    installApi({
      readSoul: vi
        .fn()
        .mockImplementation((profile) =>
          profile === "a" ? old.promise : Promise.resolve("B text"),
        ),
    });
    const view = render(<Soul profile="a" />);
    await flush();
    view.rerender(<Soul profile="b" />);
    await flush();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "B text",
    );
    await act(async () => old.resolve("A text"));
    await flush(2000);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "B text",
    );
    expect(window.hermesAPI.writeSoul).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "B edit" },
    });
    await flush(600);
    expect(window.hermesAPI.writeSoul).toHaveBeenCalledWith(
      "B edit",
      "b",
      expect.objectContaining({ profile: "b" }),
    );
  });

  // @lat: [[profile-editors#Tests#Cancelled draft timers]]
  it("cancels an autosave when the same connection ID is edited or changes mode", async () => {
    const fixture = profileEditorFixture();
    installApi({ ...fixture.api });
    render(<Soul profile="work" />);
    await flush();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "old desktop draft" },
    });
    await act(async () => fixture.change("local", "remote"));
    await flush(2000);
    expect(window.hermesAPI.writeSoul).not.toHaveBeenCalled();
    expect(screen.queryByText("soul.reset")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "be kind",
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "remote draft" },
    });
    await flush(600);
    expect(window.hermesAPI.writeSoul).toHaveBeenCalledWith(
      "remote draft",
      "work",
      expect.objectContaining({ mode: "remote" }),
    );
  });

  // @lat: [[profile-editors#Tests#Late save results]]
  it("ignores an old save rejection and cancels its Saved timers after switching profile", async () => {
    const old = deferred<boolean>();
    installApi({
      writeSoul: vi
        .fn()
        .mockImplementation((_text, profile) =>
          profile === "a" ? old.promise : Promise.resolve(true),
        ),
    });
    const view = render(<Soul profile="a" />);
    await flush();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "A edit" },
    });
    await flush(600);
    view.rerender(<Soul profile="b" />);
    await flush();
    await act(async () => old.reject(new Error("A failed")));
    expect(screen.queryByText("A failed")).toBeNull();
    expect(screen.queryByText("common.saved")).toBeNull();
    view.unmount();
    await flush(3000);
    expect(window.hermesAPI.writeSoul).toHaveBeenCalledTimes(1);
  });

  // @lat: [[profile-editors#Tests#Out of order target capture]]
  it("does not read a target whose capture resolves after a newer profile", async () => {
    const old =
      deferred<
        Awaited<ReturnType<typeof window.hermesAPI.getProfileEditorTarget>>
      >();
    installApi({
      getProfileEditorTarget: vi.fn().mockImplementation((profile) =>
        profile === "a"
          ? old.promise
          : Promise.resolve({
              connectionId: "b",
              profile: "b",
              mode: "remote",
              scopeToken: "b",
            }),
      ),
    });
    const view = render(<Soul profile="a" />);
    view.rerender(<Soul profile="b" />);
    await flush();
    await act(async () =>
      old.resolve({
        connectionId: "a",
        profile: "a",
        mode: "local",
        scopeToken: "a",
      }),
    );
    expect(window.hermesAPI.readSoul).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.readSoul).toHaveBeenCalledWith(
      "b",
      expect.objectContaining({ connectionId: "b" }),
    );
  });
});

// @lat: [[profile-editors#Tests#Serialized Soul writes]]
it("serializes slow saves and only acknowledges the latest edited draft", async () => {
  vi.useFakeTimers();
  const old = deferred<boolean>();
  installApi({
    writeSoul: vi.fn().mockResolvedValue(true).mockReturnValueOnce(old.promise),
  });
  const view = render(<Soul profile="work" />);
  await flush();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "first" } });
  await flush(600);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "second" },
  });
  await flush(600);
  expect(window.hermesAPI.writeSoul).toHaveBeenCalledTimes(1);
  await act(async () => old.resolve(true));
  expect(window.hermesAPI.writeSoul).toHaveBeenCalledTimes(2);
  expect(window.hermesAPI.writeSoul).toHaveBeenLastCalledWith(
    "second",
    "work",
    expect.objectContaining({ profile: "work" }),
  );
  expect(screen.getByText("common.saved")).toBeTruthy();
  view.unmount();
  await flush(3000);
  vi.useRealTimers();
});
