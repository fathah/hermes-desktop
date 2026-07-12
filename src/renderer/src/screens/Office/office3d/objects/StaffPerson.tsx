import { memo, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as SkeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { PERSON_WORLD_HEIGHT } from "../core/constants";
import { tintCharacterClone } from "../core/glb";
import { CHAR_MAN, type CharacterModel } from "../core/characters";

/**
 * A stationary staff NPC (bank teller, showroom manager/salesperson): a rig
 * from the character pool, shirt-tinted, playing its idle animation at a
 * fixed spot. Normalised to PERSON_WORLD_HEIGHT so staff stand exactly as
 * tall as the visiting profile agents. These are set dressing today —
 * assisting features (account details, new accounts, car sales) will attach
 * to them later.
 */
export const StaffPerson = memo(function StaffPerson({
  position,
  rotationY = 0,
  tint,
  model = CHAR_MAN,
}: {
  position: [number, number, number];
  /** Which way the person faces (0 = +Z, matching the walker NPCs). */
  rotationY?: number;
  /** Shirt colour. */
  tint: string;
  /** Which rig from the character pool to use. */
  model?: CharacterModel;
}): React.JSX.Element {
  const { scene, animations } = useGLTF(model.url);

  const { cloned, mixer, clipIdx, autoScale } = useMemo(() => {
    const c = SkeletonClone(scene);
    c.updateMatrixWorld(true);
    // Shirt-only tint, same as the profile agents' avatars.
    tintCharacterClone(c, tint, 0.6, model.shirtMaterials);
    const bbox = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const aScale = size.y > 0 ? PERSON_WORLD_HEIGHT / size.y : 1;
    const m = new THREE.AnimationMixer(c);
    const names = animations.map((a) => a.name.toLowerCase());
    // Standing staff idle in place; fall back to the walk clip only if the
    // rig ships without an idle.
    let idx = names.findIndex((n) => n.includes("idle"));
    if (idx < 0) idx = names.findIndex((n) => n.includes("walk"));
    return { cloned: c, mixer: m, clipIdx: idx, autoScale: aScale };
  }, [scene, animations, tint, model]);

  useEffect(() => {
    if (clipIdx >= 0 && animations[clipIdx]) {
      mixer.clipAction(animations[clipIdx], cloned).reset().play();
    }
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(cloned);
    };
  }, [mixer, cloned, animations, clipIdx]);

  useFrame((_, delta) => {
    mixer.update(Math.min(delta, 1 / 30));
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive object={cloned} scale={autoScale} />
    </group>
  );
});
