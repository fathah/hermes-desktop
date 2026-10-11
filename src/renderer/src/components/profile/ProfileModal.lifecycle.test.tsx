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
