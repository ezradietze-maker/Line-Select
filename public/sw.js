const CACHE_NAME = "line-select-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** How long a page request waits on a weak connection before showing the copy from the last visit instead. */
const NETWORK_TIMEOUT_MS = 4000;

function cacheCopy(request, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // API routes need a real round trip every time — bid pack parsing, hotel
  // lookups, and auth all depend on live server state; a stale cached
  // response would be worse than a clear failure.
  if (url.pathname.startsWith("/api/")) return;

  // Next's build output is content-hashed and never changes under the same
  // name, so it comes straight from the cache once it's there — no waiting on
  // a hotel's Wi-Fi for a file that's already on the phone.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((r) => cacheCopy(event.request, r))));
    return;
  }

  // Everything else is network-first, falling back to whatever was last
  // cached — every page a pilot has already visited stays usable with no
  // signal on a layover, without hand-maintaining a precache list. On a
  // connection that's there but crawling, a page that has a cached copy shows
  // it after a few seconds rather than hanging.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((r) => cacheCopy(event.request, r));
      if (!cached) return network.catch(() => Response.error());
      const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
      return Promise.race([network.catch(() => cached), timeout]);
    })
  );
});
