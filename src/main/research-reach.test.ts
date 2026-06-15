import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  agentReachSkillCandidates,
  findAgentReachSkillSource,
  getResearchReachStatusFromRunner,
} from "./research-reach";

describe("getResearchReachStatusFromRunner", () => {
  it("returns normalized status when agent-reach doctor succeeds", async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("--version")) {
        return { ok: true, stdout: "Agent Reach v1.5.0\n", stderr: "" };
      }
      return {
        ok: true,
        stdout: JSON.stringify({
          github: {
            status: "ok",
            name: "GitHub",
            message: "gh ok",
            tier: 0,
            backends: ["gh CLI"],
            active_backend: "gh CLI",
          },
        }),
        stderr: "",
      };
    });

    const status = await getResearchReachStatusFromRunner(run);

    expect(status.installed).toBe(true);
    expect(status.version).toBe("1.5.0");
    expect(status.channels[0]?.label).toBe("GitHub");
    expect(run).toHaveBeenCalledWith("agent-reach", ["--version"], 8000);
    expect(run).toHaveBeenCalledWith(
      "agent-reach",
      ["doctor", "--json"],
      30000,
    );
  });

  it("does not leak stderr into UI when agent-reach is missing", async () => {
    const run = vi.fn(async () => ({
      ok: false,
      stdout: "",
      stderr: "/Users/amar/secret/path: command not found",
    }));

    const status = await getResearchReachStatusFromRunner(run);

    expect(status.installed).toBe(false);
    expect(status.error).toBe("Agent-Reach is not installed.");
  });

  it("returns a safe parse error for malformed doctor JSON", async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("--version")) {
        return { ok: true, stdout: "Agent Reach v1.5.0\n", stderr: "" };
      }
      return { ok: true, stdout: "not json", stderr: "" };
    });

    const status = await getResearchReachStatusFromRunner(run);

    expect(status.installed).toBe(false);
    expect(status.error).toBe(
      "Agent-Reach is installed but doctor did not return JSON.",
    );
  });
});

describe("findAgentReachSkillSource", () => {
  it("checks the common local agent skill directories", () => {
    const home = mkdtempSync(join(tmpdir(), "research-reach-"));
    try {
      const claudeSkill = join(home, ".claude", "skills", "agent-reach");
      mkdirSync(claudeSkill, { recursive: true });

      expect(agentReachSkillCandidates(home)).toEqual([
        join(home, ".agents", "skills", "agent-reach"),
        claudeSkill,
        join(home, ".openclaw", "skills", "agent-reach"),
      ]);
      expect(findAgentReachSkillSource(home)).toBe(claudeSkill);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
