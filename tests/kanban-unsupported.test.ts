import { describe, expect, it } from "vitest";
import { unsupportedInRemote } from "../src/main/kanban";

// The Kanban screen must distinguish "this connection mode genuinely
// doesn't support Kanban" from an operational failure (issue #319).
// Only `unsupportedInRemote()` carries the `unsupportedMode` flag; the
// renderer keys its "switch modes" screen off the flag, never off the
// error text — so an SSH-Kanban failure whose message happens to contain
// "remote" is no longer mislabelled as a mode problem.
describe("unsupportedInRemote (issue #319)", () => {
  it("flags the result as an unsupported connection mode", () => {
    const res = unsupportedInRemote();
    expect(res.success).toBe(false);
    expect(res.unsupportedMode).toBe(true);
    expect(res.error).toBeTruthy();
  });
});
