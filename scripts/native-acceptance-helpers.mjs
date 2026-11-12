/* eslint-disable @typescript-eslint/explicit-function-return-type -- Executable acceptance helpers. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// @lat: [[native-release-acceptance#Disposable native installation]]
export async function waitForWelcomeReady(page) {
  await page
    .getByRole("heading", { name: "Welcome to Hermes One", exact: true })
    .waitFor({ state: "visible", timeout: 60000 });
  await page
    .locator('.onboard-screen[data-phase="done"]')
    .waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(
    () => {
      const screen = document.querySelector(
        '.onboard-screen[data-phase="done"]',
      );
      return [".onboard-title", ".onboard-body"].every((selector) => {
        const element = screen?.querySelector(selector);
        return element && getComputedStyle(element).opacity === "1";
      });
    },
    undefined,
    { timeout: 60000 },
  );
}

// @lat: [[native-release-acceptance#Disposable native installation]]
export async function validateStapledApplication(
  bundle,
  { execute = spawnSync, sleep = delay, onAttempt = () => {} } = {},
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = execute("xcrun", ["stapler", "validate", bundle], {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
    });
    onAttempt({ attempt, status: result.status });
    if (result.status === 0) return result.stdout.trim();
    const diagnostic = `${result.stderr || ""}\n${result.stdout || ""}`;
    const transient =
      result.status === 68 &&
      /NSURLErrorDomain\s+Code=-1005\b/.test(diagnostic) &&
      /the network connection was lost/i.test(diagnostic);
    if (!transient || attempt === 3)
      assert.equal(
        result.status,
        0,
        `xcrun stapler validate failed: ${result.error || result.stderr || result.stdout}`,
      );
    await sleep(attempt * 2000);
  }
}
