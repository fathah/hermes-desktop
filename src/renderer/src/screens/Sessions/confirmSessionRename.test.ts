import { describe, expect, it, vi } from "vitest";
import toast from "react-hot-toast";
import {
  confirmSessionRename,
  type ConfirmSessionRenameOptions,
} from "./confirmSessionRename";
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));

function options(): ConfirmSessionRenameOptions {
  return {
    sessionId: "session",
    value: "New title",
    currentTitle: "Original",
    inputRef: { current: null },
    isStillEditing: () => true,
    isCurrentContext: () => true,
    setSaving: vi.fn(),
    applyOptimistic: vi.fn(),
    rollback: vi.fn(),
    clearEditing: vi.fn(),
    fallbackErrorMessage: "Rename failed",
    persist: vi.fn(async () => undefined),
  };
}

describe("confirmSessionRename", () => {
  // @lat: [[sidebar-navigation#Sidebar recent sessions#Row context menu#Rename persistence#Overlapping rename protection]]
  it("allows only one save per editor and restores editing after a failed save", async () => {
    let reject!: (error: Error) => void;
    const opts = options();
    opts.persist = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const first = confirmSessionRename(opts);
    expect(opts.setSaving).toHaveBeenCalledWith(true);
    expect(
      await confirmSessionRename({ ...opts, value: "Another title" }),
    ).toBe("pending");
    expect(opts.persist).toHaveBeenCalledTimes(1);
    reject(new Error("Duplicate title"));
    expect(await first).toBe("failed");
    expect(opts.rollback).toHaveBeenCalledTimes(1);
    expect(opts.clearEditing).not.toHaveBeenCalled();
    expect(opts.setSaving).toHaveBeenLastCalledWith(false);
    expect(toast.error).toHaveBeenCalledWith("Duplicate title");
    opts.persist = vi.fn(async () => undefined);
    expect(await confirmSessionRename(opts)).toBe("saved");
    expect(opts.clearEditing).toHaveBeenCalledTimes(1);
  });

  it("does not roll back a different connection or profile after a late rejection", async () => {
    let reject!: (error: Error) => void;
    let current = true;
    const opts = options();
    opts.isCurrentContext = () => current;
    opts.persist = () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      });
    const save = confirmSessionRename(opts);
    current = false;
    reject(new Error("Connection changed"));
    expect(await save).toBe("failed");
    expect(opts.rollback).not.toHaveBeenCalled();
    expect(opts.clearEditing).not.toHaveBeenCalled();
  });

  it("keeps an unrelated editor open after a successful save", async () => {
    const opts = options();
    opts.isStillEditing = () => false;
    expect(await confirmSessionRename(opts)).toBe("saved");
    expect(opts.clearEditing).not.toHaveBeenCalled();
  });
});
