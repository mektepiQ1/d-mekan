/* veri.js — ağır içerik (soru metinleri, konu anlatımı sayfaları; base64/SVG görseller dahil)
   GitHub'da ŞİFRELİ JSON dosyası olarak durur: data/<sb|dn>/<sorular|aicerik>/<id>.json
   • Öğrenci sayfaları: Pages'ten okur, anahtarı Firebase'deki contentKey düğümünden (lisanslı kullanıcı) alır.
   • Admin sayfaları: GitHub API ile yazar/okur. Token yalnızca admin cihazının localStorage'ında durur. */

const OWNER = 'mektepiQ1', REPO = 'd-mekan';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;
const YAYINDA_DEGIL = 'İçerik henüz yayınlanmadı (GitHub Pages güncelleniyor olabilir). 1-2 dakika sonra tekrar deneyin.';
const yol = (ns, tur, id) => `data/${ns}/${tur}/${id}.json`;
const enc = new TextEncoder(), dec = new TextDecoder();

const b64e = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = t => Uint8Array.from(atob(String(t).replace(/\s/g, '')), c => c.charCodeAt(0));
const ckey = b64 => crypto.subtle.importKey('raw', b64d(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);

async function sifrele(metin, anahtar, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await ckey(anahtar), enc.encode(metin));
  return JSON.stringify({ v: 1, iv: b64e(iv), ct: b64e(new Uint8Array(ct)) });
}
async function coz(dosya, anahtar, aad) {
  const o = JSON.parse(dosya);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv), additionalData: enc.encode(aad) }, await ckey(anahtar), b64d(o.ct));
  return dec.decode(pt);
}
/* Önbellekteki anahtar eskiyse (değişmişse) bir kez Firebase'den tazeler. */
async function cozAnahtarli(dosya, getKey, aad) {
  try { return await coz(dosya, await getKey(), aad); }
  catch (e) {
    if (!getKey.yenile) throw e;
    getKey.yenile();
    return await coz(dosya, await getKey(), aad);
  }
}

/* ================= ÖĞRENCİ TARAFI ================= */
export function ogrenciAnahtar(getir) {
  const f = async () => {
    let k = null; try { k = localStorage.getItem('og-ck'); } catch (_) {}
    if (k) return k;
    k = await getir();
    if (!k) throw new Error('İçerik anahtarı alınamadı (lisans/giriş kontrol edin).');
    try { localStorage.setItem('og-ck', k); } catch (_) {}
    return k;
  };
  f.yenile = () => { try { localStorage.removeItem('og-ck'); } catch (_) {} };
  return f;
}
async function pagesOku(ns, tur, id, v) {
  const u = `${yol(ns, tur, id)}?v=${encodeURIComponent(v || 0)}`;
  let r = await fetch(u);
  if (r.status === 404) r = await fetch(`${u}&r=${Date.now()}`);   // CDN 404'ü önbelleğe almış olabilir
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('İçerik indirilemedi (' + r.status + ')');
  return r.text();
}
/* Firebase anlık görüntüsü gibi davranır: .val() / .exists() */
export async function sorular(ns, tid, v, getKey) {
  const t = await pagesOku(ns, 'sorular', tid, v);
  if (t === null) throw new Error(YAYINDA_DEGIL);
  const obj = JSON.parse(await cozAnahtarli(t, getKey, `${ns}/sorular/${tid}`));
  return { val: () => obj, exists: () => true };
}
export async function aicerik(id, v, getKey, ns = 'sb') {
  const t = await pagesOku(ns, 'aicerik', id, v);
  if (t === null) throw new Error(YAYINDA_DEGIL);
  return await cozAnahtarli(t, getKey, `${ns}/aicerik/${id}`);
}

/* ================= ADMİN TARAFI ================= */
export function tokenAl() {
  let t = ''; try { t = localStorage.getItem('gh-tok') || ''; } catch (_) {}
  if (!t) {
    t = (prompt('GitHub token yapıştırın (github_pat_...). Yalnızca bu cihazda saklanır.') || '').trim();
    if (!/^(github_pat_|ghp_)/.test(t)) throw new Error('GitHub token girilmedi.');
    try { localStorage.setItem('gh-tok', t); } catch (_) {}
  }
  return t;
}
export function tokenDugmesi() {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = '🔑 GitHub';
  b.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9999;opacity:.65;font-size:12px;padding:4px 9px;border-radius:8px;border:1px solid #888;background:#fff;color:#222';
  b.onclick = () => { try { localStorage.removeItem('gh-tok'); } catch (_) {} try { tokenAl(); alert('Token kaydedildi.'); } catch (e) { alert(e.message); } };
  document.body.appendChild(b);
}
/* İçerik anahtarı: Firebase'deki contentKey. Yoksa admin ilk kullanımda üretip yazar. */
export function adminAnahtar(getir, yaz) {
  let p = null;
  const f = () => p || (p = (async () => {
    let k = await getir();
    if (!k) { k = b64e(crypto.getRandomValues(new Uint8Array(32))); await yaz(k); }
    return k;
  })().catch(e => { p = null; throw e; }));
  return f;
}

async function gh(path, opt = {}) {
  const r = await fetch(API + path, {
    cache: 'no-store', ...opt,
    headers: { Authorization: 'Bearer ' + tokenAl(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) }
  });
  if (r.status === 401) { try { localStorage.removeItem('gh-tok'); } catch (_) {} throw new Error('GitHub token geçersiz/süresi dolmuş. 🔑 GitHub düğmesinden yenisini girin.'); }
  return r;
}
async function hata(r) {
  let m = ''; try { m = (await r.json()).message || ''; } catch (_) {}
  return new Error(`GitHub hatası ${r.status}${m ? ': ' + m : ''}${r.status === 403 || r.status === 404 ? ' (token izni: Contents → Read and write ve doğru repo seçili mi?)' : ''}`);
}
async function ghOku(path) {
  const r = await gh(path);
  if (r.status === 404) return null;
  if (!r.ok) throw await hata(r);
  const j = await r.json();
  let text = j.content ? atob(j.content.replace(/\s/g, '')) : '';
  if (!text && j.size > 0) {              // 1 MB üstü dosyalarda içerik ham olarak ayrıca istenir
    const r2 = await gh(path, { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!r2.ok) throw await hata(r2);
    text = await r2.text();
  }
  return { sha: j.sha, text };
}
/* fn(eskiMetin|null) → yeni metin | null (null = dosyayı sil). Çakışmada baştan dener. */
async function dosyaDegistir(path, mesaj, fn) {
  for (let d = 0; d < 3; d++) {
    const o = await ghOku(path);
    const yeni = await fn(o ? o.text : null);
    if (yeni === null) {
      if (!o) return;
      const r = await gh(path, { method: 'DELETE', body: JSON.stringify({ message: mesaj, sha: o.sha }) });
      if (r.ok || r.status === 404) return;
      if (r.status === 409 || r.status === 422) continue;
      throw await hata(r);
    }
    const body = { message: mesaj, content: btoa(yeni) };
    if (o) body.sha = o.sha;
    const r = await gh(path, { method: 'PUT', body: JSON.stringify(body) });
    if (r.ok) return;
    if (r.status === 409 || r.status === 422) continue;
    throw await hata(r);
  }
  throw new Error('GitHub çakışması: lütfen tekrar deneyin.');
}

let kuyruk = Promise.resolve();            // yazmalar sırayla (aynı dalda eşzamanlı commit çakışır)
const sirala = fn => { const p = kuyruk.then(fn); kuyruk = p.catch(() => {}); return p; };

const sv = x => (x && typeof x === 'object' && !Array.isArray(x))
  ? (x['.sv'] === 'timestamp' ? Date.now() : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, sv(v)])))
  : x;
function ayarla(obj, yl, v) {
  let n = obj;
  for (let i = 0; i < yl.length - 1; i++) {
    if (!n[yl[i]] || typeof n[yl[i]] !== 'object') { if (v === null || v === undefined) return; n[yl[i]] = {}; }
    n = n[yl[i]];
  }
  const s = yl[yl.length - 1];
  if (v === null || v === undefined) delete n[s]; else n[s] = sv(v);
}

export async function testOku(ns, tid, getKey) {
  const o = await ghOku(yol(ns, 'sorular', tid));
  if (!o) return { val: () => null, exists: () => false };
  const obj = JSON.parse(await cozAnahtarli(o.text, getKey, `${ns}/sorular/${tid}`));
  return { val: () => obj, exists: () => true };
}
export async function aicerikOku(ns, id, getKey) {
  const o = await ghOku(yol(ns, 'aicerik', id));
  return o ? await cozAnahtarli(o.text, getKey, `${ns}/aicerik/${id}`) : '';
}
/* agir: Firebase çoklu-yol güncellemesindeki 'sorular/…' ve 'aicerik/…' anahtarları (değer null = sil) */
export function ghUygula(ns, agir, getKey) {
  return sirala(async () => {
    const anahtar = await getKey();
    const testler = new Map(), sayfalar = new Map();
    for (const [k, v] of Object.entries(agir)) {
      const p = k.split('/');
      if (p[0] === 'sorular' && p[1]) { if (!testler.has(p[1])) testler.set(p[1], []); testler.get(p[1]).push([p.slice(2), v]); }
      else if (p[0] === 'aicerik' && p[1]) sayfalar.set(p[1], v);
    }
    for (const [tid, islemler] of testler) {
      const aad = `${ns}/sorular/${tid}`;
      await dosyaDegistir(yol(ns, 'sorular', tid), `${ns}: sorular/${tid}`, async eski => {
        let obj = eski ? JSON.parse(await coz(eski, anahtar, aad)) : {}, sil = false;
        for (const [yl, v] of islemler) {
          if (!yl.length) { if (v === null) { sil = true; obj = {}; } else { sil = false; obj = sv(v) || {}; } }
          else { sil = false; ayarla(obj, yl, v); }
        }
        return sil ? null : await sifrele(JSON.stringify(obj), anahtar, aad);
      });
    }
    for (const [id, v] of sayfalar) {
      const aad = `${ns}/aicerik/${id}`;
      await dosyaDegistir(yol(ns, 'aicerik', id), `${ns}: aicerik/${id}`, async () => v === null ? null : await sifrele(String(v), anahtar, aad));
    }
  });
}
