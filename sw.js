const CACHE = "couple-rewards-app-v19-health-firestore";
const PRECACHE = [
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./firebase-config.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const url of PRECACHE) {
        try {
          await cache.add(new Request(url, { cache: "reload" }));
        } catch (_) {}
      }
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE && key.startsWith("couple-rewards-app")) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("sw.js")) return;

  const isHtml =
    event.request.mode === "navigate" ||
    url.pathname.endsWith("index.html") ||
    url.pathname.endsWith("/");

  const networkReq = isHtml
    ? new Request(event.request, { cache: "reload" })
    : event.request;

  event.respondWith(
    fetch(networkReq)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((hit) => {
          if (hit) return hit;
          return caches.match(new URL("index.html", self.location.href).href);
        })
      )
  );
});
