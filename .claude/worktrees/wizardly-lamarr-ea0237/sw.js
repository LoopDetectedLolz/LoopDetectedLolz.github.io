/* Field kit offline cache. Touches nothing but the kit. */
var CACHE = 'nfn-kit-v1';
var FILES = ['/kit.html', '/kit.webmanifest', '/apple-touch-icon.png', '/favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (FILES.indexOf(url.pathname) < 0) return;          /* the rest of the site is none of our business */
  e.respondWith(
    fetch(e.request).then(function (r) {
      if (r && r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
      return r;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || caches.match('/kit.html'); });
    })
  );
});
