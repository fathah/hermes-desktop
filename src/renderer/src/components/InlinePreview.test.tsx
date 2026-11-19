import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InlinePreview } from "./InlinePreview";

const readPreviewFile = vi.fn();

describe("InlinePreview", () => {
  beforeEach(() => {
    readPreviewFile.mockReset();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { readPreviewFile },
    });
  });

  it("recovers from a failed relative read once the workspace is linked", async () => {
    readPreviewFile
      .mockResolvedValueOnce(null) // relative path fails with no workspace
      .mockResolvedValueOnce("<p>hi</p>"); // succeeds once the workspace is linked

    const raw = '::preview{file="widget.html"}';
    const { container, rerender } = render(
      <InlinePreview file="widget.html" raw={raw} workspace={null} />,
    );

    // No workspace → relative read fails → literal directive text, no iframe.
    expect(await screen.findByText(raw)).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();

    // Linking the workspace retries the read; a success clears the error and
    // mounts the iframe instead of leaving the literal text behind.
    rerender(<InlinePreview file="widget.html" raw={raw} workspace="/proj" />);
    await waitFor(() =>
      expect(container.querySelector("iframe")).toBeTruthy(),
    );
  });
});
