import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const ipc = readFileSync(join(root, "src/main/ipc/register.ts"), "utf8");

function ipcHandlerSource(channel: string): string {
  const start = ipc.indexOf(`ipcMain.handle("${channel}"`);
  if (start === -1) return "";
  const next = ipc.indexOf("ipcMain.handle(", start + 1);
  return ipc.slice(start, next === -1 ? undefined : next);
}

describe("remote management renderer gates", () => {
  // @lat: [[remote-management#Test specifications#Renderer feature gates]]
  it("does not replace Skills with a remote-mode notice", () => {
    const layout = readFileSync(
      join(root, "src/renderer/src/screens/Layout/Layout.tsx"),
      "utf8",
    );
    const tools = readFileSync(
      join(root, "src/renderer/src/screens/Tools/Tools.tsx"),
      "utf8",
    );
    expect(layout).not.toContain('<RemoteNotice feature="Skills" />');
    expect(tools).not.toContain('<RemoteNotice feature="Skills" />');
  });

  it("keeps platform Toolsets visible in Remote mode", () => {
    const layout = readFileSync(
      join(root, "src/renderer/src/screens/Layout/Layout.tsx"),
      "utf8",
    );
    expect(layout).not.toContain("showPlatformToolsets={!remoteMode}");
  });

  it("does not replace Profiles with a remote-mode notice", () => {
    const layout = readFileSync(
      join(root, "src/renderer/src/screens/Layout/Layout.tsx"),
      "utf8",
    );
    expect(layout).not.toContain('<RemoteNotice feature="Profiles" />');
  });

  it("does not replace Gateway with a remote-mode notice", () => {
    const layout = readFileSync(
      join(root, "src/renderer/src/screens/Layout/Layout.tsx"),
      "utf8",
    );
    expect(layout).not.toContain('<RemoteNotice feature="Gateway" />');
  });
});

describe("direct Remote IPC routing", () => {
  const routes = [
    [
      "list-installed-skills",
      "remoteListInstalledSkills",
      "listInstalledSkills",
    ],
    ["get-toolsets", "remoteGetToolsets", "getToolsets"],
    ["list-profiles", "remoteListProfiles", "listProfiles"],
    ["gateway-status", "remoteGatewayStatus", "isGatewayRunning"],
  ] as const;

  // @lat: [[remote-management#Test specifications#No local fallthrough]]
  it.each(routes)(
    "%s returns its remote adapter before the local implementation",
    (channel, remoteCall, localCall) => {
      const source = ipcHandlerSource(channel);
      const remoteMode = source.indexOf('conn.mode === "remote"');
      const remoteReturn = source.indexOf(`return ${remoteCall}`);
      const localReturn = source.indexOf(`return ${localCall}`);

      expect(source).not.toBe("");
      expect(remoteMode).toBeGreaterThanOrEqual(0);
      expect(remoteReturn).toBeGreaterThan(remoteMode);
      expect(localReturn).toBeGreaterThan(remoteReturn);
    },
  );
});
