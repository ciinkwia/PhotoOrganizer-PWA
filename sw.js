const CACHE_NAME = 'photo-organizer-v4';

// Use relative paths so this works on any subdirectory (e.g. GitHub Pages)
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/db.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

// Install: cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch handler: intercept share-target POSTs + cache-first for app shell
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // ── Share Target: intercept the POST from the OS share sheet ──
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShareTarget(e.request));
    return;
  }

  // ── Normal fetch: cache-first ──
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).catch(() => {
        // Offline fallback for navigation
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

/**
 * Handle incoming share-target POST.
 * Extracts shared image files, stashes them in IndexedDB ("share_inbox"),
 * then redirects to the main app with ?share=pending in the URL.
 * app.js picks them up from there.
 */
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('images');

    if (files && files.length > 0) {
      // Open/create a simple IndexedDB to stash the shared files
      const db = await openShareDB();
      const tx = db.transaction('inbox', 'readwrite');
      const store = tx.objectStore('inbox');

      for (const file of files) {
        if (file && file.size > 0) {
          // Store as a serializable object (blob + metadata)
          await idbPut(store, {
            blob: file,
            name: file.name || `Shared_${Date.now()}.jpg`,
            type: file.type || 'image/jpeg',
            size: file.size,
            sharedAt: Date.now()
          });
        }
      }
    }
  } catch (err) {
    console.error('[SW] Share target error:', err);
  }

  // Redirect to the app — the ?share=pending param tells app.js to check inbox
  const scope = self.registration.scope;
  return Response.redirect(scope + '?share=pending', 303);
}

/** Open a dedicated IndexedDB for share inbox (separate from main app DB) */
function openShareDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('PhotoOrgShareInbox', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('inbox')) {
        db.createObjectStore('inbox', { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Promise wrapper for IDB put */
function idbPut(store, value) {
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
