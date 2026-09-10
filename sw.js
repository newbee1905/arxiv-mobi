/* =========================================================================
   Service worker: makes the reader installable and lets saved papers open
   with no network at all.

   Three caches:
     shell   — this app's own files
     papers  — arXiv HTML documents (written by the page, read here)
     assets  — figures, so an offline paper is not a wall of broken images
   ========================================================================= */

const VERSION = 'v2';
const SHELL = `arxiv-mobi-shell-${VERSION}`;
const PAPERS = 'arxiv-mobi-papers-v2';
const ASSETS = 'arxiv-mobi-assets-v2';
const KEEP = new Set([SHELL, PAPERS, ASSETS]);

const SHELL_FILES = [
  './',
  'index.html',
  'read.html',
  'manifest.webmanifest',
  'assets/css/base.css',
  'assets/css/reader.css',
  'assets/css/app.css',
  'assets/css/landing.css',
  'assets/js/arxiv-id.js',
  'assets/js/color.js',
  'assets/js/fetcher.js',
  'assets/js/icons.js',
  'assets/js/landing.js',
  'assets/js/library.js',
  'assets/js/lightbox.js',
  'assets/js/peek.js',
  'assets/js/reader.js',
  'assets/js/recolor.js',
  'assets/js/settings.js',
  'assets/js/toc.js',
  'assets/js/transform.js',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(async (file) => {
      const url = new URL(file, self.registration.scope).href;
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch { /* skip */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!KEEP.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

/* Which figures we actually hold. Kept in memory so the fetch handler can
   decide *synchronously* whether to get involved: a figure we have not saved
   is left to the browser entirely, instead of paying for a worker round trip
   on every image in the paper. */
let assetIndex = new Set();
let assetIndexReady = false;
const assetIndexPromise = (async () => {
  try {
    const cache = await caches.open(ASSETS);
    assetIndex = new Set((await cache.keys()).map((req) => req.url));
  } catch { assetIndex = new Set(); }
  assetIndexReady = true;
})();

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'skip-waiting') { self.skipWaiting(); return; }
  // The page saved figures; adopt them without waiting for a worker restart.
  if (data && data.type === 'assets-saved' && Array.isArray(data.urls)) {
    for (const url of data.urls) assetIndex.add(url);
  }
});

const isArxivPaper = (url) => url.hostname.endsWith('arxiv.org') && /^\/html\/[^/]+$/.test(url.pathname);
const isArxivAsset = (url) => url.hostname.endsWith('arxiv.org') && /^\/html\//.test(url.pathname);

/* `caches.match(request, { cacheName })` *rejects* when that cache does not
   exist yet — the normal state on a fresh install — which would turn every
   first request into a failed fetch. Opening the cache creates it. */
async function cachedResponse(cacheName, request) {
  try {
    const cache = await caches.open(cacheName);
    return await cache.match(request);
  } catch {
    return null;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* arXiv paper HTML: fresh when possible, cached copy when not. */
  if (isArxivPaper(url)) {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (err) {
        const hit = await cachedResponse(PAPERS, req);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  /* Figures: a saved copy wins — they never change under a versioned path.
     Nothing is written here; the page stores figures explicitly when the
     reader saves a paper, which is also the only way to get a storable
     (non-opaque) response. */
  if (isArxivAsset(url)) {
    if (assetIndexReady && !assetIndex.has(url.href)) return;   // not ours
    event.respondWith((async () => {
      if (!assetIndexReady) await assetIndexPromise;
      const hit = assetIndex.has(url.href) ? await cachedResponse(ASSETS, req) : null;
      return hit || fetch(req);
    })());
    return;
  }

  /* Our own files: serve from cache, refresh in the background. */
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req, { ignoreSearch: url.pathname.endsWith('read.html') });
      const network = fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) return hit;
      const res = await network;
      if (res) return res;
      const shell = await cache.match(new URL('index.html', self.registration.scope).href);
      if (shell && req.mode === 'navigate') return shell;
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })());
  }
});
