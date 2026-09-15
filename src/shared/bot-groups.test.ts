import { describe, expect, it } from "vitest";
import { mergeBotGroupLog, validateBotGroupRequest } from "./bot-groups";

describe("Bot group request boundary", () => {
  it("preserves the send identity and shared discussion thread", () => {
    // @lat: [[bot-groups#Request boundary]]
    const input = {
      room_id: "group-one",
      event_id: "send-one",
      payload: { text: "@review check this", thread_id: "main" },
    };
    expect(validateBotGroupRequest("send", input)).toEqual(input);
    expect(validateBotGroupRequest("send", input)).toEqual(input);
  });

  it.each([
    ["replicate", { room_id: "a" }],
    [
      "send",
      {
        room_id: "a",
        event_id: "b",
        payload: { text: "hello", thread_id: "main", actor: "admin" },
      },
    ],
    [
      "approve",
      {
        room_id: "a",
        member_id: "b",
        task_id: "c",
        request_id: "d",
        execution_generation: 1,
        choice: "always",
      },
    ],
    ["state", { room_id: "a", url: "https://example.com" }],
    ["state", { room_id: "invalid/path" }],
    [
      "send",
      {
        room_id: "a",
        event_id: "b",
        payload: { text: "研".repeat(22000), thread_id: "main" },
      },
    ],
    ["log", { room_id: "a", since_seq: -1 }],
    ["list", { limit: 10000 }],
    ["create", { room_id: "a", name: "Team", members: [{ profile: "one" }] }],
  ])("rejects privileged or malformed %s operations", (method, params) => {
    expect(() => validateBotGroupRequest(method, params)).toThrow();
  });
});

it("deduplicates replay and refuses mixed authority pages", () => {
  // @lat: [[bot-groups#Replay authority]]
  const room = {
    room_id: "one",
    name: "One",
    members: [],
    authority_gateway_id: "gateway",
    authority_epoch: 2,
  };
  const event = {
    room_id: "one",
    event_id: "e1",
    seq: 1,
    kind: "message.user",
    payload: { text: "hello" },
  };
  const page = {
    events: [event],
    cursor: 1,
    has_more: false,
    authority: { gateway_id: "gateway", epoch: 2 },
  };
  expect(mergeBotGroupLog([event], page, room)).toEqual([event]);
  expect(() =>
    mergeBotGroupLog(
      [event],
      { ...page, authority: { gateway_id: "other", epoch: 3 } },
      room,
    ),
  ).toThrow("authority");
});
