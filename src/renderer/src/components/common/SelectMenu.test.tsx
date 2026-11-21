import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SelectMenu, type SelectMenuOption } from "./SelectMenu";

const OPTIONS: SelectMenuOption[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

function renderMenu(options: {
  value?: string;
  disabled?: boolean;
  onSelect?: (value: string) => void;
}): React.JSX.Element {
  return (
    <SelectMenu
      value={options.value ?? "dark"}
      options={OPTIONS}
      label="Theme"
      disabled={options.disabled}
      onSelect={options.onSelect ?? (() => {})}
    />
  );
}

describe("SelectMenu", () => {
  it("opens on the trigger and shows every option", () => {
    render(renderMenu({}));
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(OPTIONS.length);
    expect(screen.getByRole("button", { name: "Theme" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("reports the selection, closes, and refocuses the trigger", () => {
    const onSelect = vi.fn();
    render(renderMenu({ onSelect }));
    const trigger = screen.getByRole("button", { name: "Theme" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Light" }));

    expect(onSelect).toHaveBeenCalledWith("light");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape and refocuses the trigger", () => {
    render(renderMenu({}));
    const trigger = screen.getByRole("button", { name: "Theme" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside mousedown", () => {
    render(renderMenu({}));
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not open while disabled", () => {
    render(renderMenu({ disabled: true }));
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows triggerLabel for a value that is not in options", () => {
    render(
      <SelectMenu
        value="accent-subtle"
        triggerLabel="Accent subtle"
        options={OPTIONS}
        label="Style"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Style" })).toHaveTextContent(
      "Accent subtle",
    );
  });
});
