import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>): string =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

import { ContextGauge } from "./ContextGauge";

describe("ContextGauge estimated marker", () => {
  it("marks an estimated count with ~ in the ring and the tooltip", () => {
    const { container } = render(
      <ContextGauge used={12_000} window={200_000} estimated />,
    );
    expect(container.querySelector(".chat-ctx-gauge-num")?.textContent).toBe(
      "~6",
    );
    expect(screen.getByText(/"used":"~12k"/)).toBeTruthy();
    expect(screen.getByText("chat.contextEstimated")).toBeTruthy();
  });

  it("shows an exact count without the marker", () => {
    const { container } = render(
      <ContextGauge used={12_000} window={200_000} />,
    );
    expect(container.querySelector(".chat-ctx-gauge-num")?.textContent).toBe(
      "6",
    );
    expect(screen.getByText(/"used":"12k"/)).toBeTruthy();
    expect(screen.queryByText("chat.contextEstimated")).toBeNull();
  });
});
