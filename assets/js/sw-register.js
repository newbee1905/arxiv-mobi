/* =========================================================================
   Service worker registration, with an update path that actually updates.

   The failure mode this exists to prevent: a worker is installed, the site
   is redeployed, and the browser keeps serving the previous deploy's
   JavaScript from the app-shell cache. `sw.js` itself is byte-identical
   between deploys, so no new worker is ever installed and the stale code
   sticks. Hence: never let the HTTP cache answer for sw.js, ask for an
   update on every load, and act when a new worker takes over.
   ========================================================================= */

/**
 * @param {{onUpdate?: (reload: () => void) => void}} opts
 *   onUpdate is called when a newer worker has taken control and the page is
 *   running superseded code. Omit it to reload immediately.
 */
export function registerServiceWorker(opts = {}) {
  if (!('serviceWorker' in navigator)) return;

  // A page that had no controller is a first visit: the worker taking over
  // is expected, and there is nothing stale to replace.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let handled = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || handled) return;
    handled = true;
    const reload = () => location.reload();
    if (opts.onUpdate) opts.onUpdate(reload);
    else reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      reg.update().catch(() => { /* offline, or nothing new */ });
    } catch { /* offline support is optional */ }
  });
}
