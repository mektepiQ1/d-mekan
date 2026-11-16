const V = 'og-v16';
const FILES = [
  'ogrenci.html', 'ogrenci.js', 'yerel-db.js', 'kapi.js', 'paket.js', 'manifest.webmanifest',
  'admin.html', 'admin.js',
  'soru.html', 'soruadmin.html', 'deneme.html', 'denemeadmin.html',
  'konu.html', 'konuadmin.html', 'youtubeadmin.html',
  'defter.html', 'dersprogram.html', 'ogrencikitap.html', 'ogrencikitapadmin.html'
];
const EXT = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];
const HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const isExt = u => HOSTS.includes(u.hostname);

// CSS içindeki yazı tipi dosyalarını da önbelleğe alır.
async function grab(c, url, d = 0) {
  if (await c.match(url)) return;
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) return;
  await c.put(url, r.clone());
  if (d > 3 || !(/\.css(\?|$)|fonts\.googleapis/.test(url))) return;
  const t = await r.text();
  for (const m of t.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) if (!m[1].startsWith('data:')) await grab(c, new URL(m[1], url).href, d + 1).catch(() => {});
}

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(V);
  await Promise.all(FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {})));
  await Promise.all(EXT.map(u => grab(c, u).catch(() => {})));
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));

// Dış kaynaklar (CDN, yazı tipi): önce önbellek.
// Aynı kaynak dosyalar: önce ağ (güncellemeler gelsin), çevrimdışıysa önbellek. Veri zaten cihazın IndexedDB'sindedir.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (isExt(u)) {
    e.respondWith(caches.match(e.request.url).then(hit => hit || fetch(e.request.url, { mode: 'cors' }).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request.url, c)).catch(() => {}); }
      return r;
    }).catch(() => fetch(e.request))));
    return;
  }
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)).catch(() => {}); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
