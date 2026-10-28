// This app never registers a service worker itself — but a PHONE that once
// loaded an OLDER build (which used to register one) still has it sitting
// active in the background, serving that old build's cached JS/CSS forever,
// no matter how many times the person reopens the app or even hard-refreshes
// (a service worker's own cache sits BELOW normal browser cache and survives
// a reload). That's why a device can silently stay on months-old code —
// this exact gap is what let one DRI keep submitting under the pre-fix ID
// scheme long after it was fixed and deployed.
//
// This file is the kill switch: the browser always re-checks /sw.js itself
// (bypassing its own cache) on every page load, byte-diffs it against
// whatever it has registered, and installs this one the moment it differs —
// so just deploying this is enough to reach every such device. It then wipes
// every cache this origin ever created, unregisters itself so there is
// nothing left to go stale next time, and reloads every open tab so the
// fresh build loads immediately instead of waiting for a manual refresh.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    try {
      await self.registration.unregister();
    } catch {}
    const clientsList = await self.clients.matchAll({ type: "window" });
    for (const client of clientsList) {
      try { client.navigate(client.url); } catch {}
    }
  })());
});
