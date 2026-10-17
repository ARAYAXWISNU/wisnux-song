const CACHE_NAME = "wisnux.song.lokal-v7";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-64.png"
];

// IndexedDB Helper for background audio streaming
const DB_NAME = "WisnuxSongDB";
const DB_VERSION = 1;
const STORE_NAME = "songs";

function getSongFromDB(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        return resolve(null);
      }
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

// Install: pre-cache the app shell so the UI works fully offline.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean up old cache versions & claim clients immediately.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" && request.method !== "HEAD") return;

  const url = new URL(request.url);

  // Stream audio directly from IndexedDB via HTTP 206 Partial Content (Bypasses Android Chrome Blob URL & Video suspension on lockscreen)
  if (url.origin === self.location.origin && url.pathname === "/media-stream") {
    const songId = url.searchParams.get("id");
    if (!songId) {
      event.respondWith(new Response("Missing song ID", { status: 400 }));
      return;
    }

    event.respondWith(
      getSongFromDB(songId)
        .then((song) => {
          if (!song || !song.file) {
            return new Response("Song not found in DB", { status: 404 });
          }
          const blob = song.file;
          const rangeHeader = request.headers.get("Range");

          // MIME type audio murni agar Android & iOS mengenali sebagai background audio stream
          const mimeType = (blob.type && blob.type.startsWith("audio/")) ? blob.type : "audio/mpeg";

          // Dukungan untuk preflight / probe HEAD request dari Safari & Android media engine
          if (request.method === "HEAD") {
            return new Response(null, {
              status: 200,
              headers: {
                "Content-Type": mimeType,
                "Content-Length": blob.size,
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=31536000"
              }
            });
          }

          if (!rangeHeader) {
            return new Response(blob, {
              status: 200,
              headers: {
                "Content-Type": mimeType,
                "Content-Length": blob.size,
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=31536000"
              }
            });
          }

          const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
          if (!match) {
            return new Response(blob, {
              status: 200,
              headers: {
                "Content-Type": mimeType,
                "Content-Length": blob.size,
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*"
              }
            });
          }

          const start = parseInt(match[1], 10);
          if (start >= blob.size) {
            return new Response(null, {
              status: 416,
              statusText: "Range Not Satisfiable",
              headers: {
                "Content-Range": `bytes */${blob.size}`,
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*"
              }
            });
          }

          const end = match[2] ? parseInt(match[2], 10) : blob.size - 1;
          const safeEnd = Math.min(isNaN(end) ? blob.size - 1 : end, blob.size - 1);
          const chunk = blob.slice(start, safeEnd + 1);

          return new Response(chunk, {
            status: 206,
            statusText: "Partial Content",
            headers: {
              "Content-Type": mimeType,
              "Content-Range": `bytes ${start}-${safeEnd}/${blob.size}`,
              "Content-Length": chunk.size,
              "Accept-Ranges": "bytes",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=31536000"
            }
          });
        })
        .catch((err) => {
          console.error("SW media-stream error:", err);
          return new Response("Error reading song from DB", { status: 500 });
        })
    );
    return;
  }

  // Bypass service worker caching for API routes
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  } else {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
