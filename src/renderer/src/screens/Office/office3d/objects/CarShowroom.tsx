import { Suspense, memo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { VehicleModel, car1GlbUrl, car2GlbUrl } from "./Traffic";
import {
  SHOWROOM_W,
  SHOWROOM_D,
  SHOWROOM_X,
  SHOWROOM_Z,
  SHOWROOM_WALL_H,
  SHOWROOM_WALL_T,
} from "../core/cityPlan";
import officeFontUrl from "../../../../assets/fonts/Manrope-Medium.ttf";

const SHOWROOM_PALETTE = {
  floor: "#e9eaee",
  wall: "#dfe2e6",
  trim: "#aab2bc",
  pedestal: "#cfd4da",
  sign: "#1b2533",
};

/** Hero car slowly spinning on the display pedestal. */
function RotatingShowcaseCar({
  position,
  url,
  tint,
}: {
  position: [number, number, number];
  url: string;
  tint: string;
}): React.JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += Math.min(delta, 0.05) * 0.45;
    }
  });
  return (
    <group ref={groupRef} position={position}>
      <VehicleModel url={url} tint={tint} targetLen={2.6} />
    </group>
  );
}

interface DisplayCar {
  pos: [number, number, number];
  rotY: number;
  url: string;
  tint: string;
}

const DISPLAY_CARS: DisplayCar[] = [
  {
    pos: [-4, 0, -7],
    rotY: Math.PI / 2 - 0.3,
    url: car1GlbUrl,
    tint: "#b03a2e",
  },
  {
    pos: [-4, 0, -2.5],
    rotY: Math.PI / 2 + 0.25,
    url: car2GlbUrl,
    tint: "#1f618d",
  },
  {
    pos: [-4, 0, 2.5],
    rotY: Math.PI / 2 - 0.25,
    url: car1GlbUrl,
    tint: "#e8e8e8",
  },
  {
    pos: [-4, 0, 7],
    rotY: Math.PI / 2 + 0.3,
    url: car2GlbUrl,
    tint: "#39414f",
  },
  { pos: [2.5, 0, -6.5], rotY: Math.PI / 2, url: car2GlbUrl, tint: "#ca6f1e" },
  { pos: [2.5, 0, 6.5], rotY: Math.PI / 2, url: car1GlbUrl, tint: "#239b56" },
];

// Storefront pillars every 4 units; the middle bay is the open entrance.
const PILLAR_ZS = [-10, -6, -2, 2, 6, 10];
const GLASS_BAYS = [0, 1, 3, 4]; // bay 2 (centre) stays open

/**
 * Car showroom on the west block: glass storefront facing the office, display
 * cars inside (reusing the traffic vehicle models/tints) and a hero car
 * rotating on a pedestal.
 */
export const CarShowroom = memo(function CarShowroom({
  position = [SHOWROOM_X, 0, SHOWROOM_Z],
}: {
  position?: [number, number, number];
} = {}): React.JSX.Element {
  const halfW = SHOWROOM_W / 2;
  const halfD = SHOWROOM_D / 2;
  const wallH = SHOWROOM_WALL_H;
  const wallT = SHOWROOM_WALL_T;
  const plinthH = 0.5;
  const bandH = 0.7;
  const glassH = wallH - plinthH - bandH;

  return (
    <group position={position}>
      {/* Polished display floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[SHOWROOM_W, SHOWROOM_D]} />
        <meshStandardMaterial
          color={SHOWROOM_PALETTE.floor}
          roughness={0.35}
          metalness={0.05}
          envMapIntensity={0.9}
        />
      </mesh>
      {/* Back (west) wall */}
      <mesh position={[-halfW, wallH / 2, 0]}>
        <boxGeometry args={[wallT, wallH, SHOWROOM_D]} />
        <meshStandardMaterial color={SHOWROOM_PALETTE.wall} />
      </mesh>
      {/* North / south walls */}
      <mesh position={[0, wallH / 2, -halfD]}>
        <boxGeometry args={[SHOWROOM_W, wallH, wallT]} />
        <meshStandardMaterial color={SHOWROOM_PALETTE.wall} />
      </mesh>
      <mesh position={[0, wallH / 2, halfD]}>
        <boxGeometry args={[SHOWROOM_W, wallH, wallT]} />
        <meshStandardMaterial color={SHOWROOM_PALETTE.wall} />
      </mesh>
      {/* Glass storefront (east, facing the office): plinth + top band +
          pillars, transparent panes so the cars show through. */}
      <mesh position={[halfW, plinthH / 2, 0]}>
        <boxGeometry args={[wallT, plinthH, SHOWROOM_D]} />
        <meshStandardMaterial color={SHOWROOM_PALETTE.trim} />
      </mesh>
      <mesh position={[halfW, wallH - bandH / 2, 0]}>
        <boxGeometry args={[wallT, bandH, SHOWROOM_D]} />
        <meshStandardMaterial color={SHOWROOM_PALETTE.trim} />
      </mesh>
      {PILLAR_ZS.map((pz) => (
        <mesh key={`pillar-${pz}`} position={[halfW, wallH / 2, pz]}>
          <boxGeometry args={[wallT, wallH, 0.35]} />
          <meshStandardMaterial color={SHOWROOM_PALETTE.trim} />
        </mesh>
      ))}
      {GLASS_BAYS.map((bay) => {
        const z0 = PILLAR_ZS[bay];
        const z1 = PILLAR_ZS[bay + 1];
        return (
          <mesh
            key={`glass-${bay}`}
            position={[halfW, plinthH + glassH / 2, (z0 + z1) / 2]}
            rotation={[0, -Math.PI / 2, 0]}
          >
            <planeGeometry args={[z1 - z0 - 0.4, glassH]} />
            <meshStandardMaterial
              color="#cfe2ee"
              roughness={0.05}
              metalness={0.3}
              transparent
              opacity={0.32}
              envMapIntensity={1.2}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
      {/* Sign above the entrance, facing the office */}
      <Text
        position={[halfW + wallT / 2 + 0.03, wallH - bandH / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        fontSize={0.52}
        font={officeFontUrl}
        color={SHOWROOM_PALETTE.sign}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.12}
      >
        HERMES MOTORS
      </Text>
      {/* Display pedestal + rotating hero car near the storefront */}
      <mesh position={[1.5, 0.08, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.0, 2.2, 0.16, 24]} />
        <meshStandardMaterial
          color={SHOWROOM_PALETTE.pedestal}
          roughness={0.3}
          metalness={0.1}
        />
      </mesh>
      <Suspense fallback={null}>
        <RotatingShowcaseCar
          position={[1.5, 0.16, 0]}
          url={car1GlbUrl}
          tint="#d4ac0d"
        />
        {DISPLAY_CARS.map((c, i) => (
          <group key={`sc-${i}`} position={c.pos} rotation={[0, c.rotY, 0]}>
            <VehicleModel url={c.url} tint={c.tint} targetLen={2.3} />
          </group>
        ))}
      </Suspense>
      {/* Entrance plants */}
      {([-3.2, 3.2] as number[]).map((pz) => (
        <group key={`splant-${pz}`} position={[halfW + 0.8, 0, pz]}>
          <mesh position={[0, 0.35, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.25, 0.7, 8]} />
            <meshStandardMaterial color="#ddd" roughness={0.7} />
          </mesh>
          <mesh position={[0, 1.0, 0]} castShadow>
            <sphereGeometry args={[0.45, 8, 8]} />
            <meshStandardMaterial color="#3a7c47" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
});
