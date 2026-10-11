import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/common/ProfileAvatar", () => ({
  default: () => null,
}));
vi.mock("../../components/OrbLoader", () => ({ OrbLoader: () => null }));
vi.mock("../../components/AgentMarkdown", () => ({
  AgentMarkdown: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock("../../components/AttachmentChip", () => ({
  AttachmentChip: () => null,
}));
vi.mock("../../components/MediaImage", () => ({
  MediaSegmentView: () => null,
}));
import { MessageRow } from "./MessageRow";
import { stopSpeechPlayback } from "./speech-playback";
import type { ChatMessage } from "./types";
import type { SynthesizedSpeech } from "../../../../shared/minimax-speech";
const callbacks = new Set<() => void>();
const clips: FakeAudio[] = [];
class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
  constructor(readonly src: string) {
    clips.push(this);
  }
}
const audioResult: SynthesizedSpeech = {
  audio: new Uint8Array([1, 2]),
  mimeType: "audio/mpeg",
};
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function row(
  id = "1",
  profile = "work",
  connectionId = "A",
  enabled = true,
  content = `message-${id}`,
): React.JSX.Element {
  return (
    <MessageRow
      msg={
        {
          id,
          role: "agent",
          kind: "assistant",
          content,
        } as ChatMessage
      }
      isLast={false}
      isLoading={false}
      onApprove={vi.fn()}
      onDeny={vi.fn()}
      profile={profile}
      connectionId={connectionId}
      speechEnabled={enabled}
    />
  );
}
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  clips.length = 0;
  callbacks.clear();
  vi.stubGlobal("Audio", FakeAudio);
  URL.createObjectURL = vi
    .fn()
    .mockImplementation(() => `blob:${clips.length}`);
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getProviderRequestTarget: vi.fn().mockResolvedValue({
        connectionId: "A",
        mode: "local",
        revision: "revision-a",
      }),
      synthesizeSpeech: vi.fn().mockResolvedValue(audioResult),
      cancelSpeech: vi.fn().mockResolvedValue(true),
      onConnectionConfigChanged: vi.fn((callback: () => void) => {
        callbacks.add(callback);
        return () => {
          callbacks.delete(callback);
        };
      }),
      copyToClipboard: vi.fn(),
    },
  });
});
afterEach(() => {
  cleanup();
  stopSpeechPlayback();
  vi.unstubAllGlobals();
});

// @lat: [[speech-playback-tests#Two rendered rows share playback]]
it("starting a second real message row stops the first audio and uses one selected-profile owner", async () => {
  const view = render(
    <>
      {row("1")}
      {row("2")}
    </>,
  );
  fireEvent.click(screen.getAllByLabelText("chat.listen")[0]);
  await settle();
  expect(clips).toHaveLength(1);
  expect(screen.getByLabelText("chat.listenStop")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("chat.listen"));
  await settle();
  expect(clips).toHaveLength(2);
  expect(clips[0].pause).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:0");
  expect(window.hermesAPI.synthesizeSpeech).toHaveBeenLastCalledWith(
    expect.objectContaining({
      text: "message-2",
      profile: "work",
      target: expect.objectContaining({ connectionId: "A" }),
    }),
  );
  expect(
    view.container.querySelectorAll('[aria-label="chat.listenStop"]'),
  ).toHaveLength(1);
});

// @lat: [[speech-playback-tests#Superseded synthesis reply]]
it("late synthesis from the first row cannot create audio or stop the newer row", async () => {
  const first = deferred<SynthesizedSpeech>();
  vi.mocked(window.hermesAPI.synthesizeSpeech).mockReturnValueOnce(
    first.promise,
  );
  render(
    <>
      {row("1")}
      {row("2")}
    </>,
  );
  fireEvent.click(screen.getAllByLabelText("chat.listen")[0]);
  await settle();
  const firstRequest = vi.mocked(window.hermesAPI.synthesizeSpeech).mock
    .calls[0][0];
  fireEvent.click(screen.getByLabelText("chat.listen"));
  await settle();
  expect(window.hermesAPI.cancelSpeech).toHaveBeenCalledWith(
    firstRequest.requestId,
  );
  first.resolve(audioResult);
  await settle();
  expect(clips).toHaveLength(1);
  expect(clips[0].pause).not.toHaveBeenCalled();
  expect(screen.getByLabelText("chat.listenStop")).toBeInTheDocument();
});

// @lat: [[speech-playback-tests#Stop cancels loading]]
it("Stop during synthesis sends its exact cancellation ID and ignores late audio", async () => {
  const pending = deferred<SynthesizedSpeech>();
  vi.mocked(window.hermesAPI.synthesizeSpeech).mockReturnValue(pending.promise);
  render(row());
  fireEvent.click(screen.getByLabelText("chat.listen"));
  await settle();
  const request = vi.mocked(window.hermesAPI.synthesizeSpeech).mock.calls[0][0];
  fireEvent.click(screen.getByLabelText("chat.listenStop"));
  expect(window.hermesAPI.cancelSpeech).toHaveBeenCalledExactlyOnceWith(
    request.requestId,
  );
  pending.resolve(audioResult);
  await settle();
  expect(clips).toHaveLength(0);
  expect(screen.getByLabelText("chat.listen")).toBeInTheDocument();
});

it("Stop while issuing the target cannot dispatch a later synthesis", async () => {
  const target =
    deferred<
      Awaited<ReturnType<typeof window.hermesAPI.getProviderRequestTarget>>
    >();
  vi.mocked(window.hermesAPI.getProviderRequestTarget).mockReturnValue(
    target.promise,
  );
  render(row());
  fireEvent.click(screen.getByLabelText("chat.listen"));
  fireEvent.click(screen.getByLabelText("chat.listenStop"));
  target.resolve({ connectionId: "A", mode: "local", revision: "old" });
  await settle();
  expect(window.hermesAPI.synthesizeSpeech).not.toHaveBeenCalled();
  expect(clips).toHaveLength(0);
});

// @lat: [[speech-playback-tests#Unmount releases audio]]
it("unmount releases playback URL, pauses audio and cancels only its own request", async () => {
  const view = render(row());
  fireEvent.click(screen.getByLabelText("chat.listen"));
  await settle();
  const request = vi.mocked(window.hermesAPI.synthesizeSpeech).mock.calls[0][0];
  view.unmount();
  expect(clips[0].pause).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:0");
  expect(window.hermesAPI.cancelSpeech).toHaveBeenCalledExactlyOnceWith(
    request.requestId,
  );
});

it("unmount during synthesis prevents late playback", async () => {
  const pending = deferred<SynthesizedSpeech>();
  vi.mocked(window.hermesAPI.synthesizeSpeech).mockReturnValue(pending.promise);
  const view = render(row());
  fireEvent.click(screen.getByLabelText("chat.listen"));
  await settle();
  view.unmount();
  pending.resolve(audioResult);
  await settle();
  expect(clips).toHaveLength(0);
});

// @lat: [[speech-playback-tests#Profile and connection lifecycle]]
it.each(["profile", "connection", "config", "remote-mode"])(
  "%s changes invalidate pending synthesis on the real row",
  async (change) => {
    const pending = deferred<SynthesizedSpeech>();
    vi.mocked(window.hermesAPI.synthesizeSpeech).mockReturnValue(
      pending.promise,
    );
    const view = render(row());
    fireEvent.click(screen.getByLabelText("chat.listen"));
    await settle();
    if (change === "config")
      act(() => {
        for (const callback of callbacks) callback();
      });
    else
      view.rerender(
        row(
          "1",
          change === "profile" ? "other" : "work",
          change === "connection" ? "B" : "A",
          change !== "remote-mode",
        ),
      );
    pending.resolve(audioResult);
    await settle();
    expect(clips).toHaveLength(0);
    expect(window.hermesAPI.cancelSpeech).toHaveBeenCalledTimes(1);
  },
);

// @lat: [[speech-playback-tests#Actionable playback errors]]
it("synthesis, Audio error and play rejection are visible and leave a retryable Listen action", async () => {
  vi.mocked(window.hermesAPI.synthesizeSpeech).mockRejectedValueOnce(
    new Error("Configure MINIMAX_API_KEY before generating speech."),
  );
  const view = render(row());
  fireEvent.click(screen.getByLabelText("chat.listen"));
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Configure MINIMAX_API_KEY",
  );
  fireEvent.click(screen.getByLabelText("chat.listen"));
  await settle();
  act(() => clips[0].onerror?.());
  expect(screen.getByRole("alert")).toHaveTextContent("output device");
  expect(clips[0].pause).toHaveBeenCalled();
  vi.stubGlobal(
    "Audio",
    class extends FakeAudio {
      constructor(src: string) {
        super(src);
        this.play.mockRejectedValue(new Error("Output blocked"));
      }
    },
  );
  fireEvent.click(screen.getByLabelText("chat.listen"));
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent("Output blocked");
  expect(within(view.container).getByLabelText("chat.listen")).toBeEnabled();
});

// @lat: [[speech-playback-tests#Late play completion]]
it("a late play promise after Stop cannot revive playback or clear a newer owner", async () => {
  const playing = deferred<void>();
  vi.stubGlobal(
    "Audio",
    class extends FakeAudio {
      constructor(src: string) {
        super(src);
        if (clips.length === 1) this.play.mockReturnValue(playing.promise);
      }
    },
  );
  render(
    <>
      {row("1")}
      {row("2")}
    </>,
  );
  fireEvent.click(screen.getAllByLabelText("chat.listen")[0]);
  await settle();
  const oldEnded = clips[0].onended;
  fireEvent.click(screen.getByLabelText("chat.listenStop"));
  fireEvent.click(screen.getAllByLabelText("chat.listen")[1]);
  await settle();
  playing.resolve();
  await settle();
  act(() => oldEnded?.());
  expect(clips[0].pause).toHaveBeenCalledTimes(2);
  expect(clips[1].pause).not.toHaveBeenCalled();
  expect(screen.getAllByLabelText("chat.listenStop")).toHaveLength(1);
});

it("a Remote target returned during a Local transition never reaches synthesis", async () => {
  vi.mocked(window.hermesAPI.getProviderRequestTarget).mockResolvedValue({
    connectionId: "A",
    mode: "remote",
    revision: "changed",
  });
  render(row());
  fireEvent.click(screen.getByLabelText("chat.listen"));
  await settle();
  expect(window.hermesAPI.synthesizeSpeech).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Local connection");
});

// @lat: [[speech-playback-tests#Visible speech content]]
it.each([
  { content: "A readable reply.", expected: "A readable reply." },
  { content: "Here you go. MEDIA:/tmp/private.png", expected: "Here you go." },
  {
    content: '<skill_view>{"answer":"The readable answer"}</skill_view>',
    expected: "The readable answer",
  },
  {
    content: `A short answer.\n![preview](data:image/png;base64,${"A".repeat(12000)})`,
    expected: "A short answer.",
  },
])(
  "speaks only visible reply text: $expected",
  async ({ content, expected }) => {
    render(row("visible", "work", "A", true, content));
    expect(screen.getByText(expected)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("chat.listen"));
    await settle();
    expect(window.hermesAPI.synthesizeSpeech).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ text: expected, profile: "work" }),
    );
  },
);

// @lat: [[speech-playback-tests#Media only reply speech omission]]
it("omits Listen for a media-only reply without exposing its hidden path", () => {
  render(row("media", "work", "A", true, "MEDIA:/tmp/private.png"));
  expect(screen.queryByLabelText("chat.listen")).not.toBeInTheDocument();
  expect(window.hermesAPI.synthesizeSpeech).not.toHaveBeenCalled();
});
