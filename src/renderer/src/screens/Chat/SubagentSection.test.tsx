import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The section pulls its copy through useI18n, which needs the i18next provider.
// Stub it: the keys are irrelevant to the rendering behaviour under test.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

import { SubagentSection } from "./SubagentSection";
import {
  applySubagentEvent,
  resetSubagents,
  type SubagentControls,
} from "./subagents";

const SESSION = "20260926_011025_98eb58";

function makeControls(
  overrides: Partial<SubagentControls> = {},
): SubagentControls {
  return {
    interrupt: vi.fn().mockResolvedValue({ found: true }),
    list: vi.fn().mockResolvedValue([]),
    steer: vi.fn().mockResolvedValue({ status: "queued" }),
    tail: vi.fn().mockResolvedValue({
      available: true,
      text: "child output line",
      truncated: false,
    }),
    ...overrides,
  };
}

function startChild(id = "sub-1", goal = "Audit the auth module"): void {
  applySubagentEvent(SESSION, {
    payload: { goal, subagent_id: id },
    type: "subagent.start",
  });
}

afterEach(() => {
  resetSubagents();
});

describe("SubagentSection", () => {
  // @lat: [[subagents#Recovery regressions#Control state isolation]]
  it("drops expanded controls, drafts and late results when the conversation scope changes", async () => {
    let finishSteer!: (value: { status: string }) => void;
    let finishTail!: (value: {
      available: boolean;
      text: string;
      truncated: boolean;
    }) => void;
    const oldControls = makeControls({
      steer: vi.fn(
        () =>
          new Promise<{ status: string }>((resolve) => {
            finishSteer = resolve;
          }),
      ),
      tail: vi.fn(
        () =>
          new Promise<{ available: boolean; text: string; truncated: boolean }>(
            (resolve) => {
              finishTail = resolve;
            },
          ),
      ),
    });
    const nextControls = makeControls();
    startChild();
    applySubagentEvent("other-scope", {
      type: "subagent.start",
      payload: { subagent_id: "sub-1", goal: "Other server child" },
    });
    const view = render(
      <SubagentSection controls={oldControls} sessionId={SESSION} />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.change(screen.getByLabelText("chat.subagents.steerPlaceholder"), {
      target: { value: "Old server draft" },
    });
    fireEvent.submit(screen.getByText("chat.subagents.steer").closest("form")!);
    await waitFor(() =>
      expect(oldControls.steer).toHaveBeenCalledWith(
        "sub-1",
        "Old server draft",
      ),
    );
    view.rerender(
      <SubagentSection controls={nextControls} sessionId="other-scope" />,
    );
    expect(
      screen.queryByLabelText("chat.subagents.steerPlaceholder"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await screen.findByText("child output line");
    expect(
      screen.getByLabelText("chat.subagents.steerPlaceholder"),
    ).toHaveValue("");
    await act(async () => {
      finishSteer({ status: "queued" });
      finishTail({
        available: true,
        text: "Old server transcript",
        truncated: false,
      });
    });
    expect(screen.queryByText("Old server transcript")).not.toBeInTheDocument();
    expect(
      screen.queryByText("chat.subagents.steerQueued"),
    ).not.toBeInTheDocument();
    expect(nextControls.steer).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("chat.subagents.steerPlaceholder"), {
      target: { value: "New server draft" },
    });
    fireEvent.submit(screen.getByText("chat.subagents.steer").closest("form")!);
    await waitFor(() =>
      expect(nextControls.steer).toHaveBeenCalledWith(
        "sub-1",
        "New server draft",
      ),
    );
  });

  it("renders nothing while the session has no children", () => {
    const { container } = render(
      <SubagentSection controls={makeControls()} sessionId={SESSION} />,
    );

    expect(container.querySelector(".subagent-section")).toBeNull();
  });

  it("renders nothing for finished children", () => {
    startChild();
    applySubagentEvent(SESSION, {
      payload: { status: "completed", subagent_id: "sub-1", summary: "Done" },
      type: "subagent.complete",
    });

    const { container } = render(
      <SubagentSection controls={makeControls()} sessionId={SESSION} />,
    );

    expect(container.querySelector(".subagent-section")).toBeNull();
  });

  it("renders a live child with its goal and latest activity", () => {
    startChild();
    applySubagentEvent(SESSION, {
      payload: { subagent_id: "sub-1", text: "reading src/auth.ts" },
      type: "subagent.progress",
    });

    render(<SubagentSection controls={makeControls()} sessionId={SESSION} />);

    expect(screen.getByText("Audit the auth module")).toBeInTheDocument();
    expect(screen.getByText("reading src/auth.ts")).toBeInTheDocument();
  });

  it("shows the queued state for a child that has not started yet", () => {
    startChild("sub-2", "Waiting worker");
    applySubagentEvent(SESSION, {
      payload: { status: "queued", subagent_id: "sub-2" },
      type: "subagent.progress",
    });

    render(<SubagentSection controls={makeControls()} sessionId={SESSION} />);

    expect(screen.getByText("chat.subagents.queued")).toBeInTheDocument();
  });

  it("expands a row into its stream, controls and live transcript", async () => {
    const controls = makeControls();
    startChild();
    applySubagentEvent(SESSION, {
      payload: { subagent_id: "sub-1", text: "reading src/auth.ts" },
      type: "subagent.progress",
    });

    const { container } = render(
      <SubagentSection controls={controls} sessionId={SESSION} />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    const streamed = container.querySelectorAll(".subagent-stream-entry");
    expect(streamed).toHaveLength(1);
    expect(streamed[0]).toHaveTextContent("reading src/auth.ts");
    expect(screen.getByText("chat.subagents.steer")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("child output line")).toBeInTheDocument(),
    );
    expect(controls.tail).toHaveBeenCalledWith("sub-1");
  });

  it("steers a child with the trimmed draft and clears it", async () => {
    const controls = makeControls();
    startChild();
    render(<SubagentSection controls={controls} sessionId={SESSION} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    const input = screen.getByLabelText("chat.subagents.steerPlaceholder");
    fireEvent.change(input, { target: { value: "  check the null case  " } });
    fireEvent.submit(screen.getByText("chat.subagents.steer").closest("form")!);

    await waitFor(() =>
      expect(controls.steer).toHaveBeenCalledWith(
        "sub-1",
        "check the null case",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "chat.subagents.steerQueued",
      ),
    );
    expect(input).toHaveValue("");
  });

  it("reports a rejected steer instead of pretending it landed", async () => {
    const controls = makeControls({
      steer: vi.fn().mockResolvedValue({ status: "rejected" }),
    });
    startChild();
    render(<SubagentSection controls={controls} sessionId={SESSION} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    fireEvent.change(screen.getByLabelText("chat.subagents.steerPlaceholder"), {
      target: { value: "hurry up" },
    });
    fireEvent.submit(screen.getByText("chat.subagents.steer").closest("form")!);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "chat.subagents.requestRejected",
      ),
    );
  });

  it("stops a child through the interrupt RPC", async () => {
    const controls = makeControls();
    startChild();
    render(<SubagentSection controls={controls} sessionId={SESSION} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    fireEvent.click(screen.getByText("chat.subagents.stop"));

    await waitFor(() =>
      expect(controls.interrupt).toHaveBeenCalledWith("sub-1"),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "chat.subagents.stopRequested",
      ),
    );
  });

  it("hydrates children from the roster RPC", async () => {
    const controls = makeControls({
      list: vi.fn().mockResolvedValue([
        {
          goal: "Recovered child",
          last_tool: "read_file",
          status: "running",
          subagent_id: "sub-9",
        },
      ]),
    });

    render(<SubagentSection controls={controls} sessionId={SESSION} />);

    await waitFor(() =>
      expect(screen.getByText("Recovered child")).toBeInTheDocument(),
    );
    expect(controls.list).toHaveBeenCalled();
  });

  it("keeps the event-fed view when the roster RPC is unavailable", async () => {
    const controls = makeControls({
      list: vi.fn().mockRejectedValue(new Error("method not found")),
    });
    startChild();

    render(<SubagentSection controls={controls} sessionId={SESSION} />);

    await waitFor(() => expect(controls.list).toHaveBeenCalled());
    expect(screen.getByText("Audit the auth module")).toBeInTheDocument();
  });

  it("renders without any controls when the transport is disabled", () => {
    startChild();

    render(<SubagentSection controls={null} sessionId={SESSION} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("Audit the auth module")).toBeInTheDocument();
    expect(screen.queryByText("chat.subagents.steer")).toBeNull();
  });
});
