/**
 * Read an image File and produce a small, square, center-cropped data URL
 * suitable for a profile avatar. Keeping it tiny (default 128px) bounds the
 * size of what we persist in profile-meta.json.
 */
export async function fileToAvatarDataUrl(
  file: File,
  size = 128,
): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("decode failed"));
    image.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  // Center-crop to a square, then draw scaled into the canvas.
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  // PNG preserves transparency; fall back to it for all inputs.
  return canvas.toDataURL("image/png");
}
