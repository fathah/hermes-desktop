import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const hermesSrc = readFileSync(join(ROOT, "src/main/hermes.ts"), "utf-8");

/**
 * Test that sendMessage passes history parameter in remote mode.
 *
 * This test verifies the fix for the bug where remote/SSH mode was dropping
 * conversation history, causing multi-turn conversations to degrade into
 * single-turn requests.
 */
describe("Remote/SSH Mode History Preservation", () => {
  it("sendMessage passes history to sendMessageViaApi in remote mode", () => {
    // Extract the sendMessage function's remote mode branch
    const remoteModeBranch = hermesSrc.match(
      /\/\/ Remote mode: always use API, no CLI fallback[\s\S]*?if \(isRemoteMode\(\)\) \{[\s\S]*?return sendMessageViaApi\([\s\S]*?\);[\s\S]*?\}/,
    );

    expect(remoteModeBranch).toBeDefined();

    const branchCode = remoteModeBranch![0];

    // Verify that sendMessageViaApi is called with history parameter.
    // Call signature is (message, cb, profile, resumeSessionId, history, attachments).
    const apiCallMatch = branchCode.match(
      /return sendMessageViaApi\(([\s\S]*?)\);/,
    );

    expect(apiCallMatch).toBeDefined();

    const params = apiCallMatch![1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    // Should have at least 5 parameters: message, cb, profile, resumeSessionId, history
    expect(params.length).toBeGreaterThanOrEqual(5);

    // history must appear somewhere in the arg list
    expect(params.some((p) => p === "history" || p.includes("history"))).toBe(
      true,
    );
  });

  it("sendMessageViaApi builds messages from history + current message", () => {
    // Extract sendMessageViaApi function body.  The content-type element is
    // intentionally not pinned to a literal — the type widened to a union
    // when multimodal support landed.
    const funcMatch = hermesSrc.match(
      /function sendMessageViaApi\([\s\S]*?\): ChatHandle \{[\s\S]*?const messages: Array<[\s\S]*?> = \[\];[\s\S]*?if \(history && history\.length > 0\) \{[\s\S]*?for \(const msg of history\) \{[\s\S]*?messages\.push\(\{[\s\S]*?role: msg\.role === "agent" \? "assistant" : msg\.role,[\s\S]*?content: msg\.content,[\s\S]*?\}\);[\s\S]*?\}[\s\S]*?\}[\s\S]*?messages\.push\(\{ role: "user", content: [^}]+\}\);/,
    );

    expect(funcMatch).toBeDefined();

    // Verify the function:
    // 1. Creates messages array
    // 2. Iterates through history and converts "agent" to "assistant"
    // 3. Pushes current user message at the end

    const funcCode = funcMatch![0];

    // Check history iteration
    expect(funcCode).toContain("for (const msg of history)");

    // Check role conversion
    expect(funcCode).toContain('msg.role === "agent" ? "assistant" : msg.role');

    // Check current message is appended (content may be a string or a
    // multimodal-content value built upstream — both end in the same push).
    expect(funcCode).toMatch(
      /messages\.push\(\{ role: "user", content: \w+ \}\);/,
    );
  });

  it("local API available branch also passes history", () => {
    // Extract the local API available branch
    const localApiBranch = hermesSrc.match(
      /if \(apiServerAvailable\) \{[\s\S]*?return sendMessageViaApi\([\s\S]*?\);[\s\S]*?\}/,
    );

    expect(localApiBranch).toBeDefined();

    const branchCode = localApiBranch![0];

    const apiCallMatch = branchCode.match(
      /return sendMessageViaApi\(([\s\S]*?)\);/,
    );

    expect(apiCallMatch).toBeDefined();

    const params = apiCallMatch![1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    // Should have at least 5 parameters including history
    expect(params.length).toBeGreaterThanOrEqual(5);

    expect(params.some((p) => p === "history" || p.includes("history"))).toBe(
      true,
    );
  });

  it("all sendMessageViaApi calls in sendMessage include history parameter", () => {
    // Find the sendMessage function - use a more flexible regex
    const startMatch = hermesSrc.indexOf("export async function sendMessage(");
    expect(startMatch).toBeGreaterThan(-1);

    // Extract from "export async function sendMessage" to the next "export function" or end
    const remainingCode = hermesSrc.substring(startMatch);
    const endMatch = remainingCode.indexOf("\nexport function ");
    const funcCode =
      endMatch > 0 ? remainingCode.substring(0, endMatch) : remainingCode;

    // Find all sendMessageViaApi calls
    const apiCalls = funcCode.matchAll(/sendMessageViaApi\(([^)]+)\)/g);

    const calls = Array.from(apiCalls);

    // Should have at least 2 calls (remote mode + local API available)
    expect(calls.length).toBeGreaterThanOrEqual(2);

    // Verify all calls include history
    for (const call of calls) {
      const params = call[1].split(",").map((p) => p.trim());
      const hasHistory = params.some(
        (p) => p === "history" || p.includes("history"),
      );
      expect(hasHistory).toBe(true);
    }
  });
});
