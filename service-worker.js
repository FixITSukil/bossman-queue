const CACHE_NAME = "bossman-customer-v6";
const SHELL = [
  "book.html", "index.html", "brand.css", "api.js", "logo.png",
  "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"
];
const shellPaths = new Set(SHELL.map(path => new URL(path, self.registration.scope).pathname));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL.map(path => new URL(path, self.registration.scope).href))));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("bossman-customer-") && key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !shellPaths.has(url.pathname)) return;
  const cacheKey = new Request(url.origin + url.pathname);
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
    }
    return response;
  }).catch(() => caches.match(cacheKey)));
});
