import { describe, expect, it } from "vitest";
import { buildSshControlOptions } from "../src/main/ssh-options";

const NO_MULTIPLEXING = [
  "-o",
  "ControlMaster=no",
  "-o",
  "ControlPath=none",
  "-o",
  "ControlPersist=no",
];

const MULTIPLEXING_ENABLED = [
  "-o",
  "ControlMaster=auto",
  "-o",
  "ControlPath=~/.ssh/cm-hermes-%r@%h:%p",
  "-o",
  "ControlPersist=60s",
];

describe("ssh control options", () => {
  it("disables SSH multiplexing on Windows", () => {
    expect(buildSshControlOptions("win32")).toEqual(NO_MULTIPLEXING);
  });

  it("keeps SSH multiplexing enabled on non-Windows for one-shot commands", () => {
    expect(buildSshControlOptions("linux")).toEqual(MULTIPLEXING_ENABLED);
    expect(buildSshControlOptions("darwin")).toEqual(MULTIPLEXING_ENABLED);
  });

  it("disables SSH multiplexing for tunnel processes on every platform", () => {
    // ControlPersist forks a background master and exits the foreground
    // process, which breaks tunnelProcess lifecycle tracking (#195, #159).
    expect(buildSshControlOptions("linux", { forTunnel: true })).toEqual(
      NO_MULTIPLEXING,
    );
    expect(buildSshControlOptions("darwin", { forTunnel: true })).toEqual(
      NO_MULTIPLEXING,
    );
    expect(buildSshControlOptions("win32", { forTunnel: true })).toEqual(
      NO_MULTIPLEXING,
    );
  });
});
