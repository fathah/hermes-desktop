import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatScroll } from "./useChatScroll";
import type { ChatMessage } from "../types";

function bubble(id: string, role: "user" | "agent"): ChatMessage {
  return { id, role, content: id };
}

function ScrollHarness({
  messages,
}: {
  messages: ChatMessage[];
}): React.JSX.Element {
  const { containerRef, bottomRef } = useChatScroll(messages);
  return (
    <div data-testid="container" ref={containerRef}>
      <div ref={bottomRef} data-testid="bottom" />
    </div>
  );
}

describe("useChatScroll", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  function setScrollMetrics(
    container: HTMLElement,
    {
      scrollTop,
      scrollHeight = 1000,
      clientHeight = 300,
    }: {
      scrollTop: number;
      scrollHeight?: number;
      clientHeight?: number;
    },
  ): void {
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: scrollHeight,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: clientHeight,
    });
    container.scrollTop = scrollTop;
    fireEvent.scroll(container);
  }

  it("keeps auto-scrolling agent updates while pinned near the bottom", () => {
    const { getByTestId, rerender } = render(
      <ScrollHarness messages={[bubble("a1", "agent")]} />,
    );
    const container = getByTestId("container");
    scrollIntoView.mockClear();

    setScrollMetrics(container, { scrollTop: 700 });
    rerender(
      <ScrollHarness
        messages={[bubble("a1", "agent"), bubble("a2", "agent")]}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("does not auto-scroll agent updates after the user scrolls up", () => {
    const { getByTestId, rerender } = render(
      <ScrollHarness messages={[bubble("a1", "agent")]} />,
    );
    const container = getByTestId("container");
    scrollIntoView.mockClear();

    setScrollMetrics(container, { scrollTop: 100 });
    rerender(
      <ScrollHarness
        messages={[bubble("a1", "agent"), bubble("a2", "agent")]}
      />,
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("force-scrolls when a new user message is appended", () => {
    const { getByTestId, rerender } = render(
      <ScrollHarness messages={[bubble("a1", "agent")]} />,
    );
    const container = getByTestId("container");
    scrollIntoView.mockClear();

    setScrollMetrics(container, { scrollTop: 100 });
    rerender(
      <ScrollHarness
        messages={[bubble("a1", "agent"), bubble("u1", "user")]}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });
});
