/* =========================================================================
   Turn arXiv's LaTeXML HTML into something safe and phone-shaped.

   Order matters: parse into an inert document, strip anything executable
   *there*, rewrite URLs while still inert, only then adopt into the live
   document and restructure. Adopting first would run arXiv's own scripts.
   ========================================================================= */

/* Elements that have no business in a reader. */
const DROP = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'IFRAME', 'FRAME', 'FRAMESET',
  'EMBED', 'APPLET', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA',
  'OPTION', 'DIALOG', 'NOSCRIPT', 'TEMPLATE', 'CANVAS', 'AUDIO', 'VIDEO',
  'SOURCE', 'TRACK', 'SLOT', 'FOREIGNOBJECT',
]);

/* arXiv chrome that sometimes lives inside the article subtree. */
const DROP_SELECTORS = [
  '.ltx_TOC', '.ltx_toclist', '.ltx_page_navbar', '.ltx_page_footer',
  '.ltx_pagination', '.ltx_page_logo', '#infobox', '.arxiv-html-header',
  '.ds-announcement', '.package-alerts', '.extra-services', '.ltx_rdf',
];

const URL_ATTRS = ['src', 'href', 'data', 'poster', 'action', 'formaction', 'srcset', 'background'];
const SAFE_PROTO = /^(https?:|mailto:|data:image\/)/i;

function isSafeUrl(value) {
  if (!value) return false;
  const v = value.trim();
  if (v.startsWith('#')) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return SAFE_PROTO.test(v);
  return true; // relative — resolved below
}

function absolutise(value, base) {
  try { return new URL(value, base).href; } catch { return null; }
}

/**
 * Remove executable content and make every URL absolute and safe.
 * Runs while the node still belongs to the inert parsed document.
 */
function sanitize(root, base) {
  for (const sel of DROP_SELECTORS) {
    for (const el of root.querySelectorAll(sel)) el.remove();
  }

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const doomed = [];
  const nodes = [];
  for (let n = walker.currentNode; n; n = walker.nextNode()) nodes.push(n);

  for (const el of nodes) {
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    // <object type="image/*"> is a figure in disguise; convert, don't drop.
    if (tag === 'OBJECT') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      const data = el.getAttribute('data');
      if (type.startsWith('image/') && data) {
        const img = el.ownerDocument.createElement('img');
        const abs = absolutise(data, base);
        if (abs) {
          img.setAttribute('src', abs);
          for (const a of ['id', 'class', 'style', 'width', 'height']) {
            if (el.hasAttribute(a)) img.setAttribute(a, el.getAttribute(a));
          }
          img.setAttribute('alt', el.textContent.trim() || '');
          el.replaceWith(img);
          continue;
        }
      }
      doomed.push(el);
      continue;
    }
    if (DROP.has(tag)) { doomed.push(el); continue; }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name === 'srcdoc' || name === 'ping') { el.removeAttribute(attr.name); continue; }
      if (name === 'style' && /url\s*\(|expression\s*\(/i.test(attr.value)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'xlink:href' || name === 'href' || URL_ATTRS.includes(name)) {
        if (!isSafeUrl(attr.value)) { el.removeAttribute(attr.name); continue; }
        const v = attr.value.trim();
        if (!v.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(v)) {
          const abs = absolutise(v, base);
          if (abs) el.setAttribute(attr.name, abs);
          else el.removeAttribute(attr.name);
        }
      }
    }
  }
  for (const el of doomed) el.remove();

  // External links leave the reader; internal anchors stay put.
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('#')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return root;
}

/* ------------------------------- metadata ------------------------------- */

function textOf(el) {
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
}

function extractMeta(doc, parsed) {
  const title = textOf(doc.querySelector('h1.ltx_title_document')) ||
    (doc.title || '').replace(/\s*[-–—]\s*arXiv.*$/i, '').trim();

  const authors = [];
  for (const a of doc.querySelectorAll('.ltx_personname')) {
    const name = textOf(a).replace(/[,;]\s*$/, '');
    // Affiliation blobs sometimes land inside personname; keep it plausible.
    if (name && name.length < 90 && !authors.includes(name)) authors.push(name);
  }

  const abstractEl = doc.querySelector('.ltx_abstract');
  const abstract = textOf(abstractEl).replace(/^Abstract\s*/i, '').slice(0, 600);

  // "arXiv:2401.12345v1 [eess.SP] 22 Jan 2024"
  const watermark = textOf(doc.querySelector('#watermark-tr'));
  const wm = /arXiv:(\S+)\s*(?:\[([^\]]+)\])?\s*(.*)$/.exec(watermark) || [];

  return {
    id: parsed.id,
    version: (wm[1] && wm[1].includes('v') ? 'v' + wm[1].split('v').pop() : parsed.version) || '',
    slug: wm[1] || parsed.full,
    title: title || parsed.full,
    authors,
    abstract,
    primary: wm[2] || '',
    submitted: (wm[3] || '').trim(),
  };
}

/* ------------------------------ enhancement ----------------------------- */

function wrapScrollable(el, extraClass) {
  if (!el.parentElement || el.closest('.am-scroll')) return null;
  const box = document.createElement('div');
  box.className = 'am-scrollbox' + (extraClass ? ' ' + extraClass : '');
  const scroller = document.createElement('div');
  scroller.className = 'am-scroll';
  el.replaceWith(box);
  box.appendChild(scroller);
  scroller.appendChild(el);
  return box;
}

function svgToDataUrl(svg) {
  try {
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const markup = new XMLSerializer().serializeToString(clone);
    if (markup.length > 1.5e6) return null;           // too big to be useful
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  } catch { return null; }
}

function captionFor(media) {
  const fig = media.closest('figure');
  let cap = fig && fig.querySelector(':scope > figcaption');
  if (!cap && fig) {
    const outer = fig.parentElement && fig.parentElement.closest('figure');
    cap = outer && outer.querySelector(':scope > figcaption');
  }
  const parts = [];
  if (cap) parts.push(cap.innerHTML);
  const outerFig = fig && fig.parentElement && fig.parentElement.closest('figure');
  const outerCap = outerFig && outerFig.querySelector(':scope > figcaption');
  if (outerCap && outerCap !== cap) parts.push(outerCap.innerHTML);
  return {
    html: parts.join('<br>'),
    text: textOf(cap) || (media.getAttribute('alt') || '').replace(/^Refer to caption$/i, ''),
  };
}

/** Collect zoomable media and give each a plate wrapper. */
function prepareFigures(article) {
  const figures = [];

  const media = article.querySelectorAll(
    'img, svg.ltx_picture, .ltx_picture > svg, figure svg');
  for (const el of media) {
    if (el.closest('.am-figmedia')) continue;
    const isImg = el.tagName.toLowerCase() === 'img';
    const w = Number(el.getAttribute('width') || 0);
    const h = Number(el.getAttribute('height') || 0);
    // Skip decorative slivers (rules drawn as 1px images, inline glyphs).
    const tiny = (w && w < 24) || (h && h < 16);

    const wrap = document.createElement('span');
    wrap.className = 'am-figmedia';
    el.replaceWith(wrap);
    wrap.appendChild(el);

    if (isImg) {
      el.setAttribute('loading', 'lazy');
      el.setAttribute('decoding', 'async');
      if (/^refer to caption$/i.test(el.getAttribute('alt') || '')) {
        const { text } = captionFor(el);
        if (text) el.setAttribute('alt', text);
      }
    }

    if (tiny) continue;
    const src = isImg ? el.getAttribute('src') : svgToDataUrl(el);
    if (!src) continue;

    const cap = captionFor(el);
    const index = figures.length;
    figures.push({
      index,
      src,
      href: isImg ? el.getAttribute('src') : null,
      captionHTML: cap.html,
      captionText: cap.text,
      inline: !isImg,
    });
    el.setAttribute('data-am-zoom', String(index));
    wrap.setAttribute('data-am-zoomable', '');
    if (isImg) el.setAttribute('role', 'button');
  }
  return figures;
}

/** Equation and table scroll boxes, plus table micro-typography. */
function prepareTablesAndMath(article) {
  for (const t of article.querySelectorAll('table.ltx_equation, table.ltx_eqn_table')) {
    if (t.closest('.am-scrollbox')) continue;
    wrapScrollable(t, 'am-scrollbox--eq');
  }

  for (const t of article.querySelectorAll('table.ltx_tabular')) {
    if (t.closest('.am-scrollbox')) continue;
    wrapScrollable(t);
    t.classList.add('am-zebra');

    const rows = t.querySelectorAll('tr');
    rows.forEach((tr, i) => {
      const cells = Array.from(tr.children);
      const filled = cells.filter((c) => textOf(c));
      if (filled.length && filled.every((c) => c.tagName === 'TH')) tr.classList.add('am-headrow');
      for (const c of cells) {
        const len = textOf(c).length;
        // Short cells (numbers, labels) should not be broken across lines;
        // prose cells must be free to wrap or the table never fits.
        if (len && len <= 14 && !c.querySelector('img, svg')) c.classList.add('am-nw');
      }
    });
  }

  // Stray layout tables (no LaTeXML class) still need a scroll box.
  for (const t of article.querySelectorAll('table')) {
    if (!t.closest('.am-scrollbox')) wrapScrollable(t);
  }

  for (const pre of article.querySelectorAll('pre, .ltx_listing')) {
    pre.setAttribute('tabindex', '0');   // scrollable by keyboard
  }
}

/** Footnote marks become tappable controls. */
function prepareNotes(article) {
  for (const note of article.querySelectorAll('.ltx_note')) {
    const mark = note.querySelector('.ltx_note_mark');
    if (!mark) continue;
    note.setAttribute('data-am-note', '');
    mark.setAttribute('role', 'button');
    mark.setAttribute('tabindex', '0');
    mark.setAttribute('aria-label', 'Show note');
  }
}

const HEAD_LEVELS = {
  ltx_title_section: 2,
  ltx_title_appendix: 2,
  ltx_title_bibliography: 2,
  ltx_title_subsection: 3,
  ltx_title_subsubsection: 4,
  ltx_title_paragraph: 5,
};

/** Build the table of contents from real headings, not arXiv's own list. */
function buildToc(article) {
  const toc = [];
  let auto = 0;
  const heads = article.querySelectorAll(
    '.ltx_title_section, .ltx_title_appendix, .ltx_title_bibliography, ' +
    '.ltx_title_subsection, .ltx_title_subsubsection, .ltx_title_paragraph');

  const abstract = article.querySelector('.ltx_abstract');
  if (abstract) {
    if (!abstract.id) abstract.id = 'am-abstract';
    toc.push({ id: abstract.id, num: '', text: 'Abstract', level: 2 });
  }

  for (const h of heads) {
    let level = 3;
    for (const cls of h.classList) if (HEAD_LEVELS[cls]) { level = HEAD_LEVELS[cls]; break; }
    const tag = h.querySelector('.ltx_tag');
    const num = textOf(tag);
    const clone = h.cloneNode(true);
    for (const t of clone.querySelectorAll('.ltx_tag')) t.remove();
    const text = textOf(clone);
    if (!text && !num) continue;

    // Prefer the enclosing section as the jump target: landing on the
    // section start shows the heading plus its first lines.
    const section = h.closest('section, div.ltx_section, div.ltx_subsection, .ltx_appendix, .ltx_bibliography');
    let target = section && section.id ? section : h;
    if (!target.id) target.id = `am-sec-${++auto}`;
    toc.push({ id: target.id, num, text, level });
  }
  return toc;
}

/* ------------------------------ entry point ----------------------------- */

/**
 * @param {string} htmlText raw HTML from arXiv
 * @param {string} baseUrl  URL it came from (for relative asset resolution)
 * @param {{id:string,version:string,full:string}} parsed
 */
export function buildPaper(htmlText, baseUrl, parsed) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const meta = extractMeta(doc, parsed);

  const source = doc.querySelector('article.ltx_document') ||
    doc.querySelector('.ltx_page_content') ||
    doc.body;
  if (!source) throw new Error('no-article');

  sanitize(source, baseUrl);

  // Safe to bring across now: nothing executable survives.
  const article = document.adoptNode(source);
  article.classList.add('am-article');
  if (doc.documentElement.lang) article.setAttribute('lang', doc.documentElement.lang);
  if (article.tagName !== 'ARTICLE') {
    const real = document.createElement('article');
    real.className = 'ltx_document am-article';
    while (article.firstChild) real.appendChild(article.firstChild);
    return finish(real, meta, baseUrl);
  }
  return finish(article, meta, baseUrl);
}

function finish(article, meta, baseUrl) {
  prepareTablesAndMath(article);
  const figures = prepareFigures(article);
  prepareNotes(article);
  const toc = buildToc(article);
  return { article, meta, toc, figures, baseUrl };
}

/** Image URLs worth caching for offline reading. */
export function imageUrls(article) {
  const out = new Set();
  for (const img of article.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (src && /^https?:/i.test(src)) out.add(src);
  }
  return Array.from(out);
}
