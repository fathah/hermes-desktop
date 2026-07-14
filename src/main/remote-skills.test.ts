import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./hermes", () => ({
  getApiUrl: () => "http://remote.example:9119",
  getRemoteAuthHeader: () => ({ Authorization: "Bearer tok" }),
}));

import {
  REMOTE_SKILL_PREFIX,
  remoteGetSkillContent,
  remoteInstallSkill,
  remoteListInstalledSkills,
  remoteSkillPath,
  remoteUninstallSkill,
} from "./remote-skills";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remote skills routing", () => {
  it("lists installed skills from the remote dashboard, keyed by marker path", async () => {
    // Remote mode used to fall through to the local CLI, showing the LOCAL
    // machine's skills while connected to a remote dashboard (#578).
    fetchMock.mockResolvedValue(
      jsonResponse([
        { name: "pdf", category: "docs", description: "PDF tools" },
        { name: "web", description: "" },
        { notAName: true },
      ]),
    );

    const skills = await remoteListInstalledSkills("research");

    // The path embeds the profile the skill was listed under — the content
    // lookup has no other channel for it, and resolving to the globally
    // active profile there would query the wrong profile's API.
    expect(skills).toEqual([
      {
        name: "pdf",
        category: "docs",
        description: "PDF tools",
        path: `${REMOTE_SKILL_PREFIX}research:pdf`,
      },
      {
        name: "web",
        category: "",
        description: "",
        path: `${REMOTE_SKILL_PREFIX}research:web`,
      },
    ]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/skills");
    // Unified-dashboard scoping: named profile rides as ?profile=.
    expect(url).toContain("profile=research");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("does not append ?profile= for the default profile", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await remoteListInstalledSkills("default");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("profile=");
  });

  it("returns [] instead of throwing when the remote is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(remoteListInstalledSkills()).resolves.toEqual([]);
  });

  it("fetches content by unwrapping the marker path to profile + name", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ name: "pdf", content: "# PDF skill" }),
    );

    const content = await remoteGetSkillContent(
      remoteSkillPath("pdf", "research"),
    );

    expect(content).toBe("# PDF skill");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/skills/content?name=pdf");
    // The profile comes from the path, NOT the globally active profile —
    // it must match the profile the skill was listed under.
    expect(url).toContain("profile=research");
  });

  it("scopes a default-profile path with no ?profile= param", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: "x" }));
    await remoteGetSkillContent(remoteSkillPath("pdf"));
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("profile=");
  });

  it("falls back to the given profile for a bare (unprefixed) path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: "x" }));
    await remoteGetSkillContent("pdf", "research");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("name=pdf");
    expect(url).toContain("profile=research");
  });

  it("percent-encodes query params consistently via searchParams", async () => {
    // Embedding a pre-encoded name in the path then calling
    // searchParams.set("profile", ...) would re-serialize it (%20 → +) only
    // when a named profile is present — everything goes through searchParams.
    fetchMock.mockResolvedValue(jsonResponse({ content: "x" }));
    await remoteGetSkillContent(remoteSkillPath("my skill", "research"));
    expect(String(fetchMock.mock.calls[0][0])).toContain("name=my+skill");
    fetchMock.mockClear();
    await remoteGetSkillContent(remoteSkillPath("my skill"));
    expect(String(fetchMock.mock.calls[0][0])).toContain("name=my+skill");
  });

  it("maps hub install/uninstall spawn results to SkillCliResult", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, pid: 42 }));
    await expect(remoteInstallSkill("hub/pdf")).resolves.toEqual({
      success: true,
    });
    await expect(remoteUninstallSkill("pdf")).resolves.toEqual({
      success: true,
    });
  });

  it("surfaces API error detail on a failed install", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "identifier is required" }, 400),
    );
    const result = await remoteInstallSkill("");
    expect(result.success).toBe(false);
    expect(result.error).toContain("identifier is required");
  });
});
