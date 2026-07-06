import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const hermesSrc = readFileSync(join(ROOT, "src/main/hermes.ts"), "utf-8");

function splitCallArgs(args: string): string[] {
  return args
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

function hasHistoryArg(args: string): boolean {
  return splitCallArgs(args).some(
    (p) => p === "history" || p.includes("history"),
  );
}

function extractExportedFunction(name: string): string {
  const startMatch = hermesSrc.indexOf(`export async function ${name}(`);
  expect(startMatch).toBeGreaterThan(-1);

  const remainingCode = hermesSrc.substring(startMatch);
  const endMatch = remainingCode.indexOf("\nexport function ");
  return endMatch > 0 ? remainingCode.substring(0, endMatch) : remainingCode;
}

function extractLocalRecoveryFunction(): string {
  const startMatch = hermesSrc.indexOf(
    "async function sendMessageViaBestApiWithLocalRecovery(",
  );
  expect(startMatch).toBeGreaterThan(-1);

  const remainingCode = hermesSrc.substring(startMatch);
  const endMatch = remainingCode.indexOf(
    "\nexport async function sendMessage(",
  );
  expect(endMatch).toBeGreaterThan(-1);

  return remainingCode.substring(0, endMatch);
}

function extractPrivateFunction(name: string, nextFunction: string): string {
  const startMatch = hermesSrc.indexOf(`async function ${name}(`);
  expect(startMatch).toBeGreaterThan(-1);

  const remainingCode = hermesSrc.substring(startMatch);
  const endMatch = remainingCode.indexOf(`\n${nextFunction}`);
  expect(endMatch).toBeGreaterThan(-1);

  return remainingCode.substring(0, endMatch);
}

/**
 * Test that sendMessage passes history parameter in remote mode.
 *
 * This test verifies the fix for the bug where remote/SSH mode was dropping
 * conversation history, causing multi-turn conversations to degrade into
 * single-turn requests.
 */
describe("Remote/SSH Mode History Preservation", () => {
  it("sendMessage passes history to the best API transport in remote mode", () => {
    // Extract the sendMessage function's remote mode branch
    const remoteModeBranch = hermesSrc.match(
      /\/\/ Remote mode: always use API, no CLI fallback[\s\S]*?if \(isRemoteMode\(\)\) \{[\s\S]*?return sendMessageViaBestApi\([\s\S]*?\);[\s\S]*?\}/,
    );

    expect(remoteModeBranch).toBeDefined();

    const branchCode = remoteModeBranch![0];

    // Verify that sendMessageViaBestApi is called with history parameter.
    // Call signature is (message, cb, profile, resumeSessionId, history, attachments).
    const apiCallMatch = branchCode.match(
      /return sendMessageViaBestApi\(([\s\S]*?)\);/,
    );

    expect(apiCallMatch).toBeDefined();

    const params = splitCallArgs(apiCallMatch![1]);

    // Should have at least 5 parameters: message, cb, profile, resumeSessionId, history
    expect(params.length).toBeGreaterThanOrEqual(5);

    // history must appear somewhere in the arg list
    expect(hasHistoryArg(apiCallMatch![1])).toBe(true);
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

  it("local API available branch passes history to recovery wrapper", () => {
    // Extract the local API available branch
    const localApiBranch = hermesSrc.match(
      /if \(apiServerAvailable\) \{[\s\S]*?return sendMessageViaBestApiWithLocalRecovery\([\s\S]*?\);[\s\S]*?\}/,
    );

    expect(localApiBranch).toBeDefined();

    const branchCode = localApiBranch![0];

    const wrapperCallMatch = branchCode.match(
      /return sendMessageViaBestApiWithLocalRecovery\(([\s\S]*?)\);/,
    );

    expect(wrapperCallMatch).toBeDefined();

    const params = splitCallArgs(wrapperCallMatch![1]);

    // Should have at least 5 parameters including history
    expect(params.length).toBeGreaterThanOrEqual(5);

    expect(hasHistoryArg(wrapperCallMatch![1])).toBe(true);
  });

  it("best API transport forwards history through the non-gateway transport", () => {
    const bestApiCode = extractPrivateFunction(
      "sendMessageViaBestApi",
      "async function sendMessageViaBestApiWithLocalRecovery(",
    );
    const nonGatewayCall = bestApiCode.match(
      /sendMessageViaNonGatewayApi\(([\s\S]*?)\);/,
    );
    expect(nonGatewayCall).toBeDefined();
    expect(hasHistoryArg(nonGatewayCall![1])).toBe(true);
  });

  it("non-gateway API transport forwards history to every concrete transport", () => {
    const nonGatewayCode = extractPrivateFunction(
      "sendMessageViaNonGatewayApi",
      "async function sendMessageViaBestApi(",
    );
    const transportCalls = Array.from(
      nonGatewayCode.matchAll(/sendMessageVia(?:Runs|Api)\(([\s\S]*?)\);/g),
    );

    expect(transportCalls.length).toBeGreaterThanOrEqual(2);

    for (const call of transportCalls) {
      expect(hasHistoryArg(call[1])).toBe(true);
    }
  });

  it("local recovery wrapper forwards history to every best API send", () => {
    const wrapperCode = extractLocalRecoveryFunction();
    const apiCalls = Array.from(
      wrapperCode.matchAll(/sendMessageViaBestApi\(([\s\S]*?)\);/g),
    );

    // Initial local API send + retry after gateway recovery.
    expect(apiCalls.length).toBeGreaterThanOrEqual(2);

    for (const call of apiCalls) {
      expect(hasHistoryArg(call[1])).toBe(true);
    }
  });

  it("all API send paths in sendMessage include history parameter", () => {
    const funcCode = extractExportedFunction("sendMessage");

    // Find all direct and local-recovery API send paths.
    const apiCalls = funcCode.matchAll(
      /sendMessageViaBestApi(?:WithLocalRecovery)?\(([\s\S]*?)\);/g,
    );

    const calls = Array.from(apiCalls);

    // Should have at least 2 API paths (remote mode + local API available).
    expect(calls.length).toBeGreaterThanOrEqual(2);

    // Verify all API paths include history.
    for (const call of calls) {
      expect(hasHistoryArg(call[1])).toBe(true);
    }
  });

  it("sendMessageViaBestApi forwards history through chat-completions fallback", () => {
    const bestApiMatch = hermesSrc.match(
      /async function sendMessageViaBestApi\([\s\S]*?\): Promise<ChatHandle> \{[\s\S]*?return sendMessageViaNonGatewayApi\(([\s\S]*?)\);[\s\S]*?\}/,
    );

    expect(bestApiMatch).toBeDefined();

    const bestApiParams = bestApiMatch![1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    expect(
      bestApiParams.some((p) => p === "history" || p.includes("history")),
    ).toBe(true);

    const nonGatewayMatch = hermesSrc.match(
      /async function sendMessageViaNonGatewayApi\([\s\S]*?\): Promise<ChatHandle> \{[\s\S]*?return sendMessageViaApi\(([\s\S]*?)\);[\s\S]*?\}/,
    );

    expect(nonGatewayMatch).toBeDefined();

    const nonGatewayParams = nonGatewayMatch![1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    expect(
      nonGatewayParams.some((p) => p === "history" || p.includes("history")),
    ).toBe(true);
  });
});
