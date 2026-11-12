// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import {
  assertStartupDiagnostics,
  snapshotStartupDiagnostics,
  watchStartupDiagnostics,
} from "../scripts/acceptance-diagnostics.mjs";

const message = (text: string): { type: () => string; text: () => string } => ({
  type: () => "error",
  text: () => text,
});
class Page extends EventEmitter {
  errors: Error[] = [];
  messages: ReturnType<typeof message>[] = [];
  async pageErrors(): Promise<Error[]> {
    return this.errors;
  }
  async consoleMessages(): Promise<ReturnType<typeof message>[]> {
    return this.messages;
  }
  locator(): {
    waitFor: () => Promise<void>;
    innerText: () => Promise<string>;
  } {
    return { waitFor: async () => {}, innerText: async () => "Hermes One" };
  }
}
class Application extends EventEmitter {
  pages = [new Page()];
  child = { stdout: new PassThrough(), stderr: new PassThrough() };
  windows(): Page[] {
    return this.pages;
  }
  process(): Application["child"] {
    return this.child;
  }
  async firstWindow(): Promise<Page> {
    return this.pages[0];
  }
}

describe("native installer and updater startup diagnostics", () => {
  it("accepts clean UI and process diagnostics", async () => {
    const app = new Application();
    const state = watchStartupDiagnostics(app);
    expect(() => assertStartupDiagnostics(state)).not.toThrow();
    const snapshot = await snapshotStartupDiagnostics(app, state);
    expect(() => assertStartupDiagnostics(snapshot)).not.toThrow();
  });

  // @lat: [[compatibility-validation#Startup diagnostics#Retained renderer failures]]
  it.each(["live console", "early console", "early exception", "new window"])(
    "rejects %s errors even when the UI and SQLite otherwise succeed",
    async (kind) => {
      const app = new Application();
      if (kind === "early console")
        app.pages[0].messages.push(message("caught startup failure"));
      if (kind === "early exception")
        app.pages[0].errors.push(new Error("startup exception"));
      const state = watchStartupDiagnostics(app);
      if (kind === "live console")
        app.pages[0].emit("console", message("caught startup failure"));
      if (kind === "new window") {
        const page = new Page();
        app.pages.push(page);
        app.emit("window", page);
        page.emit("console", message("caught startup failure"));
      }
      await snapshotStartupDiagnostics(app, state);
      expect(() => assertStartupDiagnostics(state)).toThrow(
        /Renderer (?:page|console) errors/,
      );
    },
  );

  // @lat: [[compatibility-validation#Startup diagnostics#Main-process fatal failures]]
  it.each(["Uncaught Exception", "ERR_DLOPEN_FAILED", "Cannot find module"])(
    "rejects a native process startup failure: %s",
    (error) => {
      const app = new Application();
      const state = watchStartupDiagnostics(app);
      app.child.stderr.write(Buffer.from(error));
      expect(() => assertStartupDiagnostics(state)).toThrow(
        "Main-process fatal error occurred",
      );
    },
  );

  // @lat: [[compatibility-validation#Startup diagnostics#Native runner completion gates]]
  it.each(["verify-native-install.mjs", "verify-installed-update.mjs"])(
    "rejects caught console errors through the actual %s completion gate",
    async (filename) => {
      const application = new Application();
      application.pages[0].messages.push(
        message("caught renderer startup error"),
      );
      const diagnostics = watchStartupDiagnostics(application);
      const source = readFileSync(
        join(import.meta.dirname, "..", "scripts", filename),
        "utf8",
      );
      const nativeStart = source.indexOf("report.diagnostics = await bounded(");
      const updaterStart = source.indexOf("async function inspectUi(app)");
      const gate =
        filename === "verify-native-install.mjs"
          ? source.slice(
              nativeStart,
              source.indexOf("report.checks.push(", nativeStart),
            )
          : `${source.slice(updaterStart, source.indexOf("async function runtime(", updaterStart))}; await inspectUi(application);`;
      expect(gate).toContain("assertStartupDiagnostics(");
      const result = vm.runInNewContext(`(async () => { ${gate} })()`, {
        application,
        diagnostics,
        startupDiagnostics: diagnostics,
        report: {},
        bounded: async (value: Promise<unknown>) => value,
        snapshotStartupDiagnostics,
        assertStartupDiagnostics,
        assert,
      });
      await expect(result).rejects.toThrow("Renderer console errors occurred");
    },
  );
});
