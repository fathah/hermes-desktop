import { useCallback, useState } from "react";
import { Billboard, Text, useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";

/**
 * Wraps an interior object (ATM, display car, desk) to make it interactive:
 * hovering shows a floating billboard label and a soft ground ring, clicking
 * fires `onActivate`. When `enabled` is false it renders the children bare,
 * so city-view click semantics (agent select, dev building-mover) are
 * untouched outside the matching interior.
 */
export function Interactable({
  enabled,
  label,
  onActivate,
  position,
  indicatorPosition = [0, 0, 0],
  labelHeight = 2.0,
  ringRadius = 1.0,
  children,
}: {
  enabled: boolean;
  label: string;
  onActivate: () => void;
  position?: [number, number, number];
  /**
   * Where the hover label/ring sit, relative to the group. Children that
   * place themselves in absolute world coordinates (e.g. canvas-space
   * furniture) pass the object's world position here.
   */
  indicatorPosition?: [number, number, number];
  /** World-units above the indicator position where the label floats. */
  labelHeight?: number;
  /** Radius of the ground highlight ring shown while hovered. */
  ringRadius?: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  useCursor(enabled && hovered);

  const handleOver = useCallback((e: ThreeEvent<PointerEvent>): void => {
    e.stopPropagation();
    setHovered(true);
  }, []);
  const handleOut = useCallback((): void => setHovered(false), []);
  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>): void => {
      e.stopPropagation();
      onActivate();
    },
    [onActivate],
  );

  if (!enabled) {
    return <group position={position}>{children}</group>;
  }

  const labelWidth = Math.max(1.1, label.length * 0.13 + 0.5);
  return (
    <group
      position={position}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
      onClick={handleClick}
    >
      {children}
      {hovered && (
        <group position={indicatorPosition}>
          <Billboard position={[0, labelHeight, 0]}>
            <mesh position={[0, 0, -0.001]}>
              <planeGeometry args={[labelWidth, 0.42]} />
              <meshBasicMaterial color="#080c14" transparent opacity={0.88} />
            </mesh>
            <Text
              position={[0, 0, 0.001]}
              fontSize={0.22}
              color="#e8dfc0"
              anchorX="center"
              anchorY="middle"
              font={undefined}
            >
              {label}
            </Text>
          </Billboard>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
            <ringGeometry args={[ringRadius * 0.82, ringRadius, 40]} />
            <meshBasicMaterial
              color="#7dd3fc"
              transparent
              opacity={0.65}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
