import { createRef, type ComponentProps, type Ref } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput, type ChatInputHandle } from "./ChatInput";

vi.mock("./hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    supported: false,
    hasKey: false,
    recording: false,
    busy: false,
    error: null,
    toggle: vi.fn(),
  }),
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

describe("ChatInput textarea resize", () => {
  let scrollHeight = 24;

  beforeEach(() => {
    scrollHeight = 24;
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
  });

  function renderInput(
    overrides: Partial<ComponentProps<typeof ChatInput>> = {},
    ref?: Ref<ChatInputHandle>,
  ): void {
    render(
      <ChatInput
        ref={ref}
        isLoading={false}
        hasSession={true}
        readiness={{ ok: true }}
        onSubmit={vi.fn()}
        onQuickAsk={vi.fn()}
        onAbort={vi.fn()}
        {...overrides}
      />,
    );
  }

  it("resizes once from committed textarea value and caps at 120px", () => {
    renderInput();

    const textarea = screen.getByPlaceholderText("chat.typeMessage");
    expect(textarea).toHaveStyle({ height: "24px" });

    scrollHeight = 300;
    fireEvent.change(textarea, { target: { value: "a taller draft" } });

    expect(textarea).toHaveValue("a taller draft");
    expect(textarea).toHaveStyle({ height: "120px" });
  });

  it("routes imperative setText through the same resize owner", () => {
    const ref = createRef<ChatInputHandle>();
    renderInput({}, ref);

    const textarea = screen.getByPlaceholderText("chat.typeMessage");
    scrollHeight = 88;

    act(() => {
      ref.current?.setText("prefilled prompt");
    });

    expect(textarea).toHaveValue("prefilled prompt");
    expect(textarea).toHaveStyle({ height: "88px" });
  });

  it("submits trimmed text and clears the composer", () => {
    const onSubmit = vi.fn();
    renderInput({ onSubmit });

    const textarea = screen.getByPlaceholderText("chat.typeMessage");
    fireEvent.change(textarea, { target: { value: "  ship it  " } });
    scrollHeight = 24;
    fireEvent.click(screen.getByTitle("chat.send"));

    expect(onSubmit).toHaveBeenCalledWith("ship it", []);
    expect(textarea).toHaveValue("");
    expect(textarea).toHaveStyle({ height: "24px" });
  });
});
