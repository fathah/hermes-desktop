// ButtonBlock.test.tsx — clicking an agent-action button opens the Assistant
// panel and runs its prompt through the co-author (runAgent + openPanelTab).
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ButtonBlock } from "./ButtonBlock";
import { useStore } from "../store";
import type { Block } from "../types";

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

const block: Block = {
  id: "b1",
  type: "button",
  text: "Run review",
  emoji: "🔎",
  agentPrompt: "Review this against our SOPs.",
};

describe("ButtonBlock", () => {
  it("opens the assistant panel and runs the agentPrompt on click", () => {
    // Stub so the bridge resolves rather than throwing during the async leg.
    (window as unknown as { hermesAPI: unknown }).hermesAPI = {
      spsAssistant: vi.fn().mockResolvedValue({ kind: "chat", reply: ["ok"] }),
    };
    const before = useStore.getState().messages.length;
    const { getByText } = render(
      <ButtonBlock block={block} setType={() => {}} />,
    );

    fireEvent.click(getByText("Run review"));

    const s = useStore.getState();
    expect(s.panelOpen).toBe(true);
    expect(s.rightTab).toBe("assistant");
    expect(s.messages.length).toBe(before + 1);
    expect(JSON.stringify(s.messages.at(-1))).toContain(
      "Review this against our SOPs.",
    );
  });

  it("opens the inline editor instead of running when nothing to run", () => {
    // Empty label AND empty prompt ⇒ nothing to send, so surface the editor.
    const { getByText, getByPlaceholderText } = render(
      <ButtonBlock
        block={{ id: "b2", type: "button", text: "", agentPrompt: "" }}
        setType={() => {}}
      />,
    );
    fireEvent.click(getByText("Run"));
    // No prompt ⇒ surfaces the prompt editor rather than firing the agent.
    expect(
      getByPlaceholderText("Prompt to run against the co-author…"),
    ).toBeTruthy();
  });
});
