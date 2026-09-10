/* =========================================================================
   Fetching papers.

   arxiv.org/html/* answers with `access-control-allow-origin: *`, so a
   static site can read papers directly — no proxy, no server, no API key.
   Papers with no HTML version answer 404 *without* CORS headers, which
   surfaces in the browser as a network error rather than a status code;
   both cases land on the same "no HTML version" screen.
   ========================================================================= */

import { arxivUrl } from './arxiv-id.js';

export const PAPER_CACHE = 'arxiv-mobi-papers-v2';
export const ASSET_CACHE = 'arxiv-mobi-assets-v2';
const AUTO_KEEP = 12;          // recent papers kept for instant re-open
const ORDER_KEY = 'arxivmobi:cacheorder:v1';

const hasCaches = typeof caches !== 'undefined';

function order() {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch { return []; }
}
function setOrder(list) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

async function cacheHtml(url, html, slug) {
  if (!hasCaches) return;
  try {
    const cache = await caches.open(PAPER_CACHE);
    await cache.put(url, new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-am-cached': new Date().toISOString() },
    }));
    const list = order().filter((e) => e.slug !== slug);
    list.unshift({ slug, url });
    setOrder(list);
    await prune(list);
  } catch { /* quota or private mode: caching is a bonus, never required */ }
}

async function prune(list) {
  const pinned = pinnedSlugs();
  const keep = [];
  const drop = [];
  let auto = 0;
  for (const entry of list) {
    if (pinned.has(entry.slug) || auto < AUTO_KEEP) {
      if (!pinned.has(entry.slug)) auto++;
      keep.push(entry);
    } else drop.push(entry);
  }
  if (!drop.length) return;
  const cache = await caches.open(PAPER_CACHE);
  for (const entry of drop) await cache.delete(entry.url);
  setOrder(keep);
}

function pinnedSlugs() {
  try {
    const lib = JSON.parse(localStorage.getItem('arxivmobi:library:v1') || '[]');
    return new Set(lib.filter((e) => e.offline).map((e) => e.slug));
  } catch { return new Set(); }
}

async function fromCache(url) {
  if (!hasCaches) return null;
  try {
    const cache = await caches.open(PAPER_CACHE);
    const hit = await cache.match(url);
    return hit ? await hit.text() : null;
  } catch { return null; }
}

/**
 * @param {{id:string,version:string,full:string}} parsed
 * @returns {Promise<{html:string,url:string,fromCache:boolean}>}
 */
export async function loadPaper(parsed) {
  const url = arxivUrl.html(parsed);

  if (!navigator.onLine) {
    const cached = await fromCache(url);
    if (cached) return { html: cached, url, fromCache: true };
    const err = new Error('offline');
    err.code = 'offline';
    throw err;
  }

  let res;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
  } catch (e) {
    const cached = await fromCache(url);
    if (cached) return { html: cached, url, fromCache: true };
    // A blocked/failed cross-origin request looks identical to "no HTML
    // version exists": arXiv's 404 page omits the CORS header.
    const err = new Error('unreachable');
    err.code = 'unreachable';
    throw err;
  }

  if (!res.ok) {
    const cached = await fromCache(url);
    if (cached) return { html: cached, url, fromCache: true };
    const err = new Error('http ' + res.status);
    err.code = res.status === 404 ? 'nohtml' : 'http';
    err.status = res.status;
    throw err;
  }

  const html = await res.text();
  if (!/ltx_document|ltx_page_content/.test(html)) {
    const err = new Error('not a LaTeXML document');
    err.code = 'nohtml';
    throw err;
  }
  cacheHtml(url, html, parsed.full);          // fire and forget
  return { html, url, fromCache: false };
}

/** Pull every figure into the asset cache so the paper reads offline. */
export async function saveOffline(urls, onProgress) {
  if (!hasCaches) throw new Error('no cache storage');
  const cache = await caches.open(ASSET_CACHE);
  let done = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      if (!(await cache.match(url))) {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) await cache.put(url, res.clone());
        else failed++;
      }
    } catch { failed++; }
    done++;
    if (onProgress) onProgress(done, urls.length);
  }
  return { done, failed };
}

/** Forget the cached HTML for one paper, so the next open refetches it. */
export async function forgetPaper(parsed) {
  if (!hasCaches) return;
  try {
    const cache = await caches.open(PAPER_CACHE);
    await cache.delete(arxivUrl.html(parsed));
  } catch { /* ignore */ }
}
