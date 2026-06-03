// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ToolDiff } from "../src/renderer/src/screens/Chat/ToolDiff";

const NUL = String.fromCharCode(0);

afterEach(cleanup);

describe("<ToolDiff>", () => {
  it("renders add/remove stats and lines for a modification", () => {
    const { container } = render(
      <ToolDiff oldText={"hello\nworld\n"} newText={"hello\nthere\n"} />,
    );
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();
    expect(container.querySelector(".chat-tool-diff-line--add")).toBeTruthy();
    expect(
      container.querySelector(".chat-tool-diff-line--remove"),
    ).toBeTruthy();
    expect(
      container.querySelector(".chat-tool-diff-line--context"),
    ).toBeTruthy();
  });

  it("shows the file name when provided", () => {
    render(
      <ToolDiff oldText={"a\n"} newText={"a\nb\n"} fileName="src/foo.ts" />,
    );
    expect(screen.getByText("src/foo.ts")).toBeTruthy();
  });

  it("renders a 'no changes' note for a no-op", () => {
    render(<ToolDiff oldText={"same\n"} newText={"same\n"} />);
    expect(screen.getByText(/No changes/)).toBeTruthy();
  });

  it("renders a binary note and no diff lines for NUL content", () => {
    const { container } = render(
      <ToolDiff oldText={"a"} newText={`a${NUL}b`} />,
    );
    expect(screen.getByText(/Binary content/)).toBeTruthy();
    expect(container.querySelector(".chat-tool-diff-line")).toBeNull();
  });

  it("shows a truncated note when capped", () => {
    const oldText = Array.from({ length: 30 }, (_, i) => `o${i}`).join("\n");
    const newText = Array.from({ length: 30 }, (_, i) => `n${i}`).join("\n");
    render(<ToolDiff oldText={oldText} newText={newText} maxLines={4} />);
    expect(screen.getByText("Diff truncated")).toBeTruthy();
  });
});
