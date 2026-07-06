import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

vi.mock("./useI18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "common.copied": "Copied",
        "common.showMore": "Show more",
        "common.showLess": "Show less",
      })[key] ?? key,
  }),
}));

vi.mock("./MediaImage", () => ({
  MediaImage: () => <div data-testid="media-image" />,
  DownloadChip: () => <div data-testid="download-chip" />,
}));

// Wait until the lazily-imported Prism highlighter has produced token spans,
// so a later "no .token" assertion is meaningful rather than just observing
// the not-yet-loaded fallback.
async function renderHighlighted(
  markdown: string,
): Promise<ReturnType<typeof render>> {
  const view = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
  await waitFor(() =>
    expect(view.container.querySelector(".token")).not.toBeNull(),
  );
  return view;
}

describe("AgentMarkdown", () => {
  it("renders box-drawing tree diagrams as plain text, even with the highlighter loaded", async () => {
    // Control first: prove highlighting works in this environment, and leave
    // the highlighter module loaded so the tree block below would use Prism
    // synchronously if it were ever routed there.
    await renderHighlighted(
      ["```ts", "const answer: number = 42;", "```"].join("\n"),
    );

    const markdown = [
      "```text",
      "project",
      "├── src",
      "│   └── main.ts",
      "└── README.md",
      "```",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    const plain = container.querySelector(".chat-code-plain");

    expect(plain).not.toBeNull();
    expect(plain?.textContent).toContain("├── src");
    expect(plain?.textContent).toContain("│   └── main.ts");
    expect(plain?.textContent).toContain("└── README.md");
    expect(container.querySelector(".token")).toBeNull();
  });

  it("keeps syntax highlighting for code with an incidental box-drawing character", async () => {
    // One │ in a string literal must not demote the whole file to plain text.
    const markdown = [
      "```python",
      'SEPARATOR = "│"',
      "def greet(name):",
      '    return f"hello {name}"',
      "",
      "def main():",
      "    print(greet('world'))",
      "```",
    ].join("\n");

    const { container } = await renderHighlighted(markdown);
    expect(container.querySelector(".chat-code-plain")).toBeNull();
    expect(container.textContent).toContain("│");
  });

  it("keeps the colored diff view for diffs that touch box-drawing content", () => {
    // DiffView never uses Prism, so a patch on a tree diagram must not lose
    // its +/- coloring to the box-diagram plain path.
    const markdown = [
      "```diff",
      "+├── src",
      "-└── lib",
      "+│   └── main.ts",
      "```",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-diff-content")).not.toBeNull();
    expect(container.querySelector(".chat-diff-add")).not.toBeNull();
    expect(container.querySelector(".chat-diff-remove")).not.toBeNull();
    expect(container.querySelector(".chat-code-plain")).toBeNull();
  });

  it("labels an unlabeled box diagram as text but keeps a declared language", () => {
    const bare = render(
      <AgentMarkdown>
        {["```", "├── src", "└── README.md", "```"].join("\n")}
      </AgentMarkdown>,
    );
    expect(bare.container.querySelector(".chat-code-lang")?.textContent).toBe(
      "text",
    );

    const declared = render(
      <AgentMarkdown>
        {["```bash", "├── src", "└── README.md", "```"].join("\n")}
      </AgentMarkdown>,
    );
    expect(
      declared.container.querySelector(".chat-code-lang")?.textContent,
    ).toBe("bash");
    // Box-dominant content still renders plain regardless of the label.
    expect(declared.container.querySelector(".chat-code-plain")).not.toBeNull();
  });
});
