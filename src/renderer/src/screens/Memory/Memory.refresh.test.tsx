import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { profileEditorFixture } from "../../test/profileEditorFixture";
const t = (key: string): string => key;
vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t }) }));
import Memory from "./Memory";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
// @lat: [[profile-editors#Tests#Same target refresh preserves Soul drafts]]
it.each(["local", "remote"] as const)(
  "keeps a real %s Soul draft and pending autosave mounted during Memory refresh",
  async (mode) => {
    const data = {
      memory: {
        entries: [],
        content: "",
        exists: false,
        charCount: 0,
        charLimit: 2000,
      },
      user: { content: "", exists: false, charCount: 0, charLimit: 1000 },
      stats: { totalSessions: 0, totalMessages: 0 },
    };
    let resolveRefresh!: (value: typeof data) => void;
    const api = {
      ...profileEditorFixture(mode).api,
      readMemory: vi
        .fn()
        .mockResolvedValueOnce(data)
        .mockReturnValueOnce(
          new Promise((done) => {
            resolveRefresh = done;
          }),
        ),
      getConfig: vi.fn().mockResolvedValue(null),
      discoverMemoryProviders: vi.fn().mockResolvedValue([]),
      readSoul: vi.fn().mockResolvedValue("old Soul"),
      writeSoul: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: api,
    });
    render(<Memory profile="work" />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole("button", { name: "soul.title" }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "my pending Soul draft" } });
    fireEvent.click(document.querySelector(".memory-header button")!);
    expect(screen.getByRole("textbox")).toBe(editor);
    expect((editor as HTMLTextAreaElement).value).toBe("my pending Soul draft");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(api.writeSoul).toHaveBeenCalledWith(
      "my pending Soul draft",
      "work",
      expect.objectContaining({ mode, profile: "work" }),
    );
    await act(async () => resolveRefresh(data));
    expect(screen.getByRole("textbox")).toBe(editor);
    expect(api.readSoul).toHaveBeenCalledTimes(1);
  },
);
