import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";

const { remoteDashboardRequestJson, RemoteDashboardApiError } = vi.hoisted(
  () => {
    class TestRemoteDashboardApiError extends Error {
      readonly unsupported: boolean;

      constructor(
        message: string,
        readonly statusCode?: number,
      ) {
        super(message);
        this.name = "RemoteDashboardApiError";
        this.unsupported = statusCode === 404;
      }
    }

    return {
      remoteDashboardRequestJson: vi.fn(),
      RemoteDashboardApiError: TestRemoteDashboardApiError,
    };
  },
);

vi.mock("./remote-api", () => ({
  remoteDashboardRequestJson,
  RemoteDashboardApiError,
}));

import {
  REMOTE_SKILL_PREFIX,
  remoteGetSkillContent,
  remoteInstallSkill,
  remoteListInstalledSkills,
  remoteSkillPath,
  remoteUninstallSkill,
} from "./remote-skills";

const connection = {
  mode: "remote",
  remoteUrl: "https://remote.example:9119",
  apiKey: "",
  remoteAuthMode: "oauth",
  remoteChatTransport: "auto",
  sshChatTransport: "auto",
  ssh: {},
} as ConnectionConfig;

beforeEach(() => remoteDashboardRequestJson.mockReset());

describe("remote skills routing", () => {
  it("lists remote skills and embeds profile in marker paths", async () => {
    remoteDashboardRequestJson.mockResolvedValue([
      { name: "pdf", category: "docs", description: "PDF tools" },
      { name: "web" },
      { notAName: true },
    ]);

    await expect(
      remoteListInstalledSkills(connection, "research"),
    ).resolves.toEqual([
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
    expect(remoteDashboardRequestJson).toHaveBeenCalledWith(
      connection,
      "/api/skills",
      {},
      "research",
    );
  });

  // @lat: [[remote-management#Test specifications#Feature compatibility failures]]
  it("returns an empty list when the remote Agent lacks the skills API", async () => {
    remoteDashboardRequestJson.mockImplementationOnce(async () => {
      throw new RemoteDashboardApiError("Not found", 404);
    });
    await expect(remoteListInstalledSkills(connection)).resolves.toEqual([]);
  });

  it("surfaces network failures instead of reporting an empty skill list", async () => {
    const error = new Error("ECONNREFUSED");
    remoteDashboardRequestJson.mockRejectedValueOnce(error);

    await expect(remoteListInstalledSkills(connection)).rejects.toBe(error);
  });

  it("fetches content using marker profile and encoded skill name", async () => {
    remoteDashboardRequestJson.mockResolvedValue({ content: "# PDF skill" });
    await expect(
      remoteGetSkillContent(
        connection,
        remoteSkillPath("my skill", "research"),
      ),
    ).resolves.toBe("# PDF skill");
    expect(remoteDashboardRequestJson).toHaveBeenCalledWith(
      connection,
      "/api/skills/content?name=my+skill",
      {},
      "research",
    );
  });

  it("starts remote install and uninstall through authenticated client", async () => {
    remoteDashboardRequestJson.mockResolvedValue({ ok: true, pid: 42 });
    await expect(
      remoteInstallSkill(connection, "hub/pdf", "research"),
    ).resolves.toEqual({ success: true });
    await expect(
      remoteUninstallSkill(connection, "pdf", "research"),
    ).resolves.toEqual({ success: true });
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      1,
      connection,
      "/api/skills/hub/install",
      {
        method: "POST",
        body: { identifier: "hub/pdf", profile: "research" },
      },
      "research",
    );
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      2,
      connection,
      "/api/skills/hub/uninstall",
      { method: "POST", body: { name: "pdf", profile: "research" } },
      "research",
    );
  });

  it("surfaces remote API detail on failed mutation", async () => {
    remoteDashboardRequestJson.mockImplementationOnce(async () => {
      throw new Error("identifier is required");
    });
    const result = await remoteInstallSkill(connection, "");
    expect(result).toEqual({
      success: false,
      error: "identifier is required",
    });
  });
});
