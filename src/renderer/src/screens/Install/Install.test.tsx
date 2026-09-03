import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const i18nState = vi.hoisted(() => ({
  t: (key: string): string => `en:${key}`,
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: i18nState.t }),
}));

import Install from "./Install";

describe("Install", () => {
  beforeEach(() => {
    i18nState.t = (key: string): string => `en:${key}`;
  });

  // @lat: [[onboarding#Install confirm + progress#Single-run installation]]
  it("does not restart an active installation when translations change", async () => {
    let resolveInstall!: (result: { success: boolean; error?: string }) => void;
    const startInstall = vi.fn(
      () =>
        new Promise<{ success: boolean; error?: string }>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    const removeProgressListener = vi.fn();

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        inspectInstallTarget: vi.fn().mockResolvedValue({
          hermesHome: "/tmp/hermes",
          repoPath: "/tmp/hermes/hermes-agent",
          state: "fresh",
        }),
        onInstallProgress: vi.fn(() => removeProgressListener),
        startInstall,
      },
    });

    const props = {
      onComplete: vi.fn(),
      onFailed: vi.fn(),
      onCancel: vi.fn(),
    };
    const view = render(<Install {...props} />);

    fireEvent.click(screen.getByText("en:install.confirmInstallBtn"));
    await waitFor(() => expect(startInstall).toHaveBeenCalledTimes(1));

    i18nState.t = (key: string): string => `fr:${key}`;
    view.rerender(<Install {...props} />);

    expect(startInstall).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveInstall({ success: false });
      await Promise.resolve();
    });

    expect(startInstall).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("fr:install.retryInstallation"));
    expect(props.onFailed).toHaveBeenCalledWith(
      "fr:install.installationFailedHint",
    );
  });
});
