/**
 * Neon Courier — service worker
 * =============================
 *
 * The whole point of this file is a *shell*: the HTML, JS and CSS that make the
 * game bootable, plus the fallback page shown when a route is simply not
 * available offline. It is deliberately not a general-purpose cache. Read the
 * bypass rules in the `fetch` handler as the security policy they are:
 *
 *   1. non-GET        → never intercepted (mutations belong to the page's
 *                       outbox, which owns retries and re-authentication)
 *   2. cross-origin   → never intercepted (Supabase and the auth server are
 *                       invisible to this worker — no token or session-scoped
 *                       response can be cached by accident)
 *   3. `/api/*`       → never intercepted (session data and clock-dependent
 *                       payloads must stay `no-store`)
 *   4. documents/RSC  → network-first, stored only for the three *public* shell
 *                       routes (personalised pages such as `/profile` or
 *                       `/leaderboard` are never written to Cache Storage)
 *   5. static assets  → cache-first (content-addressed `/_next/static/*`)
 *
 * `VERSION` is the only thing to bump when the precache list changes: a new name
 * installs a fresh cache and `activate` deletes the old one. Regular deploys do
 * NOT need a bump — HTML is network-first and hashed chunk URLs are fetched on
 * demand — the version only guards the precache.
 */

'use strict';

const VERSION = 'v1';
const SHELL_CACHE = `neon-courier-shell-${VERSION}`;
const NAV_CACHE = `neon-courier-nav-${VERSION}`;
const CACHE_PREFIX = 'neon-courier-';

/** Route the worker falls back to when a navigation has neither network nor cache. */
const OFFLINE_URL = '/offline';

/**
 * The only documents that may be *stored*. All three are public, build-specific
 * and identical for every visitor, so caching them can never leak a session.
 */
const SHELL_ROUTES = ['/', '/game', OFFLINE_URL];

/** Fetched during `install`, before the worker is allowed to control a page. */
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/',
  '/game',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon-180.png',
];

/** Prefixes that must reach the network untouched — including the worker file
 *  itself, which must never be served from a cache or an old worker would
 *  outlive its own update. */
const NEVER_CACHE_PREFIXES = ['/api/', '/_next/image', '/sw.js'];

/** Upper bound on the install crawl, so a pathological page cannot wedge install. */
const MAX_PRECACHE = 400;

/* -------------------------------------------------------------------------- */
/* Install: build the shell                                                    */
/* -------------------------------------------------------------------------- */

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

/** Fetch, but ignore failures: one missing file must not fail the install. */
async function addQuiet(cache, url) {
  try {
    // `reload` bypasses the browser's HTTP cache — a precache must hold the
    // bytes that are actually deployed, not whatever the HTTP cache last saw.
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (response.ok) await cache.put(url, response);
  } catch {
    // Offline mid-install: the URLs that did land still help, and the next
    // online navigation fills the rest through the runtime handlers.
  }
}

/**
 * Pulls `/_next/static/...` references out of a text file (HTML, JS or CSS).
 *
 * Next's inline RSC payloads escape slashes, so the text is normalised first;
 * the character class stops at quotes, whitespace and closing brackets.
 */
function collectAssetUrls(text, into) {
  const matches = text.replace(/\\\//g, '/').match(/\/_next\/static\/[^"'\s\\)<]+/g);
  if (!matches) return;
  for (const raw of matches) {
    if (into.size >= MAX_PRECACHE) return;
    into.add(raw.replace(/[.,;]+$/, ''));
  }
}

async function textOf(cache, url) {
  const hit = await cache.match(url);
  return hit ? hit.text() : null;
}

/**
 * Stores the App Router *data* payload for a shell route under its normalised
 * key, so the first offline soft navigation has something to render even if the
 * player never clicked a link while online.
 */
async function addRscQuiet(cache, pathname) {
  try {
    const response = await fetch(
      new Request(pathname, { headers: { RSC: '1' }, cache: 'reload' })
    );
    if (response.ok) await cache.put(rscKey(pathname), response);
  } catch {
    // Same tolerance as `addQuiet`: a failed precache must not fail the install.
  }
}

/**
 * Two-level crawl of the shell:
 *
 *   level 0: the seed URLs themselves (HTML for `/` and `/game`, plus icons)
 *   level 1: every `/_next/static` asset referenced *by that HTML*
 *   level 2: assets referenced *by those JS/CSS files*
 *
 * Level 2 exists because Phaser loads through a dynamic import: its chunk URL is
 * written inside another chunk, not in the HTML. Without it the first offline
 * launch after install would boot the shell and then fail to load the engine.
 */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);

  await Promise.all(PRECACHE_URLS.map((url) => addQuiet(cache, url)));

  const navCache = await caches.open(NAV_CACHE);
  await Promise.all(['/', '/game'].map((path) => addRscQuiet(navCache, path)));

  const level1 = new Set();
  for (const seed of ['/', '/game']) {
    const html = await textOf(cache, seed);
    if (html) collectAssetUrls(html, level1);
  }
  await Promise.all([...level1].map((url) => addQuiet(cache, url)));

  const level2 = new Set();
  for (const url of level1) {
    if (!/\.(js|css)(\?|$)/.test(url)) continue;
    const source = await textOf(cache, url);
    if (source) collectAssetUrls(source, level2);
  }
  await Promise.all([...level2].map((url) => addQuiet(cache, url)));
}

/* -------------------------------------------------------------------------- */
/* Activate: drop superseded caches                                            */
/* -------------------------------------------------------------------------- */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          // Only this app's caches, and only the ones a previous VERSION created.
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE && name !== NAV_CACHE
          )
          .map((name) => caches.delete(name))
      );
      // Take control of pages that were already open when this worker installed,
      // so the *first* session is offline-capable too.
      await self.clients.claim();
    })()
  );
});

/* -------------------------------------------------------------------------- */
/* Fetch: the policy                                                           */
/* -------------------------------------------------------------------------- */

/** Normalised key for RSC payloads. The client's `?_rsc=` hash is build-specific
 *  and opaque here, so payloads are stored under the pathname alone. */
function rscKey(pathname) {
  return new URL(`${pathname}?__nc_rsc=1`, self.location.origin).href;
}

function isShellRoute(pathname) {
  return SHELL_ROUTES.includes(pathname);
}

/** Content-addressed files: the URL changes when the bytes change, so a hit is
 *  always correct and a miss is simply the first time this build is seen. */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/**
 * Documents: network-first so a deploy is picked up immediately, with the stored
 * copy as the offline fallback and `/offline` behind that.
 *
 * Two deliberate restrictions:
 *   - only SHELL_ROUTES are written back (a personalised page must never end up
 *     in Cache Storage, even though the cache is same-origin and private);
 *   - a freshly stored document invalidates that route's stored RSC payload, so
 *     a later soft navigation can never pair new HTML with a stale payload.
 */
async function handleNavigation(request) {
  const url = new URL(request.url);
  const store = isShellRoute(url.pathname);

  try {
    const response = await fetch(request);
    if (response.ok && store) {
      const cache = await caches.open(NAV_CACHE);
      await cache.put(request, response.clone());
      await cache.delete(rscKey(url.pathname));
    }
    return response;
  } catch {
    // Fall through: no network, use the caches.
  }

  const navCache = await caches.open(NAV_CACHE);
  const stored = await navCache.match(request);
  if (stored) return stored;

  const shellCache = await caches.open(SHELL_CACHE);
  const shellHit = await shellCache.match(request);
  if (shellHit) return shellHit;

  const fallback = await shellCache.match(OFFLINE_URL);
  if (fallback) return fallback;

  return new Response('Offline and no cached shell is available.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * App Router data requests (soft navigations and prefetches carry `RSC: 1`).
 * Same network-first rule as documents, keyed by pathname; on a miss the router
 * gets a plain 503 and renders its own error boundary — inventing a payload
 * shape here would be guessing at framework internals.
 */
async function handleRsc(request) {
  const url = new URL(request.url);

  try {
    const response = await fetch(request);
    if (response.ok && isShellRoute(url.pathname)) {
      const cache = await caches.open(NAV_CACHE);
      await cache.put(rscKey(url.pathname), response.clone());
    }
    return response;
  } catch {
    // Fall through.
  }

  const navCache = await caches.open(NAV_CACHE);
  const stored = await navCache.match(rscKey(url.pathname));
  if (stored) return stored;

  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 1. Mutations are never intercepted. Retries live in the page's outbox,
  //    which re-authenticates and applies backoff; a worker must not replay POSTs.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 2. Same-origin only. Supabase, the auth server and every third party are
  //    invisible to this worker.
  if (url.origin !== self.location.origin) return;

  // 3. Endpoints and the worker file itself stay on the network. `/sw.js` in
  //    particular must never be served from a cache, or an old worker would
  //    outlive its own update.
  for (const prefix of NEVER_CACHE_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return;
  }

  // 4. Documents and App Router data: network-first with an offline fallback.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (request.headers.get('RSC') === '1') {
    event.respondWith(handleRsc(request));
    return;
  }

  // 5. Everything else same-origin and GET is a static file: cache-first.
  event.respondWith(cacheFirst(request));
});
