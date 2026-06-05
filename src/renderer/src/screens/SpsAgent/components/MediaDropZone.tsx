// MediaDropZone.tsx — empty-state uploader for media blocks (image/audio/video/
// file). Click or drop a file → write its bytes to the vault asset store →
// hand the stored filename + metadata back to the block. Styling mirrors the
// image drop-zone so it matches the design system.
import { useRef, useState } from "react";
import { writeAssetFromBlob, type WrittenAsset } from "../lib/assets";

interface Props {
  accept: string; // file input accept filter, e.g. "image/*"
  placeholder: string;
  onUpload: (asset: WrittenAsset) => void;
  radius?: number;
}

export function MediaDropZone({
  accept,
  placeholder,
  onUpload,
  radius = 8,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const take = async (file?: File | null): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      const asset = await writeAssetFromBlob(file, file.name);
      if (asset) onUpload(asset);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`image-slot-drop ${over ? "over" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void take(e.dataTransfer.files?.[0]);
      }}
      style={{
        border: "1px dashed var(--hair-strong)",
        borderRadius: radius,
        background: over ? "var(--accent-soft)" : "var(--sunk)",
        color: "var(--tx-3)",
        fontSize: 13,
        padding: "28px 16px",
        textAlign: "center",
        cursor: "pointer",
      }}
    >
      {busy ? "Uploading…" : placeholder}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => void take(e.target.files?.[0])}
      />
    </div>
  );
}
