import { memo } from "react";
import { Environment, Lightformer, Sky } from "@react-three/drei";
import type { WorldPalette } from "../core/palette";

/**
 * Sky, fog and the full lighting rig. Memoised — nothing here depends on
 * per-frame or selection state, so it must never re-render with the parent.
 */
export const SceneEnvironment = memo(function SceneEnvironment({
  palette,
}: {
  palette: WorldPalette;
}): React.JSX.Element {
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
      {/* Key light. The shadow camera is sized to the whole room (~32 world
          units across) — the default ±5 frustum only covered the centre, so
          most furniture cast no shadow before. */}
      <directionalLight
        position={[14, 36, 16]}
        intensity={palette.directional}
        color={palette.keyColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-36}
        shadow-camera-right={36}
        shadow-camera-top={36}
        shadow-camera-bottom={-36}
      />
    </>
  );
});
