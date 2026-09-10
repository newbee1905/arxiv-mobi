/* =========================================================================
   Landing page: open a paper, and keep the reading list in front of you.
   ========================================================================= */

import { parseArxivId, readerHref } from './arxiv-id.js';
import * as prefs from './settings.js';
import * as library from './library.js';
import { icon } from './icons.js';
import { registerServiceWorker } from './sw-register.js';

const $ = (id) => document.getElementById(id);

prefs.apply();
prefs.watchSystemTheme();

/* Icons in static markup. */
$('appearanceBtn').innerHTML = icon('type');
for (const b of document.querySelectorAll('[data-close]')) b.innerHTML = icon('close');
for (const slot of document.querySelectorAll('[data-icon]')) {
  slot.innerHTML = icon(slot.getAttribute('data-icon'));
}

/* A link that arrived as ?id= / share-target text goes straight to the reader. */
(function redirectIfAsked() {
  const params = new URLSearchParams(location.search);
  const raw = params.get('id') || params.get('url') || params.get('text');
  if (!raw) return;
  const parsed = parseArxivId(raw);
  if (parsed) location.replace(readerHref(parsed));
}());

/* ------------------------------- open form ------------------------------ */

const form = $('openForm');
const input = $('idInput');
const error = $('formError');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = parseArxivId(input.value);
  if (!parsed) {
    error.hidden = false;
    error.textContent = 'That does not contain an arXiv identifier. Try 2401.12345 or a full arXiv link.';
    input.focus();
    input.select();
    return;
  }
  error.hidden = true;
  location.href = readerHref(parsed);
});
input.addEventListener('input', () => { error.hidden = true; });

/* ------------------------------- library -------------------------------- */

function timeAgo(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(ts).toLocaleDateString();
}

function cardFor(entry) {
  const li = document.createElement('li');
  li.className = 'card';

  const a = document.createElement('a');
  a.className = 'card__main';
  a.href = `read.html?id=${encodeURIComponent(entry.slug)}`;

  const title = document.createElement('div');
  title.className = 'card__title';
  title.textContent = entry.title || entry.slug;

  const sub = document.createElement('div');
  sub.className = 'card__sub';
  const pieces = [];
  if (entry.authors && entry.authors.length) {
    pieces.push(entry.authors[0] + (entry.authors.length > 1 ? ' et al.' : ''));
  }
  pieces.push(`arXiv:${entry.slug}`);
  if (entry.opened) pieces.push(timeAgo(entry.opened));
  for (const p of pieces) {
    const s = document.createElement('span');
    s.textContent = p;
    sub.appendChild(s);
  }
  if (entry.offline) {
    const b = document.createElement('span');
    b.className = 'badge-offline';
    b.textContent = 'offline';
    sub.appendChild(b);
  }

  a.append(title, sub);

  if (entry.progress > 0.01) {
    const bar = document.createElement('div');
    bar.className = 'card__bar';
    const fill = document.createElement('span');
    fill.style.width = Math.round(Math.min(1, entry.progress) * 100) + '%';
    bar.appendChild(fill);
    a.appendChild(bar);
  }

  const del = document.createElement('button');
  del.className = 'card__del';
  del.type = 'button';
  del.setAttribute('aria-label', `Remove ${entry.title || entry.slug} from the list`);
  del.innerHTML = icon('trash');
  del.addEventListener('click', () => {
    library.remove(entry.slug);
    renderLibrary();
    toast('Removed from the list');
  });

  li.append(a, del);
  return li;
}

function renderLibrary() {
  const all = library.all();
  const reading = all.filter((e) => e.progress > 0.02 && e.progress < 0.97).slice(0, 3);
  const rest = all.filter((e) => !reading.includes(e)).slice(0, 20);

  const cont = $('continueList');
  cont.textContent = '';
  for (const e of reading) cont.appendChild(cardFor(e));
  $('continueBlock').hidden = reading.length === 0;

  const list = $('libraryList');
  list.textContent = '';
  for (const e of rest) list.appendChild(cardFor(e));
  $('libraryBlock').hidden = rest.length === 0;
}

$('clearLibrary').addEventListener('click', () => {
  if (!confirm('Forget every paper in the list? Saved offline copies are kept until the browser clears them.')) return;
  library.clear();
  renderLibrary();
});

renderLibrary();

/* ------------------------------ appearance ------------------------------ */

const sheet = $('appearanceSheet');
prefs.buildSettingsUI($('appearanceBody'), { showReaderOnly: false });
$('appearanceBtn').addEventListener('click', () => sheet.showModal());
sheet.querySelector('[data-close]').addEventListener('click', () => sheet.close());
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

/* ------------------------------- fast ways ------------------------------ */

const base = location.href.replace(/[^/]*$/, '').replace(/\?.*$/, '');
$('swapExample').textContent = base.replace(/^https?:\/\//, '') + 'abs/2401.12345';
$('bookmarklet').href =
  "javascript:void((function(){location.href='" + base +
  "read.html?id='+encodeURIComponent(location.href)})())";
$('bookmarklet').addEventListener('click', (e) => {
  e.preventDefault();
  toast('Drag this link to your bookmarks instead of tapping it');
});

if (!window.matchMedia('(display-mode: standalone)').matches) {
  $('installHint').hidden = false;
}

/* --------------------------------- toast -------------------------------- */

let toastTimer = null;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('is-open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-open'), 2600);
}

/* ---------------------------- service worker ---------------------------- */

// Nothing to lose on this page: take the update straight away.
registerServiceWorker();
