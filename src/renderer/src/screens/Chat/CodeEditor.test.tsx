import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodeEditor, languageIdForFile } from "./CodeEditor";

describe("languageIdForFile", () => {
  it.each([
    ["app.ts", "typescript"],
    ["component.tsx", "tsx"],
    ["script.jsx", "jsx"],
    ["settings.jsonc", "json"],
    ["styles.scss", "css"],
    ["index.html", "html"],
    ["README.md", "markdown"],
    ["worker.py", "python"],
    ["Makefile", "plain"],
  ] as const)("maps %s to %s", (fileName, language) => {
    expect(languageIdForFile(fileName)).toBe(language);
  });
});

describe("CodeEditor", () => {
  it("renders a line-numbered editor and handles the save shortcut", () => {
    const onSave = vi.fn();
    const { container } = render(
      <CodeEditor
        value={"const answer = 42;\n"}
        fileName="answer.ts"
        onChange={() => {}}
        onSave={onSave}
      />,
    );

    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
    const editor = container.querySelector(".cm-content");
    expect(editor).not.toBeNull();
    fireEvent.keyDown(editor as Element, { key: "s", ctrlKey: true });
    expect(onSave).toHaveBeenCalledOnce();
  });
});
