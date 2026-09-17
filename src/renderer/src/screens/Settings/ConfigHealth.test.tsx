import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConfigHealth } from "./ConfigHealth";
import { CONFIG_HEALTH_UPDATED_EVENT } from "../../components/ConfigHealthBanner";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
function report(
  profile = "research",
  clean = false,
): {
  ranAt: number;
  profile: string;
  issues: Array<{
    code: string;
    severity: string;
    message: string;
    locations: string[];
    autoFixable: boolean;
    fixDescription: string;
  }>;
  summary: { errors: number; warnings: number; infos: number };
} {
  return {
    ranAt: Date.now(),
    profile,
    issues: clean
      ? []
      : [
          {
            code: "ISSUE",
            severity: "warning",
            message: `Issue in ${profile}`,
            locations: [],
            autoFixable: true,
            fixDescription: "Safe repair",
          },
        ],
    summary: { errors: 0, warnings: clean ? 0 : 1, infos: 0 },
  };
}
const get = vi.fn();
const rerun = vi.fn();
const fix = vi.fn();
beforeEach(() => {
  get.mockReset().mockResolvedValue(report());
  rerun.mockReset().mockResolvedValue(report("research", true));
  fix.mockReset().mockResolvedValue({ ok: true });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfigHealth: get,
      rerunConfigHealth: rerun,
      autofixConfigIssue: fix,
    },
  });
});

// @lat: [[config-health-navigation#Failed audit recovery]]
it("shows loading and failed audit states and allows retry to a clean report", async () => {
  get.mockRejectedValue(new Error("offline"));
  render(<ConfigHealth profile="research" showStatus />);
  expect(screen.getByRole("status")).toHaveTextContent("common.loading");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "common.errorMessage",
  );
  fireEvent.click(screen.getByRole("button", { name: "diagnose.rerun" }));
  expect(await screen.findByText("diagnose.allGood")).toBeVisible();
  expect(rerun).toHaveBeenCalledWith("research");
  expect(screen.queryByRole("alert")).toBeNull();
});

// @lat: [[config-health-navigation#Profile request isolation]]
it("discards a late old-profile audit after switching profile", async () => {
  let finish!: (value: ReturnType<typeof report>) => void;
  get.mockImplementation((profile: string) =>
    profile === "old"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(report(profile)),
  );
  const publish = vi.fn();
  window.addEventListener(CONFIG_HEALTH_UPDATED_EVENT, publish);
  try {
    const view = render(<ConfigHealth profile="old" showStatus />);
    view.rerender(<ConfigHealth profile="new" showStatus />);
    expect(await screen.findByText("Issue in new")).toBeVisible();
    await act(async () => finish(report("old")));
    expect(screen.queryByText("Issue in old")).toBeNull();
    expect(publish).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener(CONFIG_HEALTH_UPDATED_EVENT, publish);
  }
});

// @lat: [[config-health-navigation#Fix delivery recovery]]
it("keeps a rejected fix retryable and prevents duplicate in-flight mutations", async () => {
  let fail!: (reason: Error) => void;
  fix.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  render(<ConfigHealth profile="research" showStatus />);
  const button = await screen.findByRole("button", {
    name: "diagnose.fix.apply",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fix).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "diagnose.rerun" })).toBeDisabled();
  await act(async () => fail(new Error("disconnected")));
  expect(await screen.findByText("diagnose.fix.failure")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "diagnose.fix.apply" }));
  expect(await screen.findByText("diagnose.allGood")).toBeVisible();
  expect(fix).toHaveBeenLastCalledWith("ISSUE", "research", undefined);
});

// @lat: [[config-health-navigation#Partial success remains visible]]
it("retains a successful fix result if its follow-up audit fails", async () => {
  rerun.mockRejectedValueOnce(new Error("offline"));
  render(<ConfigHealth profile="research" showStatus />);
  fireEvent.click(
    await screen.findByRole("button", { name: "diagnose.fix.apply" }),
  );
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByText("diagnose.fix.success")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "diagnose.rerun" }));
  await screen.findByText("diagnose.allGood");
  expect(fix).toHaveBeenCalledTimes(1);
});

// @lat: [[config-health-navigation#Unmount ignores pending work]]
it("refreshes the scoped report after a successful fix outlives its pane", async () => {
  let finish!: (value: { ok: boolean }) => void;
  fix.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<ConfigHealth profile="research" showStatus />);
  fireEvent.click(
    await screen.findByRole("button", { name: "diagnose.fix.apply" }),
  );
  const publish = vi.spyOn(window, "dispatchEvent");
  try {
    view.unmount();
    await act(async () => finish({ ok: true }));
    expect(rerun).toHaveBeenCalledWith("research");
    const events = publish.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === CONFIG_HEALTH_UPDATED_EVENT);
    expect(events).toHaveLength(1);
    expect((events[0] as CustomEvent).detail).toMatchObject({
      profile: "research",
      issues: [],
    });
  } finally {
    publish.mockRestore();
  }
});

// @lat: [[config-health-navigation#Audit request deduplication]]
it("does not overlap audit retries and blocks fixes during audit", async () => {
  let finish!: (value: ReturnType<typeof report>) => void;
  rerun.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<ConfigHealth profile="research" showStatus />);
  await screen.findByText("Issue in research");
  const button = screen.getByRole("button", { name: "diagnose.rerun" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(rerun).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "diagnose.fix.apply" }),
  ).toBeDisabled();
  await act(async () => finish(report("research", true)));
  await waitFor(() => expect(button).toBeEnabled());
});
