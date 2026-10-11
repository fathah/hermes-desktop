import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import { useChatActions } from "./useChatActions";
import { createSlashCatalog } from "../slash/commandCatalog";
import type { ActiveTurn, ChatMessage } from "../types";

function fixture(
  authorizeSend: () => Promise<boolean>,
  sendViaDashboard?: (text: string) => Promise<boolean>,
): ReturnType<
  typeof renderHook<
    {
      actions: ReturnType<typeof useChatActions>;
      messages: ChatMessage[];
      loading: boolean;
      turn: React.MutableRefObject<ActiveTurn | null>;
    },
    unknown
  >
> & { legacy: ReturnType<typeof vi.fn> } {
  const legacy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { sendMessage: legacy },
  });
  return {
    ...renderHook(() => {
      const [messages, setMessages] = useState<ChatMessage[]>([]);
      const [loading, setIsLoading] = useState(false);
      const turn = useRef<ActiveTurn | null>(null);
      const actions = useChatActions({
        authorizeSend,
        runId: "run",
        connectionId: "a",
        profile: "work",
        hermesSessionId: "saved",
        messages,
        isLoading: loading,
        setIsLoading,
        setMessages,
        chatInputRef: useRef(null),
        localCommands: { executeLocal: vi.fn().mockResolvedValue(false) },
        slashCatalog: createSlashCatalog({}),
        activeTurnRef: turn,
        contextFolder: null,
        sendViaDashboard,
      });
      return { actions, messages, loading, turn };
    }),
    legacy,
  };
}

// @lat: [[remote-profiles#Tests#Refused action admission has no side effects]]
it.each(["handleSend", "handleQuickAsk", "handleBackground"] as const)(
  "rejects %s before rendering or dispatching a refused prompt",
  async (method) => {
    const { result, legacy } = fixture(vi.fn().mockResolvedValue(false));
    await act(async () => {
      await expect(
        result.current.actions[method]("keep payload"),
      ).rejects.toThrow("Connection settings changed");
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(legacy).not.toHaveBeenCalled();
  },
);

it("rejects a refused false-Dashboard fallback and settles the admitted turn without Legacy dispatch", async () => {
  const authorize = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const { result, legacy } = fixture(
    authorize,
    vi.fn().mockResolvedValue(false),
  );
  await act(async () => {
    await expect(
      result.current.actions.handleSend("keep payload"),
    ).rejects.toThrow("Connection settings changed");
  });
  expect(legacy).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
  expect(result.current.turn.current).toBeNull();
  expect(
    result.current.messages.some(
      (message) =>
        "error" in message &&
        message.error?.includes("Connection settings changed"),
    ),
  ).toBe(true);
});

// @lat: [[remote-profiles#Tests#Handled transport admission remains accepted]]
it("does not turn an already handled native submission into an unsent retry", async () => {
  const authorize = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const native = vi.fn().mockResolvedValue(true);
  const { result, legacy } = fixture(authorize, native);
  await act(async () => {
    await result.current.actions.handleSend("accepted");
  });
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(native).toHaveBeenCalledWith("accepted", undefined);
  expect(legacy).not.toHaveBeenCalled();
});

it("acknowledges Legacy dispatch without waiting for the full streamed reply", async () => {
  const { result, legacy } = fixture(vi.fn().mockResolvedValue(true));
  legacy.mockReturnValue(new Promise<void>(() => {}));
  await act(async () => {
    await result.current.actions.handleSend("accepted");
  });
  expect(legacy).toHaveBeenCalledWith(
    "accepted",
    "work",
    "saved",
    expect.anything(),
    undefined,
    undefined,
    "run",
    undefined,
    "a",
  );
  expect(result.current.loading).toBe(true);
});

it("admits only one plain prompt when simultaneous submissions resume after authority capture", async () => {
  let resolve!: (value: boolean) => void;
  const pending = new Promise<boolean>((done) => {
    resolve = done;
  });
  const native = vi.fn().mockResolvedValue(true);
  const { result } = fixture(() => pending, native);
  const first = result.current.actions.handleSend("first");
  const second = result.current.actions.handleSend("second");
  await act(async () => {
    resolve(true);
    await first;
    await expect(second).rejects.toThrow("still busy");
  });
  expect(native).toHaveBeenCalledTimes(1);
  expect(native).toHaveBeenCalledWith("first", undefined);
});
