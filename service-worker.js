const CACHE_NAME = "bossman-customer-v14";
const SHELL = [
  "book.html", "index.html", "brand.css", "api.js", "pwa.js", "logo.png",
  "recovery-loader.js", "recovery.js", "turn-alerts.js", "switch-barber.js",
  "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"
];
const shellPaths = new Set(SHELL.map(path => new URL(path, self.registration.scope).pathname));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(
    SHELL.map(path => new Request(new URL(path, self.registration.scope).href, { cache: "reload" }))
  )));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("bossman-customer-") && key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", event => {
  // Never intercept the HEAD request used to synchronize the shop clock.
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !shellPaths.has(url.pathname)) return;
  const cacheKey = new Request(url.origin + url.pathname);
  const isCode = /\.(html|js)$/.test(url.pathname);
  event.respondWith(fetch(event.request, isCode ? { cache: "no-store" } : {}).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
    }
    return response;
  }).catch(() => caches.match(cacheKey)));
});

self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : "Your barber is ready." };
  }

  const title = data.title || "It's your turn at Bossman";
  const options = {
    body: data.body || "Please return now. Your barber is ready for you.",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: data.tag || "bossman-turn-alert",
    renotify: true,
    requireInteraction: true,
    vibrate: [350, 150, 350, 150, 700],
    data: { url: data.url || "./index.html" }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const destination = new URL(
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "./index.html",
    self.registration.scope
  ).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.registration.scope) && "focus" in client) {
          if ("navigate" in client) {
            return client.navigate(destination).then(() => client.focus());
          }
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(destination) : undefined;
    })
  );
});
