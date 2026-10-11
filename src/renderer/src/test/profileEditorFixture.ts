import { vi } from "vitest";
import type { ProfileEditorTarget } from "../../../shared/profile-editor-target";

export function profileEditorFixture(
  mode: ProfileEditorTarget["mode"] = "local",
): {
  api: {
    getProfileEditorTarget: ReturnType<typeof vi.fn>;
    onConnectionConfigChanged: ReturnType<typeof vi.fn>;
  };
  change: (
    connectionId: string,
    nextMode?: ProfileEditorTarget["mode"],
  ) => void;
  listeners: Set<() => void>;
} {
  let id = "local";
  let currentMode = mode;
  let revision = 0;
  const listeners = new Set<() => void>();
  return {
    api: {
      getProfileEditorTarget: vi
        .fn()
        .mockImplementation(async (profile?: string) => ({
          connectionId: id,
          profile: profile || "default",
          mode: currentMode,
          scopeToken: `${id}:${profile || "default"}:${revision}`,
        })),
      onConnectionConfigChanged: vi
        .fn()
        .mockImplementation((callback: () => void) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        }),
    },
    change: (connectionId, nextMode = currentMode) => {
      id = connectionId;
      currentMode = nextMode;
      revision += 1;
      listeners.forEach((callback) => callback());
    },
    listeners,
  };
}
