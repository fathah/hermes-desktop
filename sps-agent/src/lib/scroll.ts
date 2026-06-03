// scroll.ts — smooth scroll-to helpers, decoupled from React tree via a module
// singleton for the document scroll container. Ported from app.jsx scrollToEl/
// scrollToBlock/scrollToProposal/scrollToAnchor.
let container: HTMLElement | null = null;

export function setScrollContainer(el: HTMLElement | null): void {
  container = el;
}

export function scrollToEl(el: Element | null): void {
  if (el && container) {
    const top =
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      80;
    container.scrollTo({ top, behavior: "smooth" });
  }
}

export function scrollToBlock(blockId: string): void {
  scrollToEl(document.getElementById(`bw-${blockId}`));
}

export function scrollToProposal(proposalId: string): void {
  const el =
    document.getElementById(`grp-${proposalId}`) ||
    document.querySelector(`[data-diff="${proposalId}"]`);
  scrollToEl(el);
}

export function scrollToAnchor(cid: string): void {
  const el = document.querySelector(`[data-cmt="${cid}"]`);
  if (el) scrollToEl(el.closest(".block-wrap") || el);
}
