// @vitest-environment node
// Run only against a disposable SSH account: these tests write ~/.hermes fixtures.
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/main/locale", () => ({ getAppLocale: () => "en" }));
import {
  sshExec,
  sshResolveDashboardRoot,
  sshEnsureDashboardToken,
  sshSetEnvValue,
  sshReadEnv,
  sshWriteSoul,
  sshReadSoul,
  sshWaitGatewayApiReady,
  shellQuote,
} from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";
const config: SshConfig = {
  host: "127.0.0.1",
  port: Number(process.env.HERMES_TEST_SSH_PORT || 19322),
  username: "root",
  keyPath: process.env.HERMES_TEST_SSH_KEY || "",
  remotePort: 8642,
  localPort: 18642,
};
describe.skipIf(!process.env.HERMES_TEST_SSH_KEY)(
  "disposable fish-login SSH endpoint",
  () => {
    // @lat: [[main-process#SSH login shell#Live fish endpoint]]
    it("executes POSIX assignments and control flow", async () => {
      await expect(
        sshExec(
          config,
          'value=ready; for n in one two; do printf "%s:%s\\n" "$value" "$n"; done',
        ),
      ).resolves.toBe("ready:one\nready:two\n");
    });
    it("preserves command literals parsed by fish", async () => {
      const value = "' \\ \\\\ $HOME $(false) `false`\n中文";
      await expect(
        sshExec(config, `printf '%s' ${shellQuote(value)}`),
      ).resolves.toBe(value);
    });
    it("checks the loopback health endpoint", async () => {
      expect(await sshWaitGatewayApiReady(config, 19864, 1000)).toBe(true);
    });
    it("finds the dashboard dist through the actual probe", async () => {
      await sshExec(
        config,
        "mkdir -p ~/.hermes/hermes-agent/hermes_cli/web_dist; touch ~/.hermes/hermes-agent/hermes_cli/web_dist/index.html",
      );
      await expect(sshResolveDashboardRoot(config)).resolves.toBe(
        "/root/.hermes/hermes-agent",
      );
    });
    it("preserves transactional credentials, port and stdin file data", async () => {
      const token = await sshEnsureDashboardToken(config);
      expect(token.length).toBeGreaterThan(16);
      await sshSetEnvValue(config, "HERMES_DESKTOP_DASHBOARD_PORT", "9119");
      expect((await sshReadEnv(config)).HERMES_DESKTOP_DASHBOARD_PORT).toBe(
        "9119",
      );
      expect(await sshEnsureDashboardToken(config)).toBe(token);
      const content = "quotes: ' \" \\ \\\\ $HOME $(false) `false`\n中文\n";
      expect(await sshWriteSoul(config, content, "shell-fixture")).toBe(true);
      expect(await sshReadSoul(config, "shell-fixture")).toBe(content);
    });
    it("preserves stderr on failure and accepts the next command", async () => {
      await expect(
        sshExec(config, 'printf "probe failed" >&2; exit 7'),
      ).rejects.toThrow("probe failed");
      await expect(sshExec(config, "printf recovered")).resolves.toBe(
        "recovered",
      );
    });
  },
);
