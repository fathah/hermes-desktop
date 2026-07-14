/**
 * The office world's enterable locations. "city" is the full outdoor scene;
 * the rest are building interiors. Entering an interior does NOT move any
 * geometry — buildings stay at their cityPlan positions and only the camera
 * travels there, while Office3D unmounts every scene layer that isn't part of
 * the active location (city backdrop, traffic, other buildings) so the GPU
 * renders just what's actually on screen.
 */
import {
  BANK_X,
  BANK_Z,
  BANK_W,
  BANK_D,
  SHOWROOM_X,
  SHOWROOM_Z,
  SHOWROOM_W,
  SHOWROOM_D,
} from "./cityPlan";
import { WORLD_W, WORLD_H } from "./constants";

export type OfficeLocation = "city" | "office" | "bank" | "showroom";

/** Buildings the user can enter from the city view. */
export type BuildingId = Exclude<OfficeLocation, "city">;

export interface LocationConfig {
  /** Camera fly-to position when entering this location. */
  cameraPosition: [number, number, number];
  /** OrbitControls focus point when entering. */
  cameraTarget: [number, number, number];
  minDistance: number;
  maxDistance: number;
  /** OrbitControls target clamp box, so panning can't leave the location. */
  clamp: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
  /** Directional-light / shadow-camera centre (world x, z). */
  shadowCenter: [number, number];
  /** Shadow camera half-extent around the centre. */
  shadowHalfExtent: number;
}

const BANK_PAD_X = BANK_W / 2 - 1;
const BANK_PAD_Z = BANK_D / 2 - 1;
const SHOWROOM_PAD_X = SHOWROOM_W / 2 - 1;
const SHOWROOM_PAD_Z = SHOWROOM_D / 2 - 1;

export const LOCATIONS: Record<OfficeLocation, LocationConfig> = {
  city: {
    cameraPosition: [0, 38, 48],
    cameraTarget: [0, 0, -14.6],
    minDistance: 5,
    maxDistance: 130,
    clamp: { minX: -90, maxX: 90, minY: 0, maxY: 12, minZ: -90, maxZ: 90 },
    shadowCenter: [0, 0],
    shadowHalfExtent: 36,
  },
  office: {
    cameraPosition: [0, 20, 24],
    cameraTarget: [0, 0, 0],
    minDistance: 4,
    maxDistance: 46,
    clamp: {
      minX: -WORLD_W / 2,
      maxX: WORLD_W / 2,
      minY: 0,
      maxY: 6,
      minZ: -WORLD_H / 2,
      maxZ: WORLD_H / 2,
    },
    shadowCenter: [0, 0],
    shadowHalfExtent: 24,
  },
  bank: {
    // The bank's doorway is in its south wall, so approach from the south.
    cameraPosition: [BANK_X, 13, BANK_Z + 15],
    cameraTarget: [BANK_X, 0, BANK_Z],
    minDistance: 3,
    maxDistance: 32,
    clamp: {
      minX: BANK_X - BANK_PAD_X,
      maxX: BANK_X + BANK_PAD_X,
      minY: 0,
      maxY: 5,
      minZ: BANK_Z - BANK_PAD_Z,
      maxZ: BANK_Z + BANK_PAD_Z,
    },
    shadowCenter: [BANK_X, BANK_Z],
    shadowHalfExtent: 20,
  },
  showroom: {
    // Glass storefront faces east (toward the office) — enter from there.
    cameraPosition: [SHOWROOM_X + 14, 11, SHOWROOM_Z + 8],
    cameraTarget: [SHOWROOM_X, 0, SHOWROOM_Z],
    minDistance: 3,
    maxDistance: 30,
    clamp: {
      minX: SHOWROOM_X - SHOWROOM_PAD_X,
      maxX: SHOWROOM_X + SHOWROOM_PAD_X,
      minY: 0,
      maxY: 5,
      minZ: SHOWROOM_Z - SHOWROOM_PAD_Z,
      maxZ: SHOWROOM_Z + SHOWROOM_PAD_Z,
    },
    shadowCenter: [SHOWROOM_X, SHOWROOM_Z],
    shadowHalfExtent: 18,
  },
};
