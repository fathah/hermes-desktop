// html.ts — small HTML helpers ported from the prototype (escapeHtml, stripHtml).
export function escapeHtml(s: string): string {
  return (s || "").replace(
    /[&<>"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

export function stripHtml(h: string): string {
  const d = document.createElement("div");
  d.innerHTML = h || "";
  return d.textContent || "";
}
