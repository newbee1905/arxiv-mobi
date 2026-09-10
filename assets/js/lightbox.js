/* =========================================================================
   Full-screen figure viewer.

   arXiv figures are usually rendered at a few hundred CSS pixels wide —
   unreadable axis labels on a phone. Tapping one opens it here with real
   pinch/double-tap zoom, panning, swipe between figures, and the caption
   kept within reach. Inline SVG figures are serialised to a data URL so
   they zoom like any other image.
   ========================================================================= */

import { icon } from './icons.js';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createLightbox() {
  const dlg = document.createElement('dialog');
  dlg.className = 'lb';
  dlg.setAttribute('aria-label', 'Figure viewer');
  dlg.innerHTML = `
    <div class="lb__bar">
      <button class="iconbtn" data-act="close" aria-label="Close figure">${icon('close')}</button>
      <span class="lb__count"></span>
      <button class="iconbtn" data-act="invert" aria-pressed="false" aria-label="Invert colours">${icon('invert')}</button>
      <a class="iconbtn" data-act="open" target="_blank" rel="noopener noreferrer" aria-label="Open original image">${icon('external')}</a>
    </div>
    <div class="lb__stage">
      <img class="lb__img" alt="">
      <button class="lb__nav lb__nav--prev" aria-label="Previous figure">${icon('left')}</button>
      <button class="lb__nav lb__nav--next" aria-label="Next figure">${icon('right')}</button>
    </div>
    <div class="lb__cap"></div>`;
  document.body.appendChild(dlg);

  const stage = dlg.querySelector('.lb__stage');
  const img = dlg.querySelector('.lb__img');
  const cap = dlg.querySelector('.lb__cap');
  const count = dlg.querySelector('.lb__count');
  const prevBtn = dlg.querySelector('.lb__nav--prev');
  const nextBtn = dlg.querySelector('.lb__nav--next');
  const openLink = dlg.querySelector('[data-act="open"]');
  const invertBtn = dlg.querySelector('[data-act="invert"]');

  let figures = [];
  let idx = 0;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  const pointers = new Map();
  let pinch = null;
  let lastTap = 0;
  let lastTapPt = { x: 0, y: 0 };
  let swipe = null;

  function render() {
    img.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    stage.classList.toggle('is-zoomed', scale > 1.01);
  }

  function bounds() {
    const sr = stage.getBoundingClientRect();
    const bw = img.offsetWidth;
    const bh = img.offsetHeight;
    return {
      x: Math.max(0, (bw * scale - sr.width) / 2),
      y: Math.max(0, (bh * scale - sr.height) / 2),
    };
  }

  function clampPan() {
    const b = bounds();
    tx = clamp(tx, -b.x, b.x);
    ty = clamp(ty, -b.y, b.y);
  }

  /** Zoom to `next` keeping the point `p` (stage-centre-relative) fixed. */
  function zoomTo(next, p = { x: 0, y: 0 }) {
    const s2 = clamp(next, MIN_SCALE, MAX_SCALE);
    const k = s2 / scale;
    tx = p.x - k * (p.x - tx);
    ty = p.y - k * (p.y - ty);
    scale = s2;
    if (scale <= MIN_SCALE + 0.001) { scale = 1; tx = 0; ty = 0; }
    clampPan();
    render();
  }

  function toStageCentre(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  }

  function show(i) {
    if (!figures.length) return;
    idx = (i + figures.length) % figures.length;
    const f = figures[idx];
    scale = 1; tx = 0; ty = 0; render();
    img.src = f.src;
    img.alt = f.captionText || `Figure ${idx + 1}`;
    cap.classList.remove('is-open');
    cap.innerHTML = f.captionHTML || '';
    const hint = document.createElement('div');
    hint.className = 'lb__hint';
    hint.textContent = 'Pinch or double-tap to zoom · swipe for the next figure';
    cap.appendChild(hint);
    count.textContent = figures.length > 1 ? `${idx + 1} / ${figures.length}` : '';
    prevBtn.hidden = nextBtn.hidden = figures.length < 2;
    if (f.href) { openLink.hidden = false; openLink.href = f.href; } else { openLink.hidden = true; }
  }

  function open(list, start = 0) {
    figures = list || [];
    if (!figures.length) return;
    show(start);
    if (!dlg.open) {
      dlg.showModal();
      document.documentElement.style.overflow = 'hidden';
    }
  }

  function close() {
    if (dlg.open) dlg.close();
  }

  dlg.addEventListener('close', () => {
    document.documentElement.style.overflow = '';
    img.removeAttribute('src');
  });

  /* ----------------------------- gestures ------------------------------ */

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.lb__nav')) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale,
        focal: toStageCentre((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
      swipe = null;
      return;
    }

    if (pointers.size === 1) {
      const now = Date.now();
      const near = Math.hypot(e.clientX - lastTapPt.x, e.clientY - lastTapPt.y) < 36;
      if (now - lastTap < 320 && near) {
        // Double tap: jump to a useful magnification at that point.
        zoomTo(scale > 1.2 ? 1 : 2.6, toStageCentre(e.clientX, e.clientY));
        lastTap = 0;
        return;
      }
      lastTap = now;
      lastTapPt = { x: e.clientX, y: e.clientY };
      swipe = { x: e.clientX, y: e.clientY, tx, ty, t: now, moved: 0 };
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      const [a, b] = Array.from(pointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0) {
        const next = pinch.scale * (dist / pinch.dist);
        const k = clamp(next, MIN_SCALE, MAX_SCALE) / scale;
        tx = pinch.focal.x - k * (pinch.focal.x - tx);
        ty = pinch.focal.y - k * (pinch.focal.y - ty);
        scale = clamp(next, MIN_SCALE, MAX_SCALE);
        clampPan();
        render();
      }
      return;
    }

    if (!swipe || pointers.size !== 1) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe.moved = Math.max(swipe.moved, Math.hypot(dx, dy));

    if (scale > 1.01) {
      tx = swipe.tx + dx;
      ty = swipe.ty + dy;
      clampPan();
      render();
    } else {
      // Unzoomed: drag follows the finger a little, to telegraph the swipe.
      img.style.transform = `translate(${dx * 0.35}px, ${Math.max(0, dy) * 0.35}px) scale(1)`;
      img.style.opacity = String(clamp(1 - Math.max(0, dy) / 420, 0.4, 1));
    }
  });

  function endPointer(e) {
    const had = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;

    if (swipe && had && pointers.size === 0 && scale <= 1.01) {
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      img.style.opacity = '';
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        show(idx + (dx < 0 ? 1 : -1));
      } else if (dy > 90) {
        close();
      } else {
        render();
      }
    }
    if (pointers.size === 0) swipe = null;
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY / 320);
    zoomTo(scale * factor, toStageCentre(e.clientX, e.clientY));
  }, { passive: false });

  cap.addEventListener('click', () => cap.classList.toggle('is-open'));
  prevBtn.addEventListener('click', () => show(idx - 1));
  nextBtn.addEventListener('click', () => show(idx + 1));
  dlg.querySelector('[data-act="close"]').addEventListener('click', close);
  invertBtn.addEventListener('click', () => {
    const on = img.classList.toggle('is-inverted');
    invertBtn.setAttribute('aria-pressed', String(on));
  });

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { show(idx + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { show(idx - 1); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { zoomTo(scale * 1.4); e.preventDefault(); }
    else if (e.key === '-') { zoomTo(scale / 1.4); e.preventDefault(); }
    else if (e.key === '0') { zoomTo(1); e.preventDefault(); }
  });

  // Tapping the dark surround closes, as in every native photo viewer.
  stage.addEventListener('click', (e) => {
    if (e.target === stage && scale <= 1.01) close();
  });

  return { open, close, element: dlg, get index() { return idx; } };
}
