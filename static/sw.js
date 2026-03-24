/**
 * sw.js — Service Worker DataAuditor
 *
 * Stratégie :
 *   /api/*         → réseau uniquement (jamais en cache)
 *   /static/*      → cache-first + mise à jour en arrière-plan
 *   /              → cache-first + mise à jour en arrière-plan
 *   Hors-ligne     → sert la version en cache si disponible
 */

const CACHE_VERSION = 'v3.19.0';
const CACHE_NAME    = `dataauditor-${CACHE_VERSION}`;

// Ressources pré-cachées à l'installation
const PRECACHE = [
  '/',
  '/static/style.css',
  '/static/js/state.js',
  '/static/js/audit.js',
  '/static/js/results.js',
  '/static/js/source.js',
  '/static/js/wizard.js',
  '/static/manifest.json',
  '/static/favicon.svg',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

// ── Installation : précache ──────────────────────────────────
self.addEventListener('install', event => {
  // Activation immédiate sans attendre la fermeture des anciens clients
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .catch(err => console.warn('[SW] Précache partiel :', err))
  );
});

// ── Activation : nettoyage des anciens caches ────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(n => n.startsWith('dataauditor-') && n !== CACHE_NAME)
          .map(n => {
            console.log('[SW] Suppression ancien cache :', n);
            return caches.delete(n);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch : routage des requêtes ─────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // Ignorer les ressources d'autres origines (CDN, etc.)
  if (url.origin !== self.location.origin) return;

  // API et SSE : toujours réseau, jamais en cache
  if (url.pathname.startsWith('/api/')) return;

  // Tout le reste (UI, static) : cache-first avec revalidation en arrière-plan
  event.respondWith(_cacheFirstWithUpdate(request));
});

/**
 * Cache-first avec mise à jour "stale-while-revalidate".
 *
 * 1. Répond immédiatement depuis le cache si disponible.
 * 2. Lance quand même une requête réseau pour mettre à jour le cache.
 * 3. Si pas de cache et réseau KO → offline fallback sur '/'.
 */
async function _cacheFirstWithUpdate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Revalidation en arrière-plan (on ne bloque pas sur elle)
  const networkPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Répondre depuis le cache, laisser le réseau mettre à jour silencieusement
    return cached;
  }

  // Pas de cache → attendre le réseau
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  // Hors-ligne et rien en cache → page principale (si elle est en cache)
  const fallback = await cache.match('/');
  return fallback || new Response('DataAuditor hors-ligne — relancez le serveur.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
