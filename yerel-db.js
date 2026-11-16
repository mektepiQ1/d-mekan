/* Yerel veritabanı — Firebase gerektirmez, internet gerektirmez.
   Tüm veri bu cihazın IndexedDB'sinde ("ogrenci-bahcesi-yerel") saklanır.
   Sayfalardaki mevcut kodun (ref / get / set / update / push / query ...) değişmeden çalışması için
   Firebase Realtime Database'in kullanılan alt kümesiyle aynı adlarda dışa aktarım yapar.

   Depolama biçimi: her yaprak değer, tam yolu anahtar olacak şekilde tek kayıttır (ör. "sb/sorular/abc/xyz/metin").
   Böylece büyük veri ağaçlarında yalnızca değişen yollar yazılır. */

import './kapi.js';   // lisans kapısı: her sayfa bu modülü yüklediği için kapı her yerde çalışır

const DB_ADI = 'ogrenci-bahcesi-yerel', DEPO = 'kv';

let dbp = null;
const ac = () => dbp || (dbp = new Promise((res, rej) => {
  const r = indexedDB.open(DB_ADI, 1);
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(DEPO)) r.result.createObjectStore(DEPO); };
  r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
  r.onerror = () => { dbp = null; rej(r.error); };
  r.onblocked = () => { dbp = null; rej(new Error('IndexedDB engellendi')); };
}));
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}

const temiz = y => String(y == null ? '' : y).split('/').filter(Boolean).join('/');

/* ---------- Okuma ---------- */
async function okuKayitlar(yol) {                 // yolun kendisi + altındaki tüm yapraklar: [[anahtar, değer]]
  const d = await ac();
  return new Promise((res, rej) => {
    const t = d.transaction(DEPO, 'readonly'), s = t.objectStore(DEPO);
    const aralik = yol ? IDBKeyRange.bound(yol, yol + '0', false, true) : undefined;   // '/' < '0'
    const ka = s.getAllKeys(aralik), de = s.getAll(aralik);
    t.oncomplete = () => {
      const out = [];
      ka.result.forEach((k, i) => { if (!yol || k === yol || k.startsWith(yol + '/')) out.push([k, de.result[i]]); });
      res(out);
    };
    t.onerror = t.onabort = () => rej(t.error || new Error('idb'));
  });
}
async function oku(yol) {                         // ham ağaç (dizi dönüşümü yok) ya da yaprak ya da null
  const kayitlar = await okuKayitlar(yol), bas = yol ? yol.length + 1 : 0, kok = {};
  for (const [k, v] of kayitlar) {
    if (k === yol) return v;
    const p = k.slice(bas).split('/');
    let o = kok;
    for (let i = 0; i < p.length - 1; i++) o = o[p[i]] || (o[p[i]] = {});
    o[p[p.length - 1]] = v;
  }
  return Object.keys(kok).length ? kok : null;
}
const TAMSAYI = /^(0|[1-9]\d*)$/;
function dizile(v) {                              // Firebase gibi: 0..n anahtarlı nesne dizi olarak döner
  if (v === null || typeof v !== 'object') return v;
  const ks = Object.keys(v), r = {};
  let tam = ks.length > 0, max = -1;
  for (const k of ks) { r[k] = dizile(v[k]); if (TAMSAYI.test(k)) max = Math.max(max, +k); else tam = false; }
  if (tam && max < 2 * ks.length) { const a = []; for (let i = 0; i <= max; i++) a.push(r[i] === undefined ? null : r[i]); return a; }
  return r;
}

/* ---------- Sıralama ---------- */
const rank = v => v == null ? 0 : v === false ? 1 : v === true ? 2 : typeof v === 'number' ? 3 : typeof v === 'string' ? 4 : 5;
function kiyas(a, b) {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 3) return a - b;
  if (ra === 4) return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}
const anahtarKiyas = (a, b) => {
  const ia = TAMSAYI.test(a), ib = TAMSAYI.test(b);
  if (ia && ib) return +a - +b;
  if (ia) return -1;
  if (ib) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/* ---------- Anlık görüntü (DataSnapshot) ---------- */
class Goruntu {
  constructor(yol, ham, sirali) { this._y = yol; this._h = ham == null ? null : ham; this._s = sirali || null; }
  val() { return this._h == null ? null : (this._s ? dizile(Object.fromEntries(this._s)) : dizile(this._h)); }
  exists() { return this._h != null; }
  get key() { const p = this._y.split('/'); return p[p.length - 1] || null; }
  _cocuklar() {
    if (this._s) return this._s;
    if (this._h === null || typeof this._h !== 'object') return [];
    return Object.keys(this._h).sort(anahtarKiyas).map(k => [k, this._h[k]]);
  }
  forEach(fn) { for (const [k, v] of this._cocuklar()) if (fn(new Goruntu(this._y ? this._y + '/' + k : k, v)) === true) return true; return false; }
  child(p) {
    let h = this._s ? Object.fromEntries(this._s) : this._h;
    for (const k of temiz(p).split('/').filter(Boolean)) { h = h && typeof h === 'object' ? h[k] : null; if (h == null) break; }
    return new Goruntu(temiz(this._y + '/' + p), h);
  }
  hasChild(p) { return this.child(p).exists(); }
  hasChildren() { return this._cocuklar().length > 0; }
  numChildren() { return this._cocuklar().length; }
}

/* ---------- Yazma ---------- */
const varMi = v => !!v && typeof v === 'object' && ('.sv' in v || Object.values(v).some(varMi));
async function coz(yol, v) {                      // serverTimestamp() / increment() değerlerini çözer
  if (!varMi(v)) return v;
  if ('.sv' in v) return v['.sv'] === 'timestamp' ? Date.now() : (Number(await oku(yol)) || 0) + Number(v['.sv'].increment || 0);
  const o = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) o[k] = await coz(yol + '/' + k, v[k]);
  return o;
}
function duzlestir(yol, v, cikti) {
  if (v === null || v === undefined) return;
  if (typeof v === 'object') {
    (Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v)).forEach(([k, x]) => duzlestir(yol ? yol + '/' + k : k, x, cikti));
    return;
  }
  if (typeof v === 'number' && !isFinite(v)) return;
  if (typeof v === 'function') return;
  cikti.set(yol, v);
}
async function degistir(islemler) {               // [[yol, değer]] — hepsi tek işlemde, sırayla
  const liste = [];
  for (const [y, v] of islemler) liste.push([temiz(y), await coz(temiz(y), v)]);
  const d = await ac();
  return new Promise((res, rej) => {
    const t = d.transaction(DEPO, 'readwrite'), s = t.objectStore(DEPO);
    t.oncomplete = () => res();
    t.onerror = t.onabort = () => rej(t.error || new Error('idb'));
    const sonraki = i => {
      if (i >= liste.length) return;
      const [y, v] = liste[i];
      if (!y) {                                   // kök: her şeyi sil
        s.clear();
        const c = new Map(); duzlestir('', v, c); c.forEach((x, k) => s.put(x, k));
        return sonraki(i + 1);
      }
      const p = y.split('/');
      for (let j = 1; j < p.length; j++) s.delete(p.slice(0, j).join('/'));   // üstte yaprak varsa kalkar
      const rq = s.getAllKeys(IDBKeyRange.bound(y, y + '0', false, true));
      rq.onsuccess = () => {
        rq.result.forEach(k => { if (k === y || k.startsWith(y + '/')) s.delete(k); });
        const c = new Map(); duzlestir(y, v, c); c.forEach((x, k) => s.put(x, k));
        sonraki(i + 1);
      };
    };
    sonraki(0);
  });
}

/* ---------- Firebase uyumlu dışa aktarım: uygulama / veritabanı ---------- */
export const initializeApp = () => ({ _yerel: true });
export const deleteApp = async () => {};
export const getDatabase = () => ({ _tip: 'db' });

const yonOf = (kok, yol) => {
  const y = temiz(yol);
  const p = y.split('/');
  return { _tip: 'ref', yol: y, key: p[p.length - 1] || null, root: kok };
};
export const ref = (kok, yol = '') => yonOf(kok, kok && kok._tip === 'ref' ? temiz(kok.yol + '/' + yol) : yol);
export const child = (r, yol) => ref(r, yol);

export const serverTimestamp = () => ({ '.sv': 'timestamp' });
export const increment = n => ({ '.sv': { increment: n } });

export const orderByChild = alan => ({ _k: 'sira', alan });
export const equalTo = deger => ({ _k: 'esit', deger });
export const limitToLast = n => ({ _k: 'son', n });
export const limitToFirst = n => ({ _k: 'ilk', n });
export const query = (r, ...kisitlar) => ({ _tip: 'sorgu', yol: r.yol, kisitlar });

export async function get(hedef) {
  const ham = await oku(hedef.yol);
  if (hedef._tip !== 'sorgu') return new Goruntu(hedef.yol, ham);
  if (ham === null || typeof ham !== 'object') return new Goruntu(hedef.yol, null);
  const sira = hedef.kisitlar.find(k => k._k === 'sira');
  const alan = sira ? sira.alan : null;
  const deger = c => alan == null ? null : alan.split('/').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), c);
  let liste = Object.keys(ham).map(k => [k, ham[k]]);
  liste.sort((a, b) => (alan ? kiyas(deger(a[1]), deger(b[1])) : 0) || anahtarKiyas(a[0], b[0]));
  for (const k of hedef.kisitlar) {
    if (k._k === 'esit') liste = liste.filter(([, v]) => kiyas(deger(v), k.deger) === 0 && rank(deger(v)) === rank(k.deger));
    if (k._k === 'son') liste = liste.slice(Math.max(0, liste.length - k.n));
    if (k._k === 'ilk') liste = liste.slice(0, k.n);
  }
  return new Goruntu(hedef.yol, Object.fromEntries(liste), liste);
}
export const set = (r, deger) => degistir([[r.yol, deger]]);
export const remove = r => degistir([[r.yol, null]]);
export const update = (r, nesne) => degistir(Object.entries(nesne || {}).map(([k, v]) => [r.yol ? r.yol + '/' + k : k, v]));

/* push(): zamana göre sıralanabilir benzersiz anahtar (Firebase ile aynı mantık) */
const KAR = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let sonZ = 0; const rnd = [];
function pushId() {
  let simdi = Date.now(); const ayni = simdi === sonZ; sonZ = simdi;
  const ts = new Array(8);
  for (let i = 7; i >= 0; i--) { ts[i] = KAR.charAt(simdi % 64); simdi = Math.floor(simdi / 64); }
  let id = ts.join('');
  if (!ayni) for (let i = 0; i < 12; i++) rnd[i] = Math.floor(Math.random() * 64);
  else { let i = 11; for (; i >= 0 && rnd[i] === 63; i--) rnd[i] = 0; rnd[i]++; }
  for (let i = 0; i < 12; i++) id += KAR.charAt(rnd[i]);
  return id;
}
export function push(r, deger) {
  const yeni = ref(r.root || r, (r.yol ? r.yol + '/' : '') + pushId());
  if (deger === undefined) return yeni;
  const p = set(yeni, deger).then(() => yeni);
  return Object.assign(Object.create(yeni), { then: (a, b) => p.then(a, b), catch: b => p.catch(b) });
}

/* ---------- Oturum: yok. Cihazdaki tek kullanıcı hem öğrenci hem yönetici sayılır. ---------- */
const KULLANICI = { uid: 'yerel-kullanici', email: 'Bu cihaz', displayName: 'Bu cihaz' };
const hazir = (async () => {
  try { if ((await oku('admins/' + KULLANICI.uid)) !== true) await degistir([['admins/' + KULLANICI.uid, true]]); } catch (_) {}
})();
const kimlik = { currentUser: KULLANICI };
export const getAuth = () => kimlik;
export const onAuthStateChanged = (_a, cb) => { let acik = true; hazir.then(() => { if (acik) cb(KULLANICI); }); return () => { acik = false; }; };
export const signInWithEmailAndPassword = async () => ({ user: KULLANICI });
export const signOut = async () => {};

/* ---------- İçerik paketi: seçili kök yolları toplu okur / değiştirir ---------- */
export async function paketAl(kokler) { const o = {}; for (const k of kokler) { const v = await oku(k); if (v !== null) o[k] = v; } return o; }
export const paketYaz = (o, kokler) => degistir(kokler.map(k => [k, o[k] === undefined ? null : o[k]]));
