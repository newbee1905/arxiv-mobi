/* =========================================================================
   Colour utilities + the dark/tinted-theme adaptation model.

   Why this exists: LaTeXML bakes literal colours into inline styles
   (\rowcolor, \cellcolor, \textcolor, listing frames) as either
   `background-color:#F2F2F2` or the newer `--ltx-bg-color:#F2F2F2`. Pass
   those through unchanged on a dark page and tables turn into white slabs
   with black text — the exact problem this project exists to fix.

   Naive `filter: invert()` is not an option: it wrecks photographs, flips
   hues, and cannot reason about contrast. Instead each colour is mapped in
   HSL while preserving hue, re-anchored against the *current theme's*
   background and text lightness, then nudged until it clears a WCAG
   contrast floor.
   ========================================================================= */

const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0],
  lime: [0, 255, 0], green: [0, 128, 0], blue: [0, 0, 255],
  yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255],
  magenta: [255, 0, 255], fuchsia: [255, 0, 255], silver: [192, 192, 192],
  gray: [128, 128, 128], grey: [128, 128, 128], maroon: [128, 0, 0],
  olive: [128, 128, 0], navy: [0, 0, 128], teal: [0, 128, 128],
  purple: [128, 0, 128], orange: [255, 165, 0], pink: [255, 192, 203],
  brown: [165, 42, 42], gold: [255, 215, 0], beige: [245, 245, 220],
  ivory: [255, 255, 240], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169],
  whitesmoke: [245, 245, 245], lightblue: [173, 216, 230],
  lightgreen: [144, 238, 144], lightyellow: [255, 255, 224],
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Parse a CSS colour into {r,g,b,a} (0-255, a 0-1) or null if unsupported. */
export function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'none' || s === 'inherit' ||
      s === 'currentcolor' || s === 'initial' || s === 'unset' ||
      s.startsWith('var(') || s.startsWith('url(')) return null;

  if (s[0] === '#') {
    const hex = s.slice(1);
    const ok = /^[0-9a-f]+$/.test(hex);
    if (!ok) return null;
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split('').map((c) => parseInt(c + c, 16));
      return { r, g, b, a: hex.length === 4 ? a / 255 : 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i) => parseInt(hex.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
    }
    return null;
  }

  const fn = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(s);
  if (fn) {
    const parts = fn[2].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const num = (t) => (t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t));
    const alpha = parts[3] !== undefined ? clamp(num(parts[3]), 0, 1) : 1;
    if (fn[1].startsWith('rgb')) {
      const v = parts.slice(0, 3).map((t) =>
        t.endsWith('%') ? Math.round(parseFloat(t) * 2.55) : Math.round(parseFloat(t)));
      if (v.some(Number.isNaN)) return null;
      return { r: clamp(v[0], 0, 255), g: clamp(v[1], 0, 255), b: clamp(v[2], 0, 255), a: alpha };
    }
    const h = parseFloat(parts[0]);
    const sa = num(parts[1]);
    const l = num(parts[2]);
    if ([h, sa, l].some(Number.isNaN)) return null;
    const rgb = hslToRgb(h, sa, l);
    return { ...rgb, a: alpha };
  }

  if (NAMED[s]) {
    const [r, g, b] = NAMED[s];
    return { r, g, b, a: 1 };
  }
  return null;
}

export function rgbToHsl({ r, g, b }) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0));
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

const lin = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance, 0..1. */
export function luminance({ r, g, b }) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours, 1..21. */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function toCss({ r, g, b, a = 1 }) {
  return a >= 0.999
    ? `rgb(${r} ${g} ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

/**
 * Build the adaptation context for a theme from its resolved colours.
 * @param {string} bgCss   resolved --bg
 * @param {string} textCss resolved --text
 * @param {'dark'|'tint'} mode
 */
export function makeContext(bgCss, textCss, mode) {
  const bg = parseColor(bgCss) || { r: 255, g: 255, b: 255, a: 1 };
  const text = parseColor(textCss) || { r: 0, g: 0, b: 0, a: 1 };
  return { mode, bg, text, bgL: rgbToHsl(bg).l, textL: rgbToHsl(text).l };
}

/**
 * Map one authored colour to something that belongs on the current theme.
 * @param {{r:number,g:number,b:number,a:number}} c
 * @param {'bg'|'fg'|'border'} role
 * @param ctx from makeContext
 * @returns {string|null} CSS colour, or null to leave the original alone
 */
export function adapt(c, role, ctx) {
  const { h, s, l } = rgbToHsl(c);
  const lum = luminance(c);

  if (ctx.mode === 'tint') {
    // Light themes (sepia): only neutralise near-white fills so they stop
    // punching holes in the tinted page. Everything else is already fine.
    if (role === 'bg' && lum > 0.80 && s < 0.12) {
      const nl = ctx.bgL - (1 - l) * 0.35;
      return toCss({ ...hslToRgb(rgbToHsl(ctx.bg).h, rgbToHsl(ctx.bg).s, clamp(nl, 0, 1)), a: c.a });
    }
    return null;
  }

  // HSL saturation is misleading for pale tints (#ffe4e1 reads as s=1.0),
  // so decide "is this actually colourful" on chroma instead.
  const chroma = s * (1 - Math.abs(2 * l - 1));

  // ---- dark themes -----------------------------------------------------
  if (role === 'bg') {
    // Already dark enough to sit on a dark page: leave the author's choice.
    if (lum <= 0.20) return null;
    const delta = 1 - l;                 // how far below white it started
    const lift = delta > 0.01 ? Math.max(0.035, delta * 0.55) : 0;
    const nl = clamp(ctx.bgL + lift, 0, 0.45);
    const ns = chroma < 0.06 ? clamp(chroma, 0, 0.04) : clamp(chroma * 1.4, 0.08, 0.30);
    return toCss({ ...hslToRgb(h, ns, nl), a: c.a });
  }

  if (role === 'border') {
    if (lum <= 0.10) {
      // Pure-black rules vanish on dark: lift them to a visible line.
      return toCss({ ...hslToRgb(h, chroma < 0.06 ? 0 : clamp(chroma, 0, 0.3), ctx.bgL + 0.16), a: c.a });
    }
    if (lum > 0.5) {
      const nl = clamp(ctx.bgL + Math.max(0.10, (1 - l) * 0.5), 0.14, 0.45);
      const ns = chroma < 0.06 ? 0.03 : clamp(chroma * 1.2, 0.08, 0.32);
      return toCss({ ...hslToRgb(h, ns, nl), a: c.a });
    }
    return null;
  }

  // role === 'fg'
  // Light ink was authored for a coloured ground; keep it light.
  if (lum >= 0.45) return null;

  let nl = clamp(ctx.textL - 0.30 * l, 0.45, 0.95);
  let ns = s < 0.08 ? clamp(s, 0, 0.04) : clamp(s * 0.62, 0.18, 0.58);
  let out = hslToRgb(h, ns, nl);
  // Guarantee body-text legibility against the page, not just "lighter".
  let guard = 0;
  while (contrast(out, ctx.bg) < 4.5 && nl < 0.97 && guard++ < 24) {
    nl += 0.03;
    out = hslToRgb(h, ns, nl);
  }
  return toCss({ ...out, a: c.a });
}
