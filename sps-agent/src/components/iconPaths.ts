// iconPaths.ts — Lucide-style inline SVG path data (1.5px stroke, 20px grid).
// Ported verbatim from the prototype's icons.jsx.
export const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  inbox:
    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6Z"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  chevDsm: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  star: '<path d="m12 3 2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.5l1.1-6L3.4 9.3l6-.8Z"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  table:
    '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  board:
    '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="14" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  sparkle:
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>',
  sort: '<path d="M7 4v16M7 4 4 7M7 4l3 3M14 7h7M14 12h5M14 17h3"/>',
  text: '<path d="M5 6h14M5 6v2M19 6v2M12 6v13M9 19h6"/>',
  h1: '<path d="M4 6v12M12 6v12M4 12h8"/><path d="M17 9.5 19.5 8v10"/>',
  h2: '<path d="M4 6v12M11 6v12M4 12h7"/><path d="M16 9c0-1 1-1.6 2-1.6s2 .6 2 1.8c0 1.8-4 3-4 5.8h4"/>',
  h3: '<path d="M4 6v12M11 6v12M4 12h7"/><path d="M16 8.5c0-1 1-1.3 2-1.3s2 .5 2 1.5-1 1.4-2 1.4c1 0 2 .5 2 1.6s-1 1.6-2 1.6-2-.4-2-1.3"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>',
  checkbox:
    '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
  bullet: '<circle cx="5" cy="12" r="1.6"/><path d="M10 12h10"/>',
  numlist:
    '<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4 5v4M3 5h1.2M3 9h2"/>',
  quote:
    '<path d="M7 7H4v6h3l-2 4M16 7h-3v6h3l-2 4" transform="scale(0.9) translate(1.5,1)"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
  divider: '<path d="M3 12h18"/>',
  callout:
    '<path d="M12 3a7 7 0 0 0-4 12.7V18h8v-2.3A7 7 0 0 0 12 3Z"/><path d="M9 21h6"/>',
  database:
    '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.6 3.6 3 8 3s8-1.4 8-3v-13M4 12c0 1.6 3.6 3 8 3s8-1.4 8-3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  trash:
    '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  share:
    '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v13M8 7l4-4 4 4"/>',
  comment:
    '<path d="M21 12a8 8 0 0 1-11.3 7.3L4 21l1.7-5.7A8 8 0 1 1 21 12Z"/>',
  panelRight:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  panelLeft:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  pageGraph:
    '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="12" cy="17" r="2.5"/><path d="M8 7l8 1M7 8l4 7M16 9l-3 6"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  flag: '<path d="M5 21V4M5 4h11l-1.5 3L16 10H5"/>',
  wand: '<path d="M15 4V2M15 10V8M19 6h-2M13 6h-2M5 21 16 10l-2-2L3 19Z"/>',
  return: '<path d="M9 10 4 15l5 5"/><path d="M4 15h11a5 5 0 0 0 5-5V5"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;
