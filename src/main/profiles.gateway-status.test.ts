import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./installer", () => ({
  HERMES_HOME: process.env.HERMES_ONE_PROFILE_TEST_HOME,
}));
vi.mock("./utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./utils")>()),
  pidIsAliveAs: vi.fn(() => true),
}));

describe("local profile gateway status", () => {
  // @lat: [[connections#Test specifications#Multiplex status in profile lists]]
  it.skipIf(process.platform !== "linux")(
    "reports only the multiplex default profile online in the status bar list",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "hermes-one-profile-status-"));
      process.env.HERMES_ONE_PROFILE_TEST_HOME = home;
      try {
        mkdirSync(join(home, "profiles", "scout"), { recursive: true });
        writeFileSync(join(home, "active_profile"), "default");
        const stat = readFileSync(`/proc/${process.pid}/stat`, "utf-8");
        const startTime = Number(
          stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
        );
        writeFileSync(
          join(home, "gateway_state.json"),
          JSON.stringify({
            gateway_state: "running",
            kind: "hermes-gateway",
            hermes_home: home,
            pid: process.pid,
            start_time: startTime,
            served_profiles: ["default", "scout"],
          }),
        );
        const { listProfiles } = await import("./profiles");
        const profiles = await listProfiles();
        expect(
          profiles.map(({ id, gatewayRunning }) => ({ id, gatewayRunning })),
        ).toEqual([
          { id: "default", gatewayRunning: true },
          { id: "scout", gatewayRunning: false },
        ]);
      } finally {
        delete process.env.HERMES_ONE_PROFILE_TEST_HOME;
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
});
