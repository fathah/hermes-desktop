// initial.ts — synchronous seed for first paint. The persisted workspace is loaded
// asynchronously from the main process after mount (see SpsAgent.tsx) and applied
// via setState, so initial state is always a valid seed.
import { buildInitialWorkspace } from "../data/seed";
import type { Workspace } from "../types";

export const initialWorkspace: Workspace = buildInitialWorkspace();
