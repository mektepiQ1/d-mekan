const V = 'og-v7', FILES = ['ogrenci.html', 'admin.html', 'admin.js', 'ogrenci.js', 'manifest.webmanifest'];
const CDN = 'https://www.gstatic.com/firebasejs/';
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('og-') && x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));
// Aynı kaynak dosyalar: önce ağ, çevrimdışıysa önbellek.
// Firebase JS modülleri (sürüm numaralı, değişmez): önce önbellek, yoksa ağ. Böylece uygulama internetsiz de açılır.
// Firebase veri/kimlik istekleri (googleapis, firebaseio) hiç önbelleğe alınmaz.
// Yalnızca başarılı (2xx) yanıtlar önbelleğe yazılır (hata/yönlendirme sayfaları önbelleği bozamaz).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (e.request.url.startsWith(CDN)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)).catch(() => {}); }
      return r;
    })));
    return;
  }
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)).catch(() => {}); } return r; }).catch(() => caches.match(e.request)));
});
