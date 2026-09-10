/* =========================================================================
   Reference peeking.

   On a phone, tapping "[17]" normally throws you to the bibliography and
   loses your place; the same for footnotes, figures and equations
   referenced from the text. Here the target is shown in a sheet instead,
   with a "Go to" escape hatch, and any jump you do take leaves a return
   chip behind.
   ========================================================================= */

import { icon } from './icons.js';

const KIND = [
  { test: (el) => el.classList.contains('ltx_bibitem'), label: 'Reference' },
  { test: (el) => el.classList.contains('ltx_note'), label: 'Note' },
  { test: (el) => el.matches('figure.ltx_table, .ltx_table'), label: 'Table' },
  { test: (el) => el.matches('figure, .ltx_figure'), label: 'Figure' },
  { test: (el) => el.matches('table.ltx_equation, table.ltx_eqn_table, .ltx_equation'), label: 'Equation' },
  { test: (el) => el.matches('.ltx_theorem'), label: 'Statement' },
  { test: (el) => el.matches('.ltx_item, li'), label: 'Item' },
];

function classify(el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    for (const k of KIND) {
      try { if (k.test(node)) return { kind: k.label, node }; } catch { /* selector miss */ }
    }
    if (node.classList && node.classList.contains('am-article')) break;
  }
  return null;
}

export function createPeek({ container, onJump }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet peek';
  dlg.innerHTML = `
    <div class="sheet__grip"></div>
    <div class="sheet__head">
      <h2 class="sheet__title"><span class="peek__kind"></span></h2>
      <button class="iconbtn" data-act="close" aria-label="Close">${icon('close')}</button>
    </div>
    <div class="sheet__body">
      <div class="peek__body"></div>
      <div class="peek__foot">
        <button class="btn btn--primary" data-act="jump">Go to it</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  const kindEl = dlg.querySelector('.peek__kind');
  const bodyEl = dlg.querySelector('.peek__body');
  let target = null;

  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act="jump"]').addEventListener('click', () => {
    dlg.close();
    if (target && onJump) onJump(target);
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  function openFor(node, kind) {
    target = node;
    kindEl.textContent = kind;
    bodyEl.textContent = '';
    const clone = node.cloneNode(true);
    clone.removeAttribute('id');
    for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id');
    bodyEl.appendChild(clone);
    if (!dlg.open) dlg.showModal();
  }

  /**
   * @returns {boolean} true when the event was consumed
   */
  function handle(event) {
    const mark = event.target.closest('.ltx_note_mark, [data-am-note]');
    if (mark) {
      const note = mark.closest('.ltx_note');
      const content = note && note.querySelector('.ltx_note_content');
      if (content) { openFor(content, 'Note'); return true; }
    }

    const a = event.target.closest('a[href^="#"]');
    if (!a) return false;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!id) return false;
    let node = null;
    try { node = container.querySelector('#' + CSS.escape(id)); } catch { node = null; }
    if (!node) return false;

    const hit = classify(node);
    // Section-level links are navigation, not a quotation: just go there.
    if (!hit) { if (onJump) onJump(node); return true; }
    openFor(hit.node, hit.kind);
    return true;
  }

  return { handle, close: () => dlg.close(), element: dlg };
}

/** The floating "back to where I was" chip. */
export function createBackChip() {
  const chip = document.createElement('button');
  chip.className = 'backchip';
  chip.type = 'button';
  chip.innerHTML = `${icon('back')}<span>Back</span>`;
  document.body.appendChild(chip);
  let y = null;
  let timer = null;

  chip.addEventListener('click', () => {
    if (y !== null) window.scrollTo({ top: y, behavior: 'smooth' });
    hide();
  });

  function show(fromY) {
    y = fromY;
    chip.classList.add('is-open');
    clearTimeout(timer);
    timer = setTimeout(hide, 14000);
  }
  function hide() {
    chip.classList.remove('is-open');
    clearTimeout(timer);
  }
  return { show, hide };
}
