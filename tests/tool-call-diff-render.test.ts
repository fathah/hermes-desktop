import { describe, it, expect } from "vitest";
import { parseFileEditToolCall } from "../src/renderer/src/screens/Chat/toolEditParse";

describe("parseFileEditToolCall", () => {
  it("parses write_file into an all-new diff (old is empty)", () => {
    const edit = parseFileEditToolCall(
      "write_file",
      JSON.stringify({ path: "src/a.ts", content: "line1\nline2\n" }),
    );
    expect(edit).toEqual({
      fileName: "src/a.ts",
      oldText: "",
      newText: "line1\nline2\n",
    });
  });

  it("parses edit_file with old_text/new_text", () => {
    const edit = parseFileEditToolCall(
      "edit_file",
      JSON.stringify({
        path: "src/b.ts",
        old_text: "foo",
        new_text: "bar",
      }),
    );
    expect(edit).toEqual({
      fileName: "src/b.ts",
      oldText: "foo",
      newText: "bar",
    });
  });

  it("accepts old_string/new_string aliases and the `file` field", () => {
    const edit = parseFileEditToolCall(
      "str_replace",
      JSON.stringify({ file: "x.py", old_string: "a", new_string: "b" }),
    );
    expect(edit).toEqual({ fileName: "x.py", oldText: "a", newText: "b" });
  });

  it("is case-insensitive on the tool name", () => {
    expect(
      parseFileEditToolCall(
        "WRITE_FILE",
        JSON.stringify({ path: "p", content: "c" }),
      ),
    ).not.toBeNull();
  });

  it("returns null for non-file tools", () => {
    expect(
      parseFileEditToolCall("web_search", JSON.stringify({ query: "x" })),
    ).toBeNull();
    expect(
      parseFileEditToolCall("terminal", JSON.stringify({ command: "ls" })),
    ).toBeNull();
  });

  it("returns null for malformed args or missing fields", () => {
    expect(parseFileEditToolCall("write_file", "not json")).toBeNull();
    expect(
      parseFileEditToolCall("write_file", JSON.stringify({ path: "p" })),
    ).toBeNull(); // no content
    expect(
      parseFileEditToolCall(
        "edit_file",
        JSON.stringify({ path: "p", old_text: "a" }),
      ),
    ).toBeNull(); // no new_text
  });

  it("tolerates a missing file name", () => {
    const edit = parseFileEditToolCall(
      "write_file",
      JSON.stringify({ content: "hi" }),
    );
    expect(edit).toEqual({ fileName: undefined, oldText: "", newText: "hi" });
  });
});
