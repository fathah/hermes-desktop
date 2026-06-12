import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const noop = (): void => {};

const canvas2dContext = {
  clearRect: noop,
  save: noop,
  restore: noop,
  translate: noop,
  scale: noop,
  beginPath: noop,
  moveTo: noop,
  lineTo: noop,
  stroke: noop,
  arc: noop,
  fill: noop,
  fillText: noop,
  setLineDash: noop,
};

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(contextId: string): typeof canvas2dContext | null {
      return contextId === "2d" ? canvas2dContext : null;
    },
  });
}

afterEach(() => {
  cleanup();
});
