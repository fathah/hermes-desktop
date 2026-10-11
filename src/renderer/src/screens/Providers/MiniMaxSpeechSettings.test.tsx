import type { SpeechSettings } from "../../../../shared/minimax-speech";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
import MiniMaxSpeechSettings from "./MiniMaxSpeechSettings";
const callbacks = new Set<() => void>();
const initial: SpeechSettings = { model: "speech-2.8-hd", region: "" };
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  callbacks.clear();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConnectionConfig: vi
        .fn()
        .mockResolvedValue({ connectionId: "A", mode: "local" }),
      getProviderRequestTarget: vi.fn().mockResolvedValue({
        connectionId: "A",
        mode: "local",
        revision: "issued-a",
      }),
      getSpeechConfig: vi.fn().mockResolvedValue(initial),
      setSpeechConfig: vi.fn().mockResolvedValue(true),
      onConnectionConfigChanged: vi.fn((callback: () => void) => {
        callbacks.add(callback);
        return () => {
          callbacks.delete(callback);
        };
      }),
    },
  });
});
// @lat: [[speech-playback-tests#Scoped settings screen]]
it("settings use a captured Local target and selected profile for both load and save", async () => {
  render(<MiniMaxSpeechSettings profile="work" />);
  await settle();
  expect(window.hermesAPI.getSpeechConfig).toHaveBeenCalledWith(
    "work",
    expect.objectContaining({ revision: "issued-a" }),
  );
  expect(screen.getByLabelText("constants.minimaxSpeechRegion")).toHaveValue(
    "",
  );
  expect(
    screen.getByRole("option", { name: "constants.minimaxSpeechAutomatic" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("constants.minimaxSpeechRegion"), {
    target: { value: "cn" },
  });
  await settle();
  expect(window.hermesAPI.setSpeechConfig).toHaveBeenCalledWith(
    "region",
    "cn",
    "work",
    expect.objectContaining({ connectionId: "A", revision: "issued-a" }),
  );
  expect(screen.getByLabelText("constants.minimaxSpeechRegion")).toHaveValue(
    "cn",
  );
});
it.each(["remote", "ssh"])(
  "%s cannot read or write local speech settings",
  async (mode) => {
    vi.mocked(window.hermesAPI.getConnectionConfig).mockResolvedValue({
      connectionId: "A",
      mode,
    } as Awaited<ReturnType<typeof window.hermesAPI.getConnectionConfig>>);
    render(<MiniMaxSpeechSettings profile="work" />);
    await settle();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(window.hermesAPI.getSpeechConfig).not.toHaveBeenCalled();
    expect(window.hermesAPI.setSpeechConfig).not.toHaveBeenCalled();
  },
);
// @lat: [[speech-playback-tests#Late settings hydration and save]]
it("profile change drops late old hydration and connection change drops late save outcomes", async () => {
  let finish!: (value: SpeechSettings) => void;
  vi.mocked(window.hermesAPI.getSpeechConfig).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<MiniMaxSpeechSettings profile="old" />);
  await settle();
  view.rerender(<MiniMaxSpeechSettings profile="new" />);
  await settle();
  finish({ model: "speech-01-turbo", region: "cn" });
  await settle();
  expect(screen.getByLabelText("constants.minimaxSpeechModel")).toHaveValue(
    "speech-2.8-hd",
  );
  let saved!: (value: boolean) => void;
  vi.mocked(window.hermesAPI.setSpeechConfig).mockReturnValueOnce(
    new Promise((resolve) => {
      saved = resolve;
    }),
  );
  fireEvent.change(screen.getByLabelText("constants.minimaxSpeechRegion"), {
    target: { value: "cn" },
  });
  vi.mocked(window.hermesAPI.getConnectionConfig).mockResolvedValue({
    connectionId: "B",
    mode: "ssh",
  } as Awaited<ReturnType<typeof window.hermesAPI.getConnectionConfig>>);
  act(() => {
    for (const callback of callbacks) callback();
  });
  await settle();
  saved(true);
  await settle();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(window.hermesAPI.setSpeechConfig).toHaveBeenCalledTimes(1);
});
it("failed settings writes show the error and preserve the last confirmed selection", async () => {
  vi.mocked(window.hermesAPI.setSpeechConfig).mockRejectedValue(
    new Error("Could not persist speech configuration."),
  );
  render(<MiniMaxSpeechSettings profile="work" />);
  await settle();
  fireEvent.change(screen.getByLabelText("constants.minimaxSpeechRegion"), {
    target: { value: "cn" },
  });
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent("Could not persist");
  expect(screen.getByLabelText("constants.minimaxSpeechRegion")).toHaveValue(
    "",
  );
});
