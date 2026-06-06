// ExcalidrawCanvas.tsx — the heavy Excalidraw editor, isolated in its own lazy
// chunk so the ~MB bundle (and its CSS) only loads when a drawing is opened for
// editing, never on SPS startup. Imported via React.lazy from ExcalidrawBlock.
import { useRef } from "react";
import {
  Excalidraw,
  exportToSvg,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

interface Props {
  /** Serialized scene JSON from the sidecar, or null for a blank canvas. */
  initialScene: string | null;
  /** Debounced: receives the scene JSON and a rendered SVG to persist. */
  onPersist: (sceneJson: string, svg: string) => void;
}

type ChangeHandler = NonNullable<
  React.ComponentProps<typeof Excalidraw>["onChange"]
>;

export default function ExcalidrawCanvas({ initialScene, onPersist }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  let initialData: { elements?: unknown } | undefined;
  try {
    initialData = initialScene ? JSON.parse(initialScene) : undefined;
  } catch {
    initialData = undefined;
  }

  const handleChange: ChangeHandler = (elements, appState, files) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist(elements, appState, files);
    }, 600);
  };

  const persist: ChangeHandler = async (elements, appState, files) => {
    try {
      const sceneJson = serializeAsJSON(elements, appState, files, "local");
      const svgEl = await exportToSvg({ elements, appState, files });
      onPersist(sceneJson, svgEl.outerHTML);
    } catch {
      // A transient serialize/export failure must never break editing.
    }
  };

  return (
    <div className="exc-canvas">
      <Excalidraw
        initialData={
          initialData as React.ComponentProps<typeof Excalidraw>["initialData"]
        }
        onChange={handleChange}
      />
    </div>
  );
}
