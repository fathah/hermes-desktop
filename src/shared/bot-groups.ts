/** Presentation contract for Hermes groups protocol v2. Hermes owns all execution. */
export interface BotGroupMember {
  member_id: string;
  profile: string;
  handle: string;
  display_name: string;
}
export interface BotGroupRoom {
  room_id: string;
  name: string;
  members: BotGroupMember[];
  authority_gateway_id: string;
  authority_epoch: number;
}
export interface BotGroupEvent {
  room_id: string;
  seq: number;
  event_id: string;
  kind: string;
  actor?: { id?: string };
  payload: {
    text?: string;
    member_id?: string;
    error?: string;
    reason?: string;
  };
}
export type BotGroupAction =
  | { kind: "retry"; task_id: string }
  | {
      kind: "approval";
      member_id: string;
      task_id: string;
      request_id: string;
      execution_generation: number;
      approval: { command?: string; description?: string; choices?: string[] };
    };
export interface BotGroupState {
  room: BotGroupRoom;
  driver_status?: {
    running: boolean;
    working: boolean;
    blocked: boolean;
    pending_actions: BotGroupAction[];
  };
}
export interface BotGroupResults {
  capabilities: {
    enabled: boolean;
    available: boolean;
    error?: string;
    capabilities?: {
      protocol_version: number;
      driver: boolean;
      methods: string[];
    };
  };
  profiles: { profiles: { name: string; display_name: string }[] };
  list: { rooms: BotGroupRoom[]; next_offset: number | null };
  create: { room: BotGroupRoom };
  state: BotGroupState;
  log: {
    events: BotGroupEvent[];
    cursor: number;
    has_more: boolean;
    authority: { gateway_id: string; epoch: number };
  };
  send: { accepted: boolean };
  stop: { cancelled: number };
  retry: { retried: boolean };
  approve: { approved: boolean };
}
export type BotGroupOperation = keyof BotGroupResults;
export type BotGroupAPI = <K extends BotGroupOperation>(
  connectionId: string,
  operation: K,
  params?: Record<string, unknown>,
) => Promise<BotGroupResults[K]>;

const fields: Record<BotGroupOperation, readonly string[]> = {
  capabilities: [],
  profiles: [],
  list: ["limit", "offset"],
  create: ["room_id", "name", "members"],
  state: ["room_id"],
  log: ["room_id", "since_seq", "limit"],
  send: ["room_id", "event_id", "payload"],
  stop: ["room_id", "cancel_id"],
  retry: ["room_id", "task_id"],
  approve: [
    "room_id",
    "member_id",
    "task_id",
    "execution_generation",
    "request_id",
    "choice",
  ],
};
function object(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    throw new Error("Unknown Bot group operation or parameters.");
  }
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  field: string,
  max = 128,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`Invalid ${field}.`);
  }
}
function identifier(value: unknown, field: string): void {
  text(value, field);
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value))
    throw new Error(`Invalid ${field}.`);
}
function integer(
  value: unknown,
  field: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Invalid ${field}.`);
  }
}

export function validateBotGroupRequest(
  operation: string,
  input: unknown,
): Record<string, unknown> {
  if (!Object.hasOwn(fields, operation))
    throw new Error("Unknown Bot group operation.");
  const allowed = fields[operation as BotGroupOperation];
  const params = object(input, allowed);
  for (const key of [
    "room_id",
    "event_id",
    "cancel_id",
    "task_id",
    "member_id",
    "request_id",
  ]) {
    if (allowed.includes(key)) identifier(params[key], key);
  }
  for (const key of ["offset", "since_seq", "limit", "execution_generation"]) {
    if (key in params)
      integer(
        params[key],
        key,
        ["limit", "execution_generation"].includes(key) ? 1 : 0,
        key === "limit" ? 500 : Number.MAX_SAFE_INTEGER,
      );
  }
  if (operation === "create") {
    text(params.name, "name", 120);
    if (
      !Array.isArray(params.members) ||
      params.members.length < 2 ||
      params.members.length > 6
    ) {
      throw new Error("Select 2–6 different Agent profiles.");
    }
    const members = params.members.map((value) => {
      const member = object(value, [
        "member_id",
        "profile",
        "handle",
        "display_name",
      ]);
      for (const key of ["member_id", "profile", "handle"])
        identifier(member[key], key);
      text(member.display_name, "display_name", 120);
      if (["all", "everyone"].includes(String(member.handle).toLowerCase()))
        throw new Error("Reserved handle.");
      return member;
    });
    for (const key of ["member_id", "profile", "handle"]) {
      if (
        new Set(members.map((m) => String(m[key]).toLowerCase())).size !==
        members.length
      ) {
        throw new Error("Each member, profile, and handle must be unique.");
      }
    }
  }
  if (operation === "send") {
    const payload = object(params.payload, ["text", "thread_id"]);
    text(payload.text, "text", 32000);
    if (new TextEncoder().encode(payload.text).byteLength > 65536)
      throw new Error("Message exceeds the Hermes 64 KiB UTF-8 limit.");
    identifier(payload.thread_id, "thread_id");
  }
  if (operation === "approve") {
    integer(params.execution_generation, "execution_generation", 1);
    if (params.choice !== "once" && params.choice !== "deny")
      throw new Error("Only allow once or deny is supported.");
  }
  return params;
}

/** Read-only display cache; an authority change resets replay, never promotes a replica. */
export function mergeBotGroupLog(
  previous: BotGroupEvent[],
  page: BotGroupResults["log"],
  room: BotGroupRoom,
): BotGroupEvent[] {
  if (
    page.authority.gateway_id !== room.authority_gateway_id ||
    page.authority.epoch !== room.authority_epoch
  ) {
    throw new Error("Group authority changed. Reconnect to refresh the room.");
  }
  const seen = new Set(previous.map((event) => event.event_id));
  return [
    ...previous,
    ...page.events.filter(
      (event) => event.room_id === room.room_id && !seen.has(event.event_id),
    ),
  ].slice(-500);
}
