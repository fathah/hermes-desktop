import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Mock thinking-orbs — its canvas/IntersectionObserver rendering has no
// jsdom equivalent.
vi.mock("thinking-orbs", () => ({
  ThinkingOrb: () => null,
}));

afterEach(() => {
  cleanup();
});
