// initial.ts — single hydration source shared by all slices, so the workspace
// document (docs/tree/meta/comments/trash) is loaded exactly once.
import { persistence } from "../lib/persistence";
import { buildInitialWorkspace } from "../data/seed";
import type { Workspace } from "../types";

export const initialWorkspace: Workspace =
  persistence.load() ?? buildInitialWorkspace();
