/* eslint-disable @typescript-eslint/explicit-function-return-type -- Shared executable acceptance helpers. */
import assert from "node:assert/strict";

// @lat: [[compatibility-validation#Startup diagnostics]]
export function watchStartupDiagnostics(application) {
  const state = {
    pageErrors: [],
    consoleErrors: [],
    mainLog: "",
    process: application.process(),
  };
  const observed = new WeakSet();
  const observe = (page) => {
    if (observed.has(page)) return;
    observed.add(page);
    page.on("pageerror", (error) =>
      state.pageErrors.push(error.stack || String(error)),
    );
    page.on("console", (message) => {
      if (message.type() === "error") state.consoleErrors.push(message.text());
    });
  };
  application.on("window", observe);
  for (const page of application.windows()) observe(page);
  for (const stream of [state.process.stdout, state.process.stderr])
    stream?.on("data", (data) => {
      state.mainLog += data.toString();
    });
  return state;
}

export async function snapshotStartupDiagnostics(application, state) {
  // Playwright retains messages created before the first window listener was attached.
  for (const page of application.windows()) {
    const [errors, messages] = await Promise.all([
      page.pageErrors(),
      page.consoleMessages(),
    ]);
    for (const error of errors) {
      const text = error.stack || String(error);
      if (!state.pageErrors.includes(text)) state.pageErrors.push(text);
    }
    for (const message of messages)
      if (
        message.type() === "error" &&
        !state.consoleErrors.includes(message.text())
      )
        state.consoleErrors.push(message.text());
  }
  return {
    pageErrors: state.pageErrors,
    consoleErrors: state.consoleErrors,
    mainLog: state.mainLog,
  };
}

export function assertStartupDiagnostics(state) {
  assert.deepEqual(state.pageErrors, [], "Renderer page errors occurred");
  assert.deepEqual(state.consoleErrors, [], "Renderer console errors occurred");
  assert.doesNotMatch(
    state.mainLog,
    /uncaught(?:exception| exception)|UnhandledPromiseRejection|ERR_DLOPEN_FAILED|Cannot find module|wrong architecture|mach-o.*incompatible/i,
    "Main-process fatal error occurred",
  );
}
