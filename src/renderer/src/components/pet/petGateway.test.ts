// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPetGateway, petRequest, refreshPetInfo } from "./petGateway";

const connect = vi.fn();
const request = vi.fn();
vi.mock("../../screens/Chat/dashboardGatewayClient", () => ({
  DashboardGatewayClient: class {
    connect = connect;
    request = request;
    close = vi.fn();
  },
}));

beforeEach(() => {
  connect.mockReset();
  request.mockReset();
  connect.mockResolvedValue(undefined);
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    onConnectionConfigChanged: vi.fn().mockReturnValue(vi.fn()),
    startDashboard: vi.fn().mockResolvedValue({
      running: true,
      connection: { wsUrl: "ws://fallback" },
    }),
    freshDashboardWsUrl: vi.fn().mockResolvedValue("ws://fresh-ticket"),
  };
});

describe("pet gateway interoperability", () => {
  it("connects to the selected machine with a fresh single-use ticket", async () => {
    await openPetGateway("phoenix", "machine-b");
    expect(window.hermesAPI.startDashboard).toHaveBeenCalledWith(
      "phoenix",
      "machine-b",
    );
    expect(window.hermesAPI.freshDashboardWsUrl).toHaveBeenCalledWith(
      "phoenix",
      "machine-b",
    );
    expect(connect).toHaveBeenCalledWith("ws://fresh-ticket");
  });

  // @lat: [[shared-pets#Connection edit regressions#Handshake fencing]]
  it("does not pair a dashboard from the old endpoint with a ticket from an edited endpoint", async () => {
    let changed = (): void => {};
    const unsubscribe = vi.fn();
    vi.mocked(window.hermesAPI.onConnectionConfigChanged).mockImplementation(
      (handler) => {
        changed = () => handler({} as never);
        return unsubscribe;
      },
    );
    let resolveStart!: (value: unknown) => void;
    vi.mocked(window.hermesAPI.startDashboard).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve as (value: unknown) => void;
        }),
    );
    const pending = openPetGateway("phoenix", "machine-b");
    const failure = expect(pending).rejects.toThrow(/connection changed/i);
    changed();
    resolveStart({ running: true, connection: { wsUrl: "ws://old-endpoint" } });
    await failure;
    expect(window.hermesAPI.freshDashboardWsUrl).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not fall back to local pets when the selected connection has no dashboard", async () => {
    vi.mocked(window.hermesAPI.startDashboard).mockResolvedValueOnce({
      running: false,
      supported: false,
    });
    await expect(openPetGateway("default", "machine-b")).rejects.toThrow(
      /unavailable/i,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it("scopes every RPC, including default, to the selected profile", async () => {
    request.mockResolvedValue({ ok: true });
    const client = await openPetGateway("default", "machine-b");
    await petRequest(client, "default", "pet.select", { slug: "cat" });
    await petRequest(client, "phoenix", "pet.gallery", { localOnly: true });
    expect(request).toHaveBeenNthCalledWith(1, "pet.select", {
      profile: "default",
      slug: "cat",
    });
    expect(request).toHaveBeenNthCalledWith(2, "pet.gallery", {
      profile: "phoenix",
      localOnly: true,
    });
  });

  it("never lets action parameters override the selected profile", async () => {
    request.mockResolvedValue({ ok: true });
    const client = await openPetGateway("phoenix", "machine-b");
    await petRequest(client, "phoenix", "pet.scale", {
      profile: "default",
      scale: 0.5,
    });
    expect(request).toHaveBeenCalledWith("pet.scale", {
      profile: "phoenix",
      scale: 0.5,
    });
  });

  it("reuses the sheet on matching revision and reloads it after a change", async () => {
    const client = await openPetGateway("default", "machine-b");
    const previous = {
      enabled: true,
      slug: "cat",
      spritesheetRevision: "v1",
      spritesheetBase64: "sheet",
      scale: 0.33,
    };
    request.mockResolvedValueOnce({
      enabled: true,
      slug: "cat",
      spritesheetRevision: "v1",
      spritesheetUnchanged: true,
      scale: 0.5,
    });
    expect(await refreshPetInfo(client, "default", previous)).toEqual({
      ...previous,
      scale: 0.5,
    });
    request.mockResolvedValueOnce({
      enabled: true,
      slug: "dog",
      spritesheetRevision: "v2",
      spritesheetBase64: "new-sheet",
    });
    expect(await refreshPetInfo(client, "default", previous)).toMatchObject({
      slug: "dog",
      spritesheetBase64: "new-sheet",
    });
    expect(request).toHaveBeenNthCalledWith(1, "pet.info", {
      profile: "default",
      knownRevision: "v1",
    });
  });
});
