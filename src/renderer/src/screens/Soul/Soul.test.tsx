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
      undefined,
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
