/* Soru sayfası çevrimdışı önbelleği. soru.html'in yanında durur (aynı klasör), her sınıf için aynı dosya kopyalanır.
   Sayfayı ve dış kütüphaneleri (Bootstrap, simgeler, Firebase modülleri) ilk açılışta saklar; sonra internetsiz de açılır.
   Sorular zaten cihazın veri deposunda (önbellekte) durur; veri/kimlik istekleri ve paket dosyaları bu dosyaya takılmaz. */
const V = 'soru-v1:' + self.registration.scope;       // klasöre özel ad: başka sayfaların önbelleğiyle karışmaz
const KUTUPHANE = ['https://www.gstatic.com/firebasejs/', 'https://cdn.jsdelivr.net/', 'https://cdnjs.cloudflare.com/'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('soru-') && x.endsWith(self.registration.scope) && x !== V).map(x => caches.delete(x))))
    .then(() => self.clients.claim())
));

const sakla = (req, r) => {
  if (r && (r.ok || r.type === 'opaque')) { const c = r.clone(); caches.open(V).then(x => x.put(req, c)).catch(() => {}); }
  return r;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url, u = new URL(url);

  // Dış kütüphaneler (sürüm numaralı, değişmez): önce önbellek, yoksa ağ
  if (KUTUPHANE.some(p => url.startsWith(p))) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => sakla(req, r))));
    return;
  }
  if (u.origin !== location.origin) return;                 // Firebase veri/kimlik istekleri vb.: dokunma
  if (u.pathname.includes('/paket/')) return;               // şifreli paket dosyaları: sayfa kendi yönetir
  if (!u.pathname.startsWith(new URL(self.registration.scope).pathname)) return;   // bu klasörün dışı: dokunma

  // Sayfanın kendisi ve aynı klasördeki dosyalar: önce ağ (güncel olsun), çevrimdışıysa önbellek
  e.respondWith(fetch(req).then(r => sakla(req, r)).catch(() =>
    caches.match(req, { ignoreSearch: true }).then(hit => hit || Response.error())
  ));
});
