/* =========================================================================
   Headless smoke test for the reader, at phone size.

   Runs real arXiv HTML through the full pipeline and asserts the things
   this project exists to guarantee: nothing overflows the viewport, table
   colours are theme-correct with real contrast, equations fit, figures
   zoom, citations peek.

   Fixtures are served from disk by request interception, so the test is
   deterministic and needs no network:

       mkdir -p /tmp/am-fixtures
       curl -sS https://arxiv.org/html/1706.03762 -o /tmp/am-fixtures/1706.03762.html
       python3 -m http.server 8099 &
       node tools/smoke.mjs --fixtures /tmp/am-fixtures 1706.03762

   Options: --site <url> (default http://127.0.0.1:8099), --live (no
   interception), --shots <dir>, --chromium <path>.
   ========================================================================= */

import { chromium, devices } from 'playwright';
import { readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes('--' + name);
const ids = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const SITE = opt('site', 'http://127.0.0.1:8099');
const FIXTURES = opt('fixtures', null);
const SHOTS = opt('shots', null);
const LIVE = flag('live');
const EXEC = opt('chromium', process.env.CHROMIUM_PATH ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');

const PLACEHOLDER_PNG = await readFile(new URL('../assets/icons/icon-512.png', import.meta.url));
const PLACEHOLDER_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">' +
  '<rect width="160" height="120" fill="#fff"/><polyline fill="none" stroke="#000" ' +
  'points="10,110 40,60 70,80 100,25 150,45"/></svg>');

let failures = 0;
let checks = 0;
function check(ok, name, detail) {
  checks++;
  if (ok) { console.log(`  ✓ ${name}`); return true; }
  failures++;
  console.log(`  ✗ ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`);
  return false;
}

async function fixtureIds() {
  if (ids.length) return ids;
  if (!FIXTURES) return ['1706.03762'];
  const files = await readdir(FIXTURES);
  return files.filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));
}

const browser = await chromium.launch({
  executablePath: EXEC,
  args: process.env.HTTPS_PROXY && LIVE
    ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=127.0.0.1;localhost']
    : [],
});

const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  serviceWorkers: 'block',
  // Smooth scrolling races every scripted scroll in a test run.
  reducedMotion: 'reduce',
});

/* Real arXiv answers with `access-control-allow-origin: *`; the fixtures
   must too, or the whole cross-origin premise is not being tested. */
const CORS = { 'access-control-allow-origin': '*' };

let simulateOffline = false;

/** Serve arXiv from local fixtures so runs are deterministic and offline. */
async function installRoutes(context) {
  if (LIVE) return;
  await context.route(/^https?:\/\/([a-z0-9.-]+\.)?arxiv\.org\//i, async (route) => {
    if (simulateOffline) return route.abort('internetdisconnected');
    const url = new URL(route.request().url());
    const m = /^\/html\/(.+)$/.exec(url.pathname);
    if (!m) return route.fulfill({ status: 404, body: 'no fixture' });
    const rest = m[1];
    if (/\.(png|jpe?g|gif|webp)$/i.test(rest)) {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: PLACEHOLDER_PNG });
    }
    if (/\.svg$/i.test(rest)) {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: PLACEHOLDER_SVG });
    }
    const id = rest.replace(/\/$/, '');
    for (const candidate of [id, id.replace(/v\d+$/, '')]) {
      try {
        const body = await readFile(path.join(FIXTURES || '.', candidate + '.html'));
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: CORS, body });
      } catch { /* try next */ }
    }
    return route.fulfill({ status: 404, body: 'missing fixture for ' + id });
  });
}
await installRoutes(ctx);

const LUM = `(function(){
  window.__lum = function (css) {
    const m = /rgba?\\(([^)]+)\\)/.exec(css);
    if (!m) return null;
    const [r, g, b, a] = m[1].split(/[\\s,\\/]+/).map(Number);
    if (a === 0) return null;
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  window.__contrast = function (a, b) {
    const la = window.__lum(a), lb = window.__lum(b);
    if (la === null || lb === null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
}())`;

async function openPaper(page, id) {
  const errors = [];
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`${SITE}/read.html?id=${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#paper .am-article, #state:not([hidden]) .state', { timeout: 40000 });
  await page.waitForTimeout(1200);
  await page.evaluate(LUM);
  return errors;
}

for (const id of await fixtureIds()) {
  console.log(`\n=== ${id} ===`);
  const page = await ctx.newPage();
  await page.goto(SITE + '/read.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  const errors = await openPaper(page, id);

  if (await page.$('#state:not([hidden]) .state')) {
    check(false, 'paper rendered', await page.$eval('#state h2', (h) => h.textContent));
    await page.close();
    continue;
  }

  /* ---- structure ---- */
  const base = await page.evaluate(() => {
    const paper = document.getElementById('paper');
    return {
      paras: paper.querySelectorAll('.ltx_p').length,
      toc: document.querySelectorAll('#tocList a').length,
      figures: paper.querySelectorAll('[data-am-zoom]').length,
      tables: paper.querySelectorAll('table.ltx_tabular').length,
      wrappedTables: paper.querySelectorAll('.am-scroll table.ltx_tabular').length,
      eqBoxes: paper.querySelectorAll('.am-scrollbox--eq').length,
      scaledEq: [...paper.querySelectorAll('.am-scrollbox--eq')]
        .filter((b) => b.style.getPropertyValue('--eq-scale')).length,
      scripts: paper.querySelectorAll('script, iframe, object, form').length,
      align: getComputedStyle([...paper.querySelectorAll('.ltx_para > .ltx_p')]
        .find((p) => !p.closest('.ltx_centering, figure, .ltx_abstract') && !p.classList.contains('ltx_align_center')) || paper).textAlign,
      fontSize: parseFloat(getComputedStyle(paper).fontSize),
      notes: paper.querySelectorAll('[data-am-note]').length,
    };
  });
  check(errors.length === 0, 'no page errors', errors.slice(0, 4));
  check(base.paras > 20, 'paragraphs rendered', base.paras);
  check(base.toc > 0, 'table of contents built', base.toc);
  check(base.scripts === 0, 'no executable nodes survived sanitising', base.scripts);
  check(base.tables === base.wrappedTables, 'every table is in a scroll box', base);
  check(base.align === 'left' || base.align === 'start', 'prose is not justified', base.align);
  check(base.fontSize <= 18, 'reader font size is phone-sized', base.fontSize);

  /* ---- tables actually appear ----
     A \resizebox'd table carries a transform sized for the paper's page
     width. Left in place it drags the table out of its own box and off the
     side of the screen: the caption renders and the table does not. The
     invariant is simply that a table sits inside the figure that holds it. */
  const tables = await page.evaluate(() => {
    const paper = document.getElementById('paper');
    const all = [...paper.querySelectorAll('table.ltx_tabular')];
    const bad = [];
    for (const t of all) {
      const box = t.closest('figure, .ltx_table') || t.parentElement;
      if (!box) continue;
      const r = t.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const escapedLeft = r.left < b.left - 8;
      const tallerThanItsBox = r.height > b.height + 8;
      // A one-cell layout table holding a rule is legitimately narrow;
      // only a genuinely zero-area box means nothing rendered.
      const collapsed = r.width < 6 || r.height < 6;
      if (escapedLeft || tallerThanItsBox || collapsed) {
        bad.push({
          id: t.id,
          table: [Math.round(r.left), Math.round(r.width), Math.round(r.height)],
          box: [Math.round(b.left), Math.round(b.width), Math.round(b.height)],
          reason: escapedLeft ? 'dragged outside its figure'
            : tallerThanItsBox ? 'overflows its figure' : 'collapsed',
        });
      }
    }
    return { total: all.length, bad: bad.slice(0, 3) };
  });
  check(tables.bad.length === 0, 'every table sits inside its own figure', tables);

  const scaleBoxes = await page.evaluate(() =>
    [...document.querySelectorAll('#paper .ltx_transformed_inner')]
      .filter((el) => /scale|translate/i.test(el.style.transform || '') &&
        el.querySelector('table, .ltx_tabular')).length);
  check(scaleBoxes === 0, 'no \\resizebox transform is left on a table', scaleBoxes);

  /* ---- nothing escapes the viewport ---- */
  const overflow = await page.evaluate(() => {
    const paper = document.getElementById('paper');
    const out = [];
    const vw = document.documentElement.clientWidth;
    const outside = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('#paper')) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > window.document.documentElement.clientWidth + 2) {
        outside.push(`${el.tagName.toLowerCase()}#${el.id}.${String(el.className).split(' ')[0]} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
    }
    for (const el of paper.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (el.closest('.am-scroll, .am-mathscroll, .am-contain, .ltx_picture, pre, .ltx_listing')) continue;
      if (r.right > vw + 2 || r.left < -2) {
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}` +
          ` [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
    }
    return {
      docWidth: document.documentElement.scrollWidth,
      // innerWidth follows the *visual* viewport, which Chromium's mobile
      // emulation widens when content overflows — that would hide exactly
      // the bug we are looking for. clientWidth is the layout viewport.
      clientWidth: document.documentElement.clientWidth,
      vw,
      offenders: out.slice(0, 6),
      chrome: outside.slice(0, 5),
    };
  });
  check(overflow.docWidth <= overflow.clientWidth + 1, 'document does not scroll sideways', overflow);
  check(overflow.clientWidth === 390, 'layout viewport is the phone width', overflow.clientWidth);
  check(overflow.offenders.length === 0, 'no element overflows the column', overflow.offenders);

  /* ---- rotation: the fitting passes have to run again ---- */
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(900);
  const landscape = await page.evaluate(() => ({
    docWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(landscape.docWidth <= landscape.clientWidth + 1, 'landscape does not scroll sideways', landscape);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.waitForTimeout(900);
  const backToPortrait = await page.evaluate(() => ({
    docWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(backToPortrait.docWidth <= backToPortrait.clientWidth + 1,
    'and neither does rotating back', backToPortrait);

  /* ---- dark theme: the whole point ---- */
  await page.evaluate(() => {
    const prefs = { theme: 'dark' };
    localStorage.setItem('arxivmobi:prefs:v1', JSON.stringify(prefs));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#paper .am-article', { timeout: 40000 });
  await page.waitForTimeout(1200);
  await page.evaluate(LUM);

  const dark = await page.evaluate(() => {
    const paper = document.getElementById('paper');
    const pageBg = getComputedStyle(document.body).backgroundColor;
    const worst = { lum: -1, css: null, tag: null };
    let lowContrast = [];
    const cells = paper.querySelectorAll('td, th, .ltx_listing, .ltx_theorem, .ltx_abstract');
    for (const c of cells) {
      const cs = getComputedStyle(c);
      const l = window.__lum(cs.backgroundColor);
      if (l !== null && l > worst.lum) {
        worst.lum = l; worst.css = cs.backgroundColor;
        worst.tag = c.tagName + '.' + String(c.className).split(' ').slice(0, 2).join('.');
      }
      const ratio = window.__contrast(cs.color, cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? pageBg : cs.backgroundColor);
      if (ratio !== null && ratio < 4.0 && c.textContent.trim()) {
        lowContrast.push([c.tagName, cs.color, cs.backgroundColor, Math.round(ratio * 10) / 10]);
      }
    }
    return {
      theme: document.documentElement.dataset.theme,
      pageBg,
      pageBgLum: window.__lum(pageBg),
      brightestCellLum: worst.lum,
      brightestCell: worst,
      lowContrast: lowContrast.slice(0, 5),
      recoloured: paper.querySelectorAll('[data-am-color-orig]').length,
      plate: getComputedStyle(document.documentElement).getPropertyValue('--figure-plate').trim(),
    };
  });
  check(dark.theme === 'dark', 'dark theme applied');
  check(dark.pageBgLum < 0.05, 'page ground is dark', dark.pageBg);
  check(dark.brightestCellLum < 0.12, 'no blinding light table/code surfaces in dark mode', dark.brightestCell);
  check(dark.lowContrast.length === 0, 'all paper text clears 4:1 contrast', dark.lowContrast);

  /* ---- figure lightbox ---- */
  if (base.figures > 0) {
    await page.waitForLoadState('load');
    const fig = page.locator('[data-am-zoom]').first();
    await fig.scrollIntoViewIfNeeded();
    await fig.click({ timeout: 15000 });
    await page.waitForTimeout(400);
    const lb = await page.evaluate(() => {
      const dlg = document.querySelector('dialog.lb');
      const img = dlg && dlg.querySelector('.lb__img');
      return { open: !!(dlg && dlg.open), src: img && img.getAttribute('src') ? img.getAttribute('src').slice(0, 40) : null };
    });
    check(lb.open, 'lightbox opens on a figure tap', lb);
    // wheel-zoom is the desktop path through the same transform maths
    await page.mouse.move(190, 400);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(250);
    const zoomed = await page.evaluate(() => {
      const img = document.querySelector('dialog.lb .lb__img');
      return { transform: img.style.transform, zoomedClass: img.closest('.lb__stage').classList.contains('is-zoomed') };
    });
    check(/scale\((?!1\.0000)/.test(zoomed.transform), 'figure zooms', zoomed);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check(!(await page.evaluate(() => document.querySelector('dialog.lb').open)), 'lightbox closes');
  }

  /* ---- citation peek ---- */
  const citation = page.locator('.ltx_cite a.ltx_ref').first();
  if (await citation.count()) {
    await citation.scrollIntoViewIfNeeded();
    await citation.click({ timeout: 15000 });
    await page.waitForTimeout(400);
    const peek = await page.evaluate(() => {
      const dlg = document.querySelector('dialog.peek');
      return {
        open: !!(dlg && dlg.open),
        kind: dlg && dlg.querySelector('.peek__kind').textContent,
        chars: dlg ? dlg.querySelector('.peek__body').textContent.trim().length : 0,
      };
    });
    check(peek.open && peek.chars > 20, 'citation opens a peek sheet with the reference', peek);
    await page.keyboard.press('Escape');
  }

  /* ---- contents drawer ---- */
  await page.click('#tocBtn');
  await page.waitForTimeout(350);
  const drawer = await page.evaluate(() => {
    const d = document.getElementById('tocDrawer');
    return { open: d.open, entries: d.querySelectorAll('a').length };
  });
  check(drawer.open && drawer.entries > 0, 'contents drawer opens', drawer);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* ---- settings change takes effect ---- */
  const before = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('paper')).fontSize));
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('arxivmobi:prefs:v1') || '{}');
    raw.size = 140; raw.justify = true;
    localStorage.setItem('arxivmobi:prefs:v1', JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#paper .am-article');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    fs: parseFloat(getComputedStyle(document.getElementById('paper')).fontSize),
    align: getComputedStyle([...document.querySelectorAll('#paper .ltx_para > .ltx_p')]
      .find((p) => !p.closest('.ltx_centering, figure, .ltx_abstract') && !p.classList.contains('ltx_align_center'))).textAlign,
  }));
  check(after.fs > before + 3, 'text size preference applies', { before, after });
  check(after.align === 'justify', 'justification can be turned on', after);

  if (SHOTS) {
    await mkdir(SHOTS, { recursive: true });
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('arxivmobi:prefs:v1') || '{}');
      raw.size = 100; raw.justify = false;
      localStorage.setItem('arxivmobi:prefs:v1', JSON.stringify(raw));
      localStorage.removeItem('arxivmobi:library:v1');   // start shots at the top
    });
    for (const theme of ['light', 'dark', 'sepia', 'black']) {
      await page.evaluate((t) => {
        const raw = JSON.parse(localStorage.getItem('arxivmobi:prefs:v1') || '{}');
        raw.theme = t;
        localStorage.setItem('arxivmobi:prefs:v1', JSON.stringify(raw));
      }, theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#paper .am-article');
      await page.waitForTimeout(1200);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        const t = document.getElementById('toast');
        if (t) t.classList.remove('is-open');
      });
      await page.waitForTimeout(300);
      const slug = id.replace(/\//g, '_');
      await page.screenshot({ path: path.join(SHOTS, `${slug}-${theme}-top.png`) });
      const table = await page.$('.am-scrollbox > .am-scroll > table.ltx_tabular');
      if (table) {
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SHOTS, `${slug}-${theme}-table.png`) });
      }

      // UI states, captured once in the dark theme.
      if (theme !== 'dark') continue;
      const zoomable = page.locator('[data-am-zoom]').first();
      if (await zoomable.count()) {
        await zoomable.scrollIntoViewIfNeeded();
        await zoomable.click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(SHOTS, `${slug}-lightbox.png`) });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      const cite = page.locator('.ltx_cite a.ltx_ref').first();
      if (await cite.count()) {
        await cite.scrollIntoViewIfNeeded();
        await cite.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SHOTS, `${slug}-peek.png`) });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      await page.click('#tocBtn');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${slug}-toc.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      await page.click('#typeBtn');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${slug}-settings.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
    await page.goto(SITE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(SHOTS, 'landing.png'), fullPage: true });
  }

  await page.close();
}

/* ==================== offline saving and error states =================== */

console.log('\n=== offline and error states ===');
{
  const page = await ctx.newPage();

  // A paper with no HTML version must explain itself rather than hang.
  await openPaper(page, '9911.99999');
  const missing = await page.$('#state:not([hidden]) .state h2');
  check(Boolean(missing), 'papers without HTML get an explanatory screen',
    missing ? await missing.textContent() : null);
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('#state a')].map((a) => a.textContent.trim()));
  check(links.some((l) => /PDF/i.test(l)) && links.some((l) => /ar5iv/i.test(l)),
    'that screen offers the PDF and ar5iv', links);

  await page.close();

  // Save a paper with its figures, then pull out the network entirely: the
  // service worker has to serve the shell and the caches the rest.
  const offlineId = ids.length ? ids[0] : '1706.03762';
  const offCtx = await browser.newContext({
    ...devices['iPhone 13'], serviceWorkers: 'allow', reducedMotion: 'reduce',
  });
  await installRoutes(offCtx);
  const offPage = await offCtx.newPage();
  await offPage.goto(`${SITE}/read.html?id=${encodeURIComponent(offlineId)}`, { waitUntil: 'load' });
  const opened = await offPage.waitForSelector('#paper .am-article', { timeout: 40000 })
    .then(() => true).catch(() => false);
  check(opened, 'reader works with the service worker active');

  if (opened) {
    await offPage.evaluate(() => navigator.serviceWorker.ready);
    await offPage.evaluate(() => window.scrollTo(0, 0));   // reveal the toolbar
    await offPage.waitForTimeout(500);
    await offPage.click('#moreBtn');
    await offPage.waitForTimeout(300);
    await offPage.click('#moreList button:has-text("Save for offline")');
    await offPage.waitForTimeout(3000);
    const saved = await offPage.evaluate(async () => {
      const cache = await caches.open('arxiv-mobi-assets-v2');
      const lib = JSON.parse(localStorage.getItem('arxivmobi:library:v1') || '[]');
      return { assets: (await cache.keys()).length, flagged: lib.some((e) => e.offline) };
    });
    check(saved.flagged, 'the paper is marked as saved', saved);
    check(saved.assets > 0, 'figures are downloaded into the asset cache', saved);

    simulateOffline = true;
    await offCtx.setOffline(true);
    await offPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    const rendered = await offPage.waitForSelector('#paper .am-article', { timeout: 25000 })
      .then(() => true).catch(() => false);
    check(rendered, 'a saved paper still opens with no network at all');
    if (rendered) {
      const figures = await offPage.evaluate(async () => {
        const img = document.querySelector('#paper img');
        if (!img) return { skipped: true };
        // Lazy images below the fold have not been requested yet; ask for the
        // bytes directly so this tests the cache, not the scroll position.
        const res = await fetch(img.src, { mode: 'cors' }).catch((e) => ({ error: String(e) }));
        if (res.error) return { error: res.error };
        const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
        img.loading = 'eager';
        img.scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 1200));
        return { ok: res.ok, bytes, rendered: img.complete && img.naturalWidth > 0 };
      });
      check(figures.skipped || (figures.ok && figures.bytes > 0),
        'saved figures are served from cache with no network', figures);
      check(figures.skipped || figures.rendered === true,
        'those figures actually paint', figures);
    }
    await offCtx.setOffline(false);
    simulateOffline = false;
  }
  await offCtx.close();
}

/* ===================== landing page and URL routing ===================== */

console.log('\n=== landing page and routing ===');
{
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(SITE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  check(errors.length === 0, 'landing page has no errors', errors.slice(0, 3));

  // A paper read earlier in this run should be listed.
  const cards = await page.evaluate(() =>
    document.querySelectorAll('#continueList .card, #libraryList .card').length);
  check(cards > 0, 'reading list remembers opened papers', cards);

  // Paste a pdf URL: the reader should open the right paper.
  await page.fill('#idInput', 'https://arxiv.org/pdf/2401.12345v2');
  await page.click('#openForm button[type=submit]');
  await page.waitForURL(/read\.html\?id=/, { timeout: 10000 });
  check(/id=2401\.12345v2/.test(page.url()), 'a pasted arXiv URL opens the right paper', page.url());

  await page.goto(SITE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.fill('#idInput', 'not an identifier');
  await page.click('#openForm button[type=submit]');
  await page.waitForTimeout(300);
  const errShown = await page.evaluate(() => !document.getElementById('formError').hidden);
  check(errShown, 'nonsense input is rejected with a message');

  // Host-swapping URLs are served by 404.html and bounced to the reader.
  for (const [pathname, expected] of [
    ['/abs/2401.12345', 'id=2401.12345'],
    ['/2312.11805v3', 'id=2312.11805v3'],
    ['/pdf/hep-th/9711200', 'id=hep-th%2F9711200'],
    ['/html/2005.14165v4', 'id=2005.14165v4'],
  ]) {
    await page.goto(SITE + pathname, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    check(page.url().includes('read.html') && page.url().includes(expected),
      `${pathname} routes to the reader`, page.url());
  }
  await page.close();
}

/* ========================= offline / service worker ==================== */

console.log('\n=== service worker ===');
{
  const swCtx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
  await installRoutes(swCtx);
  const page = await swCtx.newPage();
  await page.goto(SITE + '/index.html', { waitUntil: 'load' });
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    // Registration is kicked off on `load`; give it a moment to appear.
    for (let i = 0; i < 30; i++) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { await navigator.serviceWorker.ready; return reg.scope; }
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  });
  check(Boolean(registered) && registered !== 'unsupported', 'service worker registers', registered);

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check(controlled, 'service worker controls the page after reload');

  const shellCached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.startsWith('arxiv-mobi-shell'));
    if (!shell) return { keys };
    const cache = await caches.open(shell);
    const hit = await cache.match(new URL('assets/css/reader.css', location.href).href);
    return { keys, cachedReaderCss: Boolean(hit) };
  });
  check(shellCached.cachedReaderCss === true, 'app shell is cached for offline use', shellCached);

  /* The bug this guards against: a worker is installed, the site is
     redeployed, and the shell cache keeps handing back the *previous*
     deploy's JavaScript. Simulate a deploy by changing a file on disk
     between two fetches through the worker. */
  const probePath = new URL('../assets/js/.am-probe.js', import.meta.url);
  const probeUrl = SITE + '/assets/js/.am-probe.js';
  try {
    await writeFile(probePath, 'export const build = "before";\n');
    const before = await page.evaluate((u) => fetch(u).then((r) => r.text()), probeUrl);
    await writeFile(probePath, 'export const build = "after";\n');
    const after = await page.evaluate((u) => fetch(u).then((r) => r.text()), probeUrl);
    check(/before/.test(before) && /after/.test(after),
      'a redeployed file is not served stale by the worker', { before: before.trim(), after: after.trim() });
  } finally {
    await rm(probePath, { force: true });
  }

  /* The in-app escape hatch must clear code without clearing the user's
     papers, positions or preferences. */
  await page.evaluate(async () => {
    localStorage.setItem('arxivmobi:prefs:v1', JSON.stringify({ theme: 'sepia', size: 125 }));
    localStorage.setItem('arxivmobi:library:v1', JSON.stringify([{ slug: 'keepme', title: 'Kept' }]));
    const cache = await caches.open('arxiv-mobi-assets-v2');
    await cache.put('https://arxiv.org/html/keep/probe.png',
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
  });
  await page.click('#forceRefresh');
  await page.waitForURL(/fresh=/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const afterRefresh = await page.evaluate(async () => ({
    url: location.search,
    prefs: localStorage.getItem('arxivmobi:prefs:v1'),
    library: localStorage.getItem('arxivmobi:library:v1'),
    savedFigure: Boolean(await caches.open('arxiv-mobi-assets-v2')
      .then((c) => c.match('https://arxiv.org/html/keep/probe.png'))),
  }));
  check(/fresh=/.test(afterRefresh.url), 'force refresh reloads past the caches', afterRefresh.url);
  check(/sepia/.test(afterRefresh.prefs || '') && /Kept/.test(afterRefresh.library || ''),
    'force refresh keeps preferences and the reading list', afterRefresh);
  check(afterRefresh.savedFigure, 'force refresh keeps saved papers', afterRefresh);

  await swCtx.close();
}

await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
