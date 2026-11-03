const V = 'og-v3', FILES = ['ogrenci.html', 'admin.html', 'ogrenci.js', 'firebase.js', 'manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));
// Yalnızca aynı kaynak dosyalar: önce ağ, çevrimdışıysa önbellek. Firebase istekleri hiç önbelleğe alınmaz.
// Yalnızca başarılı (2xx) ve doğrudan aynı kaynaktan gelen yanıtlar önbelleğe yazılır (hata/yönlendirme sayfaları önbelleği bozamaz).
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)).catch(() => {}); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
