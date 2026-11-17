/* İçerik paketi — SINIF BAŞINA ayrı dosya: icerik-<sınıfNo>.json
   Yönetici her sınıf için ayrı şifreli paket indirir. Her paket yalnızca o sınıfın dersini/konusunu/denemesini
   ve bunlara bağlı soru, konu anlatımı, video verilerini içerir. Şifre anahtarı sınıfa özeldir ve yalnızca o
   sınıfın öğrenci kodunun içindedir; başka sınıfın paketi o kodla açılamaz. */
import { lisans } from './kapi.js';
import { paketAl, paketYaz } from './yerel-db.js';

const KOKLER = ['classes', 'lessons', 'links', 'options', 'topics', 'exams', 'sb', 'dn'];
const SURUM = 'ob_paket_v';
const b64e = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const akis = async (veri, S, ...a) => new Uint8Array(await new Response(new Blob([veri]).stream().pipeThrough(new S(...a))).arrayBuffer());

/* Sınıf anahtarı = HMAC-SHA256(ana anahtar, 'sinif:<no>') ilk 16 bayt (kod-uret.html ile aynı) */
async function sinifAnahtari(ana, cid) {
  const k = await crypto.subtle.importKey('raw', ana, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('sinif:' + cid))).slice(0, 16);
}
const aes = (raw, kul) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [kul]);


/* ---------- Kütüphane (ogrencikitap): kendi IndexedDB'sinde durur; pakete eklenir ---------- */
const KB = 'ogrencikitap', KD = ['items', 'covers', 'thumbs', 'texts', 'meta'];
const kbAc = () => new Promise((res, rej) => {
  const r = indexedDB.open(KB, 2);
  r.onupgradeneeded = () => { const d = r.result; ['items', 'covers', 'thumbs', 'texts'].forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, n === 'items' ? { keyPath: 'id' } : undefined); }); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function kutuphaneAl() {                       // → {items, covers, thumbs, texts, meta}  (anahtar türleri korunsun diye [anahtar, değer] çiftleri)
  const d = await kbAc(), t = d.transaction(KD);
  const oku = n => { const st = t.objectStore(n); return Promise.all([rq(st.getAllKeys()), rq(st.getAll())]); };
  const [it, cv, th, tx, me] = await Promise.all(KD.map(oku));
  d.close();
  const cift = ([k, v]) => k.map((x, i) => [x, v[i]]);
  const blob = async c => Promise.all(cift(c).filter(([, b]) => b instanceof Blob).map(async ([k, b]) => [k, { t: b.type, b: b64e(new Uint8Array(await b.arrayBuffer())) }]));
  return { items: it[1], covers: await blob(cv), thumbs: await blob(th), texts: cift(tx), meta: cift(me) };
}
async function kutuphaneYaz(k) {
  const d = await kbAc(), t = d.transaction(KD, 'readwrite');
  KD.forEach(n => t.objectStore(n).clear());
  (k.items || []).forEach(i => t.objectStore('items').put(i));
  ['covers', 'thumbs'].forEach(n => (k[n] || []).forEach(([id, x]) => t.objectStore(n).put(new Blob([b64d(x.b)], { type: x.t }), id)));
  (k.texts || []).forEach(([id, v]) => t.objectStore('texts').put(v, id));
  (k.meta || []).forEach(([id, v]) => t.objectStore('meta').put(v, id));
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
  d.close();
}

/* Tüm veriden yalnızca bir sınıfa ait olanları ayıklar */
const S = x => String(x);
const sec = (o, f) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => v && typeof v === 'object' && f(v, k)));
const idler = o => new Set(Object.values(o).map(v => S(v.id)));
function dilimle(d, cid) {
  const sinifIcin = o => sec(o, v => +v.class_id === cid);
  const dersler = sinifIcin(d.lessons), konular = sinifIcin(d.topics), denemeler = sinifIcin(d.exams);
  const L = idler(dersler), T = idler(konular), E = idler(denemeler);
  const sb = d.sb || {}, dn = d.dn || {};
  const pick = (o, anahtarlar) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => anahtarlar.has(k)));
  const sbKonu = sec(sb.konular, v => L.has(S(v.ders_id))), sbTest = sec(sb.testler, v => v.konu_id in sbKonu);
  const aKonu = sec(sb.akonular, v => T.has(S(v.ders_id))), aSayfa = sec(sb.asayfalar, v => v.konu_id in aKonu);
  const dnKonu = sec(dn.konular, v => E.has(S(v.ders_id))), dnTest = sec(dn.testler, v => v.konu_id in dnKonu);
  return {
    classes: sec(d.classes, v => +v.id === cid), lessons: dersler, topics: konular, exams: denemeler,
    links: d.links, options: d.options,
    sb: { meta: sb.meta, konular: sbKonu, testler: sbTest, sorular: pick(sb.sorular, new Set(Object.keys(sbTest))),
      akonular: aKonu, asayfalar: aSayfa, aicerik: pick(sb.aicerik, new Set(Object.keys(aSayfa))),
      videolar: sec(sb.videolar, v => L.has(S(v.ders_id))) },
    dn: { meta: dn.meta, konular: dnKonu, testler: dnTest, sorular: pick(dn.sorular, new Set(Object.keys(dnTest))) }
  };
}

export async function disaAktar(cid) {
  const l = await lisans;
  if (l.rol !== 1) throw new Error('yetki');
  const v = Date.now();
  let ham = new TextEncoder().encode(JSON.stringify({ v, d: dilimle(await paketAl(KOKLER), cid), k: await kutuphaneAl() })), z = 0;
  if (self.CompressionStream) { ham = await akis(ham, CompressionStream, 'gzip'); z = 1; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(await sinifAnahtari(l.key, cid), 'encrypt'), ham));
  return JSON.stringify({ s: 2, k: cid, v, z, iv: b64e(iv), c: b64e(c) });
}

export async function iceAktar(metin) {
  const l = await lisans, j = JSON.parse(metin);
  if (l.rol !== 0 || j.k !== l.sinif) throw new Error('sinif');          // yalnızca kendi sınıfının paketi
  let ham = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(j.iv) }, await aes(l.key, 'decrypt'), b64d(j.c)));
  if (j.z) ham = await akis(ham, DecompressionStream, 'gzip');
  const p = JSON.parse(new TextDecoder().decode(ham));
  await paketYaz(p.d, KOKLER);
  if (p.k) await kutuphaneYaz(p.k);
  try { localStorage.setItem(SURUM, String(j.v)); } catch (_) {}
}

async function guncelle() {                          // → {degisti, hata}  (yalnız öğrenci cihazı, yalnız kendi sınıfı)
  const l = await lisans;
  if (l.rol !== 0) return { degisti: false };
  if (!navigator.onLine) return { degisti: false, hata: 'internet' };
  try {
    const r = await fetch('icerik-' + l.sinif + '.json', { cache: 'no-store' });
    if (!r.ok) return { degisti: false, hata: 'yok' };
    const t = await r.text(), j = JSON.parse(t);
    if ((+localStorage.getItem(SURUM) || 0) >= j.v) return { degisti: false };
    try { await iceAktar(t); } catch (_) { return { degisti: false, hata: 'cozulemedi' }; }
    return { degisti: true };
  } catch (_) { return { degisti: false, hata: 'internet' }; }
}

/* ---------- Yönetici yedeği: tüm içerik + kütüphane, ana anahtarla şifreli ---------- */
async function yedekAl() {
  const l = await lisans; if (l.rol !== 1) throw new Error('yetki');
  const v = Date.now();
  let ham = new TextEncoder().encode(JSON.stringify({ v, d: await paketAl(KOKLER), k: await kutuphaneAl() })), z = 0;
  if (self.CompressionStream) { ham = await akis(ham, CompressionStream, 'gzip'); z = 1; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(l.key, 'encrypt'), ham));
  return JSON.stringify({ s: 3, v, z, iv: b64e(iv), c: b64e(c) });
}
/* Yedek dosyası VEYA Firebase "JSON dışa aktar" dosyası kabul edilir */
async function yedekCoz(metin) {
  const l = await lisans, j = JSON.parse(metin);
  if (j && j.s === 3 && j.iv && j.c) {
    let ham = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(j.iv) }, await aes(l.key, 'decrypt'), b64d(j.c)));
    if (j.z) ham = await akis(ham, DecompressionStream, 'gzip');
    const p = JSON.parse(new TextDecoder().decode(ham));
    return { d: p.d, k: p.k || null, kaynak: 'yedek' };
  }
  if (j && typeof j === 'object' && KOKLER.some(x => x in j)) return { d: j, k: null, kaynak: 'firebase' };
  throw new Error('bicim');
}

const yonetici = /admin\.html$/i.test(location.pathname);
lisans.then(() => {
  if (!yonetici) {
    guncelle().then(r => {
      if (r.degisti) return location.reload();
      if (r.hata) { window.__paketHata = r.hata; dispatchEvent(new Event('paket-hata')); }
    });
    return;
  }
  const app = document.getElementById('app');
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const kart = '<div class="card" id="paketKart"><h2>Satış paketleri (sınıf başına)</h2><p>Her sınıf için ayrı şifreli dosya indirin ve siteye (GitHub) <b>icerik-&lt;sınıf no&gt;.json</b> adıyla yükleyin. Öğrenci yalnızca kendi sınıfının dosyasını indirir (Kütüphane her pakete eklenir). Öğrenci kodunu üretirken aynı <b>sınıf no</b>\'yu yazın.</p><div id="paketListe">Sınıflar yükleniyor…</div><div class="hint" id="paketNot"></div>' +
    '<h2 style="margin-top:20px">Yedek ve geri yükleme</h2><p>İçerikleriniz yalnızca <b>bu cihazda</b> durur. Tarayıcı verisi silinirse hepsi gider; düzenli yedek alın ve dosyayı başka yerde de saklayın.</p><div class="hint" id="yedekDurum"></div>' +
    '<button type="button" id="yedekAl" style="margin:4px 0;display:block;width:100%">Yedek indir</button><button type="button" id="yedekYukle" style="margin:4px 0;display:block;width:100%">Yedekten / Firebase dışa aktarımından yükle</button><input type="file" id="yedekDosya" accept=".json,application/json" hidden><div class="hint" id="yedekNot"></div></div>';
  const yedekYaz = () => {
    const el = document.getElementById('yedekDurum'); if (!el) return;
    const t = +localStorage.getItem('ob_yedek') || 0, gun = t ? Math.floor((Date.now() - t) / 864e5) : null;
    el.innerHTML = t ? (gun > 7 ? '<b style="color:#c53030">Son yedek ' + gun + ' gün önce. Yeni yedek alın.</b>' : 'Son yedek: ' + new Date(t).toLocaleString('tr')) : '<b style="color:#c53030">Henüz yedek almadınız!</b>';
  };
  const doldur = async () => {
    const kutu = document.getElementById('paketListe');
    const sn = Object.values((await paketAl(['classes'])).classes || {}).filter(c => c && c.id != null).sort((a, b) => a.id - b.id);
    kutu.innerHTML = sn.length ? sn.map(c => `<button type="button" class="paketIndir" data-sinif="${+c.id}" style="margin:4px 0;display:block;width:100%">${esc(c.class_name)} — Sınıf no ${+c.id} · icerik-${+c.id}.json indir</button>`).join('') : 'Henüz sınıf eklenmemiş.';
  };
  const koy = () => { if (app && !document.getElementById('paketKart') && (location.hash.slice(1) || 'dashboard') === 'dashboard' && app.firstElementChild) { app.insertAdjacentHTML('afterbegin', kart); doldur().catch(() => {}); yedekYaz(); } };
  new MutationObserver(koy).observe(app, { childList: true }); koy();
  const indir = (metin, ad) => { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([metin], { type: 'application/json' })); a.href = url; a.download = ad; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); };
  document.addEventListener('click', async e => {
    const id = e.target.id, cid = +(e.target.dataset && e.target.dataset.sinif);
    if (id === 'yedekYukle') return void document.getElementById('yedekDosya').click();
    if (id === 'yedekAl') {
      const n = document.getElementById('yedekNot'); n.textContent = 'Hazırlanıyor…';
      try { indir(await yedekAl(), 'yedek-' + new Date().toISOString().slice(0, 10) + '.json'); localStorage.setItem('ob_yedek', String(Date.now())); n.textContent = 'Yedek indirildi. Dosyayı güvenli bir yerde saklayın.'; yedekYaz(); }
      catch (_) { n.textContent = 'Yedek alınamadı.'; }
      return;
    }
    if (!cid) return;
    const not = document.getElementById('paketNot'); not.textContent = 'Hazırlanıyor…';
    try { indir(await disaAktar(cid), 'icerik-' + cid + '.json'); not.textContent = 'İndirildi: icerik-' + cid + '.json · ' + new Date().toLocaleString('tr'); }
    catch (_) { not.textContent = 'Paket oluşturulamadı.'; }
  });
  document.addEventListener('change', async e => {
    if (e.target.id !== 'yedekDosya' || !e.target.files[0]) return;
    const n = document.getElementById('yedekNot'), dosya = e.target.files[0]; e.target.value = '';
    try {
      const y = await yedekCoz(await dosya.text()), sayi = o => Object.keys(o || {}).length;
      const ozet = `${y.kaynak === 'firebase' ? 'Firebase dışa aktarımı' : 'Yedek'}: ${sayi(y.d.classes)} sınıf, ${sayi(y.d.lessons)} ders, ${sayi(y.d.topics)} konu anlatımı, ${sayi(y.d.exams)} deneme` + (y.k ? `, ${(y.k.items || []).length} kütüphane kitabı` : '');
      if (!confirm(ozet + '.\n\nBu cihazdaki mevcut içeriğin TAMAMI silinip bununla değiştirilecek. Devam edilsin mi?')) return void (n.textContent = 'Vazgeçildi.');
      await paketYaz(y.d, KOKLER);
      if (y.k) await kutuphaneYaz(y.k);
      n.textContent = 'Yüklendi. Sayfa yenileniyor…'; setTimeout(() => location.reload(), 800);
    } catch (_) { n.textContent = 'Dosya okunamadı. Bu uygulamanın yedeği ya da Firebase "JSON dışa aktar" dosyası olmalı (ve bu yönetici kodu ile alınmış olmalı).'; }
  });
});
