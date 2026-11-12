const V = 'og-v14';
const FILES = ['ogrenci.html', 'admin.html', 'admin.js', 'ogrenci.js', 'manifest.webmanifest', 'kapi.js', 'soru.html', 'deneme.html', 'konu.html', 'defter.html', 'dersprogram.html', 'muzik.js', 'kitap-tek.js'];
const FB = 'https://www.gstatic.com/firebasejs/13.1.0/';
const EXT = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-database.js'
];
const HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];
const isExt = u => HOSTS.includes(u.hostname) && (u.hostname !== 'www.gstatic.com' || u.pathname.startsWith('/firebasejs/'));

// CSS içindeki yazı tipi dosyalarını ve Firebase modüllerinin alt modüllerini de önbelleğe alır.
async function grab(c, url, d = 0) {
  if (await c.match(url)) return;
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) return;
  await c.put(url, r.clone());
  if (d > 3) return;
  const css = /\.css(\?|$)|fonts\.googleapis/.test(url), js = url.startsWith(FB) && /\.js(\?|$)/.test(url);
  if (!css && !js) return;
  const t = await r.text();
  const re = css ? /url\(\s*['"]?([^'")]+)['"]?\s*\)/g : /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const m of t.matchAll(re)) if (!m[1].startsWith('data:')) await grab(c, new URL(m[1], url).href, d + 1).catch(() => {});
}

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(V);
  await Promise.all(FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {})));
  await Promise.all(EXT.map(u => grab(c, u).catch(() => {})));
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));

// Dış kaynaklar (CDN, yazı tipi, Firebase JS): önce önbellek. Firebase veri/kimlik istekleri hiç önbelleğe alınmaz.
// Aynı kaynak dosyalar: önce ağ (güncellemeler gelsin), çevrimdışıysa önbellek.
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
  // Ses dosyaları ve aralık (Range) istekleri servis çalışanından geçmesin: müzik doğrudan ağdan akar.
  if (e.request.headers.has('range') || /\.(mp3|m4a|ogg|wav)$/i.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)).catch(() => {}); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
