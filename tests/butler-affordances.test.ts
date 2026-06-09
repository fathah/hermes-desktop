import { describe, it, expect, vi, afterEach } from "vitest";
import { validateResult } from "../src/renderer/src/screens/SpsAgent/assistant/validate";
import { useStore } from "../src/renderer/src/screens/SpsAgent/store";

// Mock the window.hermesAPI object for the store tests
const startSshTunnelMock = vi.fn().mockResolvedValue(true);
const stopSshTunnelMock = vi.fn().mockResolvedValue(true);
const setEnvMock = vi.fn().mockResolvedValue(true);
const setProviderKeyMock = vi.fn().mockResolvedValue(true);

Object.defineProperty(window, "hermesAPI", {
  value: {
    startSshTunnel: startSshTunnelMock,
    stopSshTunnel: stopSshTunnelMock,
    setEnv: setEnvMock,
    setProviderKey: setProviderKeyMock,
  },
  writable: true,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Butler Affordances - Validation", () => {
  it("validates kind page correctly", () => {
    const raw = {
      kind: "page",
      reply: ["Created the design page."],
      label: "create page",
      title: "Architecture Design Notes",
      template: "prd",
    };
    const res = validateResult(raw);
    expect(res).toEqual({
      kind: "page",
      reply: ["Created the design page."],
      label: "create page",
      title: "Architecture Design Notes",
      template: "prd",
    });
  });

  it("validates kind ssh correctly", () => {
    const raw = {
      kind: "ssh",
      reply: ["Starting SSH tunnel..."],
      label: "start ssh",
      action: "start",
    };
    const res = validateResult(raw);
    expect(res).toEqual({
      kind: "ssh",
      reply: ["Starting SSH tunnel..."],
      label: "start ssh",
      action: "start",
    });
  });

  it("validates kind config correctly", () => {
    const raw = {
      kind: "config",
      reply: ["Saving Anthropic API key."],
      label: "save key",
      provider: "anthropic",
      key: "sk-ant-123456",
    };
    const res = validateResult(raw);
    expect(res).toEqual({
      kind: "config",
      reply: ["Saving Anthropic API key."],
      label: "save key",
      provider: "anthropic",
      key: "sk-ant-123456",
    });
  });

  it("rejects invalid page parameters", () => {
    const raw = {
      kind: "page",
      reply: ["Missing title."],
      label: "create page",
      // title is missing
    };
    expect(validateResult(raw)).toBeNull();
  });

  it("rejects invalid ssh parameters", () => {
    const raw = {
      kind: "ssh",
      reply: ["Invalid action."],
      label: "start ssh",
      action: "reboot", // invalid
    };
    expect(validateResult(raw)).toBeNull();
  });
});

describe("Butler Affordances - Store Actions", () => {
  it("executes applySshAction correctly", async () => {
    useStore.setState({
      conversations: [
        {
          id: "c1",
          title: "Chat",
          thinking: false,
          messages: [
            {
              id: "m1",
              role: "bot",
              text: ["Let's start the SSH tunnel."],
              sshAction: { action: "start" },
              status: "pending",
            },
          ],
        },
      ],
    });

    await useStore.getState().applySshAction("m1", "start");

    expect(startSshTunnelMock).toHaveBeenCalled();
    const msg = useStore.getState().conversations[0].messages[0];
    expect(msg.status).toBe("applied");
  });

  it("executes applyConfigAction correctly", async () => {
    useStore.setState({
      conversations: [
        {
          id: "c1",
          title: "Chat",
          thinking: false,
          messages: [
            {
              id: "m1",
              role: "bot",
              text: ["Let's configure openai."],
              configAction: { provider: "openai", key: "sk-proj-1234" },
              status: "pending",
            },
          ],
        },
      ],
    });

    await useStore.getState().applyConfigAction("m1", "openai", "sk-proj-1234");

    // MED-2: routes through the allowlisted provider-key IPC (provider, not env
    // var name), and never the generic set-env.
    expect(setProviderKeyMock).toHaveBeenCalledWith("openai", "sk-proj-1234");
    expect(setEnvMock).not.toHaveBeenCalled();
    const msg = useStore.getState().conversations[0].messages[0];
    expect(msg.status).toBe("applied");
    // MED-2: the raw key is scrubbed from the stored transcript after apply.
    expect(msg.configAction?.key).toBe("••••");
  });
});
