// Shape returned by the shared gateway's pet.info RPC.
export interface PetInfo {
  enabled: boolean;
  slug?: string;
  displayName?: string;
  mime?: string;
  spritesheetBase64?: string;
  spritesheetRevision?: string;
  frameW?: number;
  frameH?: number;
  framesPerState?: number;
  framesByState?: Record<string, number>;
  framesByRow?: Record<string, number>;
  loopMs?: number;
  scale?: number;
  stateRows?: string[];
}

export type PetState =
  | "idle"
  | "wave"
  | "run"
  | "failed"
  | "review"
  | "jump"
  | "waiting";

export interface PetActivity {
  busy?: boolean;
  awaitingInput?: boolean;
  toolRunning?: boolean;
  reasoning?: boolean;
  error?: boolean;
  justCompleted?: boolean;
  celebrate?: boolean;
}

/** Match agent.pet.state's priority: transient errors and celebrations win over work. */
export function derivePetState(activity: PetActivity): PetState {
  if (activity.error) return "failed";
  if (activity.celebrate) return "jump";
  if (activity.justCompleted) return "wave";
  if (activity.awaitingInput) return "waiting";
  if (activity.toolRunning) return "run";
  if (activity.reasoning) return "review";
  if (activity.busy) return "run";
  return "idle";
}
