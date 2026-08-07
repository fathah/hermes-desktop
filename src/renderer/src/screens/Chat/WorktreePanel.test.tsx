import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreePanel } from "./WorktreePanel";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string): string => key }),
}));

vi.mock("./FileViewer", () => ({
  FileViewer: ({
    files,
    activeFilePath,
    onCloseFile,
  }: {
    files: string[];
    activeFilePath: string;
    onCloseFile: (path: string) => void;
  }) => (
    <div data-testid="file-viewer">
      <span data-testid="open-files">{files.join("|")}</span>
      <span data-testid="active-file">{activeFilePath}</span>
      <button type="button" onClick={() => onCloseFile(activeFilePath)}>
        close active
      </button>
    </div>
  ),
}));

describe("WorktreePanel editor tabs", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        readDirectory: vi.fn().mockResolvedValue([
          { name: "app.ts", isDirectory: false },
          { name: "utils.ts", isDirectory: false },
        ]),
      },
    });
  });

  it("opens, deduplicates, switches, and closes file tabs", async () => {
    render(<WorktreePanel folderPath="/workspace" />);

    const app = await screen.findByText("app.ts");
    const utils = screen.getByText("utils.ts");
    fireEvent.click(app);
    fireEvent.click(app);
    fireEvent.click(utils);

    await waitFor(() =>
      expect(screen.getByTestId("open-files")).toHaveTextContent(
        "/workspace/app.ts|/workspace/utils.ts",
      ),
    );
    expect(screen.getByTestId("active-file")).toHaveTextContent(
      "/workspace/utils.ts",
    );

    fireEvent.click(screen.getByRole("button", { name: "close active" }));
    expect(screen.getByTestId("active-file")).toHaveTextContent(
      "/workspace/app.ts",
    );
  });
});
