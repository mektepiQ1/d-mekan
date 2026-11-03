const V = 'og-v4', FILES = ['ogrenci.html', 'admin.html', 'ogrenci.js', 'firebase.js', 'manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));
// Yalnızca aynı kaynak dosyalar: önce ağ, çevrimdışıysa önbellek. Firebase istekleri hiç önbelleğe alınmaz.
// Yalnızca başarılı (2xx) ve doğrudan aynı kaynaktan gelen yanıtlar önbelleğe yazılır (hata/yönlendirme sayfaları önbelleği bozamaz).
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Sınıfa özel dinamik manifest: manifest.webmanifest?p=<sınıfId>&n=<ad>
  if (e.request.method === 'GET' && u.origin === location.origin && u.pathname.endsWith('/manifest.webmanifest') && u.searchParams.has('p')) {
    const base = new URL('./', location.href).href, p = u.searchParams.get('p').replace(/[^\w-]/g, '').slice(0, 40);
    const name = (u.searchParams.get('n') || 'Öğrenci Bahçesi').slice(0, 40);
    const m = {
      id: base + 'ogrenci.html?paket=' + p, name: 'Öğrenci Bahçesi – ' + name, short_name: name.slice(0, 12), lang: 'tr',
      start_url: base + 'ogrenci.html?paket=' + p, scope: base, display: 'standalone', orientation: 'any',
      background_color: '#f5f7fa', theme_color: '#2c3e66',
      icons: [{ src: base + 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
              { src: base + 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
    };
    e.respondWith(new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/manifest+json' } }));
    return;
  }
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)).catch(() => {}); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
