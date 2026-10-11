import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import { ApprovalCard } from "./ApprovalCard";
import type { ApprovalMessage } from "./types";

afterEach(cleanup);

function message(overrides: Partial<ApprovalMessage> = {}): ApprovalMessage {
  return {
    id: "approval-r1",
    kind: "approval",
    role: "agent",
    requestId: "r1",
    responsePath: "ipc",
    command: "rm -rf ./build",
    description: "Remove generated output",
    choices: ["once", "session", "always", "deny"],
    ...overrides,
  };
}

function renderCard(
  msg: ApprovalMessage,
  onRespond = vi.fn(),
  onResolved = vi.fn(),
  isActive = true,
): ReturnType<typeof render> {
  return render(
    <I18nProvider>
      <ApprovalCard
        msg={msg}
        isActive={isActive}
        onRespond={onRespond}
        onResolved={onResolved}
      />
    </I18nProvider>,
  );
}

describe("ApprovalCard", () => {
  it("renders only offered choices and safely renders command text", () => {
    renderCard(
      message({
        command: '<img src=x onerror="alert(1)">',
        choices: ["once", "deny"],
      }),
    );

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(screen.getByText("Allow once")).toBeTruthy();
    expect(screen.getByText("Deny")).toBeTruthy();
    expect(screen.queryByText("Allow for session")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("requires a second explicit confirmation for always", async () => {
    const onRespond = vi.fn().mockResolvedValue(true);
    const onResolved = vi.fn();
    renderCard(message(), onRespond, onResolved);

    fireEvent.click(screen.getByText("Always allow"));
    expect(onRespond).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText("Confirm always allow"));
    });

    await vi.waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith(message(), "always"),
    );
    expect(onResolved).toHaveBeenCalledWith(message(), "always");
  });

  it.each([
    ["returns false", vi.fn().mockResolvedValue(false)],
    ["rejects", vi.fn().mockRejectedValue(new Error("offline"))],
  ])(
    "stays retryable and alerts when response %s",
    async (_case, onRespond) => {
      const onResolved = vi.fn();
      renderCard(message({ choices: ["once"] }), onRespond, onResolved);

      await act(async () => {
        fireEvent.click(screen.getByText("Allow once"));
      });
      await vi.waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(onResolved).not.toHaveBeenCalled();
      expect(
        (screen.getByText("Allow once") as HTMLButtonElement).disabled,
      ).toBe(false);
    },
  );

  it("renders a resolved card as read-only", () => {
    const onRespond = vi.fn();
    renderCard(message({ resolved: true, choice: "deny" }), onRespond);

    expect(screen.getByText("Deny")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("renders an unavailable card without actions", () => {
    renderCard(message({ unavailable: true }));

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("disables a queued approval until earlier requests resolve", () => {
    renderCard(message(), vi.fn(), vi.fn(), false);

    expect(
      screen.getByText("Resolve the earlier approval request first."),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("button")
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
  });
});
