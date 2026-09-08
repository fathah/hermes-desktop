// Isolated visual fixture: real React screen, synthetic IPC data, no Hermes launch.
import { createRoot } from "react-dom/client";
import BotGroups from "../../src/renderer/src/screens/BotGroups/BotGroups";
import { I18nProvider } from "../../src/renderer/src/components/I18nProvider";
import "../../src/renderer/src/assets/main.css";
import type {
  BotGroupAPI,
  BotGroupEvent,
  BotGroupRoom,
} from "../../src/shared/bot-groups";

const room: BotGroupRoom = {
  room_id: "fixture-room",
  name: "Research team",
  authority_gateway_id: "fixture",
  authority_epoch: 1,
  members: ["research", "review"].map((profile, i) => ({
    member_id: "m" + i,
    profile,
    handle: profile,
    display_name: profile === "research" ? "Research" : "Review",
  })),
};
const history: BotGroupEvent[] = [
  {
    room_id: room.room_id,
    event_id: "fixture-user",
    seq: 1,
    kind: "message.user",
    payload: {
      text: "@research Summarize the proposal, then @review check the risks.",
    },
  },
  {
    room_id: room.room_id,
    event_id: "fixture-research",
    seq: 2,
    kind: "message.member",
    payload: {
      member_id: "m0",
      text: "[Synthetic fixture] The proposal keeps shared context in Hermes and exposes only presentation controls to the desktop.",
    },
  },
  {
    room_id: room.room_id,
    event_id: "fixture-review",
    seq: 3,
    kind: "message.member",
    payload: {
      member_id: "m1",
      text: "[Synthetic fixture] Check permission boundaries, reconnect behavior, and uncertain external actions before release.",
    },
  },
];
const calls: { op: string; params: Record<string, unknown> }[] = [];
Object.assign(window, { botGroupFixtureCalls: calls });
const botGroups = (async (_connection: string, op: string, params = {}) => {
  calls.push({ op, params });
  if (op === "capabilities")
    return {
      enabled: true,
      available: true,
      capabilities: {
        protocol_version: 2,
        driver: true,
        methods: [
          "list",
          "state",
          "log",
          "send",
          "stop",
          "create",
          "approve",
          "retry",
        ].map((m) => "groups." + m),
      },
    };
  if (op === "list") return { rooms: [room], next_offset: null };
  if (op === "profiles")
    return {
      profiles: room.members.map((m) => ({
        name: m.profile,
        display_name: m.display_name,
      })),
    };
  if (op === "state")
    return {
      room,
      driver_status: {
        running: true,
        working: false,
        blocked: false,
        pending_actions: [],
      },
    };
  if (op === "log")
    return {
      events: history.filter((e) => e.seq > Number(params.since_seq || 0)),
      cursor: history.length,
      has_more: false,
      authority: { gateway_id: "fixture", epoch: 1 },
    };
  if (op === "send") {
    history.push({
      room_id: room.room_id,
      event_id: String(params.event_id),
      seq: history.length + 1,
      kind: "message.user",
      payload: params.payload as BotGroupEvent["payload"],
    });
    return { accepted: true };
  }
  throw new Error("This operation is outside the visual fixture.");
}) as BotGroupAPI;
window.hermesAPI = { botGroups } as Window["hermesAPI"];
createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <BotGroups connectionId="visual-fixture" visible />
  </I18nProvider>,
);
