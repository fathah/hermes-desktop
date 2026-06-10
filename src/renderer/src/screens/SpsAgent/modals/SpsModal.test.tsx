import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SpsModal } from "./SpsModal";

afterEach(cleanup);

describe("SpsModal", () => {
  it("renders the title and body", () => {
    render(
      <SpsModal title="🔬 Research" onClose={() => {}}>
        <div>body</div>
      </SpsModal>,
    );
    expect(screen.getByText("🔬 Research")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("closes on Escape by default", () => {
    const onClose = vi.fn();
    render(
      <SpsModal title="X" onClose={onClose}>
        <div />
      </SpsModal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not bind Escape when closeOnEsc is false", () => {
    const onClose = vi.fn();
    render(
      <SpsModal title="X" onClose={onClose} closeOnEsc={false}>
        <div />
      </SpsModal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on backdrop mousedown", () => {
    const onClose = vi.fn();
    const { container } = render(
      <SpsModal title="X" onClose={onClose}>
        <div />
      </SpsModal>,
    );
    const scrim = container.querySelector(".scrim")!;
    fireEvent.mouseDown(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the modal body", () => {
    const onClose = vi.fn();
    const { container } = render(
      <SpsModal title="X" onClose={onClose}>
        <div>inside</div>
      </SpsModal>,
    );
    const modal = container.querySelector(".modal")!;
    fireEvent.mouseDown(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("vetoes both backdrop and Esc close when closeGuard returns false", () => {
    const onClose = vi.fn();
    const { container } = render(
      <SpsModal title="X" onClose={onClose} closeGuard={() => false}>
        <div />
      </SpsModal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(container.querySelector(".scrim")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders headerActions and switches the header to space-between", () => {
    const { container } = render(
      <SpsModal title="X" onClose={() => {}} headerActions={<span>chip</span>}>
        <div />
      </SpsModal>,
    );
    expect(screen.getByText("chip")).toBeInTheDocument();
    const head = container.querySelector(".modal-head") as HTMLElement;
    expect(head.style.justifyContent).toBe("space-between");
  });
});
