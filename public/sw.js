// Minimal service worker so Chromium can offer "install app" / Add to Home Screen.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// No fetch handler: Chrome treats an empty one as a no-op and warns that it
// slows navigation. Installability no longer requires intercepting fetches.
