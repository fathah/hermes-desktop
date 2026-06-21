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

function renderInput(): {
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

describe("ChatInput — Enter shortcut variants", () => {
  it("submits on plain Enter", () => {
    const { onSubmit, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("hello", []);
  });

  it("does not submit on Shift+Enter (newline)", () => {
    const { onSubmit, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits on Ctrl+Enter", () => {
    const { onSubmit, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith("hello", []);
  });

  it("submits on Cmd+Enter (macOS)", () => {
    const { onSubmit, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith("hello", []);
  });
});
