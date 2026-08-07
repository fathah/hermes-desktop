import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileViewer } from "./FileViewer";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string): string => key }),
}));

vi.mock("./CodeEditor", () => ({
  CodeEditor: ({
    value,
    readOnly,
    onChange,
    onSave,
  }: {
    value: string;
    readOnly: boolean;
    onChange: (value: string) => void;
    onSave: () => void;
  }) => (
    <textarea
      aria-label="mock-code-editor"
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          onSave();
        }
      }}
    />
  ),
}));

const FILE = "/workspace/src/app.ts";

function installAPI(options?: {
  truncated?: boolean;
  saveResult?: { success: true } | { success: false; error: "stale" };
}): {
  saveFile: ReturnType<typeof vi.fn>;
} {
  const saveFile = vi
    .fn()
    .mockResolvedValue(options?.saveResult ?? { success: true });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      readFile: vi.fn().mockResolvedValue({
        content: "const answer = 41;\n",
        truncated: options?.truncated ?? false,
        editToken: options?.truncated ? undefined : "edit-token",
      }),
      saveFile,
      readImageFile: vi.fn(),
      openFileInEditor: vi.fn().mockResolvedValue(true),
    },
  });
  return { saveFile };
}

function renderViewer(onCloseFile = vi.fn()): ReturnType<typeof render> {
  return render(
    <FileViewer
      files={[FILE]}
      activeFilePath={FILE}
      workspaceRoot="/workspace"
      onSelectFile={() => {}}
      onCloseFile={onCloseFile}
    />,
  );
}

describe("FileViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("edits and saves a workspace file with the edit token", async () => {
    const { saveFile } = installAPI();
    renderViewer();

    fireEvent.click(
      await screen.findByRole("button", { name: "chat.worktree.edit" }),
    );
    const editor = screen.getByRole("textbox", {
      name: "mock-code-editor",
    });
    fireEvent.change(editor, { target: { value: "const answer = 42;\n" } });

    const save = screen.getByRole("button", { name: "chat.worktree.save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith(
        "edit-token",
        "const answer = 42;\n",
      ),
    );
    expect(await screen.findByText("chat.worktree.saved")).toBeInTheDocument();
  });

  it("supports the editor save shortcut", async () => {
    const { saveFile } = installAPI();
    renderViewer();

    fireEvent.click(
      await screen.findByRole("button", { name: "chat.worktree.edit" }),
    );
    const editor = screen.getByRole("textbox", {
      name: "mock-code-editor",
    });
    fireEvent.change(editor, { target: { value: "changed" } });
    fireEvent.keyDown(editor, { key: "s", metaKey: true });

    await waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith("edit-token", "changed"),
    );
  });

  it("keeps a truncated file read-only", async () => {
    installAPI({ truncated: true });
    renderViewer();

    const editor = await screen.findByRole("textbox", {
      name: "mock-code-editor",
    });
    expect(editor).toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "chat.worktree.edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("chat.worktree.fileTruncatedWarning"),
    ).toBeInTheDocument();
  });

  it("does not close a dirty tab when discard is declined", async () => {
    installAPI();
    const onCloseFile = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderViewer(onCloseFile);

    fireEvent.click(
      await screen.findByRole("button", { name: "chat.worktree.edit" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "mock-code-editor" }),
      { target: { value: "unsaved" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "chat.worktree.closeFile app.ts" }),
    );

    expect(window.confirm).toHaveBeenCalled();
    expect(onCloseFile).not.toHaveBeenCalled();
  });

  it("surfaces stale-save conflicts without losing the draft", async () => {
    installAPI({ saveResult: { success: false, error: "stale" } });
    renderViewer();

    fireEvent.click(
      await screen.findByRole("button", { name: "chat.worktree.edit" }),
    );
    const editor = screen.getByRole("textbox", {
      name: "mock-code-editor",
    });
    fireEvent.change(editor, { target: { value: "my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.worktree.save" }));

    expect(
      await screen.findByText("chat.worktree.staleFile"),
    ).toBeInTheDocument();
    expect(editor).toHaveValue("my draft");
  });
});
