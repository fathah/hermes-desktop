import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Mock react-loader-spinner which fails to load in test environment
vi.mock("react-loader-spinner", () => ({
  Grid: () => null,
  Audio: () => null,
  BallTriangle: () => null,
  Bars: () => null,
  Circles: () => null,
  CirclesWithBar: () => null,
  ColorRing: () => null,
  Comment: () => null,
  Discuss: () => null,
  DNA: () => null,
  FallingLines: () => null,
  FidgetSpinner: () => null,
  Hearts: () => null,
  InfinitySpin: () => null,
  LineWave: () => null,
  MagnifyingGlass: () => null,
  MutatingDots: () => null,
  Oval: () => null,
  ProgressBar: () => null,
  Puff: () => null,
  Radio: () => null,
  RevolvingDot: () => null,
  Rings: () => null,
  RotatingLines: () => null,
  RotatingSquare: () => null,
  RotatingTriangles: () => null,
  TailSpin: () => null,
  ThreeCircles: () => null,
  ThreeDots: () => null,
  Triangle: () => null,
  Vortex: () => null,
  Watch: () => null,
}));

afterEach(() => {
  cleanup();
});
