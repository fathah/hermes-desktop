import { Suspense, memo, useMemo } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import atmGlbUrl from "../assets/atm.glb?url";
import sofaGlbUrl from "../assets/loungeSofa.glb?url";
import sofaChairGlbUrl from "../assets/sofa_chair.glb?url";
import baseBankLogoUrl from "../assets/images/base-bank.webp";
import { WORLD_H } from "../core/constants";
import { glbClone } from "../core/glb";
import { CHARACTER_MODELS } from "../core/characters";
import { Interactable } from "./Interactable";
import { GlassRoof } from "./Roofs";
import { StaffPerson } from "./StaffPerson";
import {
  BANK_W,
  BANK_D,
  BANK_WALL_H,
  BANK_WALL_T,
  BANK_STREET_GAP,
  BANK_X,
  BANK_Z,
  ROAD_Y,
  ROAD_MARKING_Y,
} from "../core/cityPlan";

const BANK_PALETTE = {
  floor: "#d4c8b8",
  wall: "#e8e0d4",
  counter: "#8b7355",
  counterTop: "#f5f0e8",
  personShirt: ["#c44", "#44c", "#4a4", "#a4a", "#c84", "#488"],
};

function BankLogoSign(): React.JSX.Element {
  const texture = useTexture(baseBankLogoUrl, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
  });
  // Logo aspect ratio ≈ 3.5 : 1 (roughly 720×200 px)
  const logoW = 6.0;
  const logoH = logoW / 5;
  const halfD = BANK_D / 2;
  return (
    <mesh position={[0, BANK_WALL_H * 0.72, -halfD + BANK_WALL_T / 2 + 0.01]}>
      <planeGeometry args={[logoW, logoH]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.4}
        metalness={0.0}
        transparent
        alphaTest={0.05}
      />
    </mesh>
  );
}

function BankShell(): React.JSX.Element {
  const halfW = BANK_W / 2;
  const halfD = BANK_D / 2;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[BANK_W, BANK_D]} />
        <meshStandardMaterial color={BANK_PALETTE.floor} roughness={0.75} />
      </mesh>
      <mesh position={[0, BANK_WALL_H / 2, -halfD]}>
        <boxGeometry args={[BANK_W, BANK_WALL_H, BANK_WALL_T]} />
        <meshStandardMaterial color={BANK_PALETTE.wall} />
      </mesh>
      <Suspense fallback={null}>
        <BankLogoSign />
      </Suspense>
      {/* South wall — open doorway in the centre (2 u wide) so agents can enter */}
      <mesh position={[-halfW / 2 - 1, BANK_WALL_H / 2, halfD]}>
        <boxGeometry args={[BANK_W / 2 - 2, BANK_WALL_H, BANK_WALL_T]} />
        <meshStandardMaterial color={BANK_PALETTE.wall} />
      </mesh>
      <mesh position={[halfW / 2 + 1, BANK_WALL_H / 2, halfD]}>
        <boxGeometry args={[BANK_W / 2 - 2, BANK_WALL_H, BANK_WALL_T]} />
        <meshStandardMaterial color={BANK_PALETTE.wall} />
      </mesh>
      <mesh position={[-halfW, BANK_WALL_H / 2, 0]}>
        <boxGeometry args={[BANK_WALL_T, BANK_WALL_H, BANK_D]} />
        <meshStandardMaterial color={BANK_PALETTE.wall} />
      </mesh>
      <mesh position={[halfW, BANK_WALL_H / 2, 0]}>
        <boxGeometry args={[BANK_WALL_T, BANK_WALL_H, BANK_D]} />
        <meshStandardMaterial color={BANK_PALETTE.wall} />
      </mesh>
    </group>
  );
}

function BankCounterRow(): React.JSX.Element {
  const counterW = 10;
  const counterD = 1.2;
  const counterH = 1.1;
  const numStations = 3;
  const stationW = counterW / numStations;
  return (
    <group position={[0, 0, -BANK_D / 2 + 2.5]}>
      <mesh position={[0, counterH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[counterW, counterH, counterD]} />
        <meshStandardMaterial color={BANK_PALETTE.counter} roughness={0.6} />
      </mesh>
      <mesh position={[0, counterH + 0.04, 0]} castShadow>
        <boxGeometry args={[counterW + 0.2, 0.08, counterD + 0.1]} />
        <meshStandardMaterial color={BANK_PALETTE.counterTop} roughness={0.3} />
      </mesh>
      {Array.from({ length: numStations - 1 }).map((_, i) => (
        <mesh
          key={`div-${i}`}
          position={[
            -counterW / 2 + stationW * (i + 1),
            counterH * 0.75,
            counterD / 2 + 0.1,
          ]}
          castShadow
        >
          <boxGeometry args={[0.08, counterH * 0.5, 0.02]} />
          <meshStandardMaterial color="#6b5a45" roughness={0.5} />
        </mesh>
      ))}
      {Array.from({ length: numStations }).map((_, i) => (
        <mesh
          key={`plate-${i}`}
          position={[
            -counterW / 2 + stationW * (i + 0.5),
            counterH + 0.3,
            counterD / 2 + 0.02,
          ]}
        >
          <boxGeometry args={[1.2, 0.3, 0.02]} />
          <meshStandardMaterial color="#f0ece4" roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function BankGlbItem({
  url,
  position,
  rotation,
  scale,
  tint = null,
}: {
  url: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale: [number, number, number];
  tint?: string | null;
}): React.JSX.Element {
  const { scene } = useGLTF(url, false, false);
  const object = useMemo(() => glbClone(scene, tint), [scene, tint]);
  return (
    <group position={position} rotation={rotation ?? [0, 0, 0]} scale={scale}>
      <primitive object={object} />
    </group>
  );
}

function BankATMs({
  interactive = false,
  onAtmActivate,
}: {
  interactive?: boolean;
  onAtmActivate?: () => void;
}): React.JSX.Element {
  const positions: Array<{ pos: [number, number, number]; rotY: number }> = [
    { pos: [-BANK_W / 2 + 1.2, 0, BANK_D / 2 - 2], rotY: Math.PI },
    { pos: [-BANK_W / 2 + 3.0, 0, BANK_D / 2 - 2], rotY: Math.PI },
    { pos: [BANK_W / 2 - 1.2, 0, -BANK_D / 2 + 4], rotY: 0 },
    { pos: [BANK_W / 2 - 3.0, 0, -BANK_D / 2 + 4], rotY: 0 },
  ];
  return (
    <group>
      {positions.map(({ pos, rotY }, i) => (
        <Interactable
          key={`atm-${i}`}
          enabled={interactive && !!onAtmActivate}
          label="ATM"
          onActivate={() => onAtmActivate?.()}
          position={pos}
          labelHeight={1.9}
          ringRadius={0.75}
        >
          <BankGlbItem
            url={atmGlbUrl}
            position={[0, 0, 0]}
            rotation={[0, rotY, 0]}
            scale={[4.5, 4.5, 4.5]}
            tint={null}
          />
        </Interactable>
      ))}
    </group>
  );
}

function BankDecor(): React.JSX.Element {
  return (
    <group>
      {(
        [
          [-BANK_W / 2 + 0.8, -BANK_D / 2 + 0.8],
          [BANK_W / 2 - 0.8, -BANK_D / 2 + 0.8],
          [-BANK_W / 2 + 0.8, BANK_D / 2 - 0.8],
          [BANK_W / 2 - 0.8, BANK_D / 2 - 0.8],
        ] as Array<[number, number]>
      ).map(([x, z], i) => (
        <group key={`bplant-${i}`} position={[x, 0, z]}>
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
      {/* Waiting area: sofa + two chairs */}
      <BankGlbItem
        url={sofaGlbUrl}
        position={[-BANK_W / 2 + 3.5, 0, 2.5]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[1.6, 1.6, 1.6]}
        tint="#3d5575"
      />
      <BankGlbItem
        url={sofaChairGlbUrl}
        position={[-BANK_W / 2 + 1.2, 0, 1.2]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[1.4, 1.4, 1.4]}
        tint="#4a5568"
      />
      <BankGlbItem
        url={sofaChairGlbUrl}
        position={[-BANK_W / 2 + 1.2, 0, 3.8]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[1.4, 1.4, 1.4]}
        tint="#4a5568"
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[BANK_W * 0.5, BANK_D * 0.35]} />
        <meshStandardMaterial color="#b8a898" roughness={0.95} />
      </mesh>
    </group>
  );
}

// Teller uniforms — deliberately more sober than the customers' shirts.
const TELLER_TINTS = ["#27496d", "#3a3f55", "#5c4a72"];

/**
 * Bank staff: one teller standing behind each counter station, facing the
 * customers. In interior mode each teller is an Interactable — clicking one
 * opens the bank's representative menu (account status, balances, new
 * accounts) up in the Office screen.
 */
function BankTellers({
  interactive = false,
  label,
  onTellerActivate,
}: {
  interactive?: boolean;
  /** Hover label (pre-translated — i18n can't cross the Canvas). */
  label?: string;
  onTellerActivate?: () => void;
}): React.JSX.Element {
  const counterW = 10;
  const numStations = 3;
  const stationW = counterW / numStations;
  // The counter row sits at z = -BANK_D/2 + 2.5 and is 1.2 deep; tellers
  // stand just north of it, facing south (+Z) toward the hall.
  const tellerZ = -BANK_D / 2 + 2.5 - 1.4;
  return (
    <group>
      {Array.from({ length: numStations }).map((_, i) => (
        <Interactable
          key={`teller-${i}`}
          enabled={interactive && !!onTellerActivate}
          label={label ?? "Teller"}
          onActivate={() => onTellerActivate?.()}
          position={[-counterW / 2 + stationW * (i + 0.5), 0, tellerZ]}
          labelHeight={2.1}
          ringRadius={0.55}
        >
          <StaffPerson
            position={[0, 0, 0]}
            rotationY={0}
            tint={TELLER_TINTS[i % TELLER_TINTS.length]}
            model={CHARACTER_MODELS[i % CHARACTER_MODELS.length]}
          />
        </Interactable>
      ))}
    </group>
  );
}

/** Street / walkway connecting office south-exit to bank north-entry. */
export const ConnectingStreet = memo(
  function ConnectingStreet(): React.JSX.Element {
    const streetZ = -(WORLD_H / 2 + BANK_STREET_GAP / 2);
    const roadW = BANK_W; // full width of the gap
    const roadD = BANK_STREET_GAP;
    const kerbD = 0.6;
    const dashLen = 1.8;
    const dashGap = 1.4;
    const dashCount = Math.floor(roadW / (dashLen + dashGap));
    return (
      <group>
        {/* Road surface */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, ROAD_Y, streetZ]}
          receiveShadow
        >
          <planeGeometry args={[roadW, roadD]} />
          <meshStandardMaterial color="#4a4e57" roughness={0.95} />
        </mesh>
        {/* Kerb — office side */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, ROAD_MARKING_Y, -(WORLD_H / 2) + kerbD / 2]}
        >
          <planeGeometry args={[roadW, kerbD]} />
          <meshStandardMaterial color="#c0c5cd" roughness={0.88} />
        </mesh>
        {/* Kerb — bank side */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[
            0,
            ROAD_MARKING_Y,
            streetZ - roadD / 2 + kerbD / 2 + BANK_STREET_GAP / 2,
          ]}
        >
          <planeGeometry args={[roadW, kerbD]} />
          <meshStandardMaterial color="#c0c5cd" roughness={0.88} />
        </mesh>
        {/* White centre dashes running E-W */}
        {Array.from({ length: dashCount }, (_, i) => {
          const ox = -roadW / 2 + i * (dashLen + dashGap) + dashLen / 2;
          return (
            <mesh
              key={`cs-dash-${i}`}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[ox, ROAD_MARKING_Y, streetZ]}
            >
              <planeGeometry args={[dashLen, 0.18]} />
              <meshStandardMaterial color="#ffffff" roughness={0.9} />
            </mesh>
          );
        })}
      </group>
    );
  },
);

/** The complete bank building placed north of the office. */
export const BankSection = memo(function BankSection({
  position = [BANK_X, 0, BANK_Z],
  interactive = false,
  roof = false,
  onAtmActivate,
  tellerLabel,
  onTellerActivate,
}: {
  position?: [number, number, number];
  /** Interior mode: ATMs and tellers become hover/click interactables. */
  interactive?: boolean;
  /** Mount the glass roof (city view, or walk mode indoors). */
  roof?: boolean;
  onAtmActivate?: () => void;
  /** Pre-translated teller hover label. */
  tellerLabel?: string;
  onTellerActivate?: () => void;
} = {}): React.JSX.Element {
  return (
    <group position={position}>
      <BankShell />
      {roof && (
        <GlassRoof width={BANK_W} depth={BANK_D} height={BANK_WALL_H + 0.06} />
      )}
      <BankCounterRow />
      <Suspense fallback={null}>
        <BankATMs interactive={interactive} onAtmActivate={onAtmActivate} />
        <BankDecor />
        <BankTellers
          interactive={interactive}
          label={tellerLabel}
          onTellerActivate={onTellerActivate}
        />
      </Suspense>
    </group>
  );
});

useGLTF.preload(atmGlbUrl, false, false);
useGLTF.preload(sofaGlbUrl, false, false);
useGLTF.preload(sofaChairGlbUrl, false, false);
