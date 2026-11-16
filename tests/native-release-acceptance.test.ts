// @vitest-environment node
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { createRequire } from "module";
import { join } from "path";
import { load } from "js-yaml";
import { Script } from "vm";
import { Arch } from "builder-util";
// Initialize the builder's CommonJS platform exports before its concrete class.
import "app-builder-lib";
import { LinuxPackager } from "app-builder-lib/out/linuxPackager";
import type { Packager } from "app-builder-lib/out/packager";
import type { Configuration } from "app-builder-lib/out/configuration";
import { describe, expect, it, vi } from "vitest";

const root = join(import.meta.dirname, "..");
const script = join(root, "scripts/verify-native-install.mjs");

// @lat: [[native-release-acceptance#Test specifications#Acquisition loads workspace dependencies under github-script]]
it("executes artifact acquisition with github-script's wrapped require", async () => {
  const runner = mkdtempSync(join(tmpdir(), "hermes-native-acquisition-"));
  try {
    const workflow = load(
      readFileSync(
        join(root, ".github/workflows/native-release-acceptance.yml"),
        "utf8",
      ),
    ) as {
      jobs: {
        native: {
          steps: Array<{ name?: string; with?: { script?: string } }>;
        };
      };
    };
    const acquisition = workflow.jobs.native.steps.find(
      ({ name }) =>
        name === "Download and verify exact candidate and baseline bytes",
    )?.with?.script;
    expect(acquisition).toBeTruthy();
    const workspaceRequire = createRequire(join(root, "package.json"));
    // github-script supplies a wrapper function, not Node's complete require API.
    const wrappedRequire = (id: string): unknown => workspaceRequire(id);
    expect(Reflect.get(wrappedRequire, "resolve")).toBeUndefined();
    const metadataReached = new Error("stop before downloads or installation");
    const paginate = vi.fn(async () => {
      throw metadataReached;
    });
    const listArtifacts = vi.fn();
    const execution = new Script(
      `(async () => {\n${acquisition}\n})()`,
    ).runInNewContext({
      require: wrappedRequire,
      process: {
        env: {
          GITHUB_WORKSPACE: root,
          RUNNER_TEMP: runner,
          CANDIDATE_RUN_ID: "123456",
        },
      },
      github: {
        paginate,
        rest: { actions: { listWorkflowRunArtifacts: listArtifacts } },
      },
      context: { repo: { owner: "fathah", repo: "hermes-desktop" } },
    }) as Promise<unknown>;
    await expect(execution).rejects.toBe(metadataReached);
    expect(paginate).toHaveBeenCalledExactlyOnceWith(listArtifacts, {
      owner: "fathah",
      repo: "hermes-desktop",
      run_id: 123456,
      per_page: 100,
    });
    expect(readdirSync(runner).sort()).toEqual([
      "native-baseline",
      "native-candidate",
      "native-evidence",
    ]);
  } finally {
    rmSync(runner, { recursive: true, force: true });
  }
});

// @lat: [[native-release-acceptance#Test specifications#Updater files use actual builder names]]
it.each([
  { id: "linux-x64", architecture: Arch.x64 },
  { id: "linux-arm64", architecture: Arch.arm64 },
])(
  "uses the installed builder's actual AppImage name for $id",
  ({ id, architecture }) => {
    const config = load(
      readFileSync(join(root, "electron-builder.yml"), "utf8"),
    ) as Configuration;
    const metadata = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );
    const builder = new LinuxPackager({ config, metadata } as Packager);
    const actualName = builder.expandArtifactNamePattern(
      config.appImage,
      "AppImage",
      architecture,
    );
    const workflow = load(
      readFileSync(
        join(root, ".github/workflows/native-release-acceptance.yml"),
        "utf8",
      ),
    ) as {
      jobs: {
        native: {
          strategy: {
            matrix: {
              include: Array<{ id: string; candidate_update: string }>;
            };
          };
        };
      };
    };
    const target = workflow.jobs.native.strategy.matrix.include.find(
      (entry) => entry.id === id,
    );
    expect(target?.candidate_update.replace("VERSION", metadata.version)).toBe(
      actualName,
    );
  },
);

describe("native acceptance installation boundary", () => {
  // @lat: [[native-release-acceptance#Test specifications#Non-CI execution is refused]]
  it("refuses a real installer invocation outside a disposable CI runner", () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "false", CI: "false" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "restricted to disposable GitHub Actions runners",
    );
  });

  // @lat: [[native-release-acceptance#Test specifications#Installation cannot escape its runner root]]
  it.each([false, ...(process.platform === "win32" ? [] : [true])])(
    "rejects an outside destination before installing (symlink=%s)",
    (symlink) => {
      const runner = mkdtempSync(join(tmpdir(), "hermes-native-boundary-"));
      const outside = mkdtempSync(join(tmpdir(), "hermes-native-outside-"));
      try {
        const installer = join(runner, "fixture.AppImage");
        writeFileSync(installer, "fixture, never executed");
        let destination = outside;
        if (symlink) {
          destination = join(runner, "escape");
          symlinkSync(outside, destination, "dir");
        }
        const output = join(runner, "result.json");
        const result = spawnSync(
          process.execPath,
          [
            script,
            `--installer-path=${installer}`,
            `--install-dir=${destination}`,
            `--output=${output}`,
            "--expected-version=0.7.8",
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              GITHUB_ACTIONS: "true",
              CI: "true",
              RUNNER_TEMP: runner,
            },
          },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          "install-dir must remain inside RUNNER_TEMP",
        );
        expect(readdirSync(outside)).toEqual([]);
        expect(existsSync(output)).toBe(false);
      } finally {
        rmSync(runner, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );
});

// @lat: [[native-release-acceptance#Test specifications#Native jobs require installed launch and real update]]
it("requires native installer, SQLite and updater gates on every shipping architecture", () => {
  const workflow = load(
    readFileSync(
      join(root, ".github/workflows/native-release-acceptance.yml"),
      "utf8",
    ),
  ) as {
    permissions: Record<string, string>;
    jobs: {
      native: {
        strategy: {
          matrix: { include: Array<{ id: string; runner: string }> };
        };
        steps: Array<{
          name?: string;
          run?: string;
          uses?: string;
          with?: Record<string, string>;
        }>;
      };
    };
  };
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  expect(
    workflow.jobs.native.strategy.matrix.include.map(({ runner }) => runner),
  ).toEqual([
    "windows-2025",
    "ubuntu-24.04",
    "ubuntu-24.04-arm",
    "macos-15-intel",
  ]);
  const checkout = workflow.jobs.native.steps.find(
    ({ uses }) => uses === "actions/checkout@v4",
  );
  expect(checkout?.with?.ref).toBe("${{ github.sha }}");
  const runtime =
    workflow.jobs.native.steps.find(
      ({ name }) =>
        name === "Install, launch, query SQLite and apply an actual update",
    )?.run || "";
  expect(runtime).toContain("scripts/verify-native-install.mjs");
  expect(runtime).toContain("scripts/verify-installed-update.mjs");
  expect(runtime).toContain("--install-only");
  expect(runtime).toContain("--candidate-file=");
  expect(runtime).toContain("xvfb-run");
  expect(runtime).toContain(".desktop-update-fixture.json");
  for (const step of workflow.jobs.native.steps) {
    const javascript = step.with?.script;
    if (javascript)
      expect(
        () => new Script(`(async () => {\n${javascript}\n})`),
      ).not.toThrow();
  }
  const coordinator = runtime.match(/node <<'NODE'\n([\s\S]*?)\nNODE/)?.[1];
  expect(coordinator).toBeTruthy();
  expect(() => new Script(coordinator!)).not.toThrow();
});
