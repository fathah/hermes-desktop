// @vitest-environment node
import { spawn, execFileSync } from "child_process";
import { once } from "events";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
  readdirSync,
  rmSync,
  symlinkSync,
  lstatSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REMOTE_ENV_UPDATE_SCRIPT,
  type RemoteEnvUpdate,
  type RemoteEnvUpdateResult,
} from "../src/main/ssh-env-update";

const directories: string[] = [];
function fixture(
  content = "OPENROUTER_API_KEY=sentinel\nTELEGRAM_BOT_TOKEN=keep\n",
): string {
  const directory = mkdtempSync(join(tmpdir(), "hermes-env-update-"));
  directories.push(directory);
  const path = join(directory, ".env");
  writeFileSync(path, content, { mode: 0o640 });
  return path;
}
function run(
  path: string,
  update: RemoteEnvUpdate,
  prefix = "",
): Promise<RemoteEnvUpdateResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", prefix + REMOTE_ENV_UPDATE_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr));
      else {
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.end(JSON.stringify({ path, ...update }));
  });
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

// SSH targets are POSIX; fcntl is unavailable on native Windows test runners.
describe.skipIf(process.platform === "win32")(
  "remote credential transactions",
  () => {
    // @lat: [[main-process#Main Process#SSH credential persistence#Concurrent writers]]
    it("serializes independent processes and preserves credentials and every update", async () => {
      const path = fixture();
      const lock = spawn("python3", [
        "-c",
        "import fcntl,sys\nf=open(sys.argv[1]+'.lock','a')\nfcntl.flock(f,fcntl.LOCK_EX)\nprint('locked',flush=True)\nsys.stdin.read()",
        path,
      ]);
      await once(lock.stdout, "data");
      let completed = 0;
      const updates: RemoteEnvUpdate[] = [
        { operation: "ensure-dashboard" },
        { operation: "ensure-api" },
        {
          operation: "set",
          key: "HERMES_DESKTOP_DASHBOARD_PORT",
          value: "9119",
        },
        ...Array.from({ length: 8 }, (_, i) => ({
          operation: "set" as const,
          key: `PROVIDER_${i}_KEY`,
          value: `value-${i}`,
        })),
      ];
      const pending = Promise.all(
        updates.map((update) =>
          run(path, update).then((result) => {
            completed++;
            return result;
          }),
        ),
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(completed).toBe(0);
        expect(readFileSync(path, "utf8")).toContain(
          "OPENROUTER_API_KEY=sentinel",
        );
      } finally {
        lock.stdin.end();
      }
      const results = await pending;
      const content = readFileSync(path, "utf8");
      expect(content).toContain(
        "OPENROUTER_API_KEY=sentinel\nTELEGRAM_BOT_TOKEN=keep\n",
      );
      expect(content).toContain(
        `HERMES_DASHBOARD_SESSION_TOKEN=${results[0].values.HERMES_DASHBOARD_SESSION_TOKEN}`,
      );
      expect(content).toContain(
        `API_SERVER_KEY=${results[1].values.API_SERVER_KEY}`,
      );
      expect(content).toContain("API_SERVER_ENABLED=true");
      expect(content).toContain("HERMES_DESKTOP_DASHBOARD_PORT=9119");
      for (let i = 0; i < 8; i++)
        expect(content).toContain(`PROVIDER_${i}_KEY=value-${i}`);
      expect(statSync(path).mode & 0o777).toBe(0o640);
    });

    // @lat: [[main-process#Main Process#SSH credential persistence#Stable provisioning]]
    it.each(["ensure-dashboard", "ensure-api"] as const)(
      "%s returns the same generated key to simultaneous connections",
      async (operation) => {
        const path = fixture();
        const results = await Promise.all(
          Array.from({ length: 8 }, () => run(path, { operation })),
        );
        const key =
          operation === "ensure-dashboard"
            ? "HERMES_DASHBOARD_SESSION_TOKEN"
            : "API_SERVER_KEY";
        expect(new Set(results.map((result) => result.values[key])).size).toBe(
          1,
        );
        expect(results.filter((result) => result.changed)).toHaveLength(1);
        expect(readFileSync(path, "utf8").split(`${key}=`)).toHaveLength(2);
      },
    );

    // @lat: [[main-process#Main Process#SSH credential persistence#Failure preservation]]
    it.each(["read", "fsync", "replace"])(
      "leaves the original byte-identical on a %s failure",
      async (failure) => {
        const path = fixture();
        const original = readFileSync(path);
        const prefix =
          failure === "read"
            ? "import builtins\n_original_open=builtins.open\ndef fail_read(path,*args,**kwargs):\n    raise PermissionError('injected read failure')\nbuiltins.open=fail_read\n"
            : `import os\ndef fail(*args):\n    raise OSError('injected ${failure} failure')\nos.${failure}=fail\n`;
        await expect(
          run(
            path,
            { operation: "set", key: "API_SERVER_KEY", value: "new-secret" },
            prefix,
          ),
        ).rejects.toThrow(`injected ${failure} failure`);
        expect(readFileSync(path)).toEqual(original);
        expect(
          readdirSync(join(path, "..")).filter((name) => name.endsWith(".tmp")),
        ).toEqual([]);
      },
    );

    it("publishes a complete new inode while old readers retain the original snapshot", async () => {
      const path = fixture();
      const original = readFileSync(path, "utf8");
      const prefix =
        "import os\n_replace=os.replace\ndef check_replace(src,dst):\n    with open(dst) as before:\n        original=before.read()\n        _replace(src,dst)\n        before.seek(0)\n        assert before.read()==original\nos.replace=check_replace\n";
      const inode = statSync(path).ino;
      await run(
        path,
        { operation: "set", key: "NEW_KEY", value: "new" },
        prefix,
      );
      expect(statSync(path).ino).not.toBe(inode);
      expect(readFileSync(path, "utf8")).toBe(original + "NEW_KEY=new\n");
    });

    it("preserves unrelated bytes, line endings, ownership and permission bits; deduplicates the requested key", async () => {
      const path = fixture(
        "# Comment\r\nAPI_SERVER_KEY_BACKUP=old\r\n# API_SERVER_KEY=commented\r\nexport API_SERVER_KEY=stale\r\nAPI_SERVER_KEY=last\r\nUNICODE=olá\r\n",
      );
      const before = statSync(path);
      await run(path, {
        operation: "set",
        key: "API_SERVER_KEY",
        value: "replacement",
      });
      expect(readFileSync(path, "utf8")).toBe(
        "# Comment\r\nAPI_SERVER_KEY_BACKUP=old\r\nAPI_SERVER_KEY=replacement\r\nUNICODE=olá\r\n",
      );
      expect(statSync(path).uid).toBe(before.uid);
      expect(statSync(path).gid).toBe(before.gid);
      expect(statSync(path).mode & 0o777).toBe(0o640);
    });

    // @lat: [[main-process#Main Process#SSH credential persistence#Security metadata]]
    it("preserves real access ACLs and extended attributes across replacement", async () => {
      const path = fixture();
      let originalAcl: string;
      if (process.platform === "darwin") {
        execFileSync("chmod", ["+a", "everyone deny write", path]);
        execFileSync("xattr", [
          "-w",
          "user.hermes-test",
          "metadata-sentinel",
          path,
        ]);
        originalAcl = execFileSync("ls", ["-le", path], { encoding: "utf8" })
          .split("\n")
          .filter((line) => /^\s*\d+:/.test(line))
          .join("\n");
      } else {
        execFileSync("python3", [
          "-c",
          "import os,struct,sys; p=sys.argv[1]; acl=struct.pack('<I',2)+b''.join(struct.pack('<HHI',*entry) for entry in [(1,6,0xffffffff),(2,4,65534),(4,4,0xffffffff),(16,4,0xffffffff),(32,0,0xffffffff)]); os.setxattr(p,'system.posix_acl_access',acl); os.setxattr(p,'user.hermes-test',b'metadata-sentinel')",
          path,
        ]);
        originalAcl = execFileSync(
          "python3",
          [
            "-c",
            "import os,sys; print(os.getxattr(sys.argv[1],'system.posix_acl_access').hex())",
            path,
          ],
          { encoding: "utf8" },
        );
      }
      await run(path, { operation: "set", key: "NEW_KEY", value: "new" });
      if (process.platform === "darwin") {
        expect(
          execFileSync("xattr", ["-p", "user.hermes-test", path], {
            encoding: "utf8",
          }).trim(),
        ).toBe("metadata-sentinel");
        expect(
          execFileSync("ls", ["-le", path], { encoding: "utf8" })
            .split("\n")
            .filter((line) => /^\s*\d+:/.test(line))
            .join("\n"),
        ).toBe(originalAcl);
      } else {
        expect(
          execFileSync(
            "python3",
            [
              "-c",
              "import os,sys; print(os.getxattr(sys.argv[1],'system.posix_acl_access').hex())",
              path,
            ],
            { encoding: "utf8" },
          ),
        ).toBe(originalAcl);
        expect(
          execFileSync(
            "python3",
            [
              "-c",
              "import os,sys; print(os.getxattr(sys.argv[1],'user.hermes-test').decode())",
              path,
            ],
            { encoding: "utf8" },
          ).trim(),
        ).toBe("metadata-sentinel");
      }
    });

    it("sets the original access policy before writing credential bytes", async () => {
      const path = fixture();
      const prefix =
        "import os\n_chmod=os.fchmod\ndef check_empty(fd,mode):\n    assert os.fstat(fd).st_size==0, 'secret bytes written before access policy'\n    _chmod(fd,mode)\nos.fchmod=check_empty\n";
      await run(
        path,
        { operation: "set", key: "NEW_KEY", value: "new" },
        prefix,
      );
      expect(readFileSync(path, "utf8")).toContain("NEW_KEY=new");
    });

    it("preserves the original when security metadata cannot be copied", async () => {
      const path = fixture();
      const original = readFileSync(path);
      const prefix =
        process.platform === "darwin"
          ? "import ctypes\ndef fail(*args,**kwargs):\n    raise PermissionError('metadata failure')\nctypes.CDLL=fail\n"
          : "import os\ndef fail(*args,**kwargs):\n    raise PermissionError('metadata failure')\nos.listxattr=fail\n";
      await expect(
        run(path, { operation: "set", key: "NEW_KEY", value: "new" }, prefix),
      ).rejects.toThrow("metadata failure");
      expect(readFileSync(path)).toEqual(original);
    });

    it("preserves a symlink and locks its resolved credential file", async () => {
      const path = fixture();
      const link = join(path, "..", "linked.env");
      symlinkSync(path, link);
      await Promise.all([
        run(path, { operation: "set", key: "A", value: "a" }),
        run(link, { operation: "set", key: "B", value: "b" }),
      ]);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readFileSync(link, "utf8")).toContain("A=a");
      expect(readFileSync(link, "utf8")).toContain("B=b");
    });

    it("creates a private file for first-time provisioning and leaves valid existing values unchanged", async () => {
      const path = fixture();
      rmSync(path);
      await run(path, { operation: "ensure-api" });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const content = readFileSync(path, "utf8");
      const inode = statSync(path).ino;
      expect((await run(path, { operation: "ensure-api" })).changed).toBe(
        false,
      );
      expect(readFileSync(path, "utf8")).toBe(content);
      expect(statSync(path).ino).toBe(inode);
    });

    it("reuses the last active token while removing earlier duplicates", async () => {
      const path = fixture(
        'HERMES_DASHBOARD_SESSION_TOKEN=old\n# HERMES_DASHBOARD_SESSION_TOKEN=comment\nexport HERMES_DASHBOARD_SESSION_TOKEN="last"\n',
      );
      expect(
        (await run(path, { operation: "ensure-dashboard" })).values
          .HERMES_DASHBOARD_SESSION_TOKEN,
      ).toBe("last");
      expect(readFileSync(path, "utf8")).toBe(
        "HERMES_DASHBOARD_SESSION_TOKEN=last\n",
      );
    });

    it.each(["", "short", "changeme", "API_SERVER_KEY", "your-api-key"])(
      "replaces invalid API key %j and enables the server atomically",
      async (key) => {
        const path = fixture(
          `API_SERVER_KEY=${key}\nAPI_SERVER_ENABLED=false\n`,
        );
        const result = await run(path, { operation: "ensure-api" });
        expect(result.values.API_SERVER_KEY).toMatch(/^[a-f0-9]{48}$/);
        expect(result.values.API_SERVER_ENABLED).toBe("true");
        expect(readFileSync(path, "utf8")).toBe(
          `API_SERVER_KEY=${result.values.API_SERVER_KEY}\nAPI_SERVER_ENABLED=true\n`,
        );
      },
    );

    it("reuses a valid API key and enabled alias", async () => {
      const path = fixture(
        "API_SERVER_KEY=0123456789abcdef\nAPI_SERVER_ENABLED=yes\n",
      );
      const result = await run(path, { operation: "ensure-api" });
      expect(result.values.API_SERVER_KEY).toBe("0123456789abcdef");
      expect(result.values.API_SERVER_ENABLED).toBe("yes");
      expect(result.changed).toBe(false);
    });

    it("rejects injected lines without modifying the credential file or echoing their contents", async () => {
      const path = fixture();
      const original = readFileSync(path);
      await expect(
        run(path, {
          operation: "set",
          key: "API_SERVER_KEY",
          value: "secret\nOTHER=bad",
        }),
      ).rejects.toThrow("Environment value contains illegal characters");
      expect(readFileSync(path)).toEqual(original);
    });
  },
);
