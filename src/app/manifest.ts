import type { MetadataRoute } from 'next';

/**
 * The web app manifest, served by Next at `/manifest.webmanifest` and linked
 * automatically from the document head (file-convention metadata).
 *
 * Installability checklist this file satisfies:
 *   - `name` + `short_name`   how the app is labelled on the home screen
 *   - `start_url` + `scope`   `/game` boots straight into the dispatch console
 *   - `display: standalone`   no browser chrome, so it feels like a native app
 *   - `icons` at 192/512 plus a `maskable` variant (the platform's minimum for
 *     offering an install prompt, and the maskable one keeps Android's circular
 *     crop off the artwork)
 *
 * `id` is what ties *instances* of the app together: two start URLs with the
 * same `id` are the same installed app rather than two competing icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/game',
    name: 'Neon Courier // Cyberpunk Web Delivery Game',
    short_name: 'Neon Courier',
    description:
      'Deliver cargo across neo-metropolis districts, dodge interceptor drones, and upgrade your cyber hoverbike. Plays offline and syncs on reconnect.',
    lang: 'en',
    dir: 'ltr',
    start_url: '/game',
    scope: '/',
    display: 'standalone',
    background_color: '#08090d',
    theme_color: '#08090d',
    categories: ['games', 'entertainment'],
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Run Dispatch',
        short_name: 'Dispatch',
        description: 'Jump straight into the delivery simulation.',
        url: '/game',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Daily Challenge',
        short_name: 'Challenge',
        description: "Today's courier objective.",
        url: '/challenges',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
