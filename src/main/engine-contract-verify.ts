import { execFile } from "child_process";
import {
  ENGINE_CONTRACT,
  type EngineContractEntry,
  type EngineContractFinding,
  type EngineContractVerificationResult,
} from "../shared/engine-contract";
import {
  getEngineCapabilityState,
  recordEngineContractVerification,
} from "./engine-update-state";
import {
  HERMES_PYTHON,
  hermesCliArgs,
  HERMES_REPO,
  getEnhancedPath,
} from "./installer";
import { HERMES_HOME } from "./installer/paths";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { stripAnsi } from "./utils";

const HELP_TIMEOUT_MS = 15000;

export interface VerifyEngineContractOptions {
  now?: Date;
  entries?: readonly EngineContractEntry[];
  getCapabilityState?: typeof getEngineCapabilityState;
  runHelp?: (args: string[]) => Promise<string>;
}

export function parseHelpSubcommands(helpText: string): Set<string> {
  const commands = new Set<string>();
  const braceRe = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = braceRe.exec(helpText)) !== null) {
    for (const raw of match[1].split(",")) {
      const value = raw.trim();
      if (/^[a-z0-9][a-z0-9_-]*$/i.test(value)) commands.add(value);
    }
  }

  const commandLineRe = /^\s{4}([a-z][a-z0-9_-]*)(?:\s{2,}|\s*$)/gim;
  while ((match = commandLineRe.exec(helpText)) !== null) {
    commands.add(match[1]);
  }

  return commands;
}

export function parseHelpFlags(helpText: string): Set<string> {
  const flags = new Set<string>();
  const flagRe = /--?[a-z][a-z0-9-]*/gi;
  let match: RegExpExecArray | null;
  while ((match = flagRe.exec(helpText)) !== null) {
    flags.add(match[0]);
  }
  return flags;
}

function runHermesHelp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      HERMES_PYTHON,
      hermesCliArgs([...args, "--help"]),
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout: HELP_TIMEOUT_MS,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (error, stdout, stderr) => {
        const output = stripAnsi(`${stdout || ""}${stderr || ""}`);
        if (error && !output.trim()) {
          reject(error);
          return;
        }
        resolve(output);
      },
    );
  });
}

function finding(
  entry: EngineContractEntry,
  verdict: EngineContractFinding["verdict"],
  detail: string,
): EngineContractFinding {
  return {
    entryId: entry.id,
    kind: entry.kind,
    value: entry.value,
    tier: entry.tier,
    verdict,
    detail,
  };
}

function normalizeEndpointTemplate(path: string): string {
  return path.replace(/\{[^}]+\}/g, "{id}");
}

async function verifyCliEntry(
  entry: EngineContractEntry,
  helpFor: (args: string[]) => Promise<string>,
): Promise<EngineContractFinding> {
  const tokens = entry.value.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return finding(entry, "broken", "Empty CLI contract entry.");
  }

  if (tokens[0].startsWith("-")) {
    const rootFlags = parseHelpFlags(await helpFor([]));
    return rootFlags.has(tokens[0])
      ? finding(entry, "passed", `Root flag ${tokens[0]} is present.`)
      : finding(entry, "broken", `Root flag ${tokens[0]} is missing.`);
  }

  const rootCommands = parseHelpSubcommands(await helpFor([]));
  if (!rootCommands.has(tokens[0])) {
    return finding(
      entry,
      "broken",
      `Top-level command ${tokens[0]} is missing.`,
    );
  }

  if (tokens.length > 1) {
    const parentCommands = parseHelpSubcommands(await helpFor([tokens[0]]));
    if (!parentCommands.has(tokens[1])) {
      return finding(
        entry,
        "broken",
        `Subcommand ${tokens.slice(0, 2).join(" ")} is missing.`,
      );
    }
  }

  if (entry.flags?.length) {
    const flags = parseHelpFlags(await helpFor(tokens));
    const missing = entry.flags.filter((flag) => !flags.has(flag));
    if (missing.length > 0) {
      return finding(
        entry,
        "broken",
        `Missing CLI flags: ${missing.join(", ")}.`,
      );
    }
  }

  return finding(entry, "passed", `CLI surface ${entry.value} is present.`);
}

function verifyHttpEntry(
  entry: EngineContractEntry,
  options: VerifyEngineContractOptions,
  profile?: string,
): EngineContractFinding {
  const state = (options.getCapabilityState || getEngineCapabilityState)(
    profile,
  );
  if (state.snapshot.status !== "ready") {
    return finding(
      entry,
      "unknown",
      "Engine capability snapshot is unavailable.",
    );
  }

  if (entry.value === "/v1/capabilities") {
    return finding(
      entry,
      "passed",
      "HTTP endpoint /v1/capabilities produced the ready capability snapshot.",
    );
  }

  const endpointPaths = new Set(
    Object.values(state.snapshot.endpoints).map((endpoint) =>
      normalizeEndpointTemplate(endpoint.path),
    ),
  );
  const expected = normalizeEndpointTemplate(entry.value);
  return endpointPaths.has(expected)
    ? finding(entry, "passed", `HTTP endpoint ${entry.value} is present.`)
    : finding(entry, "broken", `HTTP endpoint ${entry.value} is missing.`);
}

export async function verifyEngineContract(
  profile?: string,
  options: VerifyEngineContractOptions = {},
): Promise<EngineContractVerificationResult> {
  const helpCache = new Map<string, Promise<string>>();
  const runHelp = options.runHelp || runHermesHelp;
  const helpFor = (args: string[]): Promise<string> => {
    const key = args.join("\u0000");
    const cached = helpCache.get(key);
    if (cached) return cached;
    const next = runHelp(args);
    helpCache.set(key, next);
    return next;
  };

  const findings: EngineContractFinding[] = [];
  for (const entry of options.entries || ENGINE_CONTRACT) {
    if (entry.tier === "warn") {
      findings.push(
        finding(entry, "warn", "Warn-tier config/JSON drift is reported only."),
      );
      continue;
    }
    if (entry.kind === "cli") {
      try {
        findings.push(await verifyCliEntry(entry, helpFor));
      } catch (err) {
        findings.push(
          finding(
            entry,
            "unknown",
            `CLI help check failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
      continue;
    }
    if (entry.kind === "http") {
      findings.push(verifyHttpEntry(entry, options, profile));
    }
  }

  const status = findings.some((item) => item.verdict === "broken")
    ? "broken"
    : findings.some((item) => item.verdict === "unknown")
      ? "unknown"
      : "passed";

  return {
    checkedAt: (options.now || new Date()).toISOString(),
    status,
    findings,
  };
}

export async function verifyAndRecordEngineContract(
  profile?: string,
  options: VerifyEngineContractOptions = {},
): Promise<EngineContractVerificationResult> {
  const result = await verifyEngineContract(profile, options);
  recordEngineContractVerification(result, profile);
  return result;
}
