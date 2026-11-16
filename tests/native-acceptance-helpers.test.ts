// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  validateStapledApplication,
  waitForWelcomeReady,
} from "../scripts/native-acceptance-helpers.mjs";

afterEach(() => {
  document.body.replaceChildren();
});

// @lat: [[native-release-acceptance#Test specifications#Welcome reveal must finish before native inspection]]
it.each(["title", "body"])(
  "keeps the actual Welcome gate pending when only the %s has fully revealed",
  async (first) => {
    document.body.innerHTML = `<div class="onboard-screen" data-phase="done"><h1 class="onboard-title" style="opacity:0.4">Welcome to Hermes One</h1><div class="onboard-body" style="opacity:0.2"><button>Get Started</button></div></div>`;
    const title = document.querySelector<HTMLElement>(".onboard-title")!;
    const body = document.querySelector<HTMLElement>(".onboard-body")!;
    let finishGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      finishGate = resolve;
    });
    let enteredPolling!: () => void;
    const polling = new Promise<void>((resolve) => {
      enteredPolling = resolve;
    });
    let poll = (): boolean => false;
    const waitForFunction = vi.fn(async (predicate: () => unknown) => {
      poll = (): boolean => {
        if (!predicate()) return false;
        finishGate();
        return true;
      };
      poll();
      enteredPolling();
      await gate;
    });
    const waitFor = vi.fn(async () => {});
    const page = {
      getByRole: vi.fn(() => ({ waitFor })),
      locator: vi.fn(() => ({ waitFor })),
      waitForFunction,
    };
    let finished = false;
    const readiness = waitForWelcomeReady(page).then(() => {
      finished = true;
    });
    await polling;
    expect(finished).toBe(false);
    expect(poll()).toBe(false);
    const leading = first === "title" ? title : body;
    const trailing = first === "title" ? body : title;
    leading.style.opacity = "1";
    expect(poll()).toBe(false);
    await Promise.resolve();
    expect(finished).toBe(false);
    trailing.style.opacity = "1";
    expect(poll()).toBe(true);
    await readiness;
    expect(finished).toBe(true);
    expect(page.getByRole).toHaveBeenCalledWith("heading", {
      name: "Welcome to Hermes One",
      exact: true,
    });
    expect(page.locator).toHaveBeenCalledWith(
      '.onboard-screen[data-phase="done"]',
    );
  },
);

const transient = {
  status: 68,
  stdout: "The validate action failed! Error 68.",
  stderr:
    'error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
};

// @lat: [[native-release-acceptance#Test specifications#Stapler retries only proven transient network loss]]
it("retries the actual stapler helper twice after proven network loss, then requires success", async () => {
  const execute = vi
    .fn()
    .mockReturnValueOnce(transient)
    .mockReturnValueOnce(transient)
    .mockReturnValueOnce({
      status: 0,
      stdout: "Ticket validated\n",
      stderr: "",
    });
  const sleep = vi.fn(async () => {});
  const onAttempt = vi.fn();
  await expect(
    validateStapledApplication("/owned/Hermes One.app", {
      execute,
      sleep,
      onAttempt,
    }),
  ).resolves.toBe("Ticket validated");
  expect(execute).toHaveBeenCalledTimes(3);
  for (const [command, args, options] of execute.mock.calls) {
    expect(command).toBe("xcrun");
    expect(args).toEqual(["stapler", "validate", "/owned/Hermes One.app"]);
    expect(options.timeout).toBe(60000);
  }
  expect(sleep.mock.calls).toEqual([[2000], [4000]]);
  expect(onAttempt.mock.calls).toEqual([
    [{ attempt: 1, status: 68 }],
    [{ attempt: 2, status: 68 }],
    [{ attempt: 3, status: 0 }],
  ]);
});

// @lat: [[native-release-acceptance#Test specifications#Stapler rejects completed failures and exhausted retries]]
it.each([
  {
    name: "missing ticket",
    status: 65,
    stderr: "The staple and validate action failed: ticket not found",
  },
  {
    name: "other network error",
    status: 68,
    stderr:
      'Error Domain=NSURLErrorDomain Code=-1001 "The network connection was lost."',
  },
  { name: "incorrect exit status", status: 65, stderr: transient.stderr },
  { name: "process timeout", status: null, stderr: transient.stderr },
])("fails closed for $name without retrying", async ({ status, stderr }) => {
  const execute = vi.fn(() => ({ status, stderr, stdout: "" }));
  const sleep = vi.fn(async () => {});
  await expect(
    validateStapledApplication("/owned/Hermes One.app", { execute, sleep }),
  ).rejects.toThrow("xcrun stapler validate failed");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

it("fails after three transient stapler results without a fourth attempt", async () => {
  const execute = vi.fn(() => transient);
  const sleep = vi.fn(async () => {});
  await expect(
    validateStapledApplication("/owned/Hermes One.app", { execute, sleep }),
  ).rejects.toThrow("xcrun stapler validate failed");
  expect(execute).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls).toEqual([[2000], [4000]]);
});
