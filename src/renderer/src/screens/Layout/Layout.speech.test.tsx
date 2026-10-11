import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SynthesizedSpeech } from "../../../../shared/minimax-speech";
import { profileEditorFixture } from "../../test/profileEditorFixture";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/settings/SettingsModalContext", () => ({
  useSettingsModal: () => ({ openSettings: vi.fn() }),
}));
vi.mock("../../components/ChatPreferencesProvider", () => ({
  useChatPreferences: () => ({ completionSoundEnabled: false }),
}));
vi.mock("../../components/ConfigHealthBanner", () => ({
  ConfigHealthBanner: () => null,
}));
vi.mock("../../components/FollowUsModal", () => ({ default: () => null }));
vi.mock("../../components/common/ProfileAvatar", () => ({
  default: () => null,
}));
vi.mock("../../components/OrbLoader", () => ({ OrbLoader: () => null }));
vi.mock("../../components/AgentMarkdown", () => ({
  AgentMarkdown: ({ content }: { content: string }) => <span>{content}</span>,
}));
vi.mock("../Chat/ChatInput", () => ({ ChatInput: () => null }));
vi.mock("../Chat/RemoteFolderPicker", () => ({
  RemoteFolderPicker: () => null,
}));
vi.mock("../Chat/hooks/useChatIPC", async () => {
  const { useEffect } = await import("react");
  return {
    useChatIPC: ({
      profile,
      setMessages,
      setHermesSessionId,
    }: {
      profile: string;
      setMessages: (messages: unknown[]) => void;
      setHermesSessionId: (id: string) => void;
    }) => {
      useEffect(() => {
        setMessages([
          {
            id: `message-${profile}`,
            role: "agent",
            kind: "assistant",
            content: `response-${profile}`,
          },
        ]);
        setHermesSessionId(`saved-${profile}`);
      }, [profile, setMessages, setHermesSessionId]);
    },
  };
});
vi.mock("../Chat/hooks/useChatActions", () => ({
  useChatActions: () => ({}),
  parseBackgroundCommand: () => null,
}));
vi.mock("../Chat/hooks/useModelConfig", () => {
  const config = {
    currentModel: "",
    currentProvider: "auto",
    currentBaseUrl: "",
    displayModel: "",
    modelGroups: [],
    reload: vi.fn(),
    selectModel: vi.fn(),
  };
  return { useModelConfig: () => config, effectiveOverrideBaseUrl: () => "" };
});
vi.mock("../Chat/hooks/useFastMode", () => ({
  useFastMode: () => ({ fastMode: false, toggle: vi.fn(), set: vi.fn() }),
}));
vi.mock("../Chat/hooks/useReasoningEffort", () => ({
  useReasoningEffort: () => ({
    reasoningEffort: "",
    setReasoningEffort: vi.fn(),
  }),
}));
vi.mock("../Chat/hooks/useLocalCommands", () => ({
  useLocalCommands: () => vi.fn(),
}));
vi.mock("../Chat/hooks/useDashboardChatTransport", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../Chat/hooks/useDashboardChatTransport")
  >()),
  useDashboardChatTransport: () => ({ enabled: false }),
  dashboardChatEnabledForConnection: () => false,
}));
vi.mock("./ProfileSwitcher", () => ({
  default: ({ onSwitch }: { onSwitch: (profile: string) => void }) => (
    <button onClick={() => onSwitch("work")}>Select work profile</button>
  ),
}));
vi.mock("./StatusBar", () => ({ StatusBar: () => null }));
vi.mock("./ActiveSessionsBar", () => ({ ActiveSessionsBar: () => null }));
vi.mock("./SidebarRecentSessions", () => ({ default: () => null }));
vi.mock("../Sessions/Sessions", () => ({ default: () => null }));
vi.mock("../Agents/Agents", () => ({ default: () => null }));
vi.mock("../Discover/Discover", () => ({ default: () => null }));
vi.mock("../Skills/Skills", () => ({ default: () => null }));
vi.mock("../Memory/Memory", () => ({ default: () => null }));
vi.mock("../Tools/Tools", () => ({ default: () => null }));
vi.mock("../Gateway/Gateway", () => ({ default: () => null }));
vi.mock("../Office/Office", () => ({ default: () => null }));
vi.mock("../Providers/Providers", () => ({ default: () => null }));
vi.mock("../Providers/RemoteProviders", () => ({ default: () => null }));
vi.mock("../Schedules/Schedules", () => ({ default: () => null }));
vi.mock("../Kanban/Kanban", () => ({ default: () => null }));
import Layout from "./Layout";
import { stopSpeechPlayback } from "../Chat/speech-playback";
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
const audio: SynthesizedSpeech = {
  audio: new Uint8Array([1, 2]),
  mimeType: "audio/mpeg",
};
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  clips.length = 0;
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {
        /* JSDOM has no layout engine. */
      }
      disconnect(): void {
        /* No native observation to disconnect. */
      }
      unobserve(): void {
        /* JSDOM has no layout engine. */
      }
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn().mockReturnValue("blob:speech");
  URL.revokeObjectURL = vi.fn();
  localStorage.clear();
  const listeners = vi.fn().mockReturnValue(() => {});
  const scope = profileEditorFixture();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      ...scope.api,
      listProfiles: vi
        .fn()
        .mockResolvedValue([
          { id: "default", isActive: true, isDefault: true },
        ]),
      getConnectionConfig: vi.fn().mockResolvedValue({ mode: "local" }),
      getSessionUsage: vi.fn().mockResolvedValue(null),
      getProviderRequestTarget: vi.fn().mockResolvedValue({
        connectionId: "local",
        mode: "local",
        revision: "rev",
      }),
      synthesizeSpeech: vi.fn().mockResolvedValue(audio),
      cancelSpeech: vi.fn().mockResolvedValue(true),
      isRemoteOnlyMode: vi.fn().mockResolvedValue(false),
      validateChatReadiness: vi.fn().mockResolvedValue({ ok: true }),
      recordSessionLocation: vi.fn().mockResolvedValue(true),
      setSessionContextFolder: vi.fn().mockResolvedValue(true),
      setSessionModelOverride: vi.fn().mockResolvedValue(true),
      onContextMenuCopyChat: listeners,
      onContextMenuSelectBubble: listeners,
      onUpdateAvailable: listeners,
      onUpdateDownloadProgress: listeners,
      onUpdateDownloaded: listeners,
      onUpdateError: listeners,
      onMenuNewChat: listeners,
      onMenuSearchSessions: listeners,
      copyToClipboard: vi.fn(),
    },
  });
});
afterEach(() => {
  stopSpeechPlayback();
  vi.unstubAllGlobals();
});
async function listen(): Promise<void> {
  fireEvent.click(await screen.findByLabelText("chat.listen"));
  await waitFor(() =>
    expect(screen.getByLabelText("chat.listenStop")).toBeInTheDocument(),
  );
}
// @lat: [[speech-playback-tests#Hidden chat playback release]]
it.each(["profile", "screen"])(
  "the actual Layout→Chat %s transition pauses speech in the retained hidden chat",
  async (transition) => {
    render(<Layout connectionId="local" />);
    await listen();
    await waitFor(() => expect(clips).toHaveLength(1));
    const request = vi.mocked(window.hermesAPI.synthesizeSpeech).mock
      .calls[0][0];
    const oldChat = screen
      .getByLabelText("chat.listenStop")
      .closest(".chat-container");
    if (transition === "profile")
      fireEvent.click(screen.getByText("Select work profile"));
    else
      fireEvent.click(
        screen.getByRole("button", { name: "navigation.providers" }),
      );
    await waitFor(() =>
      expect(clips[0].pause).toHaveBeenCalledExactlyOnceWith(),
    );
    expect(window.hermesAPI.cancelSpeech).toHaveBeenCalledWith(
      request.requestId,
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:speech");
    expect(oldChat?.isConnected).toBe(true);
    expect(oldChat?.parentElement).toHaveStyle({ display: "none" });
    expect(oldChat?.querySelector('[aria-label="chat.listenStop"]')).toBeNull();
  },
);
// @lat: [[speech-playback-tests#Hidden pending chat synthesis]]
it.each(["profile", "screen"])(
  "the actual %s transition cancels pending synthesis before hidden audio can arrive",
  async (transition) => {
    const pending = deferred<SynthesizedSpeech>();
    vi.mocked(window.hermesAPI.synthesizeSpeech).mockReturnValue(
      pending.promise,
    );
    render(<Layout connectionId="local" />);
    await listen();
    const request = vi.mocked(window.hermesAPI.synthesizeSpeech).mock
      .calls[0][0];
    if (transition === "profile")
      fireEvent.click(screen.getByText("Select work profile"));
    else
      fireEvent.click(
        screen.getByRole("button", { name: "navigation.providers" }),
      );
    expect(window.hermesAPI.cancelSpeech).toHaveBeenCalledWith(
      request.requestId,
    );
    await act(async () => pending.resolve(audio));
    expect(clips).toHaveLength(0);
  },
);
