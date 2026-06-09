// useChatSkills.test.tsx — slash-command parsing + IPC wiring for `/skill-name`.
// The IPC surface (window.hermesAPI) is stubbed so the hook is tested alone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  useChatSkills,
  slugifySkill,
  type UseChatSkills,
} from "./useChatSkills";

const INSTALLED = [
  {
    name: "Deep Research",
    category: "research",
    description: "multi-source",
    path: "/s/deep-research",
  },
  {
    name: "code-review",
    category: "dev",
    description: "adversarial",
    path: "/s/code-review",
  },
];

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    listActiveSkills: vi.fn().mockResolvedValue([]),
    listInstalledSkills: vi.fn().mockResolvedValue(INSTALLED),
    loadSkillToChat: vi.fn(),
    unloadSkillFromChat: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

async function mountReady(
  overrides: Record<string, unknown> = {},
): Promise<{ result: { current: UseChatSkills } }> {
  stubApi(overrides);
  const hook = renderHook(() =>
    useChatSkills({
      profile: undefined,
      reservedSlashNames: ["/web", "/skills"],
    }),
  );
  // Wait for the initial refresh to populate the installed catalogue (which
  // `match` consults synchronously via a ref).
  await waitFor(() => expect(hook.result.current.installed.length).toBe(2));
  return hook;
}

describe("slugifySkill", () => {
  it("matches the main-process slug", () => {
    expect(slugifySkill("Deep Research")).toBe("deep-research");
  });
});

describe("useChatSkills.match", () => {
  it("parses /skill <name> as a load", async () => {
    const { result } = await mountReady();
    expect(result.current.match("/skill deep research")).toEqual({
      action: "load",
      name: "deep research",
    });
  });

  it("parses /unload with and without an argument", async () => {
    const { result } = await mountReady();
    expect(result.current.match("/unload")).toEqual({
      action: "unload",
      name: undefined,
    });
    expect(result.current.match("/unload code-review")).toEqual({
      action: "unload",
      name: "code-review",
    });
  });

  it("resolves a bare /<slug> to the real skill name", async () => {
    const { result } = await mountReady();
    expect(result.current.match("/deep-research")).toEqual({
      action: "load",
      name: "Deep Research",
    });
  });

  it("never shadows a reserved built-in command", async () => {
    const { result } = await mountReady();
    // /web is reserved even if a skill happened to slug to it.
    expect(result.current.match("/web")).toBeNull();
  });

  it("returns null for non-commands and unknown slugs", async () => {
    const { result } = await mountReady();
    expect(result.current.match("hello there")).toBeNull();
    expect(result.current.match("/nope")).toBeNull();
  });
});

describe("useChatSkills.run", () => {
  it("loads a skill and returns a confirmation, then refreshes", async () => {
    const loadSkillToChat = vi
      .fn()
      .mockResolvedValue({ ok: true, name: "Deep Research" });
    const listActiveSkills = vi
      .fn()
      .mockResolvedValueOnce([]) // initial
      .mockResolvedValue([{ name: "Deep Research", path: "/s/deep-research" }]);
    const { result } = await mountReady({ loadSkillToChat, listActiveSkills });

    let msg = "";
    await act(async () => {
      msg = await result.current.run("/deep-research");
    });
    expect(loadSkillToChat).toHaveBeenCalledWith("Deep Research", undefined);
    expect(msg).toContain("Loaded skill");
    await waitFor(() => expect(result.current.active).toHaveLength(1));
  });

  it("surfaces the error when load fails", async () => {
    const loadSkillToChat = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "no such skill" });
    const { result } = await mountReady({ loadSkillToChat });
    let msg = "";
    await act(async () => {
      msg = await result.current.run("/skill ghost");
    });
    expect(msg).toContain("no such skill");
  });

  it("reports usage for a bare /skill with no name", async () => {
    const { result } = await mountReady();
    let msg = "";
    await act(async () => {
      msg = await result.current.run("/skill");
    });
    expect(msg).toContain("/skill <name>");
  });

  it("unloads and reports what was removed", async () => {
    const unloadSkillFromChat = vi
      .fn()
      .mockResolvedValue({ ok: true, removed: ["code-review"] });
    const { result } = await mountReady({ unloadSkillFromChat });
    let msg = "";
    await act(async () => {
      msg = await result.current.run("/unload code-review");
    });
    expect(unloadSkillFromChat).toHaveBeenCalledWith("code-review", undefined);
    expect(msg).toContain("Unloaded");
  });
});
