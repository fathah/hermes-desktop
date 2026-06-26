import { promises as fs } from "fs";
import { join } from "path";
import {
  formatSpsPulseLine,
  normalizeSpsPulse,
  parseSpsPulseLine,
  type SpsPulse,
} from "../shared/sps-pulse";

const PULSE_HEADER = `---\ntitle: "Pulse"\n---\n# Workspace pulse\n\n`;
const PULSE_FILE = "pulse.md";

export async function appendSpsPulse(
  vaultDir: string,
  input: Record<string, unknown>,
): Promise<void> {
  try {
    await fs.mkdir(vaultDir, { recursive: true });
    const path = join(vaultDir, PULSE_FILE);
    let existing = "";
    try {
      existing = await fs.readFile(path, "utf-8");
    } catch {
      // first write
    }
    const prefix = existing.trim() ? "" : PULSE_HEADER;
    const line = formatSpsPulseLine(normalizeSpsPulse(input));
    await fs.appendFile(path, `${prefix}${line}\n`, "utf-8");
  } catch {
    // Best effort: pulse logging must not block the caller.
  }
}

export async function readRecentSpsPulses(
  vaultDir: string,
  limit = 20,
): Promise<SpsPulse[]> {
  try {
    const take = Math.max(0, Math.floor(limit));
    if (take === 0) return [];
    const path = join(vaultDir, PULSE_FILE);
    const body = await fs.readFile(path, "utf-8");
    return body
      .split("\n")
      .map(parseSpsPulseLine)
      .filter((pulse): pulse is SpsPulse => !!pulse)
      .slice(-take)
      .reverse();
  } catch {
    return [];
  }
}
