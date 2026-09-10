/* =========================================================================
   Reading preferences: storage, application to the document, and the UI
   that edits them. Every pref resolves to an attribute or custom property
   on <html>, so the stylesheets stay declarative.
   ========================================================================= */

const KEY = 'arxivmobi:prefs:v1';

export const DEFAULTS = {
  theme: 'auto',        // auto | light | sepia | dark | black
  font: 'serif',        // serif | sans
  size: 100,            // % of 17px
  lineHeight: 160,      // % (1.60)
  measure: 42,          // rem, only bites on wide screens
  justify: false,       // off: ragged right, no rivers in a narrow column
  figures: 'plate',     // plate | invert | dim | raw  (dark themes)
  recolor: true,        // remap baked-in light colours for dark themes
  fitMath: true,        // shrink over-wide display maths to fit
  fitTables: true,      // shrink over-wide tables to fit
  zebra: true,
  peek: true,           // tap citations/footnotes for a popover
  autoHideBar: true,
};

let prefs = load();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw);
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (k in saved) out[k] = saved[k];
    return out;
  } catch { return { ...DEFAULTS }; }
}

export function get() { return prefs; }

export function set(patch) {
  prefs = { ...prefs, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  apply();
  return prefs;
}

export function reset() { return set({ ...DEFAULTS }); }

/** 'auto' resolves against the OS preference. */
export function resolvedTheme(p = prefs) {
  if (p.theme !== 'auto') return p.theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark' : 'light';
}

export function isDarkTheme(p = prefs) {
  const t = resolvedTheme(p);
  return t === 'dark' || t === 'black';
}

/** Push prefs onto <html>. Fires `am:prefs` so the reader can react. */
export function apply() {
  const root = document.documentElement;
  const theme = resolvedTheme();
  root.dataset.theme = theme;
  root.dataset.themePref = prefs.theme;
  root.dataset.figures = prefs.figures;
  root.dataset.font = prefs.font;
  root.dataset.justify = prefs.justify ? 'on' : 'off';
  root.dataset.zebra = prefs.zebra ? 'on' : 'off';

  const s = root.style;
  s.setProperty('--reader-font', prefs.font === 'sans' ? 'var(--font-sans)' : 'var(--font-serif)');
  s.setProperty('--reader-fs', (17 * prefs.size / 100).toFixed(2) + 'px');
  s.setProperty('--reader-lh', (prefs.lineHeight / 100).toFixed(2));
  s.setProperty('--reader-measure', prefs.measure + 'rem');
  s.setProperty('--reader-align', prefs.justify ? 'justify' : 'left');
  s.setProperty('--reader-hyphens', prefs.justify ? 'auto' : 'manual');

  // Match the browser UI to the page so the notch area does not flash white.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
  document.dispatchEvent(new CustomEvent('am:prefs', { detail: { prefs, theme } }));
}

/** Keep 'auto' honest when the OS flips mid-session. */
export function watchSystemTheme() {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (prefs.theme === 'auto') apply(); };
  mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
}

/** Cycle themes from the toolbar button: light → sepia → dark → black → … */
export function cycleTheme() {
  const order = ['light', 'sepia', 'dark', 'black'];
  const cur = resolvedTheme();
  const next = order[(order.indexOf(cur) + 1) % order.length];
  set({ theme: next });
  return next;
}

/* ------------------------------ settings UI ----------------------------- */

const THEMES = [
  { id: 'auto', label: 'Auto', chip: 'linear-gradient(100deg,#fff 0 50%,#1c1e20 50% 100%)' },
  { id: 'light', label: 'Light', chip: '#ffffff' },
  { id: 'sepia', label: 'Sepia', chip: '#f6efe0' },
  { id: 'dark', label: 'Dark', chip: '#1c1e20' },
  { id: 'black', label: 'Black', chip: '#000000' },
];

function fieldEl(label, valueText) {
  const f = document.createElement('div');
  f.className = 'field';
  if (label) {
    const l = document.createElement('div');
    l.className = 'field__label';
    l.innerHTML = `<span>${label}</span><span class="field__value">${valueText || ''}</span>`;
    f.appendChild(l);
  }
  return f;
}

function segEl(options, current, onPick) {
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    b.setAttribute('aria-pressed', String(o.id === current));
    b.addEventListener('click', () => {
      for (const sib of seg.children) sib.setAttribute('aria-pressed', String(sib === b));
      onPick(o.id);
    });
    seg.appendChild(b);
  }
  return seg;
}

function rangeEl({ min, max, step, value, label, format, onInput }) {
  const f = fieldEl(label, format(value));
  const out = f.querySelector('.field__value');
  const r = document.createElement('input');
  r.type = 'range';
  Object.assign(r, { min, max, step, value });
  r.setAttribute('aria-label', label);
  r.addEventListener('input', () => {
    const v = Number(r.value);
    out.textContent = format(v);
    onInput(v);
  });
  f.appendChild(r);
  return f;
}

function switchEl(label, hint, value, onChange) {
  const f = document.createElement('div');
  f.className = 'field';
  const row = document.createElement('label');
  row.className = 'switchrow';
  const text = document.createElement('span');
  text.className = 'switchrow__text';
  text.innerHTML = `<span>${label}</span>${hint ? `<span class="switchrow__hint">${hint}</span>` : ''}`;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'switch';
  cb.checked = !!value;
  cb.addEventListener('change', () => onChange(cb.checked));
  row.append(text, cb);
  f.appendChild(row);
  return f;
}

/**
 * Render the typography/appearance controls into `host`.
 * @param {HTMLElement} host
 * @param {{onChange?:Function, showReaderOnly?:boolean}} opts
 */
export function buildSettingsUI(host, opts = {}) {
  const changed = () => opts.onChange && opts.onChange(prefs);
  host.textContent = '';

  /* Theme */
  const themeField = fieldEl('Theme');
  const sw = document.createElement('div');
  sw.className = 'swatches';
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.setAttribute('aria-pressed', String(prefs.theme === t.id));
    b.innerHTML = `<span class="swatch__chip" style="background:${t.chip}"></span><span>${t.label}</span>`;
    b.addEventListener('click', () => {
      for (const sib of sw.children) sib.setAttribute('aria-pressed', String(sib === b));
      set({ theme: t.id });
      changed();
    });
    sw.appendChild(b);
  }
  themeField.appendChild(sw);
  host.appendChild(themeField);

  /* Typeface */
  const fontField = fieldEl('Typeface');
  fontField.appendChild(segEl(
    [{ id: 'serif', label: 'Serif' }, { id: 'sans', label: 'Sans' }],
    prefs.font,
    (v) => { set({ font: v }); changed(); },
  ));
  host.appendChild(fontField);

  /* Text size */
  host.appendChild(rangeEl({
    min: 80, max: 170, step: 5, value: prefs.size, label: 'Text size',
    format: (v) => v + '%',
    onInput: (v) => { set({ size: v }); changed(); },
  }));

  /* Line height */
  host.appendChild(rangeEl({
    min: 125, max: 200, step: 5, value: prefs.lineHeight, label: 'Line spacing',
    format: (v) => (v / 100).toFixed(2),
    onInput: (v) => { set({ lineHeight: v }); changed(); },
  }));

  /* Column width — only meaningful once the screen is wider than the column */
  if (window.matchMedia('(min-width: 48rem)').matches) {
    host.appendChild(rangeEl({
      min: 30, max: 64, step: 1, value: prefs.measure, label: 'Column width',
      format: (v) => v + 'rem',
      onInput: (v) => { set({ measure: v }); changed(); },
    }));
  }

  host.appendChild(switchEl(
    'Justify text',
    'Off by default: a phone column is too narrow for even word spacing.',
    prefs.justify,
    (v) => { set({ justify: v }); changed(); },
  ));

  /* Figure treatment in dark themes */
  const figField = fieldEl('Figures on dark');
  const figHint = document.createElement('div');
  figHint.className = 'switchrow__hint';
  figHint.style.margin = '-2px 0 8px';
  figHint.textContent = 'Most arXiv plots are black line art on transparent backgrounds.';
  figField.appendChild(figHint);
  figField.appendChild(segEl(
    [{ id: 'plate', label: 'Plate' }, { id: 'invert', label: 'Invert' },
     { id: 'dim', label: 'Dim' }, { id: 'raw', label: 'Raw' }],
    prefs.figures,
    (v) => { set({ figures: v }); changed(); },
  ));
  host.appendChild(figField);

  host.appendChild(switchEl(
    'Recolour baked-in colours',
    'Remaps coloured table cells, highlights and code frames for dark themes.',
    prefs.recolor,
    (v) => { set({ recolor: v }); changed(); },
  ));

  if (opts.showReaderOnly !== false) {
    host.appendChild(switchEl('Shrink wide equations', 'Scale display maths down to fit before falling back to sideways scrolling.',
      prefs.fitMath, (v) => { set({ fitMath: v }); changed(); }));
    host.appendChild(switchEl('Shrink wide tables', 'Same treatment for tables that overflow the column.',
      prefs.fitTables, (v) => { set({ fitTables: v }); changed(); }));
    host.appendChild(switchEl('Striped table rows', '', prefs.zebra,
      (v) => { set({ zebra: v }); changed(); }));
    host.appendChild(switchEl('Tap references to peek', 'Show citations, footnotes and figures in place instead of jumping.',
      prefs.peek, (v) => { set({ peek: v }); changed(); }));
    host.appendChild(switchEl('Hide toolbar while reading', '', prefs.autoHideBar,
      (v) => { set({ autoHideBar: v }); changed(); }));
  }

  const resetField = document.createElement('div');
  resetField.className = 'field';
  const rb = document.createElement('button');
  rb.type = 'button';
  rb.className = 'btn btn--block';
  rb.textContent = 'Reset to defaults';
  rb.addEventListener('click', () => { reset(); buildSettingsUI(host, opts); changed(); });
  resetField.appendChild(rb);
  host.appendChild(resetField);
}
