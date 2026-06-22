import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickCapture } from "./QuickCapture";

const api = {
  spsTriggerScreencapture: vi.fn(),
  spsExportRow: vi.fn(),
  spsAssetWrite: vi.fn(),
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
  Object.defineProperty(window, "close", {
    value: vi.fn(),
    configurable: true,
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
