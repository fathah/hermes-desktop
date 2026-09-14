import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { createDefaultAgentAvatarProfile } from "../avatars/profile";
import { AGENT_SCALE, WALK_ANIM_SPEED } from "../core/constants";
import { toWorld } from "../core/geometry";
import { applyAgentNameplatePresence } from "../core/presence";
import { DIVIDER_X } from "../layout";
import type { JanitorActor, RenderAgent } from "../core/types";
import { AgentModelProps } from "./types";
import { RiggedCharacter } from "./RiggedCharacter";

const MAX_NAMEPLATE_TEXT_LENGTH = 22;
const MAX_SPEECH_BUBBLE_TEXT_LENGTH = 180;
const MAX_SPEECH_BUBBLE_LINES = 4;
const DESK_SIT_DROP = -0.03;
const REST_SIT_DROP = -0.01;

const formatAgentNameplateText = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= MAX_NAMEPLATE_TEXT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_NAMEPLATE_TEXT_LENGTH - 1).trimEnd()}…`;
};

const flattenSpeechBubbleMarkdown = (value: string) =>
  value
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s*/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const clampSpeechBubbleText = (value: string) => {
  if (value.length <= MAX_SPEECH_BUBBLE_TEXT_LENGTH) {
    return { text: value, truncated: false };
  }
  const slice = value.slice(0, MAX_SPEECH_BUBBLE_TEXT_LENGTH - 1).trimEnd();
  return { text: `${slice}…`, truncated: true };
};

export const AgentModel = memo(function AgentModel({
  agentId,
  name,
  subtitle,
  status,
  color,
  appearance,
  agentsRef,
  agentLookupRef,
  onHover,
  onUnhover,
  onClick,
  onContextMenu,
  showSpeech = false,
  speechText = null,
  suppressSpeechBubble = false,
  riggedModelUrl,
  riggedModelTint = null,
}: AgentModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const statusDotMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const pulseRingRef = useRef<THREE.Mesh>(null);
  const pulseRingMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const leftEyeHighlightRef = useRef<THREE.Mesh>(null);
  const rightEyeHighlightRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const leftMouthCornerRef = useRef<THREE.Mesh>(null);
  const rightMouthCornerRef = useRef<THREE.Mesh>(null);
  const leftBrowRef = useRef<THREE.Mesh>(null);
  const rightBrowRef = useRef<THREE.Mesh>(null);
  const heldPaddleRef = useRef<THREE.Group>(null);
  const heldPaddleFaceRef = useRef<THREE.MeshStandardMaterial>(null);
  const heldCleaningToolRef = useRef<THREE.Group>(null);
  const heldCleaningHeadRef = useRef<THREE.MeshStandardMaterial>(null);
  const heldBucketRef = useRef<THREE.Group>(null);
  const heldScrubberRef = useRef<THREE.Group>(null);
  const speechBubbleRef = useRef<THREE.Group>(null);
  const speechBubbleMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const awayBubbleRef = useRef<THREE.Group>(null);
  const bodyMatRef = useRef<THREE.MeshLambertMaterial>(null);
  const pos = useRef(new THREE.Vector3(0, 0, 0));
  // Rendered width of the name (world units), measured from troika's layout so
  // the nameplate background can size itself to the text.
  const [nameWidth, setNameWidth] = useState(0);
  const resolvedAppearance = useMemo(
    () => appearance ?? createDefaultAgentAvatarProfile(agentId),
    [agentId, appearance],
  );

  useFrame(() => {
    const agent =
      agentLookupRef?.current?.get(agentId) ??
      agentsRef.current?.find((candidate) => candidate.id === agentId);
    if (!agent || !groupRef.current) return;

    const [wx, , wz] = toWorld(agent.x, agent.y);
    pos.current.set(wx, 0, wz);
    groupRef.current.position.lerp(pos.current, 0.15);

    const targetY = agent.facing;
    let rotDelta = targetY - groupRef.current.rotation.y;
    while (rotDelta > Math.PI) rotDelta -= Math.PI * 2;
    while (rotDelta < -Math.PI) rotDelta += Math.PI * 2;
    groupRef.current.rotation.y += rotDelta * 0.12;
    const isWorkout = agent.state === "working_out";
    const isDancing = agent.state === "dancing";
    const isJanitor = "role" in agent && agent.role === "janitor";
    const janitorTool = isJanitor
      ? (agent as RenderAgent & JanitorActor).janitorTool
      : undefined;
    const workoutStyle = agent.workoutStyle ?? "lift";
    const frameValue = agent.frame + (agent.phaseOffset ?? 0) / WALK_ANIM_SPEED;
    const walkPhase = Math.sin(frameValue * WALK_ANIM_SPEED);
    const workoutPhase = Math.sin(
      agent.frame * 0.18 + (agent.phaseOffset ?? 0),
    );
    const workoutPushPhase = Math.sin(
      agent.frame * 0.18 + (agent.phaseOffset ?? 0) + Math.PI / 2,
    );
    groupRef.current.rotation.z = 0;
    groupRef.current.rotation.x =
      agent.state === "sitting"
        ? -0.15
        : isDancing
          ? Math.sin(agent.frame * 0.18 + (agent.phaseOffset ?? 0)) * 0.06
          : isWorkout
            ? workoutStyle === "bike"
              ? 0.18
              : workoutStyle === "row"
                ? -0.12 + Math.max(0, workoutPhase) * 0.08
                : workoutStyle === "stretch"
                  ? -0.08
                  : workoutStyle === "run"
                    ? 0.08
                    : workoutStyle === "box"
                      ? 0.04
                      : 0.02
            : agent.pingPongUntil
              ? 0.08
              : 0;
    const bounce =
      agent.state === "walking"
        ? Math.sin(frameValue * WALK_ANIM_SPEED) * 0.04
        : isDancing
          ? 0.03 +
            Math.abs(Math.sin(agent.frame * 0.22 + (agent.phaseOffset ?? 0))) *
              0.05
          : isWorkout
            ? workoutStyle === "stretch"
              ? 0.012 + Math.abs(workoutPhase) * 0.018
              : workoutStyle === "row"
                ? 0.015 + Math.abs(workoutPhase) * 0.028
                : 0.02 + Math.abs(workoutPhase) * 0.04
            : 0;
    const breathe =
      agent.state === "standing" || isWorkout || agent.pingPongUntil
        ? Math.sin(frameValue * 0.03) * 0.01
        : 0;
    // Sitting lowers the hips onto the chair seat (legs bend forward below).
    // Desk chairs need a small drop; rest-room beanbags are lower so agents
    // sink further to avoid levitating above the lounge chair surface.
    const sitDrop =
      agent.state === "sitting"
        ? agent.x > DIVIDER_X
          ? REST_SIT_DROP
          : DESK_SIT_DROP
        : 0;
    groupRef.current.position.y = bounce + breathe + sitDrop;

    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = 0;
      leftArmRef.current.rotation.y = 0;
      leftArmRef.current.rotation.z = 0;
      if (isJanitor && janitorTool !== "broom") {
        leftArmRef.current.rotation.x = -0.22;
        leftArmRef.current.rotation.z = -0.08;
      } else if (agent.state === "walking") {
        leftArmRef.current.rotation.x = walkPhase * 0.4;
      } else if (isDancing) {
        leftArmRef.current.rotation.x =
          -0.8 + Math.sin(agent.frame * 0.22) * 0.9;
        leftArmRef.current.rotation.z =
          -0.45 + Math.cos(agent.frame * 0.16) * 0.18;
        leftArmRef.current.rotation.y = -0.08;
        groupRef.current.rotation.z = Math.sin(agent.frame * 0.12) * 0.08;
      } else if (isWorkout) {
        if (workoutStyle === "run") {
          leftArmRef.current.rotation.x = -(0.28 + workoutPhase * 1.05);
          leftArmRef.current.rotation.z = -0.08;
        } else if (workoutStyle === "bike") {
          leftArmRef.current.rotation.x = -(1.05 + workoutPushPhase * 0.16);
          leftArmRef.current.rotation.z = -0.18;
          leftArmRef.current.rotation.y = -0.12;
        } else if (workoutStyle === "row") {
          leftArmRef.current.rotation.x = -(
            0.95 -
            Math.max(0, workoutPhase) * 0.7
          );
          leftArmRef.current.rotation.z = -0.16;
          leftArmRef.current.rotation.y = -0.1;
        } else if (workoutStyle === "box") {
          leftArmRef.current.rotation.x = -(
            0.92 +
            Math.max(0, workoutPushPhase) * 0.45
          );
          leftArmRef.current.rotation.z = -0.52;
          leftArmRef.current.rotation.y = -0.06;
          groupRef.current.rotation.z = 0.05;
        } else if (workoutStyle === "stretch") {
          leftArmRef.current.rotation.x = -1.58;
          leftArmRef.current.rotation.z = -0.42;
          leftArmRef.current.rotation.y = -0.08;
        } else {
          leftArmRef.current.rotation.x = -(
            0.28 +
            Math.abs(workoutPhase) * 0.28
          );
          leftArmRef.current.rotation.z = -0.58;
          leftArmRef.current.rotation.y = -0.12;
        }
      } else if (agent.pingPongUntil) {
        leftArmRef.current.rotation.x =
          0.2 + Math.sin(agent.frame * 0.08) * 0.28;
      } else if (agent.state === "sitting") {
        // Rest the arms forward toward the desk (negative = forward here).
        leftArmRef.current.rotation.x = -0.45;
      }
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = 0;
      rightArmRef.current.rotation.y = 0;
      rightArmRef.current.rotation.z = 0;
      if (isJanitor && janitorTool !== "broom") {
        rightArmRef.current.rotation.x = -0.95;
        rightArmRef.current.rotation.y = 0.18;
        rightArmRef.current.rotation.z = 0.08;
      } else if (agent.state === "walking") {
        rightArmRef.current.rotation.x = -walkPhase * 0.4;
      } else if (isDancing) {
        rightArmRef.current.rotation.x =
          -0.8 - Math.sin(agent.frame * 0.22) * 0.9;
        rightArmRef.current.rotation.z =
          0.45 - Math.cos(agent.frame * 0.16) * 0.18;
        rightArmRef.current.rotation.y = 0.08;
        groupRef.current.rotation.z = Math.sin(agent.frame * 0.12) * 0.08;
      } else if (isWorkout) {
        if (workoutStyle === "run") {
          rightArmRef.current.rotation.x = -(0.28 - workoutPhase * 1.05);
          rightArmRef.current.rotation.z = 0.08;
        } else if (workoutStyle === "bike") {
          rightArmRef.current.rotation.x = -(1.05 - workoutPushPhase * 0.16);
          rightArmRef.current.rotation.z = 0.18;
          rightArmRef.current.rotation.y = 0.12;
        } else if (workoutStyle === "row") {
          rightArmRef.current.rotation.x = -(
            0.95 -
            Math.max(0, -workoutPhase) * 0.7
          );
          rightArmRef.current.rotation.z = 0.16;
          rightArmRef.current.rotation.y = 0.1;
        } else if (workoutStyle === "box") {
          rightArmRef.current.rotation.x = -(
            0.92 +
            Math.max(0, -workoutPushPhase) * 0.45
          );
          rightArmRef.current.rotation.z = 0.52;
          rightArmRef.current.rotation.y = 0.06;
          groupRef.current.rotation.z = -0.05;
        } else if (workoutStyle === "stretch") {
          rightArmRef.current.rotation.x = -1.58;
          rightArmRef.current.rotation.z = 0.42;
          rightArmRef.current.rotation.y = 0.08;
        } else {
          rightArmRef.current.rotation.x = -(
            0.28 +
            Math.abs(workoutPhase) * 0.28
          );
          rightArmRef.current.rotation.z = 0.58;
          rightArmRef.current.rotation.y = 0.12;
        }
      } else if (agent.pingPongUntil) {
        rightArmRef.current.rotation.x =
          0.08 - Math.sin(agent.frame * 0.08) * 0.16;
      } else if (agent.state === "sitting") {
        // Rest the arms forward toward the desk (negative = forward here).
        rightArmRef.current.rotation.x = -0.45;
      }
    }
    if (leftLegRef.current) {
      leftLegRef.current.rotation.x =
        agent.state === "walking"
          ? walkPhase * 0.35
          : isDancing
            ? Math.sin(agent.frame * 0.22 + (agent.phaseOffset ?? 0)) * 0.35
            : isWorkout
              ? workoutStyle === "run"
                ? workoutPhase * 0.7
                : workoutStyle === "bike"
                  ? workoutPhase * 0.82
                  : workoutStyle === "row"
                    ? 0.14 + Math.max(0, workoutPhase) * 0.42
                    : workoutStyle === "stretch"
                      ? -0.2 + Math.abs(workoutPhase) * 0.08
                      : workoutStyle === "box"
                        ? 0.06 + workoutPhase * 0.14
                        : workoutPhase * 0.18
              : 0;
    }
    if (rightLegRef.current) {
      rightLegRef.current.rotation.x =
        agent.state === "walking"
          ? -walkPhase * 0.35
          : isDancing
            ? -Math.sin(agent.frame * 0.22 + (agent.phaseOffset ?? 0)) * 0.35
            : isWorkout
              ? workoutStyle === "run"
                ? -workoutPhase * 0.7
                : workoutStyle === "bike"
                  ? -workoutPhase * 0.82
                  : workoutStyle === "row"
                    ? 0.14 + Math.max(0, -workoutPhase) * 0.42
                    : workoutStyle === "stretch"
                      ? -0.12 + Math.abs(workoutPhase) * 0.08
                      : workoutStyle === "box"
                        ? 0.06 - workoutPhase * 0.14
                        : -workoutPhase * 0.18
              : 0;
    }
    // Seated: bend both legs forward at the hip (negative rotation.x swings
    // limbs toward the facing direction in this rig) so the avatar reads as
    // sitting on the chair rather than standing at — and clipping into — the
    // desk.
    if (agent.state === "sitting") {
      if (leftLegRef.current) leftLegRef.current.rotation.x = -0.85;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -0.85;
    }

    // `working` drives the activity-based face/animation cues (a seated,
    // exercising or dancing agent looks engaged). It is NOT the gateway state.
    const working =
      agent.state === "sitting" ||
      isWorkout ||
      isDancing ||
      agent.status === "working";
    const isError = agent.status === "error";
    const isAway = agent.state === "away";
    // The nameplate dot and pulse reflect gateway connectivity, independent of
    // the Kanban-derived working/idle activity status.
    applyAgentNameplatePresence(
      agent,
      statusDotMatRef.current,
      pulseRingRef.current,
      pulseRingMatRef.current,
    );

    if (awayBubbleRef.current) awayBubbleRef.current.visible = isAway;
    if (bodyMatRef.current) bodyMatRef.current.opacity = isAway ? 0.45 : 1;
    if (groupRef.current) {
      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as
            | THREE.MeshStandardMaterial
            | THREE.MeshLambertMaterial;
          if (
            mat instanceof THREE.MeshLambertMaterial ||
            mat instanceof THREE.MeshStandardMaterial
          ) {
            mat.transparent = isAway;
            mat.opacity = isAway ? 0.45 : 1;
          }
        }
      });
    }

    const blinkSeed = agentId
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const blinkCycle = isAway ? 180 : isError ? 120 : working ? 170 : 240;
    const blinkWindow = isAway ? 26 : isError ? 18 : 12;
    const blinkPhase = (agent.frame + blinkSeed * 17) % blinkCycle;
    let eyeOpen = isError ? 0.92 : working ? 0.84 : 1.12;

    if (blinkPhase < blinkWindow) {
      const midpoint = blinkWindow / 2;
      eyeOpen *= Math.min(1, Math.abs(blinkPhase - midpoint) / midpoint);
    }
    if (working) eyeOpen = Math.max(0.48, eyeOpen);
    if (isError) eyeOpen = Math.max(0.28, eyeOpen);
    if (isAway) eyeOpen = Math.min(eyeOpen, 0.2);

    const eyeScaleX = isError ? 1.2 : working ? 1.06 : 1.12;
    const eyeScaleY = Math.max(0.05, eyeOpen);
    const eyeOffsetY =
      (working ? -0.006 : 0) +
      (isError ? -0.004 : 0) +
      (agent.state === "walking" ? 0.004 : 0) +
      (isAway ? -0.008 : 0);

    for (const eyeRef of [leftEyeRef, rightEyeRef]) {
      if (!eyeRef.current) continue;
      eyeRef.current.scale.x = eyeScaleX;
      eyeRef.current.scale.y = eyeScaleY;
      eyeRef.current.position.y = 0.475 + eyeOffsetY;
    }
    for (const highlightRef of [leftEyeHighlightRef, rightEyeHighlightRef]) {
      if (!highlightRef.current) continue;
      highlightRef.current.visible = eyeOpen > 0.45 && !isAway;
      highlightRef.current.position.y = 0.482 + eyeOffsetY;
    }

    if (mouthRef.current) {
      mouthRef.current.rotation.z = 0;
      mouthRef.current.position.set(0, 0.436, 0.074);
      if (isAway) {
        mouthRef.current.scale.set(0.5, 0.12, 1);
        mouthRef.current.position.y = 0.434;
      } else if (isError) {
        mouthRef.current.scale.set(1.28, 0.16, 1);
        mouthRef.current.position.y = 0.43;
      } else if (working) {
        mouthRef.current.scale.set(0.92, 0.14, 1);
        mouthRef.current.position.y = 0.437;
      } else if (agent.state === "walking") {
        const talkPulse =
          0.38 + (Math.sin(agent.frame * 0.14 + blinkSeed) + 1) * 0.22;
        mouthRef.current.scale.set(0.95, talkPulse, 1);
      } else {
        mouthRef.current.scale.set(1.35, 0.34, 1);
        mouthRef.current.position.y = 0.428;
      }
    }

    const showSmileCorners =
      !isAway && !isError && !working && agent.state !== "walking";
    const showFrownCorners = isError;
    if (leftMouthCornerRef.current && rightMouthCornerRef.current) {
      leftMouthCornerRef.current.visible = showSmileCorners || showFrownCorners;
      rightMouthCornerRef.current.visible =
        showSmileCorners || showFrownCorners;
      leftMouthCornerRef.current.position.set(-0.031, 0.434, 0.074);
      rightMouthCornerRef.current.position.set(0.031, 0.434, 0.074);
      if (showFrownCorners) {
        leftMouthCornerRef.current.rotation.z = -0.6;
        rightMouthCornerRef.current.rotation.z = 0.6;
        leftMouthCornerRef.current.position.y = 0.425;
        rightMouthCornerRef.current.position.y = 0.425;
      } else if (showSmileCorners) {
        leftMouthCornerRef.current.rotation.z = 0.62;
        rightMouthCornerRef.current.rotation.z = -0.62;
        leftMouthCornerRef.current.position.y = 0.438;
        rightMouthCornerRef.current.position.y = 0.438;
      }
    }

    if (leftBrowRef.current && rightBrowRef.current) {
      leftBrowRef.current.position.y = 0.52;
      rightBrowRef.current.position.y = 0.52;
      if (isAway) {
        leftBrowRef.current.rotation.z = -0.24;
        rightBrowRef.current.rotation.z = 0.24;
        leftBrowRef.current.position.y = 0.512;
        rightBrowRef.current.position.y = 0.512;
      } else if (isError) {
        leftBrowRef.current.rotation.z = 0.42;
        rightBrowRef.current.rotation.z = -0.42;
        leftBrowRef.current.position.y = 0.516;
        rightBrowRef.current.position.y = 0.516;
      } else if (working) {
        leftBrowRef.current.rotation.z = 0.3;
        rightBrowRef.current.rotation.z = -0.3;
      } else {
        leftBrowRef.current.rotation.z = -0.18;
        rightBrowRef.current.rotation.z = 0.18;
        leftBrowRef.current.position.y = 0.526;
        rightBrowRef.current.position.y = 0.526;
      }
    }

    const ambientBubbleVisible =
      (!suppressSpeechBubble && isError) ||
      (!isAway &&
        !suppressSpeechBubble &&
        !working &&
        !isError &&
        agent.state === "standing" &&
        (agent.frame + blinkSeed * 11) % 320 < 42);
    const bumpTalking = (agent.bumpTalkUntil ?? 0) > Date.now();

    if (speechBubbleRef.current) {
      const bubbleVisible =
        !suppressSpeechBubble &&
        (showSpeech || bumpTalking || ambientBubbleVisible);
      speechBubbleRef.current.visible = bubbleVisible;
      if (bubbleVisible) {
        if (showSpeech && speechText?.trim()) {
          speechBubbleRef.current.scale.setScalar(1);
        } else {
          const pulseBase = isError
            ? 1.06
            : showSpeech || bumpTalking
              ? 1.03
              : 0.98;
          const pulse =
            pulseBase + Math.sin(agent.frame * (isError ? 0.18 : 0.12)) * 0.06;
          speechBubbleRef.current.scale.setScalar(pulse);
        }
      }
    }

    if (speechBubbleMatRef.current) {
      speechBubbleMatRef.current.color.set(
        isError ? "#3a1016" : working ? "#1d2a17" : "#1a2030",
      );
      speechBubbleMatRef.current.opacity = isError ? 0.97 : 0.92;
    }

    if (heldPaddleRef.current) {
      const isPlaying = agent.pingPongUntil !== undefined;
      heldPaddleRef.current.visible = isPlaying;
      if (isPlaying) {
        const swing = Math.sin(agent.frame * 0.08);
        heldPaddleRef.current.position.set(-0.01, -0.21, 0.07 + swing * 0.015);
        heldPaddleRef.current.rotation.set(-0.55 + swing * 0.1, 0.25, -0.35);
      }
    }

    if (heldPaddleFaceRef.current) {
      heldPaddleFaceRef.current.color.set(
        agent.pingPongSide === 0 ? "#1f4fa8" : "#c53b30",
      );
    }

    if (heldCleaningToolRef.current) {
      const showBroom = isJanitor && janitorTool === "broom";
      heldCleaningToolRef.current.visible = showBroom;
      if (showBroom) {
        const sweep =
          agent.state === "walking" ? Math.sin(agent.frame * 0.08) * 0.08 : 0;
        heldCleaningToolRef.current.position.set(
          -0.02,
          -0.2,
          0.08 + sweep * 0.06,
        );
        heldCleaningToolRef.current.rotation.set(-0.8, 0.18, -0.18);
      }
    }

    if (heldCleaningHeadRef.current) {
      heldCleaningHeadRef.current.color.set("#facc15");
    }

    if (heldBucketRef.current) {
      const showVacuum = isJanitor && janitorTool === "vacuum";
      heldBucketRef.current.visible = showVacuum;
      if (showVacuum) {
        heldBucketRef.current.position.set(-0.08, -0.1, 0.18);
        heldBucketRef.current.rotation.set(-0.32, 0.22, -0.38);
      }
    }

    if (heldScrubberRef.current) {
      const showScrubber = isJanitor && janitorTool === "floor_scrubber";
      heldScrubberRef.current.visible = showScrubber;
      if (showScrubber) {
        heldScrubberRef.current.position.set(-0.1, -0.08, 0.2);
        heldScrubberRef.current.rotation.set(-0.28, 0.18, -0.42);
      }
    }
  });

  const skin = resolvedAppearance.body.skinTone;
  const topColor = resolvedAppearance.clothing.topColor;
  const trouserColor = resolvedAppearance.clothing.bottomColor;
  const shoeColor = resolvedAppearance.clothing.shoesColor;
  const hairColor = resolvedAppearance.hair.color;
  const hairStyle = resolvedAppearance.hair.style;
  const topStyle = resolvedAppearance.clothing.topStyle;
  const bottomStyle = resolvedAppearance.clothing.bottomStyle;
  const hatStyle = resolvedAppearance.accessories.hatStyle;
  const showGlasses = resolvedAppearance.accessories.glasses;
  const showHeadset = resolvedAppearance.accessories.headset;
  const showBackpack = resolvedAppearance.accessories.backpack;
  const accessoryColor = topColor;
  const sleeveColor = topStyle === "jacket" ? "#dbe4ff" : topColor;
  const cuffColor = topStyle === "hoodie" ? "#d1d5db" : sleeveColor;
  const topAccentColor = topStyle === "jacket" ? "#1f2937" : cuffColor;

  const nameplateY = riggedModelUrl ? 1.45 : 1.05;
  const awayY = riggedModelUrl ? 1.7 : 1.3;
  const speechY = riggedModelUrl ? 1.85 : 1.45;

  const faceTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new THREE.CanvasTexture(canvas);

    ctx.fillStyle = skin;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(0, 0, 64, 10);
    ctx.fillStyle = "rgba(196,122,84,0.18)";
    ctx.beginPath();
    ctx.arc(18, 38, 7, 0, Math.PI * 2);
    ctx.arc(46, 38, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d8a06e";
    ctx.fillRect(30, 28, 4, 10);
    ctx.fillRect(29, 37, 6, 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [skin]);

  // CanvasTextures hold GPU memory; dispose the previous one when `skin`
  // changes (and on unmount) so cycling appearances doesn't leak.
  useEffect(() => {
    return () => {
      faceTexture.dispose();
    };
  }, [faceTexture]);

  const resolvedSpeechText =
    showSpeech && speechText?.trim()
      ? speechText.trim()
      : status === "error"
        ? "error"
        : "...";
  const activeSpeechBubble = showSpeech && Boolean(speechText?.trim());
  const normalizedSpeechBubbleText = activeSpeechBubble
    ? flattenSpeechBubbleMarkdown(resolvedSpeechText)
    : resolvedSpeechText;
  const speechBubblePreview = activeSpeechBubble
    ? clampSpeechBubbleText(normalizedSpeechBubbleText)
    : { text: normalizedSpeechBubbleText, truncated: false };
  const speechBubbleDisplayText = speechBubblePreview.text;
  const speechBubbleWasTruncated = speechBubblePreview.truncated;
  const speechBubbleTextLength = speechBubbleDisplayText.length;
  const speechBubbleWidth = activeSpeechBubble
    ? Math.min(4.6, Math.max(1.8, 1.55 + speechBubbleTextLength * 0.018))
    : 0.36;
  const speechBubblePaddingX = activeSpeechBubble ? 0.34 : 0.06;
  const speechBubblePaddingY = activeSpeechBubble ? 0.3 : 0.06;
  const speechBubbleMaxWidth = Math.max(
    0.24,
    speechBubbleWidth - speechBubblePaddingX,
  );
  const estimatedSpeechCharsPerLine = activeSpeechBubble
    ? Math.max(10, Math.floor(speechBubbleMaxWidth * 7))
    : 8;
  const estimatedSpeechLines = activeSpeechBubble
    ? Math.max(
        1,
        Math.min(
          MAX_SPEECH_BUBBLE_LINES,
          Math.ceil(speechBubbleTextLength / estimatedSpeechCharsPerLine),
        ),
      )
    : 1;
  const speechBubbleHeight = activeSpeechBubble
    ? Math.max(0.72, estimatedSpeechLines * 0.26 + speechBubblePaddingY)
    : 0.2;
  const speechBubbleFontSize = activeSpeechBubble
    ? speechBubbleTextLength > 110
      ? 0.188
      : speechBubbleTextLength > 70
        ? 0.2
        : 0.216
    : 0.13;
  const speechBubbleTextColor = activeSpeechBubble
    ? "#f8fafc"
    : status === "error"
      ? "#ff9aa5"
      : status === "working"
        ? "#b9f99d"
        : "#a0c8ff";
  const speechBubbleBorderColor = activeSpeechBubble
    ? status === "error"
      ? "#ff7f93"
      : status === "working"
        ? "#93f57d"
        : "#8dc4ff"
    : "transparent";
  const speechBubbleBorderInset = activeSpeechBubble ? 0.03 : 0;
  const nameplateText = name ? formatAgentNameplateText(name) : "";
  const subtitleText = typeof subtitle === "string" ? subtitle.trim() : "";
  const nameplateFontSize =
    nameplateText.length > 16
      ? 0.1
      : nameplateText.length > 11
        ? 0.112
        : nameplateText.length > 8
          ? 0.124
          : 0.144;

  // The nameplate background hugs the rendered name width (measured via troika's
  // onSync) plus room for the left accent bar, the status dot and side padding,
  // so long names no longer overflow a fixed-width plate.
  const NAMEPLATE_BAR_W = 0.028;
  const NAMEPLATE_DOT_R = 0.052;
  const NAMEPLATE_DOT_MARGIN = 0.055;
  const NAMEPLATE_PAD = 0.075;
  const nameplateHeight = subtitleText ? 0.34 : 0.24;
  // Estimate before the first layout lands, then use the measured width.
  const estimatedNameWidth = nameplateText.length * nameplateFontSize * 0.62;
  const measuredNameWidth = nameWidth > 0 ? nameWidth : estimatedNameWidth;
  const nameplateWidth =
    measuredNameWidth +
    NAMEPLATE_BAR_W +
    NAMEPLATE_DOT_R * 2 +
    NAMEPLATE_DOT_MARGIN +
    NAMEPLATE_PAD * 2;
  const nameplateBarX = -nameplateWidth / 2 + NAMEPLATE_BAR_W / 2;
  const nameplateDotX =
    nameplateWidth / 2 - NAMEPLATE_DOT_MARGIN - NAMEPLATE_DOT_R;
  const nameplateTextLeft =
    -nameplateWidth / 2 + NAMEPLATE_BAR_W + NAMEPLATE_PAD;
  const nameplateTextRight = nameplateDotX - NAMEPLATE_DOT_R - NAMEPLATE_PAD;
  const nameplateTextCenterX = (nameplateTextLeft + nameplateTextRight) / 2;

  return (
    <group
      ref={groupRef}
      scale={[AGENT_SCALE, AGENT_SCALE, AGENT_SCALE]}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover?.(agentId);
      }}
      onPointerOut={() => onUnhover?.()}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(agentId);
      }}
      onContextMenu={(event) => {
        event.stopPropagation();
        const nativeEvent = event.nativeEvent as MouseEvent;
        onContextMenu?.(agentId, nativeEvent.clientX, nativeEvent.clientY);
      }}
    >
      {!riggedModelUrl && (
        <group>
          <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.12, 12]} />
            <meshBasicMaterial color="#000" transparent opacity={0.2} />
          </mesh>
          <group ref={rightLegRef} position={[-0.045, 0.1, 0]}>
            {bottomStyle === "shorts" ? (
              <>
                <mesh position={[0, 0.03, 0]}>
                  <boxGeometry args={[0.07, 0.08, 0.08]} />
                  <meshLambertMaterial color={trouserColor} />
                </mesh>
                <mesh position={[0, -0.045, 0]}>
                  <boxGeometry args={[0.05, 0.06, 0.05]} />
                  <meshLambertMaterial color={skin} />
                </mesh>
              </>
            ) : (
              <>
                <mesh>
                  <boxGeometry args={[0.07, 0.14, 0.08]} />
                  <meshLambertMaterial color={trouserColor} />
                </mesh>
                {bottomStyle === "cuffed" ? (
                  <mesh position={[0, -0.05, 0]}>
                    <boxGeometry args={[0.074, 0.022, 0.084]} />
                    <meshLambertMaterial color="#d1d5db" />
                  </mesh>
                ) : null}
              </>
            )}
            <mesh position={[0, -0.09, 0]}>
              <boxGeometry args={[0.07, 0.05, 0.12]} />
              <meshLambertMaterial color={shoeColor} />
            </mesh>
          </group>
          <group ref={leftLegRef} position={[0.045, 0.1, 0]}>
            {bottomStyle === "shorts" ? (
              <>
                <mesh position={[0, 0.03, 0]}>
                  <boxGeometry args={[0.07, 0.08, 0.08]} />
                  <meshLambertMaterial color={trouserColor} />
                </mesh>
                <mesh position={[0, -0.045, 0]}>
                  <boxGeometry args={[0.05, 0.06, 0.05]} />
                  <meshLambertMaterial color={skin} />
                </mesh>
              </>
            ) : (
              <>
                <mesh>
                  <boxGeometry args={[0.07, 0.14, 0.08]} />
                  <meshLambertMaterial color={trouserColor} />
                </mesh>
                {bottomStyle === "cuffed" ? (
                  <mesh position={[0, -0.05, 0]}>
                    <boxGeometry args={[0.074, 0.022, 0.084]} />
                    <meshLambertMaterial color="#d1d5db" />
                  </mesh>
                ) : null}
              </>
            )}
            <mesh position={[0, -0.09, 0]}>
              <boxGeometry args={[0.07, 0.05, 0.12]} />
              <meshLambertMaterial color={shoeColor} />
            </mesh>
          </group>
          {showBackpack ? (
            <group position={[0, 0.28, -0.08]}>
              <mesh>
                <boxGeometry args={[0.15, 0.18, 0.06]} />
                <meshLambertMaterial color={accessoryColor} />
              </mesh>
              <mesh position={[-0.06, 0.02, 0.02]}>
                <boxGeometry args={[0.018, 0.16, 0.018]} />
                <meshLambertMaterial color="#cbd5e1" />
              </mesh>
              <mesh position={[0.06, 0.02, 0.02]}>
                <boxGeometry args={[0.018, 0.16, 0.018]} />
                <meshLambertMaterial color="#cbd5e1" />
              </mesh>
            </group>
          ) : null}
          <mesh position={[0, 0.28, 0]}>
            <boxGeometry args={[0.18, 0.2, 0.1]} />
            <meshLambertMaterial ref={bodyMatRef} color={topColor} />
          </mesh>
          {topStyle === "hoodie" ? (
            <>
              <mesh position={[0, 0.35, -0.045]}>
                <boxGeometry args={[0.17, 0.1, 0.03]} />
                <meshLambertMaterial color={topColor} />
              </mesh>
              <mesh position={[0, 0.22, 0.056]}>
                <boxGeometry args={[0.11, 0.03, 0.012]} />
                <meshLambertMaterial color={cuffColor} />
              </mesh>
            </>
          ) : null}
          {topStyle === "jacket" ? (
            <>
              <mesh position={[0, 0.28, 0.056]}>
                <boxGeometry args={[0.182, 0.21, 0.012]} />
                <meshLambertMaterial color={topAccentColor} />
              </mesh>
              <mesh position={[0, 0.28, 0.063]}>
                <boxGeometry args={[0.034, 0.2, 0.01]} />
                <meshLambertMaterial color="#f8fafc" />
              </mesh>
            </>
          ) : null}
          <group ref={rightArmRef} position={[-0.12, 0.28, 0]}>
            <mesh position={[0, -0.08, 0]}>
              <boxGeometry args={[0.06, 0.16, 0.06]} />
              <meshLambertMaterial color={sleeveColor} />
            </mesh>
            {topStyle === "hoodie" ? (
              <mesh position={[0, -0.145, 0]}>
                <boxGeometry args={[0.064, 0.03, 0.064]} />
                <meshLambertMaterial color={cuffColor} />
              </mesh>
            ) : null}
            <mesh position={[0, -0.17, 0]}>
              <boxGeometry args={[0.05, 0.05, 0.05]} />
              <meshLambertMaterial color={skin} />
            </mesh>
            <group
              ref={heldPaddleRef}
              position={[-0.01, -0.21, 0.07]}
              visible={false}
            >
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.042, 0.042, 0.012, 18]} />
                <meshStandardMaterial
                  ref={heldPaddleFaceRef}
                  color="#c53b30"
                  roughness={0.72}
                />
              </mesh>
              <mesh position={[0, -0.045, -0.015]} rotation={[0.12, 0, 0]}>
                <boxGeometry args={[0.014, 0.07, 0.014]} />
                <meshStandardMaterial color="#c59a68" roughness={0.74} />
              </mesh>
            </group>
            <group
              ref={heldCleaningToolRef}
              position={[-0.02, -0.2, 0.08]}
              rotation={[-0.8, 0.18, -0.18]}
              visible={false}
            >
              <mesh position={[0, -0.13, 0]}>
                <boxGeometry args={[0.012, 0.28, 0.012]} />
                <meshStandardMaterial color="#9a6b3c" roughness={0.76} />
              </mesh>
              <mesh position={[0, -0.28, 0.012]}>
                <boxGeometry args={[0.09, 0.028, 0.03]} />
                <meshStandardMaterial
                  ref={heldCleaningHeadRef}
                  color="#facc15"
                  roughness={0.68}
                />
              </mesh>
            </group>
            {/* Vacuum cleaner: larger upright silhouette so it reads clearly in-scene. */}
            <group
              ref={heldBucketRef}
              position={[-0.08, -0.1, 0.18]}
              visible={false}
            >
              <mesh position={[0, -0.02, 0]}>
                <boxGeometry args={[0.015, 0.3, 0.015]} />
                <meshStandardMaterial color="#555" roughness={0.72} />
              </mesh>
              <mesh position={[0.025, -0.16, 0]}>
                <boxGeometry args={[0.08, 0.12, 0.07]} />
                <meshStandardMaterial color="#dc2626" roughness={0.48} />
              </mesh>
              <mesh position={[0.05, -0.24, 0.02]}>
                <boxGeometry args={[0.11, 0.024, 0.06]} />
                <meshStandardMaterial color="#1f2937" roughness={0.65} />
              </mesh>
              <mesh
                position={[0.02, -0.11, 0.035]}
                rotation={[0, Math.PI / 2, 0]}
              >
                <torusGeometry args={[0.03, 0.005, 10, 18, Math.PI]} />
                <meshStandardMaterial
                  color="#94a3b8"
                  roughness={0.36}
                  metalness={0.18}
                />
              </mesh>
            </group>
            {/* Floor scrubber: prominent handle, body, and wide cleaning base. */}
            <group
              ref={heldScrubberRef}
              position={[-0.1, -0.08, 0.2]}
              visible={false}
            >
              <mesh position={[0, -0.02, 0]}>
                <boxGeometry args={[0.015, 0.32, 0.015]} />
                <meshStandardMaterial color="#777" roughness={0.7} />
              </mesh>
              <mesh position={[0.035, -0.17, 0]}>
                <boxGeometry args={[0.085, 0.08, 0.065]} />
                <meshStandardMaterial color="#f59e0b" roughness={0.46} />
              </mesh>
              <mesh
                position={[0.06, -0.27, 0.02]}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <cylinderGeometry args={[0.075, 0.075, 0.018, 24]} />
                <meshStandardMaterial color="#0ea5e9" roughness={0.52} />
              </mesh>
              <mesh position={[0.06, -0.23, 0.02]}>
                <boxGeometry args={[0.12, 0.018, 0.07]} />
                <meshStandardMaterial color="#1f2937" roughness={0.6} />
              </mesh>
            </group>
          </group>
          <group ref={leftArmRef} position={[0.12, 0.28, 0]}>
            <mesh position={[0, -0.08, 0]}>
              <boxGeometry args={[0.06, 0.16, 0.06]} />
              <meshLambertMaterial color={sleeveColor} />
            </mesh>
            {topStyle === "hoodie" ? (
              <mesh position={[0, -0.145, 0]}>
                <boxGeometry args={[0.064, 0.03, 0.064]} />
                <meshLambertMaterial color={cuffColor} />
              </mesh>
            ) : null}
            <mesh position={[0, -0.17, 0]}>
              <boxGeometry args={[0.05, 0.05, 0.05]} />
              <meshLambertMaterial color={skin} />
            </mesh>
          </group>
          <mesh position={[0, 0.39, 0]}>
            <boxGeometry args={[0.07, 0.05, 0.07]} />
            <meshLambertMaterial color={skin} />
          </mesh>
          <mesh position={[0, 0.47, 0]}>
            <boxGeometry args={[0.16, 0.16, 0.14]} />
            <meshLambertMaterial attach="material-0" color={skin} />
            <meshLambertMaterial attach="material-1" color={skin} />
            <meshLambertMaterial attach="material-2" color={skin} />
            <meshLambertMaterial attach="material-3" color={skin} />
            <meshLambertMaterial attach="material-4" map={faceTexture} />
            <meshLambertMaterial attach="material-5" color={skin} />
          </mesh>
          {hairStyle === "short" ? (
            <mesh position={[0, 0.555, 0]}>
              <boxGeometry args={[0.17, 0.05, 0.15]} />
              <meshLambertMaterial color={hairColor} />
            </mesh>
          ) : null}
          {hairStyle === "parted" ? (
            <>
              <mesh position={[0, 0.555, 0]}>
                <boxGeometry args={[0.17, 0.045, 0.15]} />
                <meshLambertMaterial color={hairColor} />
              </mesh>
              <mesh position={[-0.035, 0.59, 0.01]} rotation={[0.1, 0, -0.2]}>
                <boxGeometry args={[0.12, 0.03, 0.08]} />
                <meshLambertMaterial color={hairColor} />
              </mesh>
            </>
          ) : null}
          {hairStyle === "spiky" ? (
            <>
              <mesh position={[0, 0.55, 0]}>
                <boxGeometry args={[0.16, 0.035, 0.14]} />
                <meshLambertMaterial color={hairColor} />
              </mesh>
              <mesh position={[-0.05, 0.59, 0]} rotation={[0, 0, -0.2]}>
                <boxGeometry args={[0.04, 0.06, 0.04]} />
                <meshLambertMaterial color={hairColor} />
              </mesh>
              <mesh position={[0, 0.605, 0]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.04, 0.08, 0.04]} />
                <meshLambertMaterial color={hairColor} />
              </mesh>
              <mesh position={[0.05, 0.59, 0]} rotation={[0, 0, 0.2]}>
                <boxGeometry args={[0.04, 0.06, 0.04]} />
                <meshLambertMaterial color={hairColor} />
              </mesh>
            </>
          ) : null}
          {hairStyle === "bun" ? (
            <>
              <mesh position={[0, 0.548, 0]}>
                <boxGeometry args={[0.17, 0.04, 0.15]} />
                <meshLambertMaterial color={hairColor} />
              </mesh>
              <mesh position={[0, 0.6, -0.035]}>
                <sphereGeometry args={[0.042, 14, 14]} />
                <meshLambertMaterial color={hairColor} />
              </mesh>
            </>
          ) : null}
          {hatStyle === "cap" ? (
            <>
              <mesh position={[0, 0.59, 0]}>
                <boxGeometry args={[0.172, 0.03, 0.152]} />
                <meshLambertMaterial color={accessoryColor} />
              </mesh>
              <mesh position={[0, 0.575, 0.07]}>
                <boxGeometry args={[0.09, 0.012, 0.05]} />
                <meshLambertMaterial color={accessoryColor} />
              </mesh>
            </>
          ) : null}
          {hatStyle === "beanie" ? (
            <mesh position={[0, 0.59, 0]}>
              <boxGeometry args={[0.18, 0.06, 0.16]} />
              <meshLambertMaterial color={accessoryColor} />
            </mesh>
          ) : null}
          {showHeadset ? (
            <>
              <mesh position={[0, 0.57, 0]} rotation={[0, 0, Math.PI / 2]}>
                <torusGeometry args={[0.09, 0.008, 8, 24, Math.PI]} />
                <meshLambertMaterial color="#94a3b8" />
              </mesh>
              <mesh position={[-0.1, 0.48, 0]}>
                <boxGeometry args={[0.018, 0.05, 0.028]} />
                <meshLambertMaterial color="#475569" />
              </mesh>
              <mesh position={[0.1, 0.48, 0]}>
                <boxGeometry args={[0.018, 0.05, 0.028]} />
                <meshLambertMaterial color="#475569" />
              </mesh>
              <mesh
                position={[0.085, 0.43, 0.06]}
                rotation={[0.25, 0.25, -0.4]}
              >
                <boxGeometry args={[0.012, 0.06, 0.012]} />
                <meshLambertMaterial color="#94a3b8" />
              </mesh>
            </>
          ) : null}
          <mesh ref={leftBrowRef} position={[-0.04, 0.52, 0.074]}>
            <boxGeometry args={[0.04, 0.01, 0.01]} />
            <meshBasicMaterial color="#342016" />
          </mesh>
          <mesh ref={rightBrowRef} position={[0.04, 0.52, 0.074]}>
            <boxGeometry args={[0.04, 0.01, 0.01]} />
            <meshBasicMaterial color="#342016" />
          </mesh>
          <mesh ref={leftEyeRef} position={[-0.04, 0.475, 0.072]}>
            <boxGeometry args={[0.03, 0.03, 0.01]} />
            <meshBasicMaterial color="#1a1a2e" />
          </mesh>
          <mesh ref={rightEyeRef} position={[0.04, 0.475, 0.072]}>
            <boxGeometry args={[0.03, 0.03, 0.01]} />
            <meshBasicMaterial color="#1a1a2e" />
          </mesh>
          <mesh ref={leftEyeHighlightRef} position={[-0.03, 0.482, 0.074]}>
            <boxGeometry args={[0.008, 0.008, 0.01]} />
            <meshBasicMaterial color="#fff" />
          </mesh>
          <mesh ref={rightEyeHighlightRef} position={[0.05, 0.482, 0.074]}>
            <boxGeometry args={[0.008, 0.008, 0.01]} />
            <meshBasicMaterial color="#fff" />
          </mesh>
          {showGlasses ? (
            <>
              <mesh position={[-0.04, 0.475, 0.078]}>
                <boxGeometry args={[0.05, 0.05, 0.01]} />
                <meshBasicMaterial color="#111827" wireframe />
              </mesh>
              <mesh position={[0.04, 0.475, 0.078]}>
                <boxGeometry args={[0.05, 0.05, 0.01]} />
                <meshBasicMaterial color="#111827" wireframe />
              </mesh>
              <mesh position={[0, 0.475, 0.078]}>
                <boxGeometry args={[0.02, 0.008, 0.01]} />
                <meshBasicMaterial color="#111827" />
              </mesh>
            </>
          ) : null}
          <mesh ref={mouthRef} position={[0, 0.436, 0.074]}>
            <boxGeometry args={[0.05, 0.014, 0.01]} />
            <meshBasicMaterial color="#9c4a4a" />
          </mesh>
          <mesh
            ref={leftMouthCornerRef}
            position={[-0.031, 0.438, 0.074]}
            visible={false}
          >
            <boxGeometry args={[0.014, 0.014, 0.01]} />
            <meshBasicMaterial color="#9c4a4a" />
          </mesh>
          <mesh
            ref={rightMouthCornerRef}
            position={[0.031, 0.438, 0.074]}
            visible={false}
          >
            <boxGeometry args={[0.014, 0.014, 0.01]} />
            <meshBasicMaterial color="#9c4a4a" />
          </mesh>
        </group>
      )}
      <mesh
        ref={pulseRingRef}
        position={[0, 0.005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <ringGeometry args={[0.13, 0.19, 24]} />
        <meshBasicMaterial
          ref={pulseRingMatRef}
          color="#22c55e"
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
      {riggedModelUrl && (
        <RiggedCharacter
          url={riggedModelUrl}
          agentId={agentId}
          agentsRef={agentsRef}
          agentLookupRef={agentLookupRef}
          tint={riggedModelTint}
        />
      )}
      {!activeSpeechBubble && nameplateText ? (
        <Billboard position={[0, nameplateY, 0]}>
          <mesh position={[0, 0, -0.001]}>
            <planeGeometry args={[nameplateWidth, nameplateHeight]} />
            <meshBasicMaterial color="#080c14" transparent opacity={0.9} />
          </mesh>
          <mesh position={[nameplateBarX, 0, 0]}>
            <planeGeometry args={[NAMEPLATE_BAR_W, nameplateHeight]} />
            <meshBasicMaterial color={color} />
          </mesh>
          <mesh position={[nameplateDotX, subtitleText ? 0.05 : 0, 0]}>
            <circleGeometry args={[NAMEPLATE_DOT_R, 14]} />
            <meshBasicMaterial ref={statusDotMatRef} color="#ef4444" />
          </mesh>
          <Text
            position={[nameplateTextCenterX, subtitleText ? 0.05 : 0, 0.001]}
            fontSize={nameplateFontSize}
            color="#e8dfc0"
            anchorX="center"
            anchorY="middle"
            font={undefined}
            onSync={(troika) => {
              const bounds = troika?.textRenderInfo?.blockBounds;
              if (!bounds) return;
              const measured = bounds[2] - bounds[0];
              setNameWidth((prev) =>
                Math.abs(prev - measured) > 0.003 ? measured : prev,
              );
            }}
          >
            {nameplateText}
          </Text>
          {subtitleText ? (
            <Text
              position={[nameplateTextCenterX, -0.085, 0.001]}
              fontSize={0.082}
              color="#8ab4ff"
              anchorX="center"
              anchorY="middle"
              font={undefined}
            >
              {subtitleText}
            </Text>
          ) : null}
        </Billboard>
      ) : null}
      <group ref={awayBubbleRef} visible={false}>
        <Billboard position={[0, awayY, 0]}>
          <mesh position={[0, 0, -0.001]}>
            <planeGeometry args={[0.32, 0.18]} />
            <meshBasicMaterial color="#0d1015" transparent opacity={0.85} />
          </mesh>
          <Text
            position={[0, 0, 0.001]}
            fontSize={0.11}
            color="#6080b0"
            anchorX="center"
            anchorY="middle"
          >
            z z z
          </Text>
        </Billboard>
      </group>
      <group ref={speechBubbleRef} visible={false}>
        <Billboard position={[0, speechY, 0]}>
          {activeSpeechBubble ? (
            <mesh
              position={[
                -speechBubbleWidth * 0.18,
                -speechBubbleHeight * 0.53,
                -0.0005,
              ]}
              rotation={[0, 0, Math.PI / 4]}
              renderOrder={99997}
            >
              <planeGeometry args={[0.22, 0.22]} />
              <meshBasicMaterial
                color="#1a2030"
                transparent
                opacity={0.82}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          ) : null}
          {activeSpeechBubble ? (
            <mesh position={[0, 0, -0.0015]} renderOrder={99998}>
              <planeGeometry
                args={[
                  speechBubbleWidth + speechBubbleBorderInset,
                  speechBubbleHeight + speechBubbleBorderInset,
                ]}
              />
              <meshBasicMaterial
                color={speechBubbleBorderColor}
                transparent
                opacity={0.88}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          ) : null}
          <mesh position={[0, 0, -0.001]} renderOrder={99999}>
            <planeGeometry args={[speechBubbleWidth, speechBubbleHeight]} />
            <meshBasicMaterial
              ref={speechBubbleMatRef}
              color="#1a2030"
              transparent
              opacity={activeSpeechBubble ? 0.76 : 0.92}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          <Text
            position={
              activeSpeechBubble
                ? [-speechBubbleWidth / 2 + speechBubblePaddingX / 2, 0, 0.001]
                : [0, 0, 0.001]
            }
            fontSize={speechBubbleFontSize}
            color={speechBubbleTextColor}
            anchorX={activeSpeechBubble ? "left" : "center"}
            anchorY="middle"
            maxWidth={speechBubbleMaxWidth}
            textAlign={activeSpeechBubble ? "left" : "center"}
            lineHeight={1.1}
            renderOrder={100000}
            depthOffset={-10}
            material-depthTest={false}
            material-depthWrite={false}
          >
            {speechBubbleDisplayText}
          </Text>
          {activeSpeechBubble && speechBubbleWasTruncated ? (
            <Text
              position={[0, -speechBubbleHeight * 0.34, 0.001]}
              fontSize={0.09}
              color="#8ab4ff"
              anchorX="center"
              anchorY="middle"
              maxWidth={speechBubbleMaxWidth}
              textAlign="center"
              renderOrder={100001}
              depthOffset={-10}
              material-depthTest={false}
              material-depthWrite={false}
            >
              click for full chat
            </Text>
          ) : null}
        </Billboard>
      </group>
    </group>
  );
});

AgentModel.displayName = "AgentModel";
