import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DASHSCOPE_BASE_URL } from "../../constants";
import Setup from "./Setup";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock("../../components/common/BrandLogo", () => ({
  default: ({ provider }: { provider: string }): React.JSX.Element => (
    <span data-testid={`brand-${provider}`} />
  ),
}));

vi.mock("../../components/VerifyWarningBanner", () => ({
  default: (): React.JSX.Element => <div data-testid="verify-warning" />,
}));

function installHermesAPI(): {
  setEnv: ReturnType<typeof vi.fn>;
  setModelConfig: ReturnType<typeof vi.fn>;
} {
  const api = {
    setEnv: vi.fn().mockResolvedValue(true),
    setModelConfig: vi.fn().mockResolvedValue(true),
    openExternal: vi.fn(),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("Setup", () => {
  it("saves DashScope credentials to the active setup profile", async () => {
    const api = installHermesAPI();
    const onComplete = vi.fn();
    render(<Setup profile="work" onComplete={onComplete} />);

    fireEvent.click(screen.getByText("Alibaba DashScope"));
    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "sk-dashscope" },
    });
    fireEvent.click(screen.getByText("setup.continue"));

    await waitFor(() => {
      expect(api.setEnv).toHaveBeenCalledWith(
        "DASHSCOPE_API_KEY",
        "sk-dashscope",
        "work",
      );
    });
    expect(api.setModelConfig).toHaveBeenCalledWith(
      "alibaba",
      "",
      DEFAULT_DASHSCOPE_BASE_URL,
      "work",
    );
    expect(onComplete).toHaveBeenCalled();
  });
});
