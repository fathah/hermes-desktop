import { render, screen, waitFor } from "@testing-library/react";
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
});
