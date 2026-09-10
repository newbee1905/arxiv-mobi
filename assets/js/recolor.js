/* =========================================================================
   Re-colour the colours LaTeXML baked into the paper.

   LaTeXML emits author colour choices as inline styles — either legacy
   declarations (`background-color:#F2F2F2`) or, in current output, custom
   properties (`--ltx-bg-color`, `--ltx-fg-color`, `--ltx-border-color`,
   `--ltx-fill-color`). reader.css wires those properties up to real
   declarations; this module rewrites their *values* so they belong to the
   active theme. Originals are stashed on the element, so switching theme
   back restores the paper exactly.
   ========================================================================= */

import { parseColor, adapt, makeContext } from './color.js';

/* Which declarations matter, and what each one is for. */
const ROLES = {
  'background-color': 'bg',
  'background': 'bg',
  '--ltx-bg-color': 'bg',
  'color': 'fg',
  '--ltx-fg-color': 'fg',
  '--ltx-fill-color': 'fg',
  'border-color': 'border',
  'border-top-color': 'border',
  'border-right-color': 'border',
  'border-bottom-color': 'border',
  'border-left-color': 'border',
  '--ltx-border-color': 'border',
};
const PROPS = Object.keys(ROLES);

const STASH = 'amColorOrig';

function readDecls(el) {
  const out = [];
  const style = el.style;
  // Custom properties are enumerable on CSSStyleDeclaration in every engine
  // we target, but fall back to explicit lookups so nothing is missed.
  const seen = new Set();
  for (let i = 0; i < style.length; i++) {
    const prop = style.item(i);
    if (prop in ROLES) { out.push(prop); seen.add(prop); }
  }
  for (const prop of PROPS) {
    if (seen.has(prop)) continue;
    if (style.getPropertyValue(prop)) out.push(prop);
  }
  return out;
}

/**
 * @param {Element} root container holding the imported paper
 * @param {{dark:boolean, enabled:boolean}} opts
 */
export function recolor(root, opts) {
  if (!root) return 0;
  const cs = getComputedStyle(document.documentElement);
  const ctx = makeContext(
    cs.getPropertyValue('--bg'),
    cs.getPropertyValue('--text'),
    opts.dark ? 'dark' : 'tint',
  );

  let touched = 0;
  const nodes = root.querySelectorAll('[style]');
  for (const el of nodes) {
    // Inline SVG figures are drawings, not prose: re-tinting individual
    // fills would corrupt plots. The figure plate/invert treatment in
    // reader.css handles those instead.
    if (el.closest('svg')) continue;

    let orig = null;
    if (STASH in el.dataset) {
      try { orig = JSON.parse(el.dataset[STASH]); } catch { orig = null; }
    }
    if (!orig) {
      const props = readDecls(el);
      if (!props.length) continue;
      orig = {};
      for (const p of props) orig[p] = el.style.getPropertyValue(p);
      el.dataset[STASH] = JSON.stringify(orig);
    }

    for (const [prop, value] of Object.entries(orig)) {
      if (!opts.enabled) { el.style.setProperty(prop, value); continue; }
      const c = parseColor(value);
      if (!c) continue;
      const mapped = adapt(c, ROLES[prop], ctx);
      el.style.setProperty(prop, mapped || value);
      if (mapped) touched++;
    }
  }
  return touched;
}
