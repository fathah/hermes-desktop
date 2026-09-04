import { spawnSync } from "child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const workDirs: string[] = [];

afterEach(() => {
  for (const workDir of workDirs.splice(0)) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe("macOS signing certificate import", () => {
  it("uses different passwords for the certificate and temporary keychain", () => {
    const workDir = mkdtempSync(join(tmpdir(), "hermes-macos-signing-"));
    workDirs.push(workDir);

    const fakeBin = join(workDir, "bin");
    const runnerTemp = join(workDir, "runner");
    const githubEnv = join(workDir, "github-env");
    const securityLog = join(workDir, "security.log");
    mkdirSync(fakeBin);
    mkdirSync(runnerTemp);

    const fakeSecurity = join(fakeBin, "security");
    writeFileSync(
      fakeSecurity,
      `#!/bin/bash
printf '%s\\n' "$*" >> "$SECURITY_LOG"
if [ "$1" = "find-identity" ]; then
  echo '1) ABC123 "Developer ID Application: Hermes Test (ABCDE12345)"'
  echo '  1 valid identities found'
fi
`,
    );
    chmodSync(fakeSecurity, 0o755);

    const result = spawnSync(
      "/bin/bash",
      [join(ROOT, "scripts/import-macos-certificate.sh")],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          RUNNER_TEMP: runnerTemp,
          GITHUB_ENV: githubEnv,
          SECURITY_LOG: securityLog,
          CSC_LINK: Buffer.from("certificate-bytes").toString("base64"),
          CSC_KEY_PASSWORD: "certificate-password",
          MACOS_KEYCHAIN_PASSWORD: "test-keychain-password",
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(securityLog, "utf-8");
    const keychain = join(
      runnerTemp,
      "hermes-macos-signing/hermes-signing.keychain-db",
    );

    expect(log).toContain(
      `create-keychain -p test-keychain-password ${keychain}`,
    );
    expect(log).toContain(
      `import ${runnerTemp}/hermes-macos-signing/developer-id.p12`,
    );
    expect(log).toContain("-P certificate-password");
    expect(log).toContain(
      `set-key-partition-list -S apple-tool:,apple:,codesign: -s -k test-keychain-password ${keychain}`,
    );
    expect(readFileSync(githubEnv, "utf-8")).toBe(`CSC_KEYCHAIN=${keychain}\n`);
    expect(
      existsSync(join(runnerTemp, "hermes-macos-signing/developer-id.p12")),
    ).toBe(false);
  });
});
