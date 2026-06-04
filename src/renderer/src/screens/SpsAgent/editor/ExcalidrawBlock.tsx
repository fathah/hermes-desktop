// ExcalidrawBlock.tsx — a freeform drawing block.
//
// The scene is stored as a sidecar asset (assets/<pageId>/<assetId>.excalidraw)
// with a rendered preview SVG beside it; the page markdown only ever carries a
// clean `![](…/<assetId>.excalidraw.svg)` reference (see blockMarkdown.ts), so
// the vault stays Obsidian-friendly and diffable. The heavy Excalidraw editor
// is lazy-loaded only while editing.
//
// `assetId` is stable and lives in the markdown path — NOT in block.id, which is
// regenerated on every markdown round-trip.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { uid } from "../lib/ids";
import { useStore } from "../store";
import type { Block } from "../types";

const ExcalidrawCanvas = lazy(() => import("./ExcalidrawCanvas"));

/** Recover the stable asset id from a `…/<assetId>.excalidraw.svg` path. */
function assetIdFromSrc(src?: string | null): string | null {
  if (!src) return null;
  const m = /([A-Za-z0-9_-]+)\.excalidraw\.svg$/.exec(src);
  return m ? m[1] : null;
}

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

export function ExcalidrawBlock({ block, setType }: Props) {
  const page = useStore((s) => s.page);
  // Mint once; reuse the path-embedded id when the block already has a drawing.
  const assetIdRef = useRef(assetIdFromSrc(block.src) ?? uid("ex"));
  const [editing, setEditing] = useState(!block.src);
  const [scene, setScene] = useState<string | null>(null);
  const [previewSvg, setPreviewSvg] = useState<string | null>(null);
  const [ready, setReady] = useState(!block.src);

  // Load the saved scene + preview from the sidecar (once, when a drawing exists).
  useEffect(() => {
    const assetId = assetIdFromSrc(block.src);
    if (!assetId) {
      setReady(true);
      return;
    }
    let cancelled = false;
    window.hermesAPI
      .spsReadExcalidraw(page, assetId)
      .then((res) => {
        if (cancelled) return;
        setScene(res.scene);
        setPreviewSvg(res.svg);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [block.src, page]);

  const persist = (sceneJson: string, svg: string) => {
    const assetId = assetIdRef.current;
    setScene(sceneJson);
    setPreviewSvg(svg);
    void window.hermesAPI
      .spsWriteExcalidraw(page, assetId, sceneJson, svg)
      .then((ok) => {
        if (!ok) return;
        const src = `assets/${page}/${assetId}.excalidraw.svg`;
        if (block.src !== src) setType(block.id, { src });
      });
  };

  if (editing) {
    return (
      <div className="b-excalidraw editing">
        <Suspense
          fallback={<div className="b-excalidraw-load">Loading canvas…</div>}
        >
          {ready && (
            <ExcalidrawCanvas initialScene={scene} onPersist={persist} />
          )}
        </Suspense>
        <button
          type="button"
          className="b-excalidraw-done"
          onClick={() => setEditing(false)}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div
      className="b-excalidraw"
      onClick={() => setEditing(true)}
      title="Click to edit drawing"
    >
      {previewSvg ? (
        // The preview is the user's own exported drawing (local content).
        <div
          className="b-excalidraw-preview"
          dangerouslySetInnerHTML={{ __html: previewSvg }}
        />
      ) : (
        <div className="b-excalidraw-empty">✎ Click to draw</div>
      )}
    </div>
  );
}
