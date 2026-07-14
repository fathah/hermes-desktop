import type { AgentAvatarProfile } from "../avatars/profile";

// Originally `@/lib/office/places` in hermes-office; the office tab only needs
// the structural agent types, so we keep this as an open string identifier.
export type OfficeInteractionTargetId = string;

/** An agent's org position. Everyone is an employee; exactly one can be CEO. */
export type AgentPosition = "employee" | "ceo";

export type OfficeAgent = {
  id: string;
  name: string;
  subtitle?: string | null;
  status: "working" | "idle" | "error";
  color: string;
  item: string;
  avatarProfile?: AgentAvatarProfile | null;
  /** Underlying profile metadata, surfaced in the details sidebar. */
  model?: string;
  provider?: string;
  gatewayRunning?: boolean;
  /** Org position; defaults to "employee" when unset. The CEO gets a desk. */
  position?: AgentPosition;
};

export type JanitorTool = "broom" | "vacuum" | "floor_scrubber";

export type JanitorActor = {
  id: string;
  name: string;
  role: "janitor";
  status: "working";
  color: string;
  item: "cleaning";
  janitorTool: JanitorTool;
  janitorRoute: FacingPoint[];
  janitorPauseMs: number;
  janitorDespawnAt: number;
};

export type SceneActor = OfficeAgent | JanitorActor;

/**
 * Where an agent currently is. Drives interior-mode visibility: each interior
 * view renders only the agents whose place matches it ("outside" = walking
 * between buildings, so visible only in the city view).
 */
export type AgentPlace = "office" | "bank" | "showroom" | "outside";

export type RenderAgent = SceneActor & {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  path: { x: number; y: number }[];
  facing: number;
  frame: number;
  walkSpeed: number;
  phaseOffset: number;
  /** Building the agent is currently in (defaults to the office). */
  place?: AgentPlace;
  state:
    | "walking"
    | "sitting"
    | "standing"
    | "away"
    | "working_out"
    | "dancing";
  awayUntil?: number;
  separationReplanAt?: number;
  bumpedUntil?: number;
  bumpTalkUntil?: number;
  collisionCooldownUntil?: number;
  pingPongUntil?: number;
  pingPongTargetX?: number;
  pingPongTargetY?: number;
  pingPongFacing?: number;
  pingPongPartnerId?: string;
  pingPongTableUid?: string;
  pingPongSide?: 0 | 1;
  pingPongPreviousWalkSpeed?: number;
  interactionTarget?: OfficeInteractionTargetId;
  smsBoothStage?: "door_outer" | "door_inner" | "typing";
  phoneBoothStage?: "door_outer" | "door_inner" | "receiver";
  serverRoomStage?: "door_outer" | "door_inner" | "terminal";
  gymStage?: "door_outer" | "door_inner" | "workout";
  qaLabStage?: "door_outer" | "door_inner" | "station";
  qaLabStationType?: QaLabStationType;
  workoutStyle?: "run" | "lift" | "bike" | "box" | "row" | "stretch";
  janitorRouteIndex?: number;
  janitorPauseUntil?: number;
};

export type FurnitureItem = {
  _uid: string;
  type: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  color?: string;
  id?: string;
  facing?: number;
  vertical?: boolean;
  elevation?: number;
};

export type FurnitureSeed = Omit<FurnitureItem, "_uid">;

export type CanvasPoint = {
  x: number;
  y: number;
};

export type FacingPoint = CanvasPoint & {
  facing: number;
};

export type QaLabStationType = "console" | "device_rack" | "bench";

export type GymWorkoutLocation = FacingPoint & {
  workoutStyle: "run" | "lift" | "bike" | "box" | "row" | "stretch";
};

export type QaLabStationLocation = FacingPoint & {
  stationType: QaLabStationType;
};

export type ServerRoomRoute = {
  stage: "door_outer" | "door_inner" | "terminal";
  targetX: number;
  targetY: number;
  facing: number;
};

export type QaLabRoute = {
  stage: "door_outer" | "door_inner" | "station";
  targetX: number;
  targetY: number;
  facing: number;
};

export type GymRoute = {
  stage: "door_outer" | "door_inner" | "workout";
  targetX: number;
  targetY: number;
  facing: number;
};

export type PhoneBoothRoute = {
  stage: "door_outer" | "door_inner" | "receiver";
  targetX: number;
  targetY: number;
  facing: number;
};

export type SmsBoothRoute = {
  stage: "door_outer" | "door_inner" | "typing";
  targetX: number;
  targetY: number;
  facing: number;
};
