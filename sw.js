/* Turni GPG/sicurezza - service worker. Cambia VERSION a ogni nuova versione dell'app. */
const VERSION="tg-v3.27";
const ASSETS=["./","index.html","favicon.ico","manifest.webmanifest","updates.json","firebase-config.js","firebase-client.js","firebase-ui.js","firebase-ui-v3-13.js","favicon-32.png","icon-192.png","icon-512.png","icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => Promise.all(
        ASSETS.map(asset =>
          cache.add(asset).catch(error => {
            console.warn("Cache asset non disponibile:", asset, error);
          })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== VERSION).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;

  const save = response => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(VERSION).then(cache => cache.put(request, copy));
    }
    return response;
  };

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(save)
        .catch(() => caches.match(request).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  if (url.pathname.endsWith("updates.json") || url.pathname.endsWith("firebase-config.js") || url.pathname.endsWith("firebase-ui.js") || url.pathname.endsWith("firebase-client.js")) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).then(save).catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit => {
      const network = fetch(request).then(save).catch(() => hit);
      return hit || network;
    })
  );
});
