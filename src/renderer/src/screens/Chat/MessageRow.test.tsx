import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import { MessageRow } from "./MessageRow";

const copyToClipboard = vi.fn(async () => undefined);

describe("MessageRow user Markdown", () => {
  beforeEach(() => {
    copyToClipboard.mockClear();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        copyToClipboard,
        openExternal: vi.fn(),
      },
    });
  });

  it("renders sent Markdown while copying its original source", async () => {
    const source = [
      "## Context",
      "",
      "- First requirement",
      "- Second requirement",
      "",
      "| Name | Value |",
      "|---|---|",
      "| Hermes | One |",
    ].join("\n");

    render(
      <I18nProvider>
        <MessageRow
          msg={{ id: "user-1", role: "user", content: source }}
          isLast
          isLoading={false}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Context", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(copyToClipboard).toHaveBeenCalledWith(source);
  });
});
