import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("remote management renderer gates", () => {
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
});
