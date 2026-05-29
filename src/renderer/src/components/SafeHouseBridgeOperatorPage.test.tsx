import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SafeHouseBridgeOperatorPage from "./SafeHouseBridgeOperatorPage";

const bridgeStatus = {
  ok: true,
  connected: true,
  url: "http://127.0.0.1:57109",
  mode: "local_proof",
  tool_count: 65,
  local_only: true,
};

const bridgeTools = {
  ok: true,
  url: "http://127.0.0.1:57109",
  mode: "local_proof",
  tools: [
    {
      name: "safehouse.platform.visibility",
      description: "Inspect SafeHouse platform visibility.",
      classification: "read_only",
    },
    {
      name: "safehouse.ops.cards.create",
      description: "Create a SafeHouse operations card.",
      classification: "local_safe_write",
    },
    {
      name: "safehouse.propose.queue.retry",
      description: "Draft a queue retry proposal.",
      classification: "proposal_only",
    },
    {
      name: "safehouse.block.migration",
      description: "Block migration requests.",
      classification: "blocked",
    },
  ],
};

function installBridgeApi(result: Record<string, unknown>): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getSafeHouseToolBridgeStatus: vi.fn().mockResolvedValue(bridgeStatus),
      listSafeHouseTools: vi.fn().mockResolvedValue(bridgeTools),
      callSafeHouseTool: vi.fn().mockResolvedValue(result),
    },
  });
}

describe("SafeHouseBridgeOperatorPage", () => {
  it("renders SafeHouse operations board data in bridge mode", async () => {
    installBridgeApi({
      ok: true,
      tool: "safehouse.ops.cards.list",
      classification: "read_only",
      status: "success",
      result: {
        cards: [
          {
            id: "card-1",
            title: "Review threat feed failures",
            status: "ready",
            priority: "high",
            risk_level: "low",
          },
        ],
      },
    });

    render(<SafeHouseBridgeOperatorPage mode="kanban" />);

    await waitFor(() => {
      expect(screen.getByText("SafeHouse Operations Board")).toBeTruthy();
      expect(screen.getByText("Review threat feed failures")).toBeTruthy();
    });

    expect(screen.getByText("SafeHouse bridge mode")).toBeTruthy();
    expect(screen.getByText("Bridge connected")).toBeTruthy();
  });

  it("groups SafeHouse tools by bridge safety class", async () => {
    installBridgeApi({ ok: true });

    render(<SafeHouseBridgeOperatorPage mode="tools" />);

    await waitFor(() => {
      expect(screen.getByText("SafeHouse Tool Registry")).toBeTruthy();
      expect(screen.getAllByText(/read only/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/local safe write/i).length).toBeGreaterThan(
        0,
      );
      expect(screen.getAllByText(/proposal only/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/blocked/i).length).toBeGreaterThan(0);
    });
  });
});
