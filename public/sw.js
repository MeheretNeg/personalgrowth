/**
 * Anchor service worker.
 * 1. Notifications: installed Android PWAs cannot use `new Notification()` —
 *    system cues must go through registration.showNotification. The page
 *    posts {type: "notify"} messages here as a fallback path, and notify.ts
 *    calls registration.showNotification directly when it can.
 * 2. Offline: network-first for navigations (never serve a stale app after
 *    a deploy), cache-first for immutable /_next/static assets.
 * 3. Push: handler is wired for Phase 3 (needs a VAPID push server).
 */

const CACHE = "anchor-v1";
const OFFLINE_URLS = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match("/"))),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
  }
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "notify") {
    event.waitUntil(self.registration.showNotification(data.title, data.options));
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Anchor", {
      body: data.body,
      tag: data.tag,
      requireInteraction: !!data.requireInteraction,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => "focus" in c);
      return open ? open.focus() : self.clients.openWindow("/execute");
    }),
  );
});
