import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("./config", () => ({
  getConnectionConfig: () => ({ mode: "remote", remoteUrl: "http://r:9119" }),
}));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: request }));

import {
  remoteAssignTask,
  remoteCompleteTask,
  remoteCreateTask,
  remoteCurrentBoard,
  remoteGetTask,
  remoteListBoards,
  remoteListTasks,
  remotePromoteTask,
  remoteSpecifyTask,
  remoteSwitchBoard,
  resetRemoteKanbanState,
} from "./remote-kanban";

const call = (n: number) => request.mock.calls[n];

describe("remote kanban", () => {
  beforeEach(() => {
    request.mockReset();
    resetRemoteKanbanState();
  });

  it("flattens board columns into tasks and filters by status client-side", async () => {
    request.mockResolvedValue({
      columns: [
        { name: "todo", tasks: [{ id: "t1", status: "todo", assignee: "a" }] },
        { name: "done", tasks: [{ id: "t2", status: "done", assignee: "b" }] },
      ],
    });
    const all = await remoteListTasks({});
    expect(all.data?.map((t) => t.id)).toEqual(["t1", "t2"]);
    const done = await remoteListTasks({ status: "done" });
    expect(done.data?.map((t) => t.id)).toEqual(["t2"]);
    expect(call(0)[1]).toBe("/api/plugins/kanban/board");
  });

  it("keeps the selected board client-side and never calls the server switch", async () => {
    request.mockResolvedValue({
      boards: [{ slug: "default" }, { slug: "ops" }],
      current: "default",
    });
    expect((await remoteSwitchBoard("ops")).success).toBe(true);
    expect((await remoteCurrentBoard()).data).toBe("ops");
    const boards = await remoteListBoards(false);
    expect(boards.data?.map((b) => [b.slug, b.is_current])).toEqual([
      ["default", false],
      ["ops", true],
    ]);
    request.mockClear();
    request.mockResolvedValue({ columns: [] });
    await remoteListTasks({});
    expect(call(0)[1]).toBe("/api/plugins/kanban/board?board=ops");
    expect(
      request.mock.calls.some((c) => String(c[1]).includes("/switch")),
    ).toBe(false);
  });

  it("rejects switching to a board the server does not have", async () => {
    request.mockResolvedValue({
      boards: [{ slug: "default" }],
      current: "default",
    });
    const res = await remoteSwitchBoard("nope");
    expect(res).toMatchObject({ success: false, error: "Unknown board: nope" });
    expect((await remoteCurrentBoard()).data).toBe("default");
  });

  it("maps task detail links and latest summary", async () => {
    request.mockResolvedValue({
      task: { id: "t1", latest_summary: "did it" },
      links: { parents: ["p"], children: ["c"] },
      comments: [{ id: 1 }],
    });
    const res = await remoteGetTask("t1");
    expect(res.data).toMatchObject({
      parents: ["p"],
      children: ["c"],
      latest_summary: "did it",
      events: [],
      runs: [],
    });
  });

  it("expresses status verbs as PATCH /tasks/{id}", async () => {
    request.mockResolvedValue({});
    await remoteAssignTask("t1", null);
    await remoteCompleteTask("t1", "ok");
    await remotePromoteTask("t1");
    expect(request.mock.calls.map((c) => [c[2].method, c[2].body])).toEqual([
      ["PATCH", { assignee: "" }],
      ["PATCH", { status: "done", result: "ok" }],
      ["PATCH", { status: "ready" }],
    ]);
  });

  it("surfaces the server's dependency refusal text instead of forcing", async () => {
    request.mockImplementation(async () => {
      throw Object.assign(
        new Error("Cannot move to 'ready': blocked by parent"),
        {
          statusCode: 409,
        },
      );
    });
    const res = await remotePromoteTask("t1");
    expect(res).toMatchObject({
      success: false,
      error: "Cannot move to 'ready': blocked by parent",
    });
  });

  it("creates a task with workspace parsed from the dir: form", async () => {
    request.mockResolvedValue({ task: { id: "t9" } });
    const res = await remoteCreateTask({
      title: "x",
      workspace: "dir:/srv/app",
      skills: [],
    });
    expect(res.data).toEqual({ id: "t9" });
    expect(call(0)[2].body).toMatchObject({
      title: "x",
      workspace_kind: "dir",
      workspace_path: "/srv/app",
      skills: undefined,
    });
  });

  it("reports a refused specify as an error with the server's reason", async () => {
    request.mockResolvedValue({ ok: false, reason: "no aux model" });
    expect(await remoteSpecifyTask("t1")).toEqual({
      success: false,
      error: "no aux model",
    });
  });

  it("explains a missing kanban plugin (404) instead of a bare status", async () => {
    request.mockImplementation(async () => {
      throw Object.assign(new Error("404"), { statusCode: 404 });
    });
    const res = await remoteListTasks({});
    expect(res.error).toMatch(/kanban dashboard plugin/);
  });
});
