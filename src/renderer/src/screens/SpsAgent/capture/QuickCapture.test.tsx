import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickCapture } from "./QuickCapture";

const api = {
  spsTriggerScreencapture: vi.fn(),
  spsExportRow: vi.fn(),
  spsAssetWrite: vi.fn(),
  spsTakeCaptureKind: vi.fn(),
  onCaptureKind: vi.fn(),
  spsClassifyTask: vi.fn(),
  spsRouteTask: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
  api.spsTriggerScreencapture.mockResolvedValue("a".repeat(64) + ".png");
  api.spsExportRow.mockResolvedValue(true);
  api.spsAssetWrite.mockResolvedValue("b".repeat(64) + ".png");
  api.spsTakeCaptureKind.mockResolvedValue(null);
  api.onCaptureKind.mockReturnValue(() => {});
  api.spsClassifyTask.mockResolvedValue({
    route: "human",
    assigneeId: "you",
    nagCadence: "daily",
    risky: false,
  });
  api.spsRouteTask.mockResolvedValue({
    route: "human",
    status: "todo",
    dispatched: false,
  });
  Object.defineProperty(window, "close", {
    value: vi.fn(),
    configurable: true,
  });
});

describe("QuickCapture task captures", () => {
  it("defaults to task mode when opened by the task hotkey", async () => {
    api.spsTakeCaptureKind.mockResolvedValue("task");

    render(<QuickCapture />);

    await waitFor(() => {
      expect(screen.getByLabelText("Capture type")).toHaveValue("task");
    });
    expect(screen.getByRole("button", { name: /save task/i })).toBeDisabled();
  });

  it("persists a task before classifying and routing it", async () => {
    api.spsTakeCaptureKind.mockResolvedValue("task");

    render(<QuickCapture />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Ask Priya to send the launch checklist\nBefore noon." },
    });
    fireEvent.click(await screen.findByRole("button", { name: /save task/i }));

    await waitFor(() => {
      expect(api.spsRouteTask).toHaveBeenCalled();
    });
    expect(api.spsExportRow).toHaveBeenCalledTimes(2);
    expect(api.spsClassifyTask).toHaveBeenCalledWith(
      "Ask Priya to send the launch checklist\nBefore noon.",
    );
    expect(api.spsExportRow.mock.invocationCallOrder[0]).toBeLessThan(
      api.spsClassifyTask.mock.invocationCallOrder[0],
    );
    expect(api.spsClassifyTask.mock.invocationCallOrder[0]).toBeLessThan(
      api.spsRouteTask.mock.invocationCallOrder[0],
    );

    const [dbFolder, rowId, draft] = api.spsExportRow.mock.calls[0];
    expect(dbFolder).toBe("tasks");
    expect(rowId).toMatch(/^task-/);
    expect(String(draft)).toContain('status: "inbox"');
    const finalMarkdown = String(api.spsExportRow.mock.calls[1][2]);
    expect(finalMarkdown).toContain('status: "todo"');
    expect(finalMarkdown).toContain('route: "human"');
    expect(finalMarkdown).toContain('assigneeId: "you"');
    expect(finalMarkdown).toContain("Before noon.");
  });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("QuickCapture visual captures", () => {
  it("saves a screen snippet as a visual screenshot capture", async () => {
    render(<QuickCapture />);

    fireEvent.click(
      screen.getByRole("button", { name: /capture screen snippet/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /save note to inbox/i }),
    );

    await waitFor(() => {
      expect(api.spsExportRow).toHaveBeenCalled();
    });
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2]);
    expect(markdown).toContain('source: "screenshot"');
    expect(markdown).toContain('assetPath: "' + "a".repeat(64) + '.png"');
    expect(markdown).toContain('captureOrigin: "screen-snippet"');
    expect(markdown).toContain('ocrStatus: "not-run"');
  });

  it("shows a camera error when camera permission is denied", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    render(<QuickCapture />);

    fireEvent.click(screen.getByRole("button", { name: /camera/i }));

    expect(
      await screen.findByText(/camera access was denied/i),
    ).toBeInTheDocument();
  });
});
