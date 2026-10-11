import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { ChatInput, type ChatInputHandle } from "./ChatInput";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("border-beam", () => ({ BorderBeam: () => null }));

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  return {
    promise: new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
    resolve,
    reject,
  };
}

function fixture(onSubmit: () => Promise<void>): {
  input: HTMLTextAreaElement;
  ref: React.RefObject<ChatInputHandle | null>;
} {
  const ref = createRef<ChatInputHandle>();
  render(
    <ChatInput
      ref={ref}
      isLoading={false}
      hasSession
      onSubmit={onSubmit}
      onQuickAsk={onSubmit}
      onAbort={vi.fn()}
    />,
  );
  return {
    ref,
    input: screen.getByPlaceholderText(
      "chat.typeMessage",
    ) as HTMLTextAreaElement,
  };
}

async function attach(
  ref: React.RefObject<ChatInputHandle | null>,
  name: string,
): Promise<void> {
  await act(async () => {
    await ref.current!.addFiles([
      new File(["file payload"], name, { type: "text/plain" }),
    ]);
  });
}

// @lat: [[chat-input#Submission acknowledgement#Refusal preserves text and attachments]]
it.each(["Send", "Quick Ask"])(
  "preserves the exact draft and staged attachment after %s refusal",
  async (kind) => {
    const pending = deferred();
    const submit = vi.fn(() => pending.promise);
    const { input, ref } = fixture(submit);
    fireEvent.change(input, { target: { value: "  original draft  " } });
    await attach(ref, "original.txt");
    fireEvent.click(
      screen.getByTitle(kind === "Send" ? "chat.send" : "chat.quickAskTitle"),
    );
    expect(input).toHaveValue("  original draft  ");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("authority changed")));
    expect(input).toHaveValue("  original draft  ");
    expect(
      screen.getByRole("button", { name: "Remove original.txt" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("authority changed");
    expect(screen.getByTitle("chat.send")).not.toBeDisabled();
  },
);

// @lat: [[chat-input#Submission acknowledgement#Accepted snapshots preserve newer drafts]]
it("clears only acknowledged attachments without erasing a newer draft or file", async () => {
  const pending = deferred();
  const { input, ref } = fixture(() => pending.promise);
  fireEvent.change(input, { target: { value: "submitted" } });
  await attach(ref, "submitted.txt");
  fireEvent.click(screen.getByTitle("chat.send"));
  fireEvent.change(input, { target: { value: "newer draft" } });
  await attach(ref, "newer.txt");
  await act(async () => pending.resolve());
  expect(input).toHaveValue("newer draft");
  expect(
    screen.queryByRole("button", { name: "Remove submitted.txt" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Remove newer.txt" })).toBeTruthy();
});

it("preserves a retyped identical draft after a delayed acknowledgement", async () => {
  const pending = deferred();
  const { input } = fixture(() => pending.promise);
  fireEvent.change(input, { target: { value: "same text" } });
  fireEvent.click(screen.getByTitle("chat.send"));
  fireEvent.change(input, { target: { value: "edited" } });
  fireEvent.change(input, { target: { value: "same text" } });
  await act(async () => pending.resolve());
  expect(input).toHaveValue("same text");
});

it("keeps a rejected slash palette draft instead of treating the command as accepted", async () => {
  const pending = deferred();
  const { input } = fixture(() => pending.promise);
  fireEvent.change(input, { target: { value: "/help" } });
  fireEvent.click(screen.getByRole("option", { name: /help/i }));
  await act(async () => pending.reject(new Error("command authority changed")));
  expect(input).toHaveValue("/help");
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "command authority changed",
    ),
  );
});

it("does not clear a fresh composer after an imperative reset during pending acceptance", async () => {
  const pending = deferred();
  const { input, ref } = fixture(() => pending.promise);
  fireEvent.change(input, { target: { value: "same text" } });
  fireEvent.click(screen.getByTitle("chat.send"));
  act(() => {
    ref.current!.clear();
  });
  fireEvent.change(input, { target: { value: "same text" } });
  await act(async () => pending.resolve());
  expect(input).toHaveValue("same text");
});
