import { memo, useMemo } from "react";
import * as THREE from "three";

/**
 * Glass roofs for the enterable buildings. From the sky the city reads as a
 * finished block instead of open-topped boxes, while the interiors (and the
 * agents in them) stay visible through the glass — a terrarium of agents.
 * In walk mode the roof stays mounted indoors, so looking up from inside
 * shows the glass grid and the sky beyond it.
 */

const GLASS_COLOR = "#bcd6e8";
const FRAME_COLOR = "#8e99a6";

/**
 * A flat glass roof centred on the local origin: one transparent pane plus a
 * metal frame (border beams + a mullion grid). Rendered inside a building's
 * group so it inherits the building's position. No shadows — glass casting a
 * solid shadow over the interior would read as a ceiling, not a skylight.
 */
export const GlassRoof = memo(function GlassRoof({
  width,
  depth,
  height,
  mullionEvery = 4,
}: {
  /** Roof extent along x (world units). */
  width: number;
  /** Roof extent along z (world units). */
  depth: number;
  /** Height of the glass plane above the building's floor. */
  height: number;
  /** Approximate spacing of the frame's mullion grid. */
  mullionEvery?: number;
}): React.JSX.Element {
  // Mullion positions along each axis (excluding the border beams).
  const { xMullions, zMullions } = useMemo(() => {
    const along = (extent: number): number[] => {
      const count = Math.max(0, Math.round(extent / mullionEvery) - 1);
      const gap = extent / (count + 1);
      return Array.from(
        { length: count },
        (_, i) => -extent / 2 + gap * (i + 1),
      );
    };
    return { xMullions: along(width), zMullions: along(depth) };
  }, [width, depth, mullionEvery]);

  return (
    <group position={[0, height, 0]}>
      {/* Glass pane. depthWrite off so the transparent pane never occludes
          other transparents (CEO glass walls, storefront) beneath it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial
          color={GLASS_COLOR}
          roughness={0.08}
          metalness={0.25}
          transparent
          opacity={0.16}
          envMapIntensity={1.2}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Border beams */}
      {([-1, 1] as const).map((s) => (
        <mesh key={`bz-${s}`} position={[0, 0.04, (s * depth) / 2]}>
          <boxGeometry args={[width + 0.24, 0.14, 0.24]} />
          <meshStandardMaterial
            color={FRAME_COLOR}
            roughness={0.4}
            metalness={0.35}
          />
        </mesh>
      ))}
      {([-1, 1] as const).map((s) => (
        <mesh key={`bx-${s}`} position={[(s * width) / 2, 0.04, 0]}>
          <boxGeometry args={[0.24, 0.14, depth + 0.24]} />
          <meshStandardMaterial
            color={FRAME_COLOR}
            roughness={0.4}
            metalness={0.35}
          />
        </mesh>
      ))}
      {/* Mullion grid */}
      {xMullions.map((x) => (
        <mesh key={`mx-${x}`} position={[x, 0.02, 0]}>
          <boxGeometry args={[0.09, 0.07, depth]} />
          <meshStandardMaterial
            color={FRAME_COLOR}
            roughness={0.45}
            metalness={0.3}
          />
        </mesh>
      ))}
      {zMullions.map((z) => (
        <mesh key={`mz-${z}`} position={[0, 0.02, z]}>
          <boxGeometry args={[width, 0.07, 0.09]} />
          <meshStandardMaterial
            color={FRAME_COLOR}
            roughness={0.45}
            metalness={0.3}
          />
        </mesh>
      ))}
    </group>
  );
});
