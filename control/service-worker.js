const CACHE_NAME = 'control-v2';
// La ruta base se saca de aquí para que valga igual servido de /control/ que
// de cualquier otra carpeta.
const BASE_PATH = self.location.pathname.replace('service-worker.js', '');

// Esto se pide siempre a la red. El manifiesto está aquí porque de él depende
// que el navegador pueda o no instalar la web como aplicación suya: servido de
// la caché se quedaba con el de antes.
const RED_PRIMERO = ['', 'index.html', 'app.js', 'manifest.json', 'manifest-gc.json'];

const guardar = [
  BASE_PATH + 'manifest.json',
  BASE_PATH + 'icons/icon-192.png',
  BASE_PATH + 'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(guardar).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.map(n => n !== CACHE_NAME && caches.delete(n))))
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(cs => cs.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  const fichero = url.pathname.split('/').pop() || 'index.html';
  if (RED_PRIMERO.includes(fichero)) {
    event.respondWith(fetch(event.request, { cache: 'no-cache' })
      .catch(() => caches.match(event.request)));
  } else {
    event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)));
  }
});
