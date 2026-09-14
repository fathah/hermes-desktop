import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "./Toggle";

function ToggleHarness(): React.JSX.Element {
  const [checked, setChecked] = useState(false);
  return (
    <Toggle
      checked={checked}
      label="Enable priority processing"
      onCheckedChange={setChecked}
    />
  );
}

describe("Toggle", () => {
  // @lat: [[sidebar-navigation#Sidebar recent sessions#Settings modal#Shared animated toggle]]
  it("exposes switch semantics and gates movement until interaction", () => {
    render(<ToggleHarness />);
    const toggle = screen.getByRole("switch", {
      name: "Enable priority processing",
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("data-on", "false");
    expect(toggle).not.toHaveClass("is-init");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("data-on", "true");
    expect(toggle).toHaveClass("is-init");
  });

  it("does not invoke changes while disabled", () => {
    const onCheckedChange = vi.fn();
    render(
      <Toggle
        checked={false}
        label="Unavailable setting"
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Unavailable setting" }),
    );
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
