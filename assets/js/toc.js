/* =========================================================================
   Table of contents drawer: built from the paper's real headings, with the
   current section tracked while you scroll.
   ========================================================================= */

export function renderToc(listEl, toc, onPick) {
  listEl.textContent = '';
  if (!toc.length) {
    const p = document.createElement('p');
    p.className = 'toc__empty';
    p.textContent = 'This paper has no section headings.';
    listEl.appendChild(p);
    return new Map();
  }
  const links = new Map();
  for (const entry of toc) {
    const li = document.createElement('li');
    li.dataset.level = String(entry.level);
    const a = document.createElement('a');
    a.href = '#' + entry.id;
    a.innerHTML = entry.num
      ? `<span class="toc__num">${escapeHtml(entry.num)}</span>${escapeHtml(entry.text)}`
      : escapeHtml(entry.text);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onPick(entry);
    });
    li.appendChild(a);
    listEl.appendChild(li);
    links.set(entry.id, a);
  }
  return links;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Highlight whichever section currently owns the top of the viewport.
 * @returns {{destroy:Function, current:Function}}
 */
export function trackSections(toc, links, onChange) {
  const targets = toc
    .map((e) => ({ entry: e, el: document.getElementById(e.id) }))
    .filter((t) => t.el);
  if (!targets.length) return { destroy() {}, current: () => null };

  let active = null;
  let queued = false;

  function measure() {
    queued = false;
    const line = (parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--bar-h')) || 48) + 24;
    let best = targets[0];
    for (const t of targets) {
      const top = t.el.getBoundingClientRect().top;
      if (top - line <= 0) best = t; else break;
    }
    if (!best || best.entry.id === active) return;
    active = best.entry.id;
    for (const [id, a] of links) a.classList.toggle('is-active', id === active);
    if (onChange) onChange(best.entry);
  }

  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  measure();

  return {
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    },
    current: () => active,
    refresh: measure,
  };
}
