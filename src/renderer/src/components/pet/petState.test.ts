import { describe, expect, it } from "vitest";
import { derivePetState, type PetActivity, type PetState } from "./petState";

describe("derivePetState", () => {
  it.each<[PetActivity, PetState]>([
    [{}, "idle"],
    [{ busy: true }, "run"],
    [{ busy: true, reasoning: true }, "review"],
    [{ busy: true, reasoning: true, toolRunning: true }, "run"],
    [{ busy: true, toolRunning: true, awaitingInput: true }, "waiting"],
    [{ awaitingInput: true, justCompleted: true }, "wave"],
    [{ justCompleted: true, celebrate: true }, "jump"],
    [{ error: true, celebrate: true, justCompleted: true }, "failed"],
  ])("maps activity %j to %s by priority", (activity, expected) => {
    expect(derivePetState(activity)).toBe(expected);
  });
});
