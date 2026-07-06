import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ChatInput pulls translations through useI18n (which requires the i18next
// provider). Stub it so the component can render in isolation; the keys are
// irrelevant to keyboard behavior.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

import { ChatInput } from "./ChatInput";

afterEach(cleanup);

function renderInput(
  slashCommands?: React.ComponentProps<typeof ChatInput>["slashCommands"],
): {
  onSubmit: ReturnType<typeof vi.fn>;
  textarea: HTMLTextAreaElement;
} {
  const onSubmit = vi.fn();
  render(
    <ChatInput
      isLoading={false}
      hasSession={true}
      onSubmit={onSubmit}
      onQuickAsk={vi.fn()}
      onAbort={vi.fn()}
      slashCommands={slashCommands}
    />,
  );
  const textarea = screen.getByPlaceholderText(
    "chat.typeMessage",
  ) as HTMLTextAreaElement;
  return { onSubmit, textarea };
}

describe("ChatInput — CJK IME Enter handling", () => {
  // Repro: typing Korean (or any CJK IME), the final syllable stays in
  // composition. macOS Chromium can deliver the finalizing Enter as a plain
  // keydown (isComposing=false, keyCode=13) before compositionend commits the
  // last syllable, so submitting on that keydown sends a truncated message.
  it("does not submit while an IME composition is still active", () => {
    const { onSubmit, textarea } = renderInput();

    fireEvent.compositionStart(textarea);
    // State only holds what was committed so far — last syllable not yet in.
    fireEvent.change(textarea, { target: { value: "안녕하세" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    // Must not fire — otherwise the truncated "안녕하세" goes out.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the full text after composition ends", () => {
    const { onSubmit, textarea } = renderInput();

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "안녕하세" } });
    fireEvent.keyDown(textarea, { key: "Enter" }); // swallowed: still composing

    // compositionend commits the last syllable; React flushes the full value.
    fireEvent.compositionEnd(textarea, { target: { value: "안녕하세요" } });
    fireEvent.change(textarea, { target: { value: "안녕하세요" } });
    fireEvent.keyDown(textarea, { key: "Enter" }); // now a real submit

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("안녕하세요", []);
  });
});

describe("ChatInput — slash command palette", () => {
  it("opens on slash and filters commands while typing", () => {
    const { textarea } = renderInput();

    fireEvent.change(textarea, { target: { value: "/" } });
    expect(
      screen.getByRole("dialog", { name: "chat.commandsTitle" }),
    ).toBeTruthy();
    expect(screen.getByText("agents")).toBeTruthy();

    fireEvent.change(textarea, { target: { value: "/lea" } });
    expect(screen.getByText("learn")).toBeTruthy();
    expect(screen.queryByText("agents")).toBeNull();
  });

  it("closes with Escape from anywhere in the modal while keeping the draft", () => {
    const { textarea } = renderInput();

    fireEvent.change(textarea, { target: { value: "/lea" } });
    const option = screen.getByRole("option", { name: /learn/i });
    option.focus();
    fireEvent.keyDown(option, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(textarea.value).toBe("/lea");
    expect(document.activeElement).toBe(textarea);
  });

  it("virtualizes large command catalogs", () => {
    const commands = Array.from({ length: 1_000 }, (_, index) => ({
      name: `/command-${index}`,
      description: `Command ${index}`,
      category: "agent" as const,
    }));
    const { textarea } = renderInput(commands);

    fireEvent.change(textarea, { target: { value: "/" } });

    expect(screen.getByText("1000 commands")).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBeLessThan(30);
    expect(screen.getByText("command-0")).toBeTruthy();
    expect(screen.queryByText("command-999")).toBeNull();

    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(screen.getByText("command-999")).toBeTruthy();
    expect(screen.queryByText("command-0")).toBeNull();
  });
});
