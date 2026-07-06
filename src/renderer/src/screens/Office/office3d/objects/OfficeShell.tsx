import { Suspense, memo, useMemo } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import woodenTableGlbUrl from "../assets/wooden_table.glb?url";
import hermesHqLogoUrl from "../assets/images/hermes-one-hq.webp";
import { WORLD_W, WORLD_H, SCALE } from "../core/constants";
import { toWorld } from "../core/geometry";
import { glbClone, normalizeFootprint } from "../core/glb";
import type { WorldPalette } from "../core/palette";
import { INTERIOR_WALLS, GLASS_WALLS, CEO_OFFICE } from "../layout";

const ROOM_WALL_H = 2.4;
const ROOM_WALL_T = 0.2;

/** North wall — 3.6 m tall with three window openings and glass panels. */
function NorthWall({ palette }: { palette: WorldPalette }): React.JSX.Element {
  const halfW = WORLD_W / 2;
  const z = -WORLD_H / 2;
  const wallT = 0.2;
  const wallH = 3.6;
  const windowW = 5.0;
  const windowH = 1.4;
  const windowY = 2.2;
  const numWindows = 3;

  const gap = (WORLD_W - numWindows * windowW) / (numWindows + 1);
  const winBottom = windowY - windowH / 2;
  const winTop = windowY + windowH / 2;

  return (
    <group>
      {/* Bottom solid strip */}
      <mesh position={[0, winBottom / 2, z]}>
        <boxGeometry args={[WORLD_W, winBottom, wallT]} />
        <meshStandardMaterial color={palette.wallNS} />
      </mesh>
      {/* Top solid strip */}
      <mesh position={[0, winTop + (wallH - winTop) / 2, z]}>
        <boxGeometry args={[WORLD_W, wallH - winTop, wallT]} />
        <meshStandardMaterial color={palette.wallNS} />
      </mesh>
      {/* Vertical pillars between windows */}
      {Array.from({ length: numWindows + 1 }).map((_, i) => {
        const x = -halfW + gap * (i + 0.5) + windowW * i;
        return (
          <mesh key={`p-${i}`} position={[x, windowY, z]}>
            <boxGeometry args={[gap, windowH, wallT]} />
            <meshStandardMaterial color={palette.wallNS} />
          </mesh>
        );
      })}
      {/* Window glass */}
      {Array.from({ length: numWindows }).map((_, i) => {
        const x = -halfW + gap * (i + 1) + windowW * (i + 0.5);
        return (
          <mesh key={`g-${i}`} position={[x, windowY, z + wallT / 2 + 0.02]}>
            <planeGeometry args={[windowW - 0.2, windowH - 0.2]} />
            <meshStandardMaterial
              color="#c8dae8"
              roughness={0.05}
              metalness={0.4}
              envMapIntensity={1.0}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/** HERMES HQ logo decal on the office's south wall. */
function OfficeLogo(): React.JSX.Element {
  const texture = useTexture(hermesHqLogoUrl, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
  });
  // Logo aspect ratio ≈ 4.3 : 1
  const logoW = 8.0;
  const logoH = logoW / 4.3;
  const halfH = WORLD_H / 2;
  const wallT = 0.2;
  const z = halfH + wallT / 2 + 0.01;
  return (
    <mesh position={[0, 1.5, z]}>
      <planeGeometry args={[logoW, logoH]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.4}
        metalness={0.0}
        envMapIntensity={2.5}
        emissiveIntensity={0.6}
        transparent
        alphaTest={0.05}
      />
    </mesh>
  );
}

/** Floor, rug and perimeter walls — a clean, minimal office shell. */
export const Room = memo(function Room({
  palette,
}: {
  palette: WorldPalette;
}): React.JSX.Element {
  const halfW = WORLD_W / 2;
  const halfH = WORLD_H / 2;
  const wallH = ROOM_WALL_H;
  const wallT = ROOM_WALL_T;
  return (
    <group>
      {/* Floor — slightly glossy so the IBL adds a soft sheen + grounding. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[WORLD_W, WORLD_H]} />
        <meshStandardMaterial
          color={palette.floor}
          roughness={0.78}
          metalness={0}
          envMapIntensity={0.6}
        />
      </mesh>
      {/* Center rug for a bit of warmth (matte). */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[WORLD_W * 0.42, WORLD_H * 0.42]} />
        <meshStandardMaterial
          color={palette.rug}
          roughness={0.95}
          metalness={0}
          envMapIntensity={0.4}
        />
      </mesh>
      {/* North wall — taller with windows */}
      <NorthWall palette={palette} />
      {/* South / east / west walls */}
      <mesh position={[0, wallH / 2, halfH]}>
        <boxGeometry args={[WORLD_W, wallH, wallT]} />
        <meshStandardMaterial color={palette.wallNS} />
      </mesh>
      <Suspense fallback={null}>
        <OfficeLogo />
      </Suspense>
      <mesh position={[-halfW, wallH / 2, 0]}>
        <boxGeometry args={[wallT, wallH, WORLD_H]} />
        <meshStandardMaterial color={palette.wallEW} />
      </mesh>
      <mesh position={[halfW, wallH / 2, 0]}>
        <boxGeometry args={[wallT, wallH, WORLD_H]} />
        <meshStandardMaterial color={palette.wallEW} />
      </mesh>
    </group>
  );
});

/** Interior partition walls (e.g. the work-area / rest-room divider). */
export const InteriorWalls = memo(function InteriorWalls({
  palette,
}: {
  palette: WorldPalette;
}): React.JSX.Element {
  const wallH = ROOM_WALL_H;
  return (
    <group>
      {INTERIOR_WALLS.map((wall) => {
        const [cx, , cz] = toWorld(wall.x + wall.w / 2, wall.y + wall.h / 2);
        return (
          <mesh key={wall.id} position={[cx, wallH / 2, cz]} castShadow>
            <boxGeometry args={[wall.w * SCALE, wallH, wall.h * SCALE]} />
            <meshStandardMaterial color={palette.wallEW} />
          </mesh>
        );
      })}
    </group>
  );
});

/**
 * Clear glass partitions enclosing the CEO's corner office, with a slim metal
 * cap rail so the pane edges read from above. No shadows — clear glass casting
 * a solid shadow looks wrong.
 */
export const GlassWalls = memo(function GlassWalls(): React.JSX.Element {
  const glassH = 2.2;
  return (
    <group>
      {GLASS_WALLS.map((wall) => {
        const [cx, , cz] = toWorld(wall.x + wall.w / 2, wall.y + wall.h / 2);
        const w = wall.w * SCALE;
        const d = wall.h * SCALE;
        return (
          <group key={wall.id}>
            <mesh position={[cx, glassH / 2, cz]}>
              <boxGeometry args={[w, glassH, d]} />
              <meshStandardMaterial
                color="#cfe2ee"
                roughness={0.05}
                metalness={0.2}
                transparent
                opacity={0.22}
                envMapIntensity={1.2}
              />
            </mesh>
            <mesh position={[cx, glassH + 0.03, cz]}>
              <boxGeometry args={[w, 0.06, d]} />
              <meshStandardMaterial
                color="#9aa4b0"
                roughness={0.4}
                metalness={0.3}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
});

/**
 * Extra set dressing inside the CEO's glass office that isn't part of the
 * data-driven furniture pipeline: a wall-mounted LED TV, a dark executive rug
 * under the lounge and a wooden coffee table between the desk and the visitor
 * couch (auto-normalised — wooden_table.glb ships at an arbitrary export scale).
 */
export const CeoOfficeExtras = memo(
  function CeoOfficeExtras(): React.JSX.Element {
    const { scene } = useGLTF(woodenTableGlbUrl, false, false);
    // Normalise the table's long side to ~1.6 world units (coffee-table size).
    const table = useMemo(
      () => normalizeFootprint(glbClone(scene, null), 1.6),
      [scene],
    );

    const [rugX, , rugZ] = toWorld(
      (CEO_OFFICE.minX + CEO_OFFICE.maxX) / 2,
      (CEO_OFFICE.minY + CEO_OFFICE.maxY) / 2,
    );
    const rugW = (CEO_OFFICE.maxX - CEO_OFFICE.minX - 90) * SCALE;
    const rugD = (CEO_OFFICE.maxY - CEO_OFFICE.minY - 110) * SCALE;
    // Between the desk (south edge) and the couch — the lounge centrepiece.
    const [tableX, , tableZ] = toWorld(300, 1475);
    // Wall-mounted LED TV on the west perimeter wall, facing the lounge.
    // Perimeter wall inner face sits at -WORLD_W/2 + wallT/2 (wallT = 0.2).
    const tvX = -WORLD_W / 2 + 0.1 + 0.05;
    const [, , tvZ] = toWorld(0, 1450);

    return (
      <group>
        {/* LED TV: dark frame + softly glowing panel */}
        <group position={[tvX, 1.45, tvZ]} rotation={[0, Math.PI / 2, 0]}>
          <mesh castShadow>
            <boxGeometry args={[2.4, 1.35, 0.07]} />
            <meshStandardMaterial
              color="#11151c"
              roughness={0.35}
              metalness={0.4}
            />
          </mesh>
          <mesh position={[0, 0, 0.045]}>
            <planeGeometry args={[2.24, 1.2]} />
            <meshStandardMaterial
              color="#0c1118"
              emissive="#3b82c4"
              emissiveIntensity={0.45}
              roughness={0.15}
              metalness={0.1}
            />
          </mesh>
        </group>
        {/* Executive rug — above the main office rug (0.01) to avoid z-fights */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[rugX, 0.02, rugZ]}
          receiveShadow
        >
          <planeGeometry args={[rugW, rugD]} />
          <meshStandardMaterial
            color="#46536b"
            roughness={0.95}
            metalness={0}
            envMapIntensity={0.4}
          />
        </mesh>
        <group position={[tableX, 0.021, tableZ]}>
          <primitive object={table} />
        </group>
      </group>
    );
  },
);

useGLTF.preload(woodenTableGlbUrl, false, false);
