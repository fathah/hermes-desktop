/**
 * Plan v10 / PR-4 — ConfirmDialog basic-states coverage.
 *
 * Behaviour matrix:
 *   - title + body render
 *   - cancel + confirm callbacks fire
 *   - pending=true disables both buttons + appends "…" to label
 *   - backdrop click triggers cancel (only when not pending)
 *   - destructive=true uses .telemetry-button-danger
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import ConfirmDialog from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title + body + default labels", () => {
    render(
      <ConfirmDialog
        title="Are you sure?"
        body="This is irreversible."
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    expect(screen.getByText("This is irreversible.")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-cancel")).toHaveTextContent(
      /^Cancel$/,
    );
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveTextContent(
      /^Confirm$/,
    );
  });

  it("fires onCancel when Cancel clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        body="b"
        onCancel={onCancel}
        onConfirm={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("fires onConfirm when Confirm clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        body="b"
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("backdrop click cancels (only when not pending)", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        body="b"
        onCancel={onCancel}
        onConfirm={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-backdrop"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("backdrop click is a no-op while pending=true", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        body="b"
        pending
        onCancel={onCancel}
        onConfirm={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-backdrop"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("pending=true disables both buttons + adds ellipsis to confirm label", () => {
    render(
      <ConfirmDialog
        title="t"
        body="b"
        confirmLabel="Delete"
        pending
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByTestId("confirm-dialog-cancel")).toBeDisabled();
    expect(screen.getByTestId("confirm-dialog-confirm")).toBeDisabled();
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveTextContent(
      "Delete…",
    );
  });

  it("destructive=true applies .telemetry-button-danger", () => {
    render(
      <ConfirmDialog
        title="t"
        body="b"
        destructive
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveClass(
      "telemetry-button-danger",
    );
  });

  it("destructive=false defaults to .telemetry-button-primary", () => {
    render(
      <ConfirmDialog
        title="t"
        body="b"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveClass(
      "telemetry-button-primary",
    );
  });
});
