'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, and owns nothing else.
 *
 * ## Why production only
 *
 * In development the worker would sit in front of Turbopack's dev server and serve
 * stale bundles — the classic "my changes do not show up" trap. Skipping
 * `register()` outside production keeps `npm run dev` honest; offline behaviour is
 * verified with `next build && next start` (Next's own guidance), which is also
 * why the registration test suite belongs on a real build.
 *
 * ## Why no `skipWaiting`
 *
 * An updated worker stays in the browser's "waiting" slot while this version
 * controls the page. That is deliberate: swapping the caches underneath a running
 * game would leave it holding a document whose hashed chunks were just deleted.
 * The next cold start activates the new worker and prunes the old caches in its
 * `activate` handler. Bump `VERSION` in `public/sw.js` when the precache list or
 * the shell strategy itself changes.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        // Explicit update check: browsers throttle the automatic one, and the
        // worker itself must never be served from a cache (see next.config.ts).
        await registration.update();
      } catch (error) {
        // Offline, or a browser that blocks workers. The game is unaffected —
        // it just stays online-only.
        console.warn('[pwa] service worker registration failed:', error);
      }
    };

    const handleLoad = () => {
      void register();
    };

    // Registering before `load` competes with the page's own assets for
    // bandwidth; the worker is only useful once the shell has rendered anyway.
    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', handleLoad, { once: true });
    }

    return () => {
      window.removeEventListener('load', handleLoad);
    };
  }, []);

  return null;
}