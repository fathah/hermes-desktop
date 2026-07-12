import {
  CANVAS_H,
  CANVAS_W,
  DOOR_LENGTH,
  DOOR_THICKNESS,
  MIN_WALL_LENGTH,
  SCALE,
  SNAP_GRID,
  WALL_THICKNESS,
} from "./constants";
import type { CanvasPoint, FurnitureItem } from "./types";

export const toWorld = (cx: number, cy: number): [number, number, number] => [
  cx * SCALE - CANVAS_W * SCALE * 0.5,
  0,
  cy * SCALE - CANVAS_H * SCALE * 0.5,
];

/**
 * Inverse of `toWorld`. The mapping is linear, so canvas coordinates are valid
 * outside the 0..1800 office rectangle too — agent trips to other buildings
 * express their world-space waypoints in canvas units through this.
 */
export const worldToCanvas = (wx: number, wz: number): [number, number] => [
  (wx + CANVAS_W * SCALE * 0.5) / SCALE,
  (wz + CANVAS_H * SCALE * 0.5) / SCALE,
];

export const snap = (value: number) =>
  Math.round(value / SNAP_GRID) * SNAP_GRID;

let uidCounter = 0;

export const nextUid = () => `fi_${Date.now()}_${uidCounter++}`;

export const normalizeDegrees = (value: number) => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

export const resolveItemTypeKey = (item: FurnitureItem) =>
  item.type === "couch" && item.vertical ? "couch_v" : item.type;

export const ITEM_FOOTPRINT: Record<string, [number, number]> = {
  wall: [80, WALL_THICKNESS],
  door: [DOOR_LENGTH, DOOR_THICKNESS],
  desk_cubicle: [100, 55],
  chair: [24, 24],
  round_table: [120, 120],
  executive_desk: [130, 65],
  couch: [100, 40],
  couch_v: [40, 80],
  bookshelf: [80, 120],
  plant: [24, 24],
  beanbag: [40, 40],
  pingpong: [100, 60],
  table_rect: [80, 40],
  coffee_machine: [32, 34],
  fridge: [40, 80],
  water_cooler: [20, 54],
  atm: [42, 38],
  sms_booth: [58, 54],
  phone_booth: [78, 72],
  whiteboard: [10, 60],
  cabinet: [200, 40],
  computer: [30, 20],
  lamp: [30, 30],
  printer: [40, 35],
  stove: [40, 40],
  microwave: [30, 20],
  wall_cabinet: [80, 20],
  sink: [40, 40],
  vending: [40, 60],
  server_rack: [45, 90],
  server_terminal: [42, 34],
  qa_terminal: [54, 38],
  kanban_board: [130, 65],
  device_rack: [70, 36],
  test_bench: [90, 42],
  treadmill: [70, 35],
  weight_bench: [90, 45],
  dumbbell_rack: [80, 28],
  exercise_bike: [45, 65],
  punching_bag: [28, 28],
  jukebox: [60, 40],
  rowing_machine: [90, 34],
  kettlebell_rack: [70, 26],
  yoga_mat: [70, 30],
  keyboard: [30, 14],
  mouse: [16, 10],
  trash: [20, 20],
  mug: [14, 14],
  clock: [20, 20],
};

export const getItemBaseSize = (item: FurnitureItem) => {
  if (item.r !== undefined) {
    return { width: item.r * 2, height: item.r * 2 };
  }
  const [defaultWidth, defaultHeight] = ITEM_FOOTPRINT[
    resolveItemTypeKey(item)
  ] ?? [item.w ?? 40, item.h ?? 40];
  return {
    width: item.w ?? defaultWidth,
    height: item.h ?? defaultHeight,
  };
};

/**
 * Per-type metadata for furniture items.
 *
 * blocksNavigation: true  → solid floor-standing prop; marks grid cells as impassable.
 * blocksNavigation: false → desk decoration, wall-mounted, elevated, or passable item.
 *
 * This is the single source of truth for nav-blocking behaviour. `buildNavGrid` in
 * navigation.ts reads this instead of maintaining its own hardcoded type set.
 */
export const ITEM_METADATA: Record<
  string,
  { blocksNavigation: boolean; navPadding?: number }
> = {
  // ── structural ────────────────────────────────────────────────────────────
  wall: { blocksNavigation: true },
  door: { blocksNavigation: false }, // passable
  // ── seating / lounge ──────────────────────────────────────────────────────
  chair: { blocksNavigation: false }, // passable / agents sit on them
  couch: { blocksNavigation: true },
  couch_v: { blocksNavigation: true },
  beanbag: { blocksNavigation: true }, // large floor seat (issue #4)
  // ── desks / workstations ──────────────────────────────────────────────────
  desk_cubicle: { blocksNavigation: true, navPadding: 0 }, // blocks nav with zero padding (tight to desk body)
  executive_desk: { blocksNavigation: true },
  // ── tables ────────────────────────────────────────────────────────────────
  round_table: { blocksNavigation: true },
  table_rect: { blocksNavigation: true },
  pingpong: { blocksNavigation: true },
  // ── storage / shelving ────────────────────────────────────────────────────
  bookshelf: { blocksNavigation: true },
  cabinet: { blocksNavigation: true },
  wall_cabinet: { blocksNavigation: false }, // wall-mounted; agents walk under
  // ── kitchen appliances ────────────────────────────────────────────────────
  fridge: { blocksNavigation: true },
  stove: { blocksNavigation: true },
  microwave: { blocksNavigation: false }, // counter-top / elevated
  dishwasher: { blocksNavigation: true }, // floor appliance (issue #4)
  sink: { blocksNavigation: true },
  coffee_machine: { blocksNavigation: false }, // elevated on counter
  // ── office equipment ──────────────────────────────────────────────────────
  printer: { blocksNavigation: true },
  vending: { blocksNavigation: true },
  atm: { blocksNavigation: true },
  whiteboard: { blocksNavigation: true },
  computer: { blocksNavigation: false }, // desk item
  keyboard: { blocksNavigation: false }, // desk decoration
  mouse: { blocksNavigation: false }, // desk decoration
  // ── server room ───────────────────────────────────────────────────────────
  server_rack: { blocksNavigation: true },
  server_terminal: { blocksNavigation: true }, // floor-standing terminal (issue #4)
  sms_booth: { blocksNavigation: true },
  phone_booth: { blocksNavigation: true },
  // ── QA lab ────────────────────────────────────────────────────────────────
  qa_terminal: { blocksNavigation: true },
  kanban_board: { blocksNavigation: true },
  device_rack: { blocksNavigation: true },
  test_bench: { blocksNavigation: true },
  // ── gym ───────────────────────────────────────────────────────────────────
  treadmill: { blocksNavigation: true },
  weight_bench: { blocksNavigation: true },
  dumbbell_rack: { blocksNavigation: true },
  exercise_bike: { blocksNavigation: true },
  punching_bag: { blocksNavigation: true },
  jukebox: { blocksNavigation: true },
  rowing_machine: { blocksNavigation: true },
  kettlebell_rack: { blocksNavigation: true },
  yoga_mat: { blocksNavigation: true },
  // ── art room ──────────────────────────────────────────────────────────────
  easel: { blocksNavigation: true }, // floor-standing prop (issue #4)
  // ── water cooler ──────────────────────────────────────────────────────────
  water_cooler: { blocksNavigation: true }, // freestanding floor appliance (issue #4)
  // ── decorative / small ────────────────────────────────────────────────────
  plant: { blocksNavigation: true },
  lamp: { blocksNavigation: false }, // floor lamp but thin; passable in practice
  trash: { blocksNavigation: false }, // small bin
  clock: { blocksNavigation: false }, // wall-mounted
  mug: { blocksNavigation: false }, // desk item
};

export const FURNITURE_ROTATION: Record<string, number> = {
  couch: Math.PI,
  couch_v: Math.PI / 2,
  executive_desk: -Math.PI / 2,
  whiteboard: Math.PI / 2,
};

export const getItemRotationRadians = (item: FurnitureItem) =>
  ((item.facing ?? 0) * Math.PI) / 180 +
  (FURNITURE_ROTATION[resolveItemTypeKey(item)] ?? 0);

export const getItemBounds = (item: FurnitureItem) => {
  const { width, height } = getItemBaseSize(item);
  const rotation = getItemRotationRadians(item);
  const absCos = Math.abs(Math.cos(rotation));
  const absSin = Math.abs(Math.sin(rotation));
  const boundsWidth = width * absCos + height * absSin;
  const boundsHeight = width * absSin + height * absCos;
  const centerX = item.x + width / 2;
  const centerY = item.y + height / 2;
  return {
    x: centerX - boundsWidth / 2,
    y: centerY - boundsHeight / 2,
    w: boundsWidth,
    h: boundsHeight,
    width,
    height,
  };
};

export const createWallItem = (
  start: CanvasPoint,
  end: CanvasPoint,
  uid: string,
): FurnitureItem => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (horizontal) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    return {
      _uid: uid,
      type: "wall",
      x: snap(minX),
      y: snap(start.y) - WALL_THICKNESS / 2,
      w: Math.max(MIN_WALL_LENGTH, snap(maxX - minX) + WALL_THICKNESS),
      h: WALL_THICKNESS,
      facing: 0,
    };
  }

  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return {
    _uid: uid,
    type: "wall",
    x: snap(start.x) - WALL_THICKNESS / 2,
    y: snap(minY),
    w: WALL_THICKNESS,
    h: Math.max(MIN_WALL_LENGTH, snap(maxY - minY) + WALL_THICKNESS),
    facing: 0,
  };
};
