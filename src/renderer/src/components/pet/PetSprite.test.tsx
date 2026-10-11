import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetSprite } from "./PetSprite";
import type { PetInfo } from "./petState";

const info: PetInfo = {
  enabled: true,
  displayName: "Boba",
  spritesheetBase64: "pixels",
};

let rafCallbacks: Map<number, FrameRequestCallback>;
let rafId: number;
let context: {
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};
let imageInstances: Array<
  HTMLImageElement & { complete: boolean; naturalWidth: number }
>;

function frame(time: number): void {
  const callbacks = [...rafCallbacks.values()];
  rafCallbacks.clear();
  act(() => callbacks.forEach((callback) => callback(time)));
}

beforeEach(() => {
  rafCallbacks = new Map();
  rafId = 0;
  context = { clearRect: vi.fn(), drawImage: vi.fn() };
  imageInstances = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as unknown as GPUCanvasContext,
  );
  vi.stubGlobal(
    "Image",
    class extends EventTarget {
      src = "";
      complete = true;
      naturalWidth = 1200;
      constructor() {
        super();
        imageInstances.push(
          this as unknown as HTMLImageElement & {
            complete: boolean;
            naturalWidth: number;
          },
        );
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    rafCallbacks.set(++rafId, callback);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    rafCallbacks.delete(id),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PetSprite", () => {
  it("decodes the gateway sheet and draws the first scaled idle cell", () => {
    const view = render(<PetSprite info={info} state="idle" />);
    const canvas = view.getByRole("img", {
      name: "Boba pet",
    }) as HTMLCanvasElement;

    expect(imageInstances[0].src).toBe("data:image/webp;base64,pixels");
    expect(canvas.width).toBe(63);
    expect(canvas.height).toBe(69);
    frame(0);
    expect(context.drawImage).toHaveBeenCalledWith(
      imageInstances[0],
      0,
      0,
      192,
      208,
      0,
      0,
      63,
      69,
    );
    expect(
      (context as unknown as CanvasRenderingContext2D).imageSmoothingEnabled,
    ).toBe(true);
    expect(
      (context as unknown as CanvasRenderingContext2D).imageSmoothingQuality,
    ).toBe("high");
  });

  it("uses the legacy row and its concrete frame count for each 1100ms loop", () => {
    render(
      <PetSprite
        info={{
          ...info,
          stateRows: ["idle", "run", "waving"],
          framesPerState: 6,
          framesByState: { wave: 4 },
          framesByRow: { waving: 2 },
        }}
        state="wave"
      />,
    );

    frame(0);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      0,
      416,
      192,
      208,
      0,
      0,
      63,
      69,
    );
    frame(275);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      192,
      416,
      192,
      208,
      0,
      0,
      63,
      69,
    );
    frame(1100);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      0,
      416,
      192,
      208,
      0,
      0,
      63,
      69,
    );
  });

  it("falls back to idle when a requested row has no real frames", () => {
    render(
      <PetSprite
        info={{
          ...info,
          stateRows: ["jumping", "idle"],
          framesByState: { jump: 0, idle: 2 },
        }}
        state="jump"
      />,
    );
    frame(0);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      0,
      208,
      192,
      208,
      0,
      0,
      63,
      69,
    );
    frame(550);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      192,
      208,
      192,
      208,
      0,
      0,
      63,
      69,
    );
  });

  it("pauses while hidden and resumes without skipping animation time", () => {
    let hidden = false;
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
      hidden ? "hidden" : "visible",
    );
    render(<PetSprite info={info} state="idle" />);
    frame(0);
    frame(184);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      192,
      0,
      192,
      208,
      0,
      0,
      63,
      69,
    );
    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(rafCallbacks.size).toBe(0);
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    frame(5000);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      192,
      0,
      192,
      208,
      0,
      0,
      63,
      69,
    );
  });

  it("draws the current taxonomy run row with state-specific frames", () => {
    render(
      <PetSprite info={{ ...info, framesByState: { run: 2 } }} state="run" />,
    );
    frame(0);
    frame(550);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      192,
      7 * 208,
      192,
      208,
      0,
      0,
      63,
      69,
    );
  });

  it("uses concrete framesByRow when the state count is unspecified", () => {
    render(
      <PetSprite
        info={{
          ...info,
          stateRows: ["idle", "waiting"],
          framesByRow: { waiting: 3 },
          loopMs: 900,
        }}
        state="waiting"
      />,
    );
    frame(0);
    frame(300);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      192,
      208,
      192,
      208,
      0,
      0,
      63,
      69,
    );
    frame(900);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      0,
      208,
      192,
      208,
      0,
      0,
      63,
      69,
    );
  });

  it("falls back to idle when the requested state row is absent", () => {
    render(
      <PetSprite
        info={{ ...info, stateRows: ["run", "idle"] }}
        state="waiting"
      />,
    );
    frame(0);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      0,
      208,
      192,
      208,
      0,
      0,
      63,
      69,
    );
  });

  it("uses the declared mime, frame size, scale, and pixel density", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const view = render(
      <PetSprite
        info={{
          ...info,
          mime: "image/png",
          frameW: 40,
          frameH: 50,
          scale: 0.5,
        }}
        state="idle"
      />,
    );
    const canvas = view.getByRole("img") as HTMLCanvasElement;
    expect(imageInstances[0].src).toBe("data:image/png;base64,pixels");
    expect([canvas.width, canvas.height]).toEqual([40, 50]);
    expect([canvas.style.width, canvas.style.height]).toEqual(["20px", "25px"]);
    frame(0);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      0,
      0,
      40,
      50,
      0,
      0,
      40,
      50,
    );
  });

  it("switches pose without keeping the previous frame or leaking callbacks", () => {
    const view = render(<PetSprite info={info} state="idle" />);
    frame(0);
    frame(184);
    view.rerender(<PetSprite info={info} state="wave" />);
    expect(rafCallbacks.size).toBe(1);
    frame(200);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      imageInstances[0],
      0,
      3 * 208,
      192,
      208,
      0,
      0,
      63,
      69,
    );
    view.unmount();
    expect(rafCallbacks.size).toBe(0);
  });

  it("does not create an image or animation loop when no sheet is supplied", () => {
    render(<PetSprite info={{ enabled: true }} state="idle" />);
    expect(imageInstances).toHaveLength(0);
    expect(rafCallbacks.size).toBe(0);
  });
});
