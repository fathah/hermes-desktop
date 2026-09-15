import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), request: vi.fn() }));
vi.mock("./config", () => ({ getConnectionConfig: mocks.config }));
vi.mock("./hermes", () => ({ requestLocalBotGroup: mocks.request }));
import { botGroupsRequest } from "./bot-groups";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HERMES_DESKTOP_BOT_GROUPS", "1");
  mocks.config.mockReturnValue({ mode: "local" });
});

describe("Bot groups main-process boundary", () => {
  it("does not start a gateway when disabled or silently route remote requests locally", async () => {
    // @lat: [[bot-groups#Connection scope]]
    vi.stubEnv("HERMES_DESKTOP_BOT_GROUPS", "");
    expect(await botGroupsRequest("local-one", "capabilities")).toEqual({
      enabled: false,
      available: false,
    });
    vi.stubEnv("HERMES_DESKTOP_BOT_GROUPS", "1");
    mocks.config.mockReturnValue({ mode: "remote" });
    expect(await botGroupsRequest("remote-one", "capabilities")).toMatchObject({
      enabled: true,
      available: false,
    });
    await expect(
      botGroupsRequest("remote-one", "send", {
        room_id: "r",
        event_id: "e",
        payload: { text: "hi", thread_id: "main" },
      }),
    ).rejects.toThrow("local Hermes");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.config).toHaveBeenCalledWith("remote-one");
  });
  it("strips profile paths and hidden session summaries from the roster", async () => {
    mocks.request.mockResolvedValue({
      profiles: [
        {
          name: "review",
          display_name: "Review",
          path: "/private",
          canonical_session: { preview: "private" },
        },
      ],
    });
    expect(await botGroupsRequest("local-one", "profiles")).toEqual({
      profiles: [{ name: "review", display_name: "Review" }],
    });
  });
  it("does not leak authenticated URLs from transport failures", async () => {
    mocks.request.mockRejectedValue(
      new Error("ws://127.0.0.1/api/ws?token=private-secret"),
    );
    await expect(
      botGroupsRequest("local-one", "state", { room_id: "room-one" }),
    ).rejects.toThrow("Hermes could not complete");
    const status = await botGroupsRequest("local-one", "capabilities");
    expect(JSON.stringify(status)).not.toContain("private-secret");
  });
});
