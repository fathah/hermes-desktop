import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub i18n so the card renders in isolation; keys come back verbatim.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

import { ClarifyCard } from "./ClarifyCard";
import type { ClarifyMessage } from "./types";

afterEach(cleanup);

function stubRespond(): ReturnType<typeof vi.fn> {
  const respondClarify = vi.fn().mockResolvedValue(true);
  (window as unknown as { hermesAPI: unknown }).hermesAPI = { respondClarify };
  return respondClarify;
}

function baseMsg(overrides: Partial<ClarifyMessage> = {}): ClarifyMessage {
  return {
    id: "clarify-r1",
    kind: "clarify",
    role: "agent",
    requestId: "r1",
    question: "Which environment?",
    choices: [],
    ...overrides,
  };
}

describe("ClarifyCard", () => {
  it("renders one button per choice and answers with the clicked choice", async () => {
    const respondClarify = stubRespond();
    const onResolved = vi.fn();
    render(
      <ClarifyCard
        msg={baseMsg({ choices: ["staging", "production"] })}
        onResolved={onResolved}
      />,
    );

    fireEvent.click(screen.getByText("production"));

    expect(respondClarify).toHaveBeenCalledWith("r1", "production");
    // onResolved runs in the submit's finally, after the awaited respondClarify.
    await vi.waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith("r1", "production"),
    );
  });

  it("answers open-ended questions with the typed text", async () => {
    const respondClarify = stubRespond();
    const onResolved = vi.fn();
    render(<ClarifyCard msg={baseMsg()} onResolved={onResolved} />);

    const textarea = screen.getByPlaceholderText(
      "chat.clarify.placeholder",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "use staging" } });
    fireEvent.click(screen.getByText("chat.clarify.send"));

    expect(respondClarify).toHaveBeenCalledWith("r1", "use staging");
    await vi.waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith("r1", "use staging"),
    );
  });

  it("skip sends an empty answer (autonomous proceed)", async () => {
    const respondClarify = stubRespond();
    const onResolved = vi.fn();
    render(<ClarifyCard msg={baseMsg()} onResolved={onResolved} />);

    fireEvent.click(screen.getByText("chat.clarify.skip"));

    expect(respondClarify).toHaveBeenCalledWith("r1", "");
    await vi.waitFor(() => expect(onResolved).toHaveBeenCalledWith("r1", ""));
  });

  it("does not send for an empty open-ended answer (Send disabled)", () => {
    const respondClarify = stubRespond();
    render(<ClarifyCard msg={baseMsg()} onResolved={vi.fn()} />);

    const send = screen.getByText("chat.clarify.send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(respondClarify).not.toHaveBeenCalled();
  });

  it("a resolved card shows the answer and exposes no controls", () => {
    const respondClarify = stubRespond();
    render(
      <ClarifyCard
        msg={baseMsg({
          choices: ["staging", "production"],
          resolved: true,
          answer: "production",
        })}
        onResolved={vi.fn()}
      />,
    );

    expect(screen.getByText("production")).toBeTruthy();
    // No interactive choice buttons in the resolved state.
    expect(screen.queryByText("staging")).toBeNull();
    expect(screen.queryByText("chat.clarify.skip")).toBeNull();
    expect(respondClarify).not.toHaveBeenCalled();
  });

  it("does not resolve the card when delivery fails (respondClarify -> false)", async () => {
    const respondClarify = vi.fn().mockResolvedValue(false);
    (window as unknown as { hermesAPI: unknown }).hermesAPI = {
      respondClarify,
    };
    const onResolved = vi.fn();
    render(
      <ClarifyCard
        msg={baseMsg({ choices: ["staging", "production"] })}
        onResolved={onResolved}
      />,
    );

    fireEvent.click(screen.getByText("staging"));

    expect(respondClarify).toHaveBeenCalledWith("r1", "staging");
    // No pending request matched → card must NOT be marked answered, and an
    // error must surface so the user can retry.
    await vi.waitFor(() =>
      expect(screen.getByText("chat.clarify.error")).toBeTruthy(),
    );
    expect(onResolved).not.toHaveBeenCalled();
    // Controls remain live for a retry.
    expect(screen.getByText("staging")).toBeTruthy();
  });

  it("does not resolve the card when the IPC call rejects", async () => {
    const respondClarify = vi.fn().mockRejectedValue(new Error("ipc down"));
    (window as unknown as { hermesAPI: unknown }).hermesAPI = {
      respondClarify,
    };
    const onResolved = vi.fn();
    render(<ClarifyCard msg={baseMsg()} onResolved={onResolved} />);

    const textarea = screen.getByPlaceholderText(
      "chat.clarify.placeholder",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "use staging" } });
    fireEvent.click(screen.getByText("chat.clarify.send"));

    await vi.waitFor(() =>
      expect(screen.getByText("chat.clarify.error")).toBeTruthy(),
    );
    expect(onResolved).not.toHaveBeenCalled();
  });
});

// @lat: [[dashboard-clarify#Card transport routing]]
it("renders gateway choices and submits through the supplied transport instead of IPC", async () => {
  const { applyDashboardStreamEvent } = await import("./dashboardEventAdapter");
  const state = applyDashboardStreamEvent(
    { messages: [], reasoningSegmentClosed: false },
    {
      type: "clarify.request",
      payload: {
        request_id: "ws-1",
        question: "Which environment?",
        choices: ["staging", "production"],
      },
    },
  );
  const msg = state.messages[0];
  if (msg.kind !== "clarify")
    throw new Error("Expected an interactive clarification");
  const ipc = stubRespond();
  const respond = vi.fn().mockResolvedValue(true);
  const resolved = vi.fn();
  render(<ClarifyCard msg={msg} onRespond={respond} onResolved={resolved} />);
  fireEvent.click(screen.getByRole("button", { name: "production" }));
  await vi.waitFor(() =>
    expect(resolved).toHaveBeenCalledWith("ws-1", "production"),
  );
  expect(respond).toHaveBeenCalledWith(msg, "production");
  expect(ipc).not.toHaveBeenCalled();
});

// @lat: [[dashboard-clarify#Unavailable card feedback]]
it("disables expired questions and explains that they no longer accept answers", () => {
  const respond = vi.fn();
  render(
    <ClarifyCard
      msg={baseMsg({ unavailable: true, choices: ["staging"] })}
      onRespond={respond}
      onResolved={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "staging" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "chat.clarify.unavailable",
  );
  fireEvent.click(screen.getByRole("button", { name: "staging" }));
  expect(respond).not.toHaveBeenCalled();
});
