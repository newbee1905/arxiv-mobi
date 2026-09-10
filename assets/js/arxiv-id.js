/* =========================================================================
   arXiv identifier parsing.
   Accepts anything a reader is likely to have in the clipboard: a bare id,
   an abs/pdf/html URL, an ar5iv URL, a DOI, or "arXiv:2401.12345v2".
   ========================================================================= */

// 2401.12345 / 2401.12345v3  (April 2007 onwards)
const RE_NEW = /\b(\d{4}\.\d{4,5})(v\d+)?\b/;
// hep-th/9711200, math.AG/0601001 (pre-2007 archive/number form)
const RE_OLD = /\b([a-z][a-z-]{1,}(?:\.[A-Za-z]{2})?\/\d{7})(v\d+)?\b/;

/**
 * @param {string} input
 * @returns {{id:string, version:string, full:string, legacy:boolean}|null}
 */
export function parseArxivId(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;

  // Unwrap a URL so query strings and fragments cannot confuse the match.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = decodeURIComponent(u.pathname) + (u.search ? ' ' + u.search : '');
    } catch { /* fall through and scan the raw string */ }
  }

  s = s
    .replace(/^arxiv:/i, '')
    .replace(/\b10\.48550\/arxiv\./i, '')   // DOI form
    .replace(/\.pdf$/i, '')
    .replace(/[)\]>,;]+$/, '');

  const m = RE_NEW.exec(s) || RE_OLD.exec(s);
  if (!m) return null;

  const id = m[1];
  const version = m[2] ? m[2].toLowerCase() : '';
  return { id, version, full: id + version, legacy: id.includes('/') };
}

export const arxivUrl = {
  html: (p) => `https://arxiv.org/html/${p.full}`,
  abs: (p) => `https://arxiv.org/abs/${p.full}`,
  pdf: (p) => `https://arxiv.org/pdf/${p.full}`,
  ar5iv: (p) => `https://ar5iv.labs.arxiv.org/html/${p.full}`,
};

/** Reader URL on this site, relative so it works under any Pages base path. */
export function readerHref(parsed, base = '') {
  return `${base}read.html?id=${encodeURIComponent(parsed.full)}`;
}
