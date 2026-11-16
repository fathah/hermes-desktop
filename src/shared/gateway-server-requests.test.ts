import { describe, expect, it } from "vitest";
import {
  gatewayClarifyResult,
  normalizeGatewayClarifyQuestions,
  normalizeGatewayServerRequestEvent,
  parseGatewayServerRequest,
} from "./gateway-server-requests";

describe("Gateway request boundary", () => {
  it("keeps the wire request ID separate from the original approval queue ID", () => {
    const request = parseGatewayServerRequest({
      id: "srq-012345abcdef",
      method: "approval",
      params: {
        session_id: "s",
        request_id: "approval-9",
        command: "echo check",
      },
    });
    expect(normalizeGatewayServerRequestEvent(request!)).toMatchObject({
      session_id: "s",
      payload: {
        request_id: "srq-012345abcdef",
        approval_request_id: "approval-9",
        server_request_id: "srq-012345abcdef",
      },
    });
    expect(
      parseGatewayServerRequest({
        id: 1,
        method: "approval",
        params: { session_id: "s" },
      }),
    ).toBeNull();
  });

  it("rejects duplicate question IDs and partial batch answers", () => {
    expect(
      normalizeGatewayClarifyQuestions([
        { qid: "same", question: "First?" },
        { qid: "same", question: "Second?" },
      ]),
    ).toEqual([]);
    const request = parseGatewayServerRequest({
      id: "srq-batch",
      method: "clarify",
      params: {
        session_id: "s",
        questions: [
          { qid: "a", question: "A?" },
          { qid: "b", question: "B?" },
        ],
      },
    })!;
    expect(
      gatewayClarifyResult(
        request,
        JSON.stringify({ answers: { a: "first" } }),
      ),
    ).toBeNull();
    expect(gatewayClarifyResult(request, "")).toEqual({
      answers: { a: null, b: null },
    });
  });

  it("rejects malformed locked answers and oversized choice labels before displaying a request", () => {
    const frame = {
      id: "srq-invalid",
      method: "clarify",
      params: {
        session_id: "s",
        questions: [{ qid: "a", question: "A?" }],
        answers: { a: 123 },
      },
    };
    expect(
      normalizeGatewayServerRequestEvent(parseGatewayServerRequest(frame)!),
    ).toBeNull();
    expect(
      normalizeGatewayClarifyQuestions([
        { qid: "a", question: "A?", choices: ["x".repeat(16_385)] },
      ]),
    ).toEqual([]);
  });

  it("treats question IDs as data, including prototype-looking names", () => {
    const request = parseGatewayServerRequest({
      id: "srq-data",
      method: "clarify",
      params: {
        session_id: "s",
        questions: [{ qid: "__proto__", question: "Value?" }],
      },
    })!;
    const result = gatewayClarifyResult(
      request,
      '{"answers":{"__proto__":"kept"}}',
    );
    expect(JSON.stringify(result)).toBe('{"answers":{"__proto__":"kept"}}');
    expect({}.hasOwnProperty.call(result?.answers, "__proto__")).toBe(true);
  });
});
