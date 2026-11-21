/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// weQuiz service worker (registered automatically by SvelteKit in production).
// - Precaches the hashed app bundle and static files of this build.
// - Navigations: network-first, falling back to the cached app shell when offline.
// - Same-origin static assets: cache-first (they are content-hashed or versioned per build).
// - Never touches cross-origin traffic: the backend API and game WebSocket go straight to the
//   network, so game state is never served stale.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `wequiz-${version}`;
const SHELL_URL = '/';
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      // The HTML shell is rendered per request (it carries runtime env), cache one copy for offline.
      try {
        await cache.add(new Request(SHELL_URL, { cache: 'reload' }));
      } catch {
        /* offline at install time: the shell will be cached on the next navigation */
      }
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok && url.pathname === SHELL_URL) {
            const cache = await caches.open(CACHE);
            await cache.put(SHELL_URL, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(SHELL_URL);
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (ASSETS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(url.pathname);
        return cached ?? fetch(request);
      })(),
    );
  }
});
