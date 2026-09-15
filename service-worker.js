/* Samay — service worker
   Caches the app shell so the UI opens instantly (even offline), while all
   live time-sync requests always go straight to the network, untouched. */

var CACHE_NAME = "samay-shell-v1";
var SHELL_FILES = [
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-180.png",
  "./icons/favicon.ico"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      // Cache each file independently — a single flaky fetch shouldn't be
      // able to fail the whole install and block offline support.
      return Promise.all(
        SHELL_FILES.map(function(file){
          return cache.add(file).catch(function(){ /* skip, non-fatal */ });
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function(event){
  var req = event.request;
  var url = new URL(req.url);

  // Only ever handle same-origin GET requests. Cloudflare, NTP Pool,
  // TimeAPI.io — and anything added later — pass straight through
  // untouched and are never cached.
  if(req.method !== "GET" || url.origin !== self.location.origin){
    return;
  }

  // The HTML page itself: network-first, so a fresh deploy is always picked
  // up when online; falls back to the cached shell only when offline.
  if(req.mode === "navigate" || url.pathname.endsWith("index.html")){
    event.respondWith(
      fetch(req).then(function(response){
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
        return response;
      }).catch(function(){
        return caches.match(req).then(function(cached){
          return cached || new Response(
            "Samay is offline and this page hasn't been cached yet. Reconnect and reload once.",
            { status: 503, statusText: "Offline", headers: { "Content-Type": "text/plain" } }
          );
        });
      })
    );
    return;
  }

  // Static assets (icons, manifest): cache-first for instant offline loads,
  // refreshed in the background whenever the network has a newer copy.
  event.respondWith(
    caches.match(req).then(function(cached){
      var networkFetch = fetch(req).then(function(response){
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
        return response;
      }).catch(function(err){
        if(cached) return cached;
        throw err;
      });
      return cached || networkFetch;
    })
  );
});
