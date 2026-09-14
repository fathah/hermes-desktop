import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { configureTextBuilder } from "troika-three-text";
import * as THREE from "three";
import { SceneEnvironment } from "./objects/SceneEnvironment";
import { CityBackdrop, DistantSkyline } from "./objects/CityBackdrop";
import { TrafficLayer } from "./objects/Traffic";
import { BankSection, ConnectingStreet } from "./objects/Bank";
import { CarShowroom, type ShowroomCar } from "./objects/CarShowroom";
import {
  Room,
  InteriorWalls,
  GlassWalls,
  CeoOfficeExtras,
} from "./objects/OfficeShell";
import { Workstations, FurniturePieces } from "./objects/furniture";
import { AgentsLayer } from "./objects/AgentsLayer";
import { PedestriansLayer } from "./objects/Pedestrians";
import { GlassRoof } from "./objects/Roofs";
import { PlayerLayer, PLAYER_SPAWN, PLAYER_LOOK_Y } from "./objects/Player";
import { buildWorkstations, REST_FURNITURE, EXECUTIVE_DECOR } from "./layout";
import { DAY_PALETTE } from "./core/palette";
import { BANK_X, BANK_Z, SHOWROOM_X, SHOWROOM_Z } from "./core/cityPlan";
import { WORLD_W, WORLD_H } from "./core/constants";
import { buildOfficeColliders } from "./core/collision";
import {
  buildPlayerInteractions,
  type PlayerInteraction,
} from "./interactions/proximity";
import {
  LOCATIONS,
  type BuildingId,
  type OfficeLocation,
} from "./core/locations";
import type { AgentPlace, OfficeAgent } from "./core/types";
import officeFontUrl from "../../../assets/fonts/Manrope-Medium.ttf";

// drei's <Text> (agent nameplates / speech bubbles, via troika) defaults to two
// behaviours the renderer's strict CSP (`script-src`/`default-src 'self'`)
// blocks: spawning a blob-backed Web Worker, and fetching its default font from
// a CDN. Disable the worker (typeset on the main thread) and point troika at
// our locally-bundled Manrope so labels render fully offline without loosening
// the app's Content-Security-Policy.
configureTextBuilder({ useWorker: false, defaultFontURL: officeFontUrl });

// Default camera look-at, hoisted to a stable reference. drei's OrbitControls
// re-applies `target` whenever the prop identity changes, so a fresh tuple each
// render would reset the focus point and wipe the user's pan/zoom on every
// unrelated re-render (e.g. an agent status poll). (Value is the office's north
// side — was BANK_Z / 2 when the bank sat north, pinned after it moved east.)
const CAMERA_TARGET: [number, number, number] = [0, 0, -14.6];

// Location fly-in duration (seconds).
const FLY_SECONDS = 0.8;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type ControlsHandle = React.ComponentRef<typeof OrbitControls>;

/**
 * Flies the camera + orbit target to the active location's preset whenever
 * the location changes (enter/exit a building). User input is suspended for
 * the flight so the damped controls don't fight the animation, then handed
 * back for free orbiting within the location's clamp bounds.
 *
 * Walk mode changes the rules: engaging it swoops the camera down behind the
 * avatar's spawn point; while it's active, location changes (walking through
 * a doorway) fly nothing — the chase camera is already exactly where the
 * player is; and disengaging flies back up to the location preset.
 */
function CameraRig({
  location,
  walkMode,
  controlsRef,
}: {
  location: OfficeLocation;
  walkMode: boolean;
  controlsRef: React.RefObject<ControlsHandle | null>;
}): null {
  const camera = useThree((s) => s.camera);
  const anim = useRef<{
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
  } | null>(null);
  const prevLocation = useRef(location);
  const prevWalk = useRef(walkMode);

  useEffect(() => {
    const locationChanged = prevLocation.current !== location;
    const walkChanged = prevWalk.current !== walkMode;
    prevLocation.current = location;
    prevWalk.current = walkMode;
    if (!locationChanged && !walkChanged) return;
    // Mid-walk doorway transitions: the scene swaps around the avatar and the
    // chase camera stays glued to it — no flight.
    if (walkMode && !walkChanged) return;
    const controls = controlsRef.current;
    let toPos: THREE.Vector3;
    let toTarget: THREE.Vector3;
    if (walkMode) {
      // Walk mode engaged: drop down behind the spawn point.
      toPos = new THREE.Vector3(PLAYER_SPAWN[0], 3.4, PLAYER_SPAWN[1] + 5.4);
      toTarget = new THREE.Vector3(
        PLAYER_SPAWN[0],
        PLAYER_LOOK_Y,
        PLAYER_SPAWN[1],
      );
    } else {
      const cfg = LOCATIONS[location];
      toPos = new THREE.Vector3(...cfg.cameraPosition);
      toTarget = new THREE.Vector3(...cfg.cameraTarget);
    }
    anim.current = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls ? controls.target.clone() : toTarget.clone(),
      toTarget,
      t: 0,
    };
    if (controls) controls.enabled = false;
  }, [location, walkMode, camera, controlsRef]);

  useFrame((_, delta) => {
    const a = anim.current;
    if (!a) return;
    a.t = Math.min(1, a.t + delta / FLY_SECONDS);
    const e = easeInOutCubic(a.t);
    camera.position.lerpVectors(a.fromPos, a.toPos, e);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
      controls.update();
    }
    if (a.t >= 1) {
      anim.current = null;
      if (controls) controls.enabled = true;
    }
  });

  return null;
}

/**
 * The native, in-renderer 3D office. Replaces the old webview that pointed at a
 * separately-cloned hermes-office dev server. Each agent corresponds to a
 * desktop profile.
 */
export default function Office3D({
  agents,
  selectedId,
  onSelectAgent,
  location = "city",
  onFocusBuilding,
  onAtmActivate,
  tellerLabel,
  onTellerActivate,
  onCarActivate,
  onDeskActivate,
  walkMode = false,
  playerLabel,
  onPlayerPlaceChange,
  onNearbyInteraction,
  devMode = false,
  onDevLog,
}: {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelectAgent: (id: string | null) => void;
  /** Active view: the city, or one of the enterable building interiors. */
  location?: OfficeLocation;
  /** City mode: a building was clicked (null = focus cleared). */
  onFocusBuilding?: (building: BuildingId | null) => void;
  /** Bank interior: an ATM was clicked. */
  onAtmActivate?: () => void;
  /** Bank interior: pre-translated teller hover label. */
  tellerLabel?: string;
  /** Bank interior: a teller was clicked (opens the representative menu). */
  onTellerActivate?: () => void;
  /** Showroom interior: a display car was clicked. */
  onCarActivate?: (car: ShowroomCar) => void;
  /** Office interior: a desk was clicked (its owner's agent id). */
  onDeskActivate?: (agentId: string) => void;
  /** GTA-style walk mode: the user's avatar walks the city (see PlayerLayer). */
  walkMode?: boolean;
  /** Pre-translated nameplate for the player avatar ("You"). */
  playerLabel?: string;
  /** Walk mode: the avatar crossed a building threshold. */
  onPlayerPlaceChange?: (place: AgentPlace) => void;
  /** Walk mode: the nearest Press-E point changed (null = none in range). */
  onNearbyInteraction?: (p: PlayerInteraction | null) => void;
  devMode?: boolean;
  onDevLog?: (msg: string) => void;
}): React.JSX.Element {
  // Clicking the selected agent again clears the selection. Memoized so agent
  // status polling (which re-renders Office3D with a new `agents` array but an
  // unchanged selection) doesn't hand AgentsLayer/AgentModel a fresh callback
  // and defeat their React.memo.
  const handleSelect = useCallback(
    (id: string): void => {
      onSelectAgent(id === selectedId ? null : id);
    },
    [selectedId, onSelectAgent],
  );

  const handlePointerMissed = useCallback((): void => {
    onSelectAgent(null);
    onFocusBuilding?.(null);
  }, [onSelectAgent, onFocusBuilding]);

  // City-mode building focus. stopPropagation so the click doesn't also fall
  // through to onPointerMissed (which clears the focus again). Walk mode
  // enters buildings by walking through doorways, not by click + Enter.
  const focusBuilding = useCallback(
    (building: BuildingId) =>
      walkMode
        ? undefined
        : (e: ThreeEvent<MouseEvent>): void => {
            e.stopPropagation();
            onFocusBuilding?.(building);
          },
    [onFocusBuilding, walkMode],
  );

  // The building-mover is a dev-only authoring aid. `import.meta.env.DEV` is a
  // build-time literal (Vite replaces it: `true` in `electron-vite dev`,
  // `false` in production builds). Using it *inline* at each JSX site below lets
  // esbuild constant-fold and dead-code-eliminate every dev-only branch — the
  // button, handlers, ground-plane catcher and helpers are all dropped from the
  // production bundle, so they can't run or cost anything for end users.

  // ── Developer building-mover ──────────────────────────────────────────────
  // When devMode is on: click a building to "pick it up" (logs it + its current
  // position), then click empty ground to drop it there (logs a paste-ready
  // code line and moves it live so spacing is visible). Landmarks (bank /
  // showroom) map to constants in cityPlan.ts; backdrop buildings map to an
  // entry in BACKDROP_OVERRIDES (CityBackdrop.tsx).
  type DevSel = {
    id: string;
    label: string;
    kind: "landmark" | "backdrop";
    base: [number, number, number];
    hint: string;
  };
  const LANDMARKS: Record<"bank" | "showroom", DevSel> = {
    bank: {
      id: "bank",
      label: "Bank",
      kind: "landmark",
      base: [BANK_X, 0, BANK_Z],
      hint: "BANK_X / BANK_Z in cityPlan.ts",
    },
    showroom: {
      id: "showroom",
      label: "CarShowroom",
      kind: "landmark",
      base: [SHOWROOM_X, 0, SHOWROOM_Z],
      hint: "SHOWROOM_X / SHOWROOM_Z in cityPlan.ts",
    },
  };
  const [devSel, setDevSel] = useState<DevSel | null>(null);
  const [devPos, setDevPos] = useState<
    Record<string, [number, number, number]>
  >({});

  const posOf = (
    id: string,
    base: [number, number, number],
  ): [number, number, number] => devPos[id] ?? base;

  // Landmark click handler (bank / showroom groups). The select logic is
  // inlined here (and in pickBackdrop) rather than shared, so that when the
  // production build strips these dev-only handlers there is no lingering
  // shared helper left referenced in the bundle.
  const pickLandmark =
    (meta: DevSel) =>
    (e: ThreeEvent<MouseEvent>): void => {
      if (!devMode) return;
      e.stopPropagation();
      const p = posOf(meta.id, meta.base);
      setDevSel(meta);
      const msg = `🏢 SELECTED ${meta.label} (${meta.id}) — current position [${p[0].toFixed(2)}, ${p[2].toFixed(2)}]. Now click empty ground to set its new spot.`;
      console.log(msg);
      onDevLog?.(msg);
    };

  // Backdrop building click handler (passed down into CityBackdrop). A plain
  // arrow (not useCallback) so production DCE can drop it entirely — its only
  // call site is gated by `import.meta.env.DEV` and folds to `undefined` in
  // prod. CityBackdrop is memoized, but in prod it always receives a stable
  // `undefined` here, so referential stability only matters in dev (where the
  // extra re-render is harmless).
  const pickBackdrop = (b: {
    id: string;
    label: string;
    x: number;
    z: number;
  }): void => {
    const meta: DevSel = {
      id: b.id,
      label: b.label,
      kind: "backdrop",
      base: [b.x, 0, b.z],
      hint: "BACKDROP_OVERRIDES in CityBackdrop.tsx",
    };
    setDevSel(meta);
    const msg = `🏢 SELECTED ${meta.label} (${meta.id}) — current position [${b.x.toFixed(2)}, ${b.z.toFixed(2)}]. Now click empty ground to set its new spot.`;
    console.log(msg);
    onDevLog?.(msg);
  };

  const dropAt = (e: ThreeEvent<MouseEvent>): void => {
    if (!devMode || !devSel) return;
    e.stopPropagation();
    const { x, z } = e.point;
    const rx = Math.round(x * 100) / 100;
    const rz = Math.round(z * 100) / 100;
    setDevPos((prev) => ({ ...prev, [devSel.id]: [rx, 0, rz] }));
    // One-shot: drop ends this building's selection so the next ground click
    // doesn't keep dragging it around. Click a building again to move it more.
    const msg =
      devSel.kind === "landmark"
        ? `📍 MOVE ${devSel.label} → position={[${rx}, 0, ${rz}]}  (update ${devSel.hint}). Selection cleared — click another building.`
        : `📍 MOVE ${devSel.label} → "${devSel.id}": [${rx}, ${rz}],  (paste into ${devSel.hint}). Selection cleared — click another building.`;
    setDevSel(null);
    console.log(msg);
    onDevLog?.(msg);
  };

  // Keep the camera's focus point inside the active location — the whole city
  // when outside, the building's footprint when inside — so panning (or
  // zoom-to-cursor) can never strand the user in empty void off the map.
  const controlsRef = useRef<ControlsHandle>(null);
  const clampControlsTarget = (): void => {
    const controls = controlsRef.current;
    if (!controls) return;
    // Walk mode: the target is glued to the avatar, which collision already
    // keeps inside the world — clamping would fight the chase camera.
    if (walkMode) return;
    // Mid-flight the target legitimately crosses space outside the new
    // location's bounds; CameraRig disables the controls while it animates.
    if (!controls.enabled) return;
    const c = LOCATIONS[location].clamp;
    const t = controls.target;
    const x = THREE.MathUtils.clamp(t.x, c.minX, c.maxX);
    const y = THREE.MathUtils.clamp(t.y, c.minY, c.maxY);
    const z = THREE.MathUtils.clamp(t.z, c.minZ, c.maxZ);
    if (x !== t.x || y !== t.y || z !== t.z) t.set(x, y, z);
  };

  // The CEO (if any) gets a separate executive desk; everyone else grids up.
  const ceoId = useMemo(
    () => agents.find((a) => a.position === "ceo")?.id ?? null,
    [agents],
  );

  // One desk per agent, assigned in profile order.
  const workstations = useMemo(
    () =>
      buildWorkstations(
        agents.map((a) => a.id),
        ceoId,
      ),
    [agents, ceoId],
  );

  const palette = DAY_PALETTE;

  // Hover-label text for office desks in interior mode.
  const agentNameById = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );

  // Walk-mode support: the player's office colliders and Press-E points.
  // (AgentsLayer builds its own collider set; both memoise off workstations.)
  const playerColliders = useMemo(
    () =>
      buildOfficeColliders(
        workstations,
        workstations.some((w) => w.isExecutive),
      ),
    [workstations],
  );
  const playerInteractions = useMemo(
    () =>
      walkMode
        ? buildPlayerInteractions({
            workstations,
            agentNameById,
            tellerLabel: tellerLabel ?? "Teller",
          })
        : [],
    [walkMode, workstations, agentNameById, tellerLabel],
  );

  // Which scene layers exist depends on the active location: interiors mount
  // ONLY their own building (plus the always-running agent layer), so the GPU
  // never renders the city while you're inside. Unmounting also stops the
  // layers' useFrame work (the traffic simulation pauses while indoors).
  const isCity = location === "city";
  const inOffice = location === "office";
  const inBank = location === "bank";
  const inShowroom = location === "showroom";
  const loc = LOCATIONS[location];

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      // near=1 (instead of the 0.1 default) gives the depth buffer ~10× more
      // precision at distance — without it the road decals z-fight the ground
      // plane into flickering stripes when viewed from far away.
      camera={{ position: [0, 38, 48], fov: 50, near: 1, far: 1000 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
      onPointerMissed={handlePointerMissed}
      style={{ width: "100%", height: "100%" }}
    >
      <SceneEnvironment
        palette={palette}
        center={loc.shadowCenter}
        shadowHalfExtent={loc.shadowHalfExtent}
      />
      {isCity && (
        <>
          <DistantSkyline />
          <CityBackdrop
            devMode={import.meta.env.DEV && devMode}
            moved={import.meta.env.DEV && devMode ? devPos : undefined}
            onPick={import.meta.env.DEV && devMode ? pickBackdrop : undefined}
          />
          <Suspense fallback={null}>
            <TrafficLayer />
          </Suspense>
          <ConnectingStreet />
        </>
      )}
      {(isCity || inOffice) && (
        <>
          {/* In city mode a click on the office focuses it for entering
              (except in the dev building-mover, which owns clicks). */}
          <group
            onClick={isCity && !devMode ? focusBuilding("office") : undefined}
          >
            <Room palette={palette} />
            {/* Glass roof: always in the city view; kept indoors in walk mode
                (looking up shows the skylight grid), dropped in orbit-interior
                mode so the top-down camera stays unobstructed. */}
            {(isCity || walkMode) && (
              // Flush on the 3.6 walls — every wall touches the roof.
              <GlassRoof width={WORLD_W} depth={WORLD_H} height={3.62} />
            )}
          </group>
          <InteriorWalls palette={palette} />
          {/* CEO glass corner office — only exists when there is a CEO. */}
          {ceoId && (
            <>
              <GlassWalls />
              <Suspense fallback={null}>
                <CeoOfficeExtras />
              </Suspense>
            </>
          )}
          <Suspense fallback={null}>
            <Workstations
              workstations={workstations}
              interactive={inOffice}
              onDeskActivate={onDeskActivate}
              agentNameById={agentNameById}
            />
            <FurniturePieces pieces={REST_FURNITURE} />
            {ceoId && <FurniturePieces pieces={EXECUTIVE_DECOR} />}
          </Suspense>
        </>
      )}
      {isCity &&
        (import.meta.env.DEV && devMode ? (
          <>
            <group onClick={pickLandmark(LANDMARKS.bank)}>
              <BankSection position={posOf("bank", LANDMARKS.bank.base)} roof />
            </group>
            <group onClick={pickLandmark(LANDMARKS.showroom)}>
              <CarShowroom
                position={posOf("showroom", LANDMARKS.showroom.base)}
                roof
              />
            </group>
            {/* Invisible ground catcher: the second click lands here (buildings
                stopPropagation on the first), giving the pick-then-drop flow. */}
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, -0.05, 0]}
              onClick={dropAt}
            >
              <planeGeometry args={[600, 600]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </>
        ) : (
          <>
            <group onClick={focusBuilding("bank")}>
              <BankSection roof />
            </group>
            <group onClick={focusBuilding("showroom")}>
              <CarShowroom roof />
            </group>
          </>
        ))}
      {inBank && (
        <BankSection
          interactive
          roof={walkMode}
          onAtmActivate={onAtmActivate}
          tellerLabel={tellerLabel}
          onTellerActivate={onTellerActivate}
        />
      )}
      {inShowroom && (
        <CarShowroom
          interactive
          roof={walkMode}
          onCarActivate={onCarActivate}
        />
      )}
      <AgentsLayer
        agents={agents}
        workstations={workstations}
        selectedId={selectedId}
        onSelect={handleSelect}
        visiblePlace={location === "city" ? null : location}
      />
      {/* City pedestrians stroll the streets and visit the bank/showroom;
          they never enter the office (agents only). Sim runs everywhere so
          interiors are populated the moment you walk in. */}
      <Suspense fallback={null}>
        <PedestriansLayer
          visiblePlace={location === "city" ? null : location}
        />
      </Suspense>
      {/* Walk mode: the user's avatar. Always mounted while walking (like
          AgentsLayer) so doorway transitions never unmount the player. */}
      {walkMode && (
        <Suspense fallback={null}>
          <PlayerLayer
            controlsRef={controlsRef}
            officeColliders={playerColliders}
            interactions={playerInteractions}
            label={playerLabel ?? "You"}
            onPlaceChange={onPlayerPlaceChange}
            onNearbyChange={onNearbyInteraction}
          />
        </Suspense>
      )}
      <CameraRig
        location={location}
        walkMode={walkMode}
        controlsRef={controlsRef}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan={!walkMode}
        // Inertial damping: motion eases out instead of stopping dead, which
        // is most of the "controllable" feel.
        enableDamping
        dampingFactor={0.08}
        // Gentler speeds — the raw defaults feel twitchy over a city-sized
        // scene, especially zoom (multiplicative per wheel tick).
        rotateSpeed={0.75}
        panSpeed={0.9}
        zoomSpeed={0.65}
        // Map-style panning: dragging slides along the ground plane at
        // constant height, instead of moving with the screen axes.
        screenSpacePanning={false}
        // Scrolling dives toward whatever the cursor points at — point at
        // the bank or showroom and scroll to fly there. In walk mode the
        // wheel zooms the chase distance instead, within close-follow range.
        zoomToCursor={!walkMode}
        minDistance={walkMode ? 2.2 : loc.minDistance}
        maxDistance={walkMode ? 11 : loc.maxDistance}
        maxPolarAngle={Math.PI / 2.15}
        // Stable module-level reference — see CAMERA_TARGET above. A fresh
        // array here would reset the controls' target and wipe any user pan.
        // Location transitions move the target via CameraRig instead.
        target={CAMERA_TARGET}
        onChange={clampControlsTarget}
      />
    </Canvas>
  );
}
