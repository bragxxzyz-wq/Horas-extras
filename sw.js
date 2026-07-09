const CACHE = 'horas-extras-v2'
const URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/firebase-config.js'
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  )
  clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    )
    return
  }
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  )
})
