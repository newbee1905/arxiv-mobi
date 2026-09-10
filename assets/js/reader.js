/* =========================================================================
   The reader: wiring for one paper.
   ========================================================================= */

import { parseArxivId, arxivUrl } from './arxiv-id.js';
import * as prefs from './settings.js';
import { loadPaper, saveOffline, forgetPaper, ASSET_CACHE } from './fetcher.js';
import { buildPaper, imageUrls } from './transform.js';
import { recolor } from './recolor.js';
import { createLightbox } from './lightbox.js';
import { createPeek, createBackChip } from './peek.js';
import { renderToc, trackSections } from './toc.js';
import * as library from './library.js';
import { icon } from './icons.js';
import { registerServiceWorker } from './sw-register.js';

const $ = (id) => document.getElementById(id);
const el = {
  topbar: $('topbar'), barTitle: $('barTitle'), progress: $('progress'),
  main: $('main'), skeleton: $('skeleton'), state: $('state'),
  paper: $('paper'), paperMeta: $('paperMeta'),
  tocDrawer: $('tocDrawer'), tocList: $('tocList'),
  typeSheet: $('typeSheet'), typeBody: $('typeBody'),
  moreSheet: $('moreSheet'), moreList: $('moreList'), moreTitle: $('moreTitle'),
  toast: $('toast'),
  homeBtn: $('homeBtn'), tocBtn: $('tocBtn'), typeBtn: $('typeBtn'),
  themeBtn: $('themeBtn'), moreBtn: $('moreBtn'),
};

let parsed = null;
let paperData = null;     // {article, meta, toc, figures, baseUrl}
let tracker = null;
let lightbox = null;
let peek = null;
let backchip = null;
let assetList = [];

/* ------------------------------ chrome icons ---------------------------- */

el.homeBtn.innerHTML = icon('home');
el.tocBtn.innerHTML = icon('toc');
el.typeBtn.innerHTML = icon('type');
el.moreBtn.innerHTML = icon('more');
for (const b of document.querySelectorAll('[data-close]')) b.innerHTML = icon('close');
function paintThemeBtn() {
  el.themeBtn.innerHTML = icon(prefs.isDarkTheme() ? 'moon' : 'sun');
}
paintThemeBtn();

/* -------------------------------- toast -------------------------------- */

let toastTimer = null;
function toast(message, opts = {}) {
  el.toast.textContent = '';
  el.toast.appendChild(document.createTextNode(message));
  if (opts.label && opts.action) {
    const b = document.createElement('button');
    b.className = 'toast__btn';
    b.type = 'button';
    b.textContent = opts.label;
    b.addEventListener('click', () => { hideToast(); opts.action(); });
    el.toast.appendChild(b);
  }
  el.toast.classList.add('is-open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.ms || 3600);
}
function hideToast() {
  el.toast.classList.remove('is-open');
  clearTimeout(toastTimer);
}

/* ------------------------------ state screens --------------------------- */

function showState({ glyph = 'alert', title, body, actions = [] }) {
  el.skeleton.hidden = true;
  el.paper.hidden = true;
  el.paperMeta.hidden = true;
  el.state.hidden = false;
  el.state.textContent = '';
  const box = document.createElement('div');
  box.className = 'state';
  box.innerHTML =
    `<div class="state__icon">${icon(glyph)}</div>` +
    `<h2></h2><p></p><div class="state__actions"></div>`;
  box.querySelector('h2').textContent = title;
  box.querySelector('p').innerHTML = body;
  const acts = box.querySelector('.state__actions');
  for (const a of actions) {
    const node = document.createElement(a.href ? 'a' : 'button');
    node.className = 'btn' + (a.primary ? ' btn--primary' : '');
    node.textContent = a.label;
    if (a.href) {
      node.href = a.href;
      if (/^https?:/.test(a.href)) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    } else {
      node.type = 'button';
      node.addEventListener('click', a.onClick);
    }
    acts.appendChild(node);
  }
  el.state.appendChild(box);
}

/* ------------------------------- rendering ------------------------------ */

function renderMeta(meta) {
  el.paperMeta.textContent = '';
  const bits = [];
  if (meta.slug) bits.push(`<span class="papermeta__badge">arXiv:${escapeHtml(meta.slug)}</span>`);
  if (meta.primary) bits.push(`<span>${escapeHtml(meta.primary)}</span>`);
  if (meta.submitted) bits.push(`<span>${escapeHtml(meta.submitted)}</span>`);
  bits.push(`<a href="${arxivUrl.abs(parsed)}" target="_blank" rel="noopener noreferrer">abs</a>`);
  bits.push(`<a href="${arxivUrl.pdf(parsed)}" target="_blank" rel="noopener noreferrer">pdf</a>`);
  el.paperMeta.innerHTML = bits.join('');
  el.paperMeta.hidden = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Re-apply colour adaptation for the current theme. */
function applyRecolor(root = el.paper) {
  const p = prefs.get();
  recolor(root, { dark: prefs.isDarkTheme(), enabled: p.recolor });
}

/** Shrink over-wide maths and tables to fit before resorting to scrolling. */
function fitWide() {
  const p = prefs.get();
  for (const box of el.paper.querySelectorAll('.am-scrollbox')) {
    const scroller = box.firstElementChild;
    const inner = scroller && scroller.firstElementChild;
    if (!inner) continue;
    const isEq = box.classList.contains('am-scrollbox--eq');

    // Always measure from the unscaled state.
    if (isEq) box.style.removeProperty('--eq-scale');
    else inner.style.removeProperty('font-size');

    if (isEq ? !p.fitMath : !p.fitTables) continue;
    const avail = scroller.clientWidth;
    if (!avail) continue;
    const need = Math.max(inner.scrollWidth, Math.ceil(inner.getBoundingClientRect().width));
    if (need <= avail + 2) continue;

    const floor = isEq ? 0.62 : 0.58;
    const ratio = Math.max(floor, avail / need);
    if (ratio >= 0.995) continue;
    if (isEq) box.style.setProperty('--eq-scale', ratio.toFixed(3) + 'em');
    else inner.style.fontSize = `calc(var(--table-fs) * ${ratio.toFixed(3)})`;
  }
}

/**
 * Long formulas are the one thing that genuinely cannot be reflowed: a
 * single \(a_1 + … + a_n\) can be 600px wide in a 358px column. Mild
 * overflow is scaled away; anything worse gets its own scroller so the
 * page itself never scrolls sideways.
 */
function fitInlineMath() {
  const limit = el.paper.clientWidth - 2;
  if (limit <= 0) return;
  const pending = [];
  for (const m of el.paper.querySelectorAll('math:not([data-am-fit])')) {
    m.setAttribute('data-am-fit', '');
    if (m.closest('.am-scroll, .am-mathscroll')) continue;
    // A <math> box does not stretch to fit its contents: the row inside it
    // happily overflows, so measure the widest child as well.
    let width = m.getBoundingClientRect().width;
    for (const child of m.children) {
      width = Math.max(width, child.getBoundingClientRect().width);
    }
    if (width > limit) pending.push([m, width]);
  }
  const shrink = prefs.get().fitMath;
  for (const [m, width] of pending) {
    const ratio = limit / width;
    if (shrink && ratio >= 0.72) {
      m.style.fontSize = ratio.toFixed(3) + 'em';
      if (m.getBoundingClientRect().width <= limit) continue;
      m.style.removeProperty('font-size');
    }
    const box = document.createElement('span');
    box.className = 'am-mathscroll' +
      (m.getAttribute('display') === 'block' ? ' am-mathscroll--block' : '');
    m.replaceWith(box);
    box.appendChild(m);
  }
}

/* Elements that are allowed to become their own scroll container. */
const CONTAIN_SELECTOR = [
  '.ltx_p', '.ltx_para', '.ltx_inline-block', '.ltx_parbox', '.ltx_minipage',
  '.ltx_block', '.ltx_framed', '.ltx_theorem', '.ltx_bibitem', '.ltx_item',
  '.ltx_caption', 'figure', 'td', 'th', 'li', 'dd',
].join(',');

/**
 * Safety net for content that still sticks out after the maths and table
 * passes — \rule with a hardcoded point width, verbatim spans that cannot
 * break, rotated boxes. Anything measurably wider than its box becomes a
 * scroller in place, so the document never scrolls sideways.
 */
function containOverflow() {
  for (const node of el.paper.querySelectorAll(CONTAIN_SELECTOR)) {
    if (node.classList.contains('am-contain')) continue;
    if (node.closest('.am-scroll, .am-mathscroll')) continue;
    if (!node.clientWidth) continue;                 // inline box: no overflow of its own
    if (node.scrollWidth - node.clientWidth > 3) node.classList.add('am-contain');
  }
}

/**
 * Undo the measured fixes so the next pass starts from the authored layout.
 * Without this a rotation into landscape, or a smaller text size, would keep
 * formulas shrunken and paragraphs scrollable for the rest of the session.
 */
function resetFits() {
  for (const m of el.paper.querySelectorAll('math[data-am-fit]')) {
    if (m.closest('.am-mathscroll')) continue;       // already has a scroller
    m.style.removeProperty('font-size');
    m.removeAttribute('data-am-fit');
  }
  for (const node of el.paper.querySelectorAll('.am-contain')) {
    node.classList.remove('am-contain');
  }
}

/** Edge fades that say "there is more of this table to the right". */
function watchScrollBoxes() {
  for (const box of el.paper.querySelectorAll('.am-scrollbox')) {
    const scroller = box.firstElementChild;
    if (!scroller || scroller.dataset.amWatched) continue;
    scroller.dataset.amWatched = '1';
    const update = () => {
      const left = scroller.scrollLeft > 2;
      const right = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2;
      box.dataset.edge = [left ? 'left' : '', right ? 'right' : ''].filter(Boolean).join(' ');
    };
    scroller.addEventListener('scroll', update, { passive: true });
    scroller._amUpdateEdges = update;
    update();
  }
}
function refreshEdges() {
  for (const box of el.paper.querySelectorAll('.am-scrollbox')) {
    const s = box.firstElementChild;
    if (s && s._amUpdateEdges) s._amUpdateEdges();
  }
}

function flash(node) {
  node.classList.add('am-flash');
  setTimeout(() => node.classList.remove('am-flash'), 1400);
}

function jumpTo(id) {
  let node = null;
  try { node = el.paper.querySelector('#' + CSS.escape(id)); } catch { /* bad id */ }
  if (!node) return false;
  backchip.show(window.scrollY);
  node.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  flash(node);
  return true;
}

/* ------------------------------- scrolling ------------------------------ */

let lastY = window.scrollY;
let rafQueued = false;
let saveTimer = null;

function onScroll() {
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const frac = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
    el.progress.style.width = (frac * 100).toFixed(2) + '%';

    if (prefs.get().autoHideBar) {
      const dy = y - lastY;
      if (dy > 8 && y > 140) el.topbar.classList.add('is-hidden');
      else if (dy < -8 || y < 80) el.topbar.classList.remove('is-hidden');
    } else {
      el.topbar.classList.remove('is-hidden');
    }
    lastY = y;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePosition(frac), 900);
  });
}

function savePosition(frac) {
  if (!paperData) return;
  const anchor = tracker ? tracker.current() : null;
  library.setProgress(paperData.meta.slug, frac, anchor);
}

/* --------------------------------- sheets ------------------------------- */

function openDialog(dlg) {
  if (!dlg.open) dlg.showModal();
}
for (const dlg of [el.tocDrawer, el.typeSheet, el.moreSheet]) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  const close = dlg.querySelector('[data-close]');
  if (close) close.addEventListener('click', () => dlg.close());
}

function buildMoreSheet() {
  const entry = paperData ? library.find(paperData.meta.slug) : null;
  const offline = entry && entry.offline;
  const items = [
    offline
      ? { glyph: 'check', label: 'Saved for offline', hint: 'Tap to remove the downloaded figures.', act: removeOffline }
      : { glyph: 'download', label: 'Save for offline', hint: `${assetList.length} figure${assetList.length === 1 ? '' : 's'} plus the text.`, act: doSaveOffline },
    { glyph: 'share', label: 'Share this reader link', act: share },
    { glyph: 'copy', label: 'Copy BibTeX', act: copyBibtex },
    { glyph: 'arrowup', label: 'Back to the top', act: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
    { glyph: 'book', label: 'Jump to references', act: jumpToBibliography },
    { glyph: 'refresh', label: 'Reload from arXiv', hint: 'Discard the cached copy and fetch again.', act: hardReload },
    { glyph: 'external', label: 'arXiv abstract page', href: arxivUrl.abs(parsed) },
    { glyph: 'file', label: 'Original PDF', href: arxivUrl.pdf(parsed) },
    { glyph: 'bolt', label: 'Try the ar5iv rendering', hint: 'Community LaTeXML build, useful when arXiv HTML is incomplete.', href: arxivUrl.ar5iv(parsed) },
  ];

  el.moreList.textContent = '';
  for (const it of items) {
    const li = document.createElement('li');
    const node = document.createElement(it.href ? 'a' : 'button');
    if (it.href) {
      node.href = it.href;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    } else {
      node.type = 'button';
      node.addEventListener('click', () => { el.moreSheet.close(); it.act(); });
    }
    node.innerHTML = `${icon(it.glyph)}<span class="actionlist__text">${escapeHtml(it.label)}` +
      `${it.hint ? `<span class="hint">${escapeHtml(it.hint)}</span>` : ''}</span>`;
    li.appendChild(node);
    el.moreList.appendChild(li);
  }
}

/* ------------------------------- actions -------------------------------- */

function share() {
  const url = `${location.origin}${location.pathname}?id=${encodeURIComponent(paperData.meta.slug)}`;
  const title = paperData.meta.title;
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
    return;
  }
  copyText(url, 'Link copied');
}

function copyText(text, okMessage) {
  const done = () => toast(okMessage);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { toast('Could not copy'); }
  ta.remove();
}

function guessYear(meta) {
  const m = /\b(19|20)\d{2}\b/.exec(meta.submitted || '');
  if (m) return m[0];
  if (/^\d{4}\./.test(meta.id)) return '20' + meta.id.slice(0, 2);
  const old = /\/(\d{2})/.exec(meta.id);
  if (old) {
    const yy = Number(old[1]);
    return (yy >= 91 ? '19' : '20') + old[1];
  }
  return '';
}

function bibtex(meta) {
  const year = guessYear(meta);
  const key = `arxiv${meta.id.replace(/[^0-9a-z]/gi, '')}`;
  const authors = meta.authors.length ? meta.authors.join(' and ') : 'Unknown';
  return [
    `@misc{${key},`,
    `  title         = {${meta.title}},`,
    `  author        = {${authors}},`,
    year ? `  year          = {${year}},` : null,
    `  eprint        = {${meta.id}},`,
    `  archivePrefix = {arXiv},`,
    meta.primary ? `  primaryClass  = {${meta.primary}},` : null,
    `  url           = {https://arxiv.org/abs/${meta.slug || meta.id}}`,
    `}`,
  ].filter(Boolean).join('\n');
}

function copyBibtex() {
  copyText(bibtex(paperData.meta), 'BibTeX copied');
}

function jumpToBibliography() {
  const bib = el.paper.querySelector('.ltx_bibliography, #bib');
  if (bib) {
    if (!bib.id) bib.id = 'am-bib';
    jumpTo(bib.id);
  } else toast('This paper has no reference list');
}

async function doSaveOffline() {
  if (!assetList.length) {
    library.setOffline(paperData.meta.slug, true, []);
    toast('Text saved for offline reading');
    return;
  }
  toast(`Downloading ${assetList.length} figures…`, { ms: 2000 });
  try {
    const { failed } = await saveOffline(assetList, (done, total) => {
      if (done === total) return;
      if (done % 8 === 0) toast(`Downloading figures… ${done}/${total}`, { ms: 1500 });
    });
    library.setOffline(paperData.meta.slug, true, assetList);
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'assets-saved', urls: assetList });
    }
    toast(failed ? `Saved, ${failed} figure(s) unavailable` : 'Saved for offline reading');
  } catch {
    toast('Could not save this paper offline');
  }
}

async function removeOffline() {
  library.setOffline(paperData.meta.slug, false);
  try {
    const cache = await caches.open(ASSET_CACHE);
    for (const url of assetList) await cache.delete(url);
  } catch { /* nothing to do */ }
  toast('Offline copy removed');
}

async function hardReload() {
  await forgetPaper(parsed);
  location.reload();
}

/* ------------------------------ boot sequence --------------------------- */

function readIdFromLocation() {
  const params = new URLSearchParams(location.search);
  // `url`/`text` arrive from the PWA share target when an arXiv link is
  // shared into the installed app.
  return params.get('id') || params.get('url') || params.get('text') ||
    params.get('paper') || decodeURIComponent(location.hash.replace(/^#/, ''));
}

async function boot() {
  prefs.apply();
  prefs.watchSystemTheme();
  paintThemeBtn();

  lightbox = createLightbox();
  backchip = createBackChip();
  peek = createPeek({ container: el.paper, onJump: (node) => {
    if (!node.id) node.id = 'am-peek-' + Math.random().toString(36).slice(2, 8);
    jumpTo(node.id);
  } });

  prefs.buildSettingsUI(el.typeBody, { onChange: () => {
    paintThemeBtn();
    applyRecolor();
    resetFits();
    fitWide();
    fitInlineMath();
    containOverflow();
    refreshEdges();
  } });

  el.tocBtn.addEventListener('click', () => openDialog(el.tocDrawer));
  el.typeBtn.addEventListener('click', () => openDialog(el.typeSheet));
  el.moreBtn.addEventListener('click', () => { buildMoreSheet(); openDialog(el.moreSheet); });
  el.themeBtn.addEventListener('click', () => {
    const next = prefs.cycleTheme();
    paintThemeBtn();
    applyRecolor();
    toast(`${next[0].toUpperCase()}${next.slice(1)} theme`, { ms: 1200 });
  });

  document.addEventListener('am:prefs', () => { paintThemeBtn(); });

  const raw = readIdFromLocation();
  parsed = parseArxivId(raw);
  if (!parsed) {
    el.barTitle.textContent = 'arxiv-mobi';
    showState({
      glyph: 'search',
      title: 'No paper selected',
      body: 'Add an arXiv identifier to the address, for example <code>?id=2401.12345</code>.',
      actions: [{ label: 'Open the search page', href: './', primary: true }],
    });
    return;
  }

  el.barTitle.textContent = `arXiv:${parsed.full}`;
  document.title = `${parsed.full} — arxiv-mobi`;

  try {
    const { html, url, fromCache } = await loadPaper(parsed);
    render(html, url, fromCache);
  } catch (err) {
    failure(err);
  }
}

function failure(err) {
  const code = err && err.code;
  const common = [
    { label: 'Read the PDF', href: arxivUrl.pdf(parsed), primary: true },
    { label: 'arXiv abstract page', href: arxivUrl.abs(parsed) },
    { label: 'Try ar5iv instead', href: arxivUrl.ar5iv(parsed) },
    { label: 'Try again', onClick: () => location.reload() },
  ];

  if (code === 'offline') {
    showState({
      glyph: 'cloudoff',
      title: 'You are offline',
      body: `No saved copy of <code>${escapeHtml(parsed.full)}</code> is on this device yet. ` +
            'Papers you open are kept for a while, and anything you explicitly save stays available.',
      actions: [{ label: 'Try again', onClick: () => location.reload(), primary: true },
                { label: 'Back to library', href: './' }],
    });
    return;
  }

  showState({
    glyph: 'alert',
    title: 'No HTML version available',
    body: `arXiv could not serve HTML for <code>${escapeHtml(parsed.full)}</code>. ` +
          'Papers only have HTML when the authors submitted LaTeX source, and the ' +
          'back-catalogue is still being filled in. The PDF always exists.',
    actions: common,
  });
}

function render(html, url, fromCache) {
  let built;
  try {
    built = buildPaper(html, url, parsed);
  } catch {
    failure({ code: 'nohtml' });
    return;
  }
  paperData = built;
  assetList = imageUrls(built.article);

  // Colour adaptation happens before insertion: no flash of white tables.
  applyRecolor(built.article);

  el.paper.textContent = '';
  el.paper.appendChild(built.article);
  el.skeleton.hidden = true;
  el.state.hidden = true;
  el.paper.hidden = false;
  renderMeta(built.meta);

  document.title = `${built.meta.title} — arxiv-mobi`;
  el.barTitle.textContent = built.meta.title;

  if (!('MathMLElement' in window) && built.article.querySelector('math')) {
    replaceMathWithTex(built.article);
    toast('This browser has no MathML support — showing TeX source instead', { ms: 5000 });
  }

  const links = renderToc(el.tocList, built.toc, (entry) => {
    el.tocDrawer.close();
    jumpTo(entry.id);
  });
  tracker = trackSections(built.toc, links, null);

  fitWide();
  fitInlineMath();
  containOverflow();
  watchScrollBoxes();
  wirePaperInteractions();

  const previous = library.find(built.meta.slug);
  library.touch({
    slug: built.meta.slug,
    id: built.meta.id,
    title: built.meta.title,
    authors: built.meta.authors.slice(0, 6),
    primary: built.meta.primary,
  });
  buildMoreSheet();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    savePosition(max > 0 ? window.scrollY / max : 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      savePosition(max > 0 ? window.scrollY / max : 0);
    }
  });

  restorePosition(previous);
  if (fromCache) toast('Loaded the copy saved on this device', { ms: 2200 });

  // Figures and fonts settle after first paint; re-measure then.
  let lastWidth = window.innerWidth;
  const remeasure = debounce(() => {
    resetFits();
    fitWide();
    fitInlineMath();
    containOverflow();
    refreshEdges();
  }, 150);
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    remeasure();
  });
  window.addEventListener('load', remeasure);
  setTimeout(remeasure, 600);
  for (const img of built.article.querySelectorAll('img')) {
    img.addEventListener('load', remeasure, { once: true });
  }
}

/** Last resort for browsers without MathML: show the LaTeX source. */
function replaceMathWithTex(article) {
  for (const math of article.querySelectorAll('math[alttext]')) {
    const tex = math.getAttribute('alttext');
    if (!tex) continue;
    const code = document.createElement('code');
    code.className = 'am-tex';
    code.textContent = math.getAttribute('display') === 'block' ? tex : `\\(${tex}\\)`;
    math.replaceWith(code);
  }
}

function restorePosition(previous) {
  if (!previous || !previous.progress || previous.progress < 0.02 || location.hash) return;
  const go = () => {
    const anchor = previous.anchor && document.getElementById(previous.anchor);
    if (anchor) anchor.scrollIntoView({ block: 'start' });
    else {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.round(previous.progress * max));
    }
    toast(`Resumed at ${Math.round(previous.progress * 100)}%`, {
      label: 'Start over',
      action: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
      ms: 5000,
    });
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
}

function wirePaperInteractions() {
  el.paper.addEventListener('click', (e) => {
    const zoom = e.target.closest('[data-am-zoom]');
    if (zoom) {
      e.preventDefault();
      lightbox.open(paperData.figures, Number(zoom.getAttribute('data-am-zoom')));
      return;
    }
    if (prefs.get().peek && peek.handle(e)) { e.preventDefault(); return; }
    const a = e.target.closest('a[href^="#"]');
    if (a) {
      e.preventDefault();
      jumpTo(decodeURIComponent(a.getAttribute('href').slice(1)));
    }
  });

  el.paper.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const mark = e.target.closest('.ltx_note_mark');
    if (mark) { e.preventDefault(); mark.click(); }
  });

  // Figures cloned into the peek sheet stay zoomable.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.peek__body')) return;
    const zoom = e.target.closest('[data-am-zoom]');
    if (!zoom) return;
    e.preventDefault();
    lightbox.open(paperData.figures, Number(zoom.getAttribute('data-am-zoom')));
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ----------------------------- keyboard keys ---------------------------- */

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
  if (document.querySelector('dialog[open]') && e.key !== 'Escape') return;

  switch (e.key) {
    case 't': openDialog(el.tocDrawer); break;
    case 'a': openDialog(el.typeSheet); break;
    case 'm': buildMoreSheet(); openDialog(el.moreSheet); break;
    case 'd': prefs.cycleTheme(); paintThemeBtn(); applyRecolor(); break;
    case 'j': window.scrollBy({ top: window.innerHeight * 0.25 }); break;
    case 'k': window.scrollBy({ top: -window.innerHeight * 0.25 }); break;
    case 'g': window.scrollTo({ top: 0 }); break;
    case 'G': window.scrollTo({ top: document.documentElement.scrollHeight }); break;
    default: return;
  }
  e.preventDefault();
});

/* ---------------------------- service worker ---------------------------- */

// Mid-paper is the wrong moment to reload out from under someone, so offer
// it instead of taking it.
registerServiceWorker({
  onUpdate: (reload) => toast('A new version of the reader is ready', {
    label: 'Reload', action: reload, ms: 10000,
  }),
});

window.addEventListener('online', () => toast('Back online', { ms: 1500 }));
window.addEventListener('offline', () => toast('Offline — saved papers still work', { ms: 2600 }));

boot();
