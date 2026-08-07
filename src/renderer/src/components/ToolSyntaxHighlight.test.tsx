import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  detectToolCodeLanguage,
  ToolSyntaxHighlight,
} from "./ToolSyntaxHighlight";

describe("ToolSyntaxHighlight", () => {
  it("detects common code and data languages", () => {
    expect(detectToolCodeLanguage('{"name":"Hermes","enabled":true}')).toBe(
      "json",
    );
    expect(detectToolCodeLanguage("def greet(name):\n    return name")).toBe(
      "python",
    );
    expect(detectToolCodeLanguage("const answer = () => 42;")).toBe(
      "javascript",
    );
    expect(
      detectToolCodeLanguage(
        "interface User { id: string }\nconst user: User = { id: '1' };",
      ),
    ).toBe("typescript");
  });

  it("leaves ordinary command output as plain text", () => {
    expect(
      detectToolCodeLanguage("Build completed successfully in 2.4 seconds"),
    ).toBeNull();
  });

  it("colors JSON tool payloads with Prism tokens", async () => {
    const { container } = render(
      <ToolSyntaxHighlight source={'{"command":"pwd","active":true}'} />,
    );

    await waitFor(() =>
      expect(container.querySelector(".token")).not.toBeNull(),
    );
    const tokens = [...container.querySelectorAll<HTMLElement>(".token")];
    expect(tokens.length).toBeGreaterThan(2);
    expect(
      new Set(tokens.map((token) => token.style.color)).size,
    ).toBeGreaterThan(1);
  });
});
