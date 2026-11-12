// v2: starts a fresh cache, so any reset-password page an older worker kept (with its link) is dropped on update.
const CACHE_NAME = "line-select-shell-v2";

/**
 * Pages kept from the first visit: the worker installs after that visit's page has loaded, so without these the app
 * didn't open offline until a second visit. Their build files come with them as the page asks for them.
 */
const SHELL_PAGES = ["/", "/results"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Best effort: a page that can't be fetched now is cached on its next visit, as before.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(SHELL_PAGES.map((p) => cache.add(p).catch(() => {})))));
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

/** Build files kept at most. Every deploy brings new hashed names and the old ones are never asked for again, so without a cap they'd pile up on the phone forever. */
const MAX_STATIC_ENTRIES = 400;

function cacheCopy(request, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  return response;
}

/** Drops the oldest build files past the cap (a cache lists its keys in the order they went in). Pages are left alone. */
function trimStatic() {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.keys().then((keys) => {
      const statics = keys.filter((k) => new URL(k.url).pathname.startsWith("/_next/static/"));
      return Promise.all(statics.slice(0, Math.max(0, statics.length - MAX_STATIC_ENTRIES)).map((k) => cache.delete(k)));
    })
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // API routes need a real round trip every time — bid pack parsing, hotel
  // lookups, and auth all depend on live server state; a stale cached
  // response would be worse than a clear failure.
  if (url.pathname.startsWith("/api/")) return;
  // Sign-in and password-reset pages carry one-time links (`?token=…`) that must never be kept on the phone, and
  // gain nothing from an offline copy.
  if (url.pathname.startsWith("/reset-password") || url.pathname.startsWith("/auth") || url.searchParams.has("token")) return;

  // Next's build output is content-hashed and never changes under the same
  // name, so it comes straight from the cache once it's there — no waiting on
  // a hotel's Wi-Fi for a file that's already on the phone.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((r) => cacheCopy(event.request, r))));
    return;
  }

  // Once per page load is often enough to keep the build files under their cap.
  if (event.request.mode === "navigate") event.waitUntil(trimStatic());

  // Everything else is network-first, falling back to whatever was last
  // cached — every page a pilot has already visited stays usable with no
  // signal on a layover, without hand-maintaining a precache list. On a
  // connection that's there but crawling, a page that has a cached copy shows
  // it after a few seconds rather than hanging.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((r) => cacheCopy(event.request, r));
      if (!cached) return network.catch(() => Response.error());
      // Kept to compare with: the copy served is read by the page, and a read body can't be read again.
      const kept = cached.clone();
      let servedCached = false;
      const timeout = new Promise((resolve) =>
        setTimeout(() => {
          servedCached = true;
          resolve(cached);
        }, NETWORK_TIMEOUT_MS)
      );
      // The last visit's copy shown on a slow link: when the network's arrives from a newer deploy, the page is told,
      // so the pilot isn't left running old code against the live server.
      if (event.request.mode === "navigate") event.waitUntil(network.then((fresh) => servedCached && fresh && tellIfNewer(kept, fresh, event.resultingClientId || event.clientId)).catch(() => {}));
      return Promise.race([network.catch(() => cached), timeout]);
    })
  );
});

/** A page's build, by the build files it loads: two copies of the same deploy name the same ones. */
function buildOf(html) {
  return [...new Set(html.match(/\/_next\/static\/[^"'\s)]+\.js/g) || [])].sort().join(" ");
}

function tellIfNewer(cached, fresh, clientId) {
  return Promise.all([cached.text(), fresh.clone().text()]).then(([a, b]) => {
    if (buildOf(a) === buildOf(b)) return;
    return self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if (!clientId || c.id === clientId) c.postMessage({ type: "line-select:newer-page" });
    });
  });
}
