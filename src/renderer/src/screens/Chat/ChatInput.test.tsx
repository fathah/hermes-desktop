import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("ChatInput", () => {
  it("passes spellCheck=true to the composer textarea", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        spellCheck={true}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveAttribute("spellcheck", "true");
  });

  it("passes spellCheck=false to the composer textarea", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        spellCheck={false}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveAttribute("spellcheck", "false");
  });
});
