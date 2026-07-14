import { useGLTF } from "@react-three/drei";
import { memo, useMemo } from "react";
import * as THREE from "three";
import { SCALE } from "../core/constants";
import { toWorld } from "../core/geometry";
import { Interactable } from "./Interactable";
import type { FurniturePlacement, FurnitureType, Workstation } from "../layout";
import deskUrl from "../assets/desk.glb?url";
import executiveDeskUrl from "../assets/ceo_desk.glb?url";
import chairUrl from "../assets/chairDesk.glb?url";
import couchUrl from "../assets/loungeSofa.glb?url";
import sofaChairUrl from "../assets/sofa_chair.glb?url";
import beanbagUrl from "../assets/loungeDesignChair.glb?url";
import plantUrl from "../assets/pottedPlant.glb?url";
import whitePotUrl from "../assets/white_pot.glb?url";
import computerUrl from "../assets/computerScreen.glb?url";
import pantryUrl from "../assets/pantry.glb?url";

interface FurnitureDef {
  url: string;
  scale: [number, number, number];
  tint: string | null;
  footprint: [number, number];
  castShadow: boolean;
  /** World-units lifted off the floor (e.g. a monitor resting on a desk). */
  yOffset?: number;
  origin?: "corner" | "center";
  /** Unscaled GLB-local X/Z point that should land on the placement coordinate. */
  placementAnchor?: [number, number];
}

// Per-type GLB + transform metadata, mirroring hermes-office's furniture maps.
const FURNITURE_DEFS: Record<FurnitureType, FurnitureDef> = {
  desk: {
    url: deskUrl,
    scale: [1.5, 1.5, 1.5],
    tint: "#8b5e32",
    footprint: [100, 55],
    castShadow: true,
  },
  // The CEO's executive desk (ceo_desk.glb). Keeps its own material (tint
  // null). Scale + footprint are starting values — tune to the model's size.
  executiveDesk: {
    url: executiveDeskUrl,
    scale: [0.85, 0.85, 0.85],
    tint: null,
    footprint: [120, 65],
    castShadow: true,
    origin: "center",
  },
  chair: {
    url: chairUrl,
    scale: [1.2, 1.2, 1.2],
    tint: "#4a5568",
    footprint: [24, 24],
    castShadow: true,
  },
  couch: {
    url: couchUrl,
    scale: [1.8, 1.8, 1.8],
    tint: "#3d5575",
    footprint: [100, 40],
    castShadow: true,
  },
  // Upholstered guest armchair (sofa_chair.glb). Origin is at the model's
  // footprint centre (same as how BankDecor places it directly). The raw
  // model is bulky — at 1.5 it dwarfed the executive desk — so it's scaled
  // to read as an armchair next to it.
  sofaChair: {
    url: sofaChairUrl,
    scale: [0.9, 0.9, 0.9],
    tint: "#4a5568",
    footprint: [40, 40],
    castShadow: true,
    origin: "center",
  },
  beanbag: {
    url: beanbagUrl,
    scale: [1.5, 1.5, 1.5],
    tint: "#5a4870",
    footprint: [60, 60],
    castShadow: true,
    placementAnchor: [0.25, 0.05],
  },
  plant: {
    url: plantUrl,
    scale: [1.2, 1.8, 1.2],
    tint: null,
    footprint: [24, 24],
    castShadow: false,
  },
  // Decorative white planter (white_pot.glb). Keeps its own material. The raw
  // model is ~3.5 world units tall (taller than the walls), so it's scaled way
  // down to a ~1 world-unit floor planter.
  whitePot: {
    url: whitePotUrl,
    scale: [0.3, 0.3, 0.3],
    tint: null,
    footprint: [30, 30],
    castShadow: true,
  },
  // Desk monitor (computerScreen.glb), tinted dark and lifted onto the desk
  // surface — values mirror hermes-office's `computer` furniture.
  computer: {
    url: computerUrl,
    scale: [1.1, 1.1, 1.1],
    tint: "#363c58",
    footprint: [30, 20],
    castShadow: true,
    yOffset: 0.61,
  },
  pantry: {
    url: pantryUrl,
    scale: [0.00013, 0.00013, 0.00013],
    tint: null,
    footprint: [120, 80],
    castShadow: true,
    yOffset: 0.007,
    placementAnchor: [-122984.47, -41638.51],
  },
};

/**
 * Clone a loaded GLB scene and apply tint/shadow treatment. `tint === null`
 * keeps the model's own colors (e.g. plants); the desk/chair/couch GLBs are
 * `KHR_materials_unlit`, so the tint lerps their flat base color.
 */
function tintedClone(
  scene: THREE.Object3D,
  tint: string | null,
  castShadow: boolean,
): THREE.Object3D {
  const tintColor = tint ? new THREE.Color(tint) : null;
  const template = scene.clone(true);
  template.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const nextMats = mats.map((material) => {
      // These GLBs ship as KHR_materials_unlit (flat, lighting-independent), so
      // they ignore the key light, IBL environment and shadows. Rebuild each as
      // a lit PBR material that keeps the source colour/texture but now responds
      // to the scene lighting — the core of the realism upgrade.
      const src = material as THREE.Material & {
        color?: THREE.Color;
        map?: THREE.Texture | null;
        vertexColors?: boolean;
      };
      const lit = new THREE.MeshStandardMaterial({
        color: src.color ? src.color.clone() : new THREE.Color("#ffffff"),
        map: src.map ?? null,
        vertexColors: src.vertexColors ?? false,
        transparent: src.transparent ?? false,
        opacity: src.opacity ?? 1,
        alphaTest: src.alphaTest ?? 0,
        side: src.side ?? THREE.FrontSide,
        roughness: 0.72,
        metalness: 0.0,
        envMapIntensity: 0.85,
      });
      if (tintColor) lit.color.lerp(tintColor, 0.8);
      return lit;
    });
    mesh.material = Array.isArray(mesh.material) ? nextMats : nextMats[0];
  });
  return template;
}

/**
 * Render one GLB furniture item placed by canvas (x, y) top-left and rotated
 * around its footprint centre — same placement maths as hermes-office.
 */
function GlbItem({
  type,
  x,
  y,
  facingDeg,
  tint,
  scaleMultiplier = 1,
  yOffset,
}: {
  type: FurnitureType;
  x: number;
  y: number;
  facingDeg: number;
  tint?: string | null;
  /** Uniformly scales the model up (e.g. the larger executive desk). */
  scaleMultiplier?: number;
  /** Override the default vertical lift off the floor. */
  yOffset?: number;
}): React.JSX.Element {
  const def = FURNITURE_DEFS[type];
  // Draco (CDN) and Meshopt (WASM) decoders are disabled — our GLBs are
  // uncompressed and either decoder would violate the renderer CSP.
  const { scene } = useGLTF(def.url, false, false);
  const resolvedTint = tint === undefined ? def.tint : tint;
  const object = useMemo(
    () => tintedClone(scene, resolvedTint, def.castShadow),
    [scene, resolvedTint, def.castShadow],
  );
  const scale = useMemo(
    () =>
      [
        def.scale[0] * scaleMultiplier,
        def.scale[1] * scaleMultiplier,
        def.scale[2] * scaleMultiplier,
      ] as [number, number, number],
    [def.scale, scaleMultiplier],
  );
  const [wx, , wz] = toWorld(x, y);
  const rotY = (facingDeg * Math.PI) / 180;
  const isCenter = def.origin === "center";
  const placementAnchor = def.placementAnchor;
  const pivotX = isCenter ? 0 : def.footprint[0] * SCALE * 0.5;
  const pivotZ = isCenter ? 0 : def.footprint[1] * SCALE * 0.5;
  const anchorX = placementAnchor ? placementAnchor[0] * scale[0] : 0;
  const anchorZ = placementAnchor ? placementAnchor[1] * scale[2] : 0;
  const resolvedYOffset = yOffset ?? def.yOffset ?? 0;

  if (placementAnchor) {
    return (
      <group position={[wx, resolvedYOffset, wz]} rotation={[0, rotY, 0]}>
        <primitive
          object={object}
          position={[-anchorX, 0, -anchorZ]}
          scale={scale}
        />
      </group>
    );
  }

  return (
    <group position={[wx, resolvedYOffset, wz]}>
      <group position={[pivotX, 0, pivotZ]} rotation={[0, rotY, 0]}>
        <group position={[-pivotX, 0, -pivotZ]}>
          <primitive object={object} scale={scale} />
        </group>
      </group>
    </group>
  );
}

// Executive desk treatment: a real wooden table (its own material) + dark
// chair, flanked by potted plants so the CEO's corner reads as a premium
// private office.
const EXEC_CHAIR_TINT = "#171b24";
const EXEC_CHAIR_SCALE = 1.22;
// Plant offsets (canvas units from the desk's top-left). Placed outside the
// up-scaled desk's visual width so they flank rather than overlap it.
const EXEC_PLANT_LEFT_DX = -95;
const EXEC_PLANT_RIGHT_DX = 150;
const EXEC_PLANT_DY = 8;

function ExecutiveWorkstation({
  station,
}: {
  station: Workstation;
}): React.JSX.Element {
  return (
    <group>
      <GlbItem
        type="executiveDesk"
        x={station.deskX}
        y={station.deskY}
        facingDeg={station.deskFacingDeg}
      />
      <GlbItem
        type="computer"
        x={station.deskX}
        y={station.deskY - 25}
        facingDeg={180}
        yOffset={0.78}
      />
      <GlbItem
        type="chair"
        x={station.chairX}
        y={station.chairY}
        facingDeg={station.chairFacingDeg}
        tint={EXEC_CHAIR_TINT}
        scaleMultiplier={EXEC_CHAIR_SCALE}
      />
      <GlbItem
        type="plant"
        x={station.deskX + EXEC_PLANT_LEFT_DX}
        y={station.deskY + EXEC_PLANT_DY}
        facingDeg={0}
      />
      <GlbItem
        type="plant"
        x={station.deskX + EXEC_PLANT_RIGHT_DX}
        y={station.deskY + EXEC_PLANT_DY}
        facingDeg={0}
      />
    </group>
  );
}

/** Render an arbitrary list of furniture placements (e.g. the rest room). */
export const FurniturePieces = memo(function FurniturePieces({
  pieces,
}: {
  pieces: FurniturePlacement[];
}): React.JSX.Element {
  return (
    <>
      {pieces.map((piece) => (
        <GlbItem
          key={piece.id}
          type={piece.type}
          x={piece.x}
          y={piece.y}
          facingDeg={piece.facingDeg}
          tint={piece.tint}
        />
      ))}
    </>
  );
});

/** Render every workstation (a desk + its chair) in the work area. */
export const Workstations = memo(function Workstations({
  workstations,
  interactive = false,
  onDeskActivate,
  agentNameById,
}: {
  workstations: Workstation[];
  /** Office-interior mode: desks become hover/click interactables. */
  interactive?: boolean;
  onDeskActivate?: (agentId: string) => void;
  /** Hover-label text per agent id (the agent's display name). */
  agentNameById?: Map<string, string>;
}): React.JSX.Element {
  return (
    <>
      {workstations.map((w) => {
        // GlbItems place themselves at absolute world positions, so the
        // hover label/ring gets the desk's world centre as its indicator.
        const [ix, , iz] = toWorld(
          w.isExecutive ? w.deskX : w.deskX + 50,
          w.isExecutive ? w.deskY : w.deskY - 15,
        );
        return (
          <Interactable
            key={w.id}
            enabled={interactive && !!onDeskActivate}
            label={agentNameById?.get(w.agentId) ?? w.agentId}
            onActivate={() => onDeskActivate?.(w.agentId)}
            indicatorPosition={[ix, 0, iz]}
            labelHeight={1.7}
            ringRadius={1.3}
          >
            {w.isExecutive ? (
              <ExecutiveWorkstation station={w} />
            ) : (
              <group>
                <GlbItem
                  type="desk"
                  x={w.deskX}
                  y={w.deskY}
                  facingDeg={w.deskFacingDeg}
                />
                <GlbItem
                  type="computer"
                  x={w.deskX + 20}
                  y={w.deskY - 40}
                  facingDeg={180}
                  yOffset={0.58}
                />
                <GlbItem
                  type="chair"
                  x={w.chairX}
                  y={w.chairY}
                  facingDeg={w.chairFacingDeg}
                />
              </group>
            )}
          </Interactable>
        );
      })}
    </>
  );
});

useGLTF.preload(deskUrl, false, false);
useGLTF.preload(executiveDeskUrl, false, false);
useGLTF.preload(chairUrl, false, false);
useGLTF.preload(couchUrl, false, false);
useGLTF.preload(beanbagUrl, false, false);
useGLTF.preload(plantUrl, false, false);
useGLTF.preload(whitePotUrl, false, false);
useGLTF.preload(computerUrl, false, false);
useGLTF.preload(pantryUrl, false, false);
