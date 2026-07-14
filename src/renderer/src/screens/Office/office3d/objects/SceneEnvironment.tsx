import { memo, useEffect, useRef } from "react";
import { Environment, Lightformer, Sky } from "@react-three/drei";
import type * as THREE from "three";
import type { WorldPalette } from "../core/palette";

const DEFAULT_CENTER: [number, number] = [0, 0];

/**
 * Sky, fog and the full lighting rig. Memoised — nothing here depends on
 * per-frame or selection state, so it must never re-render with the parent.
 *
 * `center` / `shadowHalfExtent` aim the key light's shadow camera at the
 * active location: interiors away from the origin (the bank sits at x≈68)
 * would otherwise fall outside the default frustum and get no shadows.
 */
export const SceneEnvironment = memo(function SceneEnvironment({
  palette,
  center = DEFAULT_CENTER,
  shadowHalfExtent = 36,
}: {
  palette: WorldPalette;
  center?: [number, number];
  shadowHalfExtent?: number;
}): React.JSX.Element {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const [cx, cz] = center;
  // The directional light's shadow direction comes from its `target` object,
  // which must be placed in the scene and positioned explicitly.
  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.target.position.set(cx, 0, cz);
    light.target.updateMatrixWorld();
    // shadowHalfExtent is a dep only because it remounts the light (key
    // change), which needs the target re-applied even when cx/cz are equal.
  }, [cx, cz, shadowHalfExtent]);
  return (
    <>
      {/* Procedural day-sky gradient (Preetham atmosphere). Sun direction
          matches the key light so sky brightness and shadows agree. Sky
          ignores fog by design. */}
      <Sky
        distance={400}
        sunPosition={[14, 36, 16]}
        turbidity={4}
        rayleigh={0.5}
      />
      {/* Light aerial haze matched to the sky's horizon band, so distant
          ground and the skyline ring dissolve into the sky instead of ending
          at a hard edge. */}
      <fog attach="fog" args={["#d6dde5", 70, 280]} />
      {/* Soft image-based lighting baked once from in-scene Lightformers — no
          external HDRI fetch, so it stays within the renderer's strict CSP. */}
      <Environment frames={1} resolution={256} background={false}>
        <Lightformer
          form="rect"
          intensity={palette.envIntensity}
          color={palette.keyColor}
          position={[0, 20, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[36, 36, 1]}
        />
        <Lightformer
          form="rect"
          intensity={palette.envIntensity * 0.6}
          color="#eaf0ff"
          position={[0, 8, 24]}
          rotation={[0, 0, 0]}
          scale={[36, 14, 1]}
        />
        <Lightformer
          form="rect"
          intensity={palette.envIntensity * 0.4}
          color="#ffffff"
          position={[-24, 9, 0]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[36, 14, 1]}
        />
        <Lightformer
          form="rect"
          intensity={palette.envIntensity * 0.4}
          color="#ffffff"
          position={[24, 9, 0]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[36, 14, 1]}
        />
      </Environment>
      <hemisphereLight
        args={[palette.hemiSky, palette.hemiGround, palette.hemiIntensity]}
      />
      <ambientLight intensity={palette.ambient} />
      {/* Key light. The shadow camera is sized to the active location — the
          default ±5 frustum only covered the scene centre, so most furniture
          cast no shadow before. `key` forces a remount when the frustum
          changes: three only reads shadow.camera bounds at creation. */}
      <directionalLight
        key={`key-light-${cx}-${cz}-${shadowHalfExtent}`}
        ref={lightRef}
        position={[cx + 14, 36, cz + 16]}
        intensity={palette.directional}
        color={palette.keyColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-shadowHalfExtent}
        shadow-camera-right={shadowHalfExtent}
        shadow-camera-top={shadowHalfExtent}
        shadow-camera-bottom={-shadowHalfExtent}
      />
    </>
  );
});
