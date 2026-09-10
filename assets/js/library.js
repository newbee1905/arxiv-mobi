/* =========================================================================
   Reading list: what you opened, where you stopped, what is saved offline.
   localStorage only — nothing leaves the device, no accounts, no tracking.
   ========================================================================= */

const KEY = 'arxivmobi:library:v1';
const MAX = 60;

export function all() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* ignore */ }
}

export function find(slug) {
  return all().find((e) => e.slug === slug) || null;
}

/** Insert or update an entry, moving it to the top of the list. */
export function touch(entry) {
  const list = all();
  const i = list.findIndex((e) => e.slug === entry.slug);
  const merged = i >= 0 ? { ...list[i], ...entry } : { added: Date.now(), ...entry };
  merged.opened = Date.now();
  if (i >= 0) list.splice(i, 1);
  list.unshift(merged);
  write(list);
  return merged;
}

export function setProgress(slug, progress, anchor) {
  const list = all();
  const e = list.find((x) => x.slug === slug);
  if (!e) return;
  e.progress = Math.max(0, Math.min(1, progress));
  if (anchor) e.anchor = anchor;
  e.opened = Date.now();
  write(list);
}

export function setOffline(slug, offline, assets) {
  const list = all();
  const e = list.find((x) => x.slug === slug);
  if (!e) return;
  e.offline = !!offline;
  if (assets) e.assets = assets;
  write(list);
}

export function remove(slug) {
  write(all().filter((e) => e.slug !== slug));
}

export function clear() { write([]); }
