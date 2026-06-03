// ImageSlot.tsx — click/drop/paste image uploader. React port of the prototype's
// <image-slot> custom element (image-slot.js), reduced to the behaviour the editor
// uses: empty drop-zone → pick/drop a file → render it. Value is a data URL stored
// on the block, so images persist with the document.
import { useRef, useState } from "react";

interface Props {
  value: string | null | undefined;
  onChange: (dataUrl: string) => void;
  shape?: "rounded" | "rect";
  radius?: number;
  placeholder?: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function ImageSlot({
  value,
  onChange,
  shape = "rounded",
  radius = 8,
  placeholder = "Drop an image, or click to upload",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = async (file?: File | null) => {
    if (file && file.type.startsWith("image/"))
      onChange(await fileToDataUrl(file));
  };

  if (value) {
    return (
      <img
        className="image-slot-img"
        src={value}
        alt=""
        style={{
          display: "block",
          maxWidth: "100%",
          borderRadius: shape === "rounded" ? radius : 0,
        }}
      />
    );
  }

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
        borderRadius: shape === "rounded" ? radius : 0,
        background: over ? "var(--accent-soft)" : "var(--sunk)",
        color: "var(--tx-3)",
        fontSize: 13,
        padding: "28px 16px",
        textAlign: "center",
        cursor: "pointer",
      }}
    >
      {placeholder}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void take(e.target.files?.[0])}
      />
    </div>
  );
}
