import * as THREE from "three";

/**
 * Clone a GLB scene and rebuild every material as a lit PBR standard material
 * (many source GLBs ship KHR_materials_unlit, which ignores scene lighting).
 * `tint` lerps the base colour 75% toward it; `null` keeps original colours.
 */
export function glbClone(
  scene: THREE.Object3D,
  tint: string | null,
): THREE.Object3D {
  const tintColor = tint ? new THREE.Color(tint) : null;
  const copy = scene.clone(true);
  copy.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const isArray = Array.isArray(mesh.material);
    const mats = isArray
      ? (mesh.material as THREE.Material[])
      : [mesh.material as THREE.Material];
    const converted = mats.map((m) => {
      const src = m as THREE.Material & {
        color?: THREE.Color;
        map?: THREE.Texture | null;
      };
      const lit = new THREE.MeshStandardMaterial({
        color: src.color ? src.color.clone() : new THREE.Color("#ffffff"),
        map: src.map ?? null,
        roughness: 0.72,
        metalness: 0.0,
        envMapIntensity: 0.85,
      });
      if (tintColor) lit.color.lerp(tintColor, 0.75);
      return lit;
    });
    mesh.material = isArray ? converted : converted[0];
  });
  return copy;
}

/**
 * Like glbClone, but only repaints plausible body panels: dark materials
 * (tyres, glass, grilles) keep their colour so tint variants don't become
 * single-colour blobs. Slightly glossier than furniture for a car-paint look.
 */
export function vehicleClone(
  scene: THREE.Object3D,
  tint: string,
): THREE.Object3D {
  const tintColor = new THREE.Color(tint);
  const hsl = { h: 0, s: 0, l: 0 };
  const copy = scene.clone(true);
  copy.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const isArray = Array.isArray(mesh.material);
    const mats = isArray
      ? (mesh.material as THREE.Material[])
      : [mesh.material as THREE.Material];
    const converted = mats.map((m) => {
      const src = m as THREE.Material & {
        color?: THREE.Color;
        map?: THREE.Texture | null;
      };
      const lit = new THREE.MeshStandardMaterial({
        color: src.color ? src.color.clone() : new THREE.Color("#ffffff"),
        map: src.map ?? null,
        roughness: 0.45,
        metalness: 0.15,
        envMapIntensity: 0.9,
      });
      lit.color.getHSL(hsl);
      if (hsl.l > 0.22) lit.color.lerp(tintColor, 0.8);
      return lit;
    });
    mesh.material = isArray ? converted : converted[0];
  });
  return copy;
}

/**
 * Wrap an (already cloned) object in a group normalised for world placement:
 * recentred on its footprint, grounded at y=0, and uniformly scaled so its
 * longest horizontal side equals `targetLen`. With `alignLongAxisToZ`, the
 * object is also yawed 90° when needed so the long axis lies along +Z
 * (vehicles' direction of travel). GLBs ship at arbitrary export scales and
 * origins — this makes them all placeable with the same maths.
 */
export function normalizeFootprint(
  obj: THREE.Object3D,
  targetLen: number,
  alignLongAxisToZ = false,
): THREE.Group {
  const bbox = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);
  obj.position.set(-center.x, -bbox.min.y, -center.z);
  const root = new THREE.Group();
  root.add(obj);
  if (alignLongAxisToZ && size.x > size.z) root.rotation.y = Math.PI / 2;
  const base = Math.max(size.x, size.z);
  root.scale.setScalar(base > 0 ? targetLen / base : 1);
  return root;
}
