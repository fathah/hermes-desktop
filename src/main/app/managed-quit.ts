import type { App } from "electron";

/** Electron must keep its event loop alive until owned-child cleanup settles. */
export function registerManagedQuit(
  app: App,
  cleanup: () => Promise<void>,
): void {
  let started = false;
  let complete = false;
  app.on("before-quit", (event) => {
    if (complete) return;
    event.preventDefault();
    if (started) return;
    started = true;
    void Promise.resolve()
      .then(cleanup)
      .catch((error) => console.error("[SHUTDOWN] Cleanup failed:", error))
      .finally(() => {
        complete = true;
        app.quit();
      });
  });
}
