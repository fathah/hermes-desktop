import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BotGroupAction,
  BotGroupOperation,
  BotGroupRoom,
} from "../../../../shared/bot-groups";
vi.mock("../../components/useI18n", () => {
  const t = (key: string): string => key;
  return { useI18n: () => ({ t }) };
});
import BotGroups from "./BotGroups";

const room = (id: string): BotGroupRoom => ({
  room_id: id,
  name: "Team " + id,
  authority_gateway_id: "fixture",
  authority_epoch: 1,
  members: ["research", "review"].map((profile, i) => ({
    member_id: "m" + i,
    profile,
    handle: profile,
    display_name: profile,
  })),
});
const rooms = [room("one"), room("two")];
const api = vi.fn();
let actions: BotGroupAction[] = [];
let loseAck = false;
let notifyConnectionChange = (): void => {};

beforeEach(() => {
  actions = [];
  loseAck = false;
  api.mockReset();
  api.mockImplementation(
    async (
      _connectionId: string,
      op: BotGroupOperation,
      params: Record<string, unknown> = {},
    ) => {
      if (op === "capabilities")
        return {
          enabled: true,
          available: true,
          capabilities: {
            driver: true,
            protocol_version: 2,
            methods: [
              "list",
              "state",
              "log",
              "create",
              "send",
              "approve",
              "retry",
              "stop",
            ].map((m) => "groups." + m),
          },
        };
      if (op === "list") return { rooms, next_offset: null };
      if (op === "profiles")
        return {
          profiles: rooms[0].members.map((m) => ({
            name: m.profile,
            display_name: m.display_name,
          })),
        };
      if (op === "state")
        return {
          room: rooms.find((r) => r.room_id === params.room_id),
          driver_status: {
            running: true,
            working: false,
            blocked: actions.length > 0,
            pending_actions: [...actions],
          },
        };
      if (op === "log")
        return {
          events: [],
          cursor: 0,
          has_more: false,
          authority: { gateway_id: "fixture", epoch: 1 },
        };
      if (op === "send") {
        if (loseAck) {
          loseAck = false;
          throw new Error("No acknowledgement");
        }
        return { accepted: true };
      }
      if (op === "approve" || op === "retry") {
        actions = [];
        return { approved: true, retried: true };
      }
      if (op === "create") return { room: { ...room("three"), ...params } };
      return { cancelled: 1 };
    },
  );
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      botGroups: api,
      onConnectionConfigChanged: (handler: () => void) => {
        notifyConnectionChange = handler;
        return (): void => {};
      },
    },
  });
});

async function open(): Promise<ReturnType<typeof render>> {
  const view = render(<BotGroups connectionId="local-one" visible />);
  await screen.findByRole("textbox", { name: "botGroups.composeHint" });
  return view;
}

describe("Bot groups presentation lifecycle", () => {
  it("requires an explicit retry and preserves the event ID and shared thread", async () => {
    // @lat: [[bot-groups#Explicit send retry]]
    await open();
    fireEvent.click(screen.getByRole("button", { name: "@research" }));
    const input = screen.getByRole("textbox", {
      name: "botGroups.composeHint",
    });
    expect(input).toHaveValue("@research ");
    fireEvent.change(input, { target: { value: "@review check this" } });
    loseAck = true;
    fireEvent.click(screen.getByRole("button", { name: "botGroups.send" }));
    await screen.findByRole("alert");
    expect(api.mock.calls.filter((c) => c[1] === "send")).toHaveLength(1);
    expect(input).toHaveValue("@review check this");
    fireEvent.click(screen.getByRole("button", { name: "botGroups.send" }));
    await waitFor(() => expect(input).toHaveValue(""));
    const sends = api.mock.calls.filter((c) => c[1] === "send");
    expect(sends).toHaveLength(2);
    expect(sends[0]).toEqual(sends[1]);
    expect(sends[0][2].payload.thread_id).toBe("main");
  });
  it("keeps old room responses out of a newly selected room", async () => {
    // @lat: [[bot-groups#View lifecycle]]
    await open();
    const ordinary = api.getMockImplementation()!;
    let resolveOld: (value: unknown) => void = () => {};
    api.mockImplementation((connection, op, params) =>
      op === "state" && params.room_id === "one"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : ordinary(connection, op, params),
    );
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Team two" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Team two" })).toBeVisible(),
    );
    await act(async () => {
      resolveOld({
        room: rooms[0],
        driver_status: { running: true, working: false, pending_actions: [] },
      });
    });
    expect(
      screen.queryByRole("heading", { name: "Team one" }),
    ).not.toBeInTheDocument();
  });
  it("sends exact approval identity and never offers an always-allow action", async () => {
    // @lat: [[bot-groups#Exact approval]]
    actions = [
      {
        kind: "approval",
        member_id: "m1",
        task_id: "t1",
        request_id: "r1",
        execution_generation: 4,
        approval: { command: "echo test", choices: ["once", "deny", "always"] },
      },
    ];
    await open();
    expect(
      screen.queryByRole("button", { name: /always/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "botGroups.deny" }));
    await waitFor(() =>
      expect(api.mock.calls.some((c) => c[1] === "approve")).toBe(true),
    );
    expect(api.mock.calls.find((c) => c[1] === "approve")?.[2]).toEqual({
      room_id: "one",
      member_id: "m1",
      task_id: "t1",
      request_id: "r1",
      execution_generation: 4,
      choice: "deny",
    });
  });
  it("does not retry an uncertain task until confirmation", async () => {
    actions = [{ kind: "retry", task_id: "t1" }];
    await open();
    fireEvent.click(screen.getByRole("button", { name: "botGroups.retry" }));
    expect(api.mock.calls.filter((c) => c[1] === "retry")).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "botGroups.confirmRetry" }),
    );
    await waitFor(() =>
      expect(api.mock.calls.filter((c) => c[1] === "retry")).toHaveLength(1),
    );
  });
  it("creates a group with the selected profiles rather than reusing chat sessions", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "botGroups.create" }));
    fireEvent.change(screen.getByRole("textbox", { name: "botGroups.name" }), {
      target: { value: "Review team" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "research" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "review" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "botGroups.create" })[1],
    );
    await waitFor(() =>
      expect(api.mock.calls.some((c) => c[1] === "create")).toBe(true),
    );
    expect(
      api.mock.calls
        .find((c) => c[1] === "create")?.[2]
        .members.map((m) => m.profile),
    ).toEqual(["research", "review"]);
  });
});

// @lat: [[bot-groups#Recovery regressions#Edited connection scope]]
it("discards drafts and cached rooms when a connection is edited without changing its ID", async () => {
  render(<BotGroups connectionId="same-id" visible />);
  const composer = await screen.findByRole("textbox", {
    name: "botGroups.composeHint",
  });
  fireEvent.change(composer, {
    target: { value: "draft for old local installation" },
  });
  api.mockImplementation(async (_connection, op) =>
    op === "capabilities"
      ? {
          enabled: true,
          available: false,
          error: "Remote connections are unsupported",
        }
      : Promise.reject(new Error("must not read old local group")),
  );
  act(() => notifyConnectionChange());
  expect(
    await screen.findByText("Remote connections are unsupported"),
  ).toBeInTheDocument();
  expect(
    screen.queryByDisplayValue("draft for old local installation"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Team one")).not.toBeInTheDocument();
});

// @lat: [[bot-groups#Recovery regressions#Unconfirmed room creation]]
it("keeps create identity on an explicit retry after an unconfirmed acknowledgement", async () => {
  await open();
  const ordinary = api.getMockImplementation()!;
  let unconfirmed = true;
  let created: BotGroupRoom | null = null;
  api.mockImplementation((connection, op, params) => {
    if (op === "create") {
      created ||= {
        ...room(params.room_id),
        name: params.name,
        members: params.members,
      };
      if (unconfirmed) {
        unconfirmed = false;
        return Promise.reject(new Error("Create acknowledgement lost"));
      }
      return Promise.resolve({ room: created });
    }
    if (op === "state" && created && params.room_id === created.room_id)
      return Promise.resolve({
        room: created,
        driver_status: {
          running: true,
          working: false,
          blocked: false,
          pending_actions: [],
        },
      });
    return ordinary(connection, op, params);
  });
  fireEvent.click(screen.getByRole("button", { name: "botGroups.create" }));
  fireEvent.change(screen.getByRole("textbox", { name: "botGroups.name" }), {
    target: { value: "Team retry" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "research" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "review" }));
  fireEvent.click(
    screen.getAllByRole("button", { name: "botGroups.create" })[1],
  );
  await screen.findByText("Create acknowledgement lost");
  expect(api.mock.calls.filter((call) => call[1] === "create")).toHaveLength(1);
  fireEvent.click(
    screen.getAllByRole("button", { name: "botGroups.create" })[1],
  );
  await screen.findByRole("heading", { name: "Team retry" });
  const creates = api.mock.calls.filter((call) => call[1] === "create");
  expect(creates).toHaveLength(2);
  expect(creates[0]).toEqual(creates[1]);
});

// @lat: [[bot-groups#Recovery regressions#Creation preserves navigation]]
it.each(["two", "one"])(
  "a late accepted creation preserves the newer deliberate selection of %s",
  async (selectedRoom) => {
    await open();
    const ordinary = api.getMockImplementation()!;
    let completeCreate!: () => void;
    let created: BotGroupRoom | null = null;
    api.mockImplementation((connection, op, params) => {
      if (op === "create")
        return new Promise((done) => {
          completeCreate = () => {
            created = {
              ...room(params.room_id),
              name: params.name,
              members: params.members,
            };
            done({ room: created });
          };
        });
      if (op === "state" && created && params.room_id === created.room_id)
        return Promise.resolve({
          room: created,
          driver_status: {
            running: true,
            working: false,
            blocked: false,
            pending_actions: [],
          },
        });
      return ordinary(connection, op, params);
    });
    fireEvent.click(screen.getByRole("button", { name: "botGroups.create" }));
    fireEvent.change(screen.getByRole("textbox", { name: "botGroups.name" }), {
      target: { value: "Slow created room" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "research" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "review" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "botGroups.create" })[1],
    );
    fireEvent.click(screen.getByRole("button", { name: "Team two" }));
    await screen.findByRole("heading", { name: "Team two" });
    if (selectedRoom === "one") {
      fireEvent.click(screen.getByRole("button", { name: "Team one" }));
      await screen.findByRole("heading", { name: "Team one" });
    }
    await act(async () => completeCreate());
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: `Team ${selectedRoom}` }),
      ).toBeVisible(),
    );
  },
);

// @lat: [[bot-groups#Recovery regressions#Delayed action room isolation]]
it.each([
  ["approve", "success"],
  ["approve", "error"],
  ["retry", "success"],
  ["retry", "error"],
  ["send", "success"],
  ["send", "error"],
] as const)(
  "keeps a delayed %s %s result out of the newer room and draft",
  async (operation, outcome) => {
    actions =
      operation === "approve"
        ? [
            {
              kind: "approval",
              member_id: "m1",
              task_id: "t1",
              request_id: "r1",
              execution_generation: 4,
              approval: { command: "echo test", choices: ["once", "deny"] },
            },
          ]
        : operation === "retry"
          ? [{ kind: "retry", task_id: "t1" }]
          : [];
    const ordinary = api.getMockImplementation()!;
    let settle!: () => void;
    api.mockImplementation((connection, op, params) => {
      if (op === operation && params.room_id === "one")
        return new Promise((resolve, reject) => {
          settle = () =>
            outcome === "error"
              ? reject(new Error("Late old-room failure"))
              : resolve({ accepted: true, approved: true, retried: true });
        });
      return ordinary(connection, op, params);
    });
    await open();
    if (operation === "approve")
      fireEvent.click(screen.getByRole("button", { name: "botGroups.deny" }));
    else if (operation === "retry") {
      fireEvent.click(screen.getByRole("button", { name: "botGroups.retry" }));
      fireEvent.click(
        screen.getByRole("button", { name: "botGroups.confirmRetry" }),
      );
    } else {
      fireEvent.change(
        screen.getByRole("textbox", { name: "botGroups.composeHint" }),
        { target: { value: "old room submitted draft" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "botGroups.send" }));
    }
    actions = [];
    fireEvent.click(screen.getByRole("button", { name: "Team two" }));
    await screen.findByRole("heading", { name: "Team two" });
    const composer = screen.getByRole("textbox", {
      name: "botGroups.composeHint",
    });
    fireEvent.change(composer, { target: { value: "new room unsent draft" } });
    await act(async () => settle());
    expect(screen.getByRole("heading", { name: "Team two" })).toBeVisible();
    expect(composer).toHaveValue("new room unsent draft");
    expect(screen.queryByText(/Late old-room failure/)).toBeNull();
  },
);
