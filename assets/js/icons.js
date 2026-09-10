/* Inline SVG icons (stroke-based, inherit currentColor). */
const P = {
  toc: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  type: '<path d="M4 19l5.5-14h1L16 19M6.3 14h7.4"/><path d="M17.5 19l2.8-7h.6l2.6 7" transform="translate(-2 0) scale(0.82) translate(3 3)"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
  more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M14.5 5L7.5 12l7 7"/>',
  right: '<path d="M9.5 5l7 7-7 7"/>',
  up: '<path d="M5 14l7-7 7 7"/>',
  back: '<path d="M9 14l-5-4 5-4"/><path d="M4 10h9a6 6 0 010 12h-4"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 11.5L12 16l4.5-4.5"/><path d="M4 19h16"/>',
  cloudoff: '<path d="M3 3l18 18"/><path d="M7.5 18h9.8a3.7 3.7 0 00.9-7.3A6 6 0 009 7.3"/><path d="M5.5 9.2A3.9 3.9 0 007.2 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9L18 7"/>',
  share: '<path d="M12 3v11"/><path d="M8 6.5L12 3l4 3.5"/><path d="M5 12v8h14v-8"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14.5V19H5V6h4.5"/>',
  file: '<path d="M13 3H6v18h12V8z"/><path d="M13 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  invert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 000 17z" fill="currentColor" stroke="none"/>',
  copy: '<path d="M9 9V5h10v10h-4"/><path d="M5 9h10v10H5z"/>',
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 014 18.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 001.5-1.5z"/>',
  alert: '<path d="M12 4.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.3v.2"/>',
  image: '<path d="M4 5h16v14H4z"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4 3.5 3L16 12l4 4"/>',
  refresh: '<path d="M20 12a8 8 0 10-2.6 5.9"/><path d="M20 5v5h-5"/>',
  bolt: '<path d="M13 3l-7 10h5l-1 8 7-10h-5z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  arrowup: '<path d="M12 20V5"/><path d="M6 11l6-6 6 6"/>',
};

export function icon(name, extra = '') {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${P[name] || ''}</svg>`;
}
