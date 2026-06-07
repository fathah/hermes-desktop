import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { HERMES_PYTHON } from "./installer";

const CLI_PATH = join(process.cwd(), ".agents", "lib", "agent_core_cli.py");

/**
 * Helper to run the Python agent core CLI and parse its JSON output.
 */
function runPythonBridge(subcommand: string, args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    // Resolve the right Python executable path
    let pythonPath = "python3";
    if (typeof HERMES_PYTHON === "string" && existsSync(HERMES_PYTHON)) {
      pythonPath = HERMES_PYTHON;
    } else if (process.platform === "win32") {
      pythonPath = "python";
    }

    if (!existsSync(CLI_PATH)) {
      return reject(
        new Error(`Python core bridge CLI not found at path: ${CLI_PATH}`),
      );
    }

    const fullArgs = [CLI_PATH, subcommand, ...args];

    execFile(
      pythonPath,
      fullArgs,
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(
              `Bridge CLI execution failed: ${error.message}\nStderr: ${stderr}`,
            ),
          );
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.error) {
            return reject(
              new Error(`Bridge CLI returned error: ${parsed.error}`),
            );
          }
          resolve(parsed);
        } catch (parseError: any) {
          reject(
            new Error(
              `Failed to parse Bridge CLI output: ${parseError.message}\nRaw stdout: ${stdout}`,
            ),
          );
        }
      },
    );
  });
}

/**
 * Calls TokenJuice to compress text (e.g. tool output, html, shell logs).
 */
export async function pythonCompress(
  text: string,
  tool?: string,
): Promise<string> {
  const args = ["--text", text];
  if (tool) {
    args.push("--tool", tool);
  }
  const result = await runPythonBridge("compress", args);
  return result.compressed;
}

/**
 * Checks if a target path is allowed under the action_dir sandbox bounds.
 */
export async function pythonIsPathAllowed(
  targetPath: string,
  actionDir: string,
): Promise<boolean> {
  const result = await runPythonBridge("is-path-allowed", [
    "--path",
    targetPath,
    "--action-dir",
    actionDir,
  ]);
  return !!result.allowed;
}

/**
 * Evaluates command safety, path validation, and security tier gating.
 */
export async function pythonEvaluateExecution(
  cmdArgs: string[],
  tier: "readonly" | "supervised" | "full",
  paths: string[],
  actionDir: string,
): Promise<{ decision: "ALLOW" | "PROMPT" | "BLOCK"; reason: string }> {
  const args = [
    "--args",
    JSON.stringify(cmdArgs),
    "--tier",
    tier,
    "--action-dir",
    actionDir,
  ];
  if (paths && paths.length > 0) {
    args.push("--paths", JSON.stringify(paths));
  }
  const result = await runPythonBridge("evaluate-execution", args);
  return {
    decision: result.decision as "ALLOW" | "PROMPT" | "BLOCK",
    reason: result.reason,
  };
}

/**
 * Saves a page to the Obsidian markdown memory vault.
 */
export async function pythonMemorySave(
  vaultDir: string,
  pageId: string,
  metadata: any,
  body: string,
): Promise<void> {
  await runPythonBridge("memory-save", [
    "--vault",
    vaultDir,
    "--id",
    pageId,
    "--meta",
    JSON.stringify(metadata),
    "--body",
    body,
  ]);
}

/**
 * Performs full-text search in the Obsidian memory vault.
 */
export async function pythonMemorySearch(
  vaultDir: string,
  query: string,
): Promise<Array<{ id: string; score: number }>> {
  const result = await runPythonBridge("memory-search", [
    "--vault",
    vaultDir,
    "--query",
    query,
  ]);
  return result.results || [];
}

/**
 * Builds incoming/outgoing backlinks graph for the Obsidian memory vault.
 */
export async function pythonMemoryGraph(vaultDir: string): Promise<{
  outgoing: Record<string, string[]>;
  backlinks: Record<string, string[]>;
}> {
  const result = await runPythonBridge("memory-graph", ["--vault", vaultDir]);
  return {
    outgoing: result.outgoing || {},
    backlinks: result.backlinks || {},
  };
}
