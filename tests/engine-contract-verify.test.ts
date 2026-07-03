import { describe, expect, it } from "vitest";
import type { EngineContractEntry } from "../src/shared/engine-contract";
import type { EngineCapabilityState } from "../src/shared/engine-capabilities";
import {
  parseHelpFlags,
  parseHelpSubcommands,
  verifyEngineContract,
} from "../src/main/engine-contract-verify";

const cliSkillsBrowse: EngineContractEntry = {
  id: "cli-skills-browse",
  kind: "cli",
  value: "skills browse",
  flags: ["--query", "--json"],
  usedBy: ["src/main/skills.ts"],
  upstreamPaths: ["hermes_cli/_parser.py"],
  tier: "fail",
};

const httpCapabilities: EngineContractEntry = {
  id: "http-capabilities",
  kind: "http",
  value: "/v1/capabilities",
  usedBy: ["src/main/engine-capabilities.ts"],
  upstreamPaths: ["gateway/platforms/api_server.py"],
  tier: "fail",
};

const warnConfig: EngineContractEntry = {
  id: "config-model",
  kind: "config-key",
  value: "model.*",
  usedBy: ["src/main/config/model-config.ts"],
  upstreamPaths: ["hermes_cli/config.py"],
  tier: "warn",
};

function readyState(): EngineCapabilityState {
  return {
    installedSha: "abc123",
    lastVerifiedSha: null,
    snapshot: {
      status: "ready",
      fetchedAt: "2026-07-03T00:00:00.000Z",
      mode: "local",
      engineSha: "abc123",
      features: {},
      endpoints: {
        capabilities: { method: "GET", path: "/v1/capabilities" },
      },
    },
  };
}

describe("engine contract verifier", () => {
  it("parses argparse subcommands and flags from help text", () => {
    expect(
      parseHelpSubcommands(`
usage: hermes [-h] [--version] {doctor,skills,prompt-size}

positional arguments:
  {doctor,skills,prompt-size}
`),
    ).toEqual(new Set(["doctor", "skills", "prompt-size"]));

    expect(
      parseHelpSubcommands(`
usage: hermes checkpoints [-h] COMMAND ...

positional arguments:
  COMMAND
    status      Show total size
    prune       Delete stale checkpoints
    clear       Delete the checkpoint base
`),
    ).toEqual(new Set(["status", "prune", "clear"]));

    expect(
      parseHelpFlags(`
usage: hermes skills browse [-h] [--query QUERY] [--json] [--yes]
`),
    ).toEqual(new Set(["-h", "--query", "--json", "--yes"]));
  });

  it("passes when fail-tier CLI commands, flags, and HTTP endpoints are present", async () => {
    const seen: string[][] = [];
    const result = await verifyEngineContract("work", {
      now: new Date("2026-07-03T00:00:00.000Z"),
      entries: [cliSkillsBrowse, httpCapabilities, warnConfig],
      getCapabilityState: () => readyState(),
      runHelp: async (args) => {
        seen.push(args);
        const key = args.join(" ");
        if (key === "") return "usage: hermes [-h] {skills}";
        if (key === "skills") return "usage: hermes skills [-h] {browse}";
        if (key === "skills browse") {
          return "usage: hermes skills browse [-h] [--query QUERY] [--json]";
        }
        throw new Error(`unexpected help args: ${key}`);
      },
    });

    expect(result.status).toBe("passed");
    expect(result.findings.map((finding) => finding.verdict)).toEqual([
      "passed",
      "passed",
      "warn",
    ]);
    expect(seen).toEqual([[], ["skills"], ["skills", "browse"]]);
  });

  it("breaks when a consumed CLI flag disappears", async () => {
    const result = await verifyEngineContract("work", {
      now: new Date("2026-07-03T00:00:00.000Z"),
      entries: [cliSkillsBrowse, httpCapabilities],
      getCapabilityState: () => readyState(),
      runHelp: async (args) => {
        const key = args.join(" ");
        if (key === "") return "usage: hermes [-h] {skills}";
        if (key === "skills") return "usage: hermes skills [-h] {browse}";
        if (key === "skills browse") {
          return "usage: hermes skills browse [-h] [--query QUERY]";
        }
        return "";
      },
    });

    expect(result.status).toBe("broken");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        entryId: "cli-skills-browse",
        verdict: "broken",
        detail: expect.stringContaining("--json"),
      }),
    );
  });

  it("reports unknown instead of broken when the HTTP capability snapshot is unavailable", async () => {
    const state = readyState();
    state.snapshot.status = "unknown";
    state.snapshot.endpoints = {};

    const result = await verifyEngineContract("work", {
      now: new Date("2026-07-03T00:00:00.000Z"),
      entries: [httpCapabilities],
      getCapabilityState: () => state,
      runHelp: async () => "",
    });

    expect(result.status).toBe("unknown");
    expect(result.findings).toEqual([
      expect.objectContaining({
        entryId: "http-capabilities",
        verdict: "unknown",
      }),
    ]);
  });
});
