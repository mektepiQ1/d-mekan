
'use strict';

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getDatabase, ref, get, set, remove, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
/* --- Firebase ortak ayarları (eski firebase.js) --- */

// Not: Firebase web apiKey gizli değildir; güvenlik Database Rules + Authentication ile sağlanır (bkz. KURULUM.md).
const config = {
  apiKey: "AIzaSyAtqtkB4mYY7t1HCM3umVLxRC2un30_-fQ",
  authDomain: "ogrenciveyonetim.firebaseapp.com",
  databaseURL: "https://ogrenciveyonetim-default-rtdb.firebaseio.com",
  projectId: "ogrenciveyonetim",
  storageBucket: "ogrenciveyonetim.firebasestorage.app",
  messagingSenderId: "660345359561",
  appId: "1:660345359561:web:5c74d90d8624c8e4c75118",
  measurementId: "G-C7TN0GBJL3"
};
const app = initializeApp(config);
const db = getDatabase(app);
const auth = getAuth(app);
const EMAIL_DOMAIN = 'ogrenci.local';
const USER_RE = /^[\w.-]{3,30}$/;
const ukey = u => u.toLowerCase().replace(/\./g, ','); // RTDB anahtarlarında '.' olamaz
const errText = e => /permission_denied/i.test((e && (e.code + e.message)) || '') ? 'Bu işlem için yetkiniz yok.'
  : e && e.code === 'auth/email-already-in-use' ? 'Bu kullanıcı adı zaten kullanılıyor.'
  : e && e.code === 'auth/too-many-requests' ? 'Çok fazla deneme yapıldı. Lütfen biraz bekleyin.'
  : navigator.onLine ? 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' : 'İnternet bağlantısı yok.';
/* --- /Firebase --- */
if (window.top !== window.self) { document.body.textContent = ''; throw new Error('Çerçeve içinde çalışamaz'); }

/* Cihaz kimliği: rastgele, cihazdan çıkmaz */
const deviceId = () => {
  try {
    let d = localStorage.getItem('og-did');
    if (!/^[a-f0-9]{32}$/.test(d || '')) {
      d = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('og-did', d);
    }
    return d;
  } catch { return ''; }
};

/* Çevrimiçi doğrulama damgası: 10 günde bir internete bağlanmak gerekir. Araç sayfaları (kapi.js) da bunu okur. */
const OK_GUN = 10 * 864e5;
const Ok = {
  get() { try { return JSON.parse(localStorage.getItem('og-ok') || 'null'); } catch { return null; } },
  set(uid) { try { localStorage.setItem('og-ok', JSON.stringify({ uid, t: Date.now(), s: Date.now() })); } catch {} },
  clear() { try { localStorage.removeItem('og-ok'); } catch {} },
  valid(uid) {
    const o = this.get(), n = Date.now();
    if (!o || o.uid !== uid || n - o.t > OK_GUN || n < (o.s || o.t) - 36e5) return false;
    try { o.s = Math.max(o.s || 0, n); localStorage.setItem('og-ok', JSON.stringify(o)); } catch {}
    return true;
  }
};

/* Aynı cihaza başka hesap girerse önceki öğrencinin defter/program verisi yeni hesaba karışmasın.
   Önceki öğrencinin verisi kendi hesabında yedekli durur; o girince geri gelir. */
function kisiDegisti(uid) {
  try {
    const last = localStorage.getItem('og-data-uid');
    if (last && last !== uid) {
      ['ob_slots', 'ob_tt', 'ob_weeks'].forEach(k => localStorage.removeItem(k));
      indexedDB.deleteDatabase('UltraStudentNotebookDB_v2');
    }
    localStorage.setItem('og-data-uid', uid);
  } catch {}
}

/* Cihaz paketi (IndexedDB, AES-GCM ile şifreli) */
const Pkg = (() => {
/* Cihaz paketi: seçilen sınıfın içeriği IndexedDB'ye (cihazın kendi depolamasına) kopyalanır.
   Merkezi veritabanıyla bağı yalnızca indirme anındadır; sonrasında internet gerekmez. */

const DB_NAME = 'ogrenci-bahcesi', STORE = 'packages', KEYS = 'keys', VERSION = 2;
let dbp;

const open = () => dbp || (dbp = new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, VERSION);
  r.onupgradeneeded = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'key' }).createIndex('uid', 'uid');
    if (!d.objectStoreNames.contains(KEYS)) d.createObjectStore(KEYS, { keyPath: 'k' });   // çıkarılamaz (extractable:false) anahtarlar
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => { dbp = null; rej(r.error); };
  r.onblocked = () => { dbp = null; rej(new Error('blocked')); };
}));

const run = async (mode, fn, store = STORE) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = t.onabort = () => rej(t.error || new Error('idb'));
  });
};

const keyOf = (uid, cid) => `${uid}:${cid}`;
const b64 = u => btoa(String.fromCharCode(...u)), unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
const enc = new TextEncoder(), dec = new TextDecoder();
const noKey = () => { throw { ui: 'Şifreleme anahtarı alınamadı. Lütfen tekrar giriş yapın.' }; };

/* Anahtar: sunucuda keys/<uid>/<cihaz> altında; yalnızca KAYITLI cihaz okuyabilir (kurallar).
   Cihaza çıkarılamaz CryptoKey olarak yazılır, bir daha ham hâli görülemez. */
async function getKey(uid, create) {
  const did = deviceId();
  if (!did || !(crypto && crypto.subtle)) return null;
  const hit = await run('readonly', s => s.get(uid), KEYS);
  if (hit && hit.key) return hit.key;
  if (!navigator.onLine) return null;
  const kr = ref(db, `keys/${uid}/${did}`), snap = await get(kr);
  let raw;
  if (snap.exists()) raw = unb64(snap.val());
  else if (!create) return null;
  else { raw = crypto.getRandomValues(new Uint8Array(32)); await set(kr, b64(raw)); }
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  await run('readwrite', s => s.put({ k: uid, key }), KEYS);
  return key;
}
async function seal(pkg) {
  const key = await getKey(pkg.uid, true) || noKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify({ class: pkg.class, user: pkg.user, lessons: pkg.lessons, topics: pkg.topics }));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(pkg.key) }, key, body);
  return { v: 2, key: pkg.key, uid: pkg.uid, class_id: pkg.class_id, pub: pkg.pub, downloaded_at: pkg.downloaded_at, bytes: pkg.bytes, iv, ct };
}
async function unseal(rec) {                  // çözülemezse null (anahtar yok / başka kullanıcıya ait kayıt)
  if (!rec || rec.v !== 2) return rec || null;   // v1: eski şifresiz paket, bir sonraki güncellemede şifrelenir
  try {
    const key = await getKey(rec.uid, false);
    if (!key) return null;
    const body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: enc.encode(rec.key) }, key, rec.ct);
    return { v: 2, key: rec.key, uid: rec.uid, class_id: rec.class_id, pub: rec.pub, downloaded_at: rec.downloaded_at, bytes: rec.bytes, ...JSON.parse(dec.decode(body)) };
  } catch { return null; }
}
const slim = (x, extra = []) => {          // yalnızca gerekli alanlar (_fbKey vb. cihaza taşınmaz)
  const o = { id: x.id, lesson_name: x.lesson_name, link_url: x.link_url || '', created_at: x.created_at || '' };
  extra.forEach(k => { if (x[k] !== undefined) o[k] = x[k]; });
  return o;
};

return {
  supported: typeof indexedDB !== 'undefined' && !!(window.crypto && crypto.subtle),

  build(user, cls, lessons, topics, pub = '|') {
    const byId = (a, b) => b.id - a.id;
    const pkg = {
      v: 1,
      key: keyOf(user._fbKey || user.id, cls.id),
      uid: user._fbKey || user.id,
      class_id: cls.id,
      class: { id: cls.id, class_name: cls.class_name, created_at: cls.created_at },
      user: { username: user.username, exam: user.exam || '', education_status: user.education_status || '' },
      lessons: lessons.filter(l => l.class_id === cls.id).sort(byId).map(l => slim(l, ['img', 'img_link', 'img_caption'])),
      topics: topics.filter(l => l.class_id === cls.id).sort(byId).map(l => slim(l, ['img', 'img_link', 'img_caption'])),
      pub,                                   // yöneticinin son "Güncelle" damgası (çekmece|sınıf)
      downloaded_at: new Date().toISOString(),
      bytes: 0
    };
    pkg.bytes = new Blob([JSON.stringify(pkg)]).size;
    return pkg;
  },

  get: (uid, cid) => run('readonly', s => s.get(keyOf(uid, cid))).then(unseal),

  async forUser(uid) {                      // bu kullanıcının en yeni paketi (çevrimdışı açılış için)
    const all = await run('readonly', s => s.index('uid').getAll(uid));
    return unseal((all || []).sort((a, b) => String(b.downloaded_at).localeCompare(String(a.downloaded_at)))[0]);
  },

  save: async pkg => { const rec = await seal(pkg); return run('readwrite', s => s.put(rec)); },

  async remove(uid) {                       // kullanıcının tüm paketlerini cihazdan siler
    await run('readwrite', s => s.delete(uid), KEYS).catch(() => {});
    const all = await run('readonly', s => s.index('uid').getAllKeys(uid));
    if (all && all.length) await run('readwrite', s => { let r; all.forEach(k => { r = s.delete(k); }); return r; });
  },

  async pruneOthers(uid, keepKey) {         // sınıf değiştiyse eski sınıfın paketi yer kaplamasın
    const keys = (await run('readonly', s => s.index('uid').getAllKeys(uid))) || [];
    const old = keys.filter(k => k !== keepKey);
    if (old.length) await run('readwrite', s => { let r; old.forEach(k => { r = s.delete(k); }); return r; });
  }
};
})();

const DB = {
  async all(store) {
    const snap = await get(ref(db, store));
    if (!snap.exists()) return [];
    const val = snap.val();
    if (Array.isArray(val)) return val.filter(Boolean);
    return Object.entries(val).map(([k, v]) => ({ ...v, _fbKey: k }));
  },
  async byClass(store, cid) {
    const snap = await get(query(ref(db, store), orderByChild('class_id'), equalTo(cid)));
    if (!snap.exists()) return [];
    const val = snap.val();
    if (Array.isArray(val)) return val.filter(Boolean);
    return Object.entries(val).map(([k, v]) => ({ ...v, _fbKey: k }));
  },
  async get(store, id) { const snap = await get(ref(db, `${store}/${id}`)); return snap.exists() ? snap.val() : null; },
  async put(store, item) { await set(ref(db, `${store}/${item._fbKey}`), item); return item; }
};

const U = {
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
  now: () => new Date().toISOString(),
  okUrl(u) { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } },
  fd(iso, withTime = true) {
    const d = new Date(iso), p = n => String(n).padStart(2, '0');
    const date = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
    return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
  },
  matchClass(classes, exam, edu) {
    const norm = s => String(s).toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').trim();
    const has = (name, term) => !!term &&
      new RegExp('(^|[^a-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(name);
    const e = norm(exam), l = norm(edu);
    let best, top = 0;
    for (const c of [...classes].sort((x, y) => x.id - y.id)) {
      const n = norm(c.class_name), score = (has(n, e) ? 2 : 0) + (has(n, l) ? 1 : 0);
      if (score > top) { best = c; top = score; }
    }
    return best;
  }
};

(() => {
  const { esc, now, fd, matchClass, okUrl } = U;
  const app = document.getElementById('app');
  const LINKS = [
    ['Ders Programım', 'dersprogram.html'],
    ['Kütüphane', 'https://mektepiq1.github.io/d-mekan/ogrencikitap.html'],
    ['Defter', 'defter.html']
  ];
  let reqView = false, pend = null, pickData = null;
  let error = '', notice = '', leftMsg = '', awaitInstall = false, lastUser = '', orphan = false, busy = false;

  const errorHtml = () => {
    const e = error; error = '';
    return e ? `<div class="alert er">${esc(e)}</div>` : '';
  };
  const noticeHtml = () => {
    const n = notice; notice = '';
    return n ? `<div class="alert ok" role="status">${esc(n)}</div>` : '';
  };
  /* Cihaz kaydı: hesap başına en fazla DEV_MAX cihaz. Yeni cihaz eklenince en az kullanılan düşer;
     düşen cihaz bir sonraki açılışında paketini siler ve çıkış yapar. Cihaz kimliği rastgeledir, cihazdan çıkmaz. */
  const DEV_MAX = 2;
  let devChecked = '';
  const devLabel = () => {
    const u = navigator.userAgent;
    return (/android/i.test(u) ? 'Android' : /iphone|ipad|ipod/i.test(u) ? 'iOS' : /windows/i.test(u) ? 'Windows' : /mac/i.test(u) ? 'Mac' : /linux/i.test(u) ? 'Linux' : 'Cihaz')
      + (matchMedia('(display-mode: standalone)').matches ? ' · uygulama' : ' · tarayıcı');
  };
  async function checkDevice(uid) {            // 'ok' | 'kicked' | 'skip'
    const did = deviceId();
    if (!did || !navigator.onLine || devChecked === uid) return 'skip';
    const regKey = 'og-reg-' + uid, SL = ['s1', 's2'];                // en fazla 2 yuva: sınır kurallarda da sabit
    const snap = await get(ref(db, `devices/${uid}`));
    const all = snap.exists() ? snap.val() : {}, t = new Date().toISOString();
    const mine = SL.find(k => all[k] && all[k].id === did);
    if (mine) {
      if (Date.now() - Date.parse(all[mine].last_seen) > 36e5) await set(ref(db, `devices/${uid}/${mine}`), { ...all[mine], last_seen: t, label: devLabel() });
    } else {
      if (localStorage.getItem(regKey)) return 'kicked';          // bu cihaz kayıtlıydı, başka cihaz yerini aldı
      let slot = SL.find(k => !all[k]);
      if (!slot) {                                                // dolu: en az kullanılan cihazın yerine geç
        slot = SL.sort((a, b) => String(all[a].last_seen).localeCompare(String(all[b].last_seen)))[0];
        await remove(ref(db, `keys/${uid}/${all[slot].id}`)).catch(() => {});
      }
      await set(ref(db, `devices/${uid}/${slot}`), { id: did, created_at: t, last_seen: t, label: devLabel() });
    }
    try { localStorage.setItem(regKey, '1'); } catch {}
    devChecked = uid;
    return 'ok';
  }

  const fail = ui => { throw { ui }; };            // kullanıcıya gösterilecek hata
  const fmtSize = b => b < 1024 ? b + ' B'
    : b < 1048576 ? (b / 1024).toFixed(1).replace('.', ',') + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB';

  /* Yöneticinin çekmece/sınıf için bastığı "Güncelle" damgası */
  const stampOf = (cls, options) => {
    const g = options.find(o => o.type === 'cgroup' && o.id === cls.group_id);
    return (g && g.published_at || '') + '|' + (cls.published_at || '');
  };

  /* Cihaz paketi kartı: seçilen sınıf cihaza indirilir, sonra internetsiz de açılır */
  const pkgCard = (cls, pkg, offline) => !cls ? '' : `
    <div class="pkg${pkg ? ' ok' : ''}">
      <div class="pkg-t"><strong>📦 ${esc(cls.class_name)} paketi</strong>
        <small>${pkg
          ? `Cihazında hazır · ${fd(pkg.downloaded_at)}<br>${pkg.lessons.length} soru bankası · ${pkg.topics.length} konu anlatımı · ${fmtSize(pkg.bytes)}`
          : 'Henüz cihazına indirilmedi. İndirince bu sınıfın içeriği telefonunda saklanır ve internet olmadan da açılır.'}</small></div>
      <div class="pkg-b">
        ${offline || pkg ? '' : '<button type="button" class="pk" data-a="dl">Paketi İndir</button>'}</div>
      <div class="pkg-s" id="pkgs" role="status" aria-live="polite"></div>
    </div>`;

  const loginView = () => `
    <div class="card form-card">
      <h2>Hoş Geldiniz</h2>
      <p class="sub-t">Sisteme erişmek için giriş yapın</p>
      ${leftMsg ? `<div class="alert ok" role="status">${esc(leftMsg)}</div>` : ''}
      ${errorHtml()}
      <form data-f="login">
        <div class="fg"><label>Kullanıcı Adı</label>
          <input name="un" required autocomplete="username" value="${esc(lastUser)}"></div>
        <div class="fg"><label>Şifre</label>
          <input name="pw" type="password" required autocomplete="current-password"></div>
        <button>Giriş Yap</button>
      </form>
    </div>`;

  const welcome = user => `
    <div class="top">
      <div class="wel">Hoş Geldin, ${esc(user.username)}!</div>
      <button class="out" data-a="logout">Çıkış Yap</button>
    </div>`;

  const byName = (a, b) => String(a).localeCompare(String(b), 'tr');
  const groupLabel = (c, groups) => { const g = groups.find(o => o.id === c.group_id); return g ? g.label : ''; };
  const pickBtn = c => `<button type="button" class="pick" data-a="pick" data-id="${c.id}" data-label="${esc(c.class_name)}">${esc(c.class_name)}</button>`;
  const pickerHtml = (classes, groups) => {
    const gids = new Set(groups.map(g => g.id));
    const sorted = [...classes].sort((a, b) => byName(a.class_name, b.class_name));
    const drawers = [...groups].sort((a, b) => byName(a.label, b.label)).map(g => {
      const kids = sorted.filter(c => c.group_id === g.id);
      return kids.length ? `<details class="drawer"><summary>${esc(g.label)}</summary><div class="drawer-body">${kids.map(pickBtn).join('')}</div></details>` : '';
    }).join('');
    const loose = sorted.filter(c => !gids.has(c.group_id));
    return `<div class="drawers">${drawers}${loose.map(pickBtn).join('')}</div>`;
  };

  const profileView = (user, classes, groups) => `
    <div class="card">${welcome(user)}
      <div class="card form-card" style="box-shadow:none;border:1px solid var(--line)">
        <h2>Sınıf Seçiniz</h2>
        ${errorHtml()}` +
        (classes.length ? `
        <form data-f="profile">
          <input type="hidden" name="class_id" value="">
          ${pickerHtml(classes, groups)}
          <div class="chosen" id="chosen" aria-live="polite">Henüz sınıf seçmediniz.</div>
          <button id="saveBtn">Kaydet ve İndir</button>
          <div class="hint">Seçtiğin sınıfın paketi cihazına indirilir.</div>
          <div class="pkg-s" id="pkgs" role="status" aria-live="polite"></div>
        </form>` : `<div class="warn"><p>Henüz sınıf eklenmemiş.</p></div>`) + `
      </div>
    </div>`;

  const itemRows = (list, none) => list.length ? list.map(l => `
            <details class="itemdrawer"><summary>${esc(l.lesson_name)}</summary>
              <div class="item-body">${l.img && String(l.img).startsWith('data:image/')
                ? (okUrl(l.img_link)
                  ? `<a class="item-img" href="${esc(l.img_link)}" target="_blank" rel="noopener noreferrer"><img src="${l.img}" alt="${esc(l.lesson_name)}"></a>`
                  : `<div class="item-img"><img src="${l.img}" alt="${esc(l.lesson_name)}"></div>`)
                  + (l.img_caption ? `<p class="item-cap">${esc(l.img_caption)}</p>` : '')
                : okUrl(l.link_url)
                  ? `<a class="item-link" href="${esc(l.link_url)}" target="_blank" rel="noopener noreferrer">${esc(l.lesson_name)} bağlantısını aç</a>`
                  : '<div class="empty"><p>İçerik eklenmemiş.</p></div>'}</div>
            </details>`).join('')
    : `<div class="empty"><p>${none}</p></div>`;

  /* Sınıf değiştirme: öğrenci istek gönderir, yönetici onaylayınca sınıf değişir */
  const changeBlock = (cls, offline) => {
    if (offline || !cls) return '';
    const w = h => `<div style="margin:0 0 16px">${h}</div>`;
    if (pend) return w(`<div class="alert off" role="status">Sınıf değiştirme isteğin onay bekliyor: <b>${esc(pend.to_class_name)}</b></div><button type="button" class="gray" data-a="cancelreq">İsteği İptal Et</button>`);
    if (reqView && pickData) return w(`<form data-f="classreq"><input type="hidden" name="class_id" value="">
      ${pickerHtml(pickData.classes.filter(c => c.id !== cls.id), pickData.groups)}
      <div class="chosen" id="chosen" aria-live="polite">Henüz sınıf seçmediniz.</div>
      <button>İstek Gönder</button><button type="button" class="gray" data-a="closereq">Vazgeç</button>
      <div class="hint">Yöneticinin onayından sonra sınıfın değişir.</div></form>`);
    return '';
  };
  const changeIdle = (cls, offline) => (offline || !cls || pend || (reqView && pickData)) ? '' : '<button type="button" class="hb" data-a="chg">Sınıf Değiştir</button>';

  /* ===== Dijital kitaplık: raflar + 3 boyutlu kitaplar ===== */
  const BK = new Map();                       // kitap anahtarı -> açılacak adres (DOM'da adres tutulmaz)
  const SPINES = ['#7b2d26', '#1f2937', '#2b3d68', '#14532d', '#5b21b6', '#92400e', '#0f4c5c', '#6b2142'];
  const hashOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const IMG_OK = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const NAV = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  let openSec = null;                         // açık raf (null: ilk dolu raf, '': hepsi kapalı)

  const bookHtml = (store, l, n) => {
    const url = okUrl(l.img_link) ? l.img_link : okUrl(l.link_url) ? l.link_url : '';
    const key = store + ':' + l.id;
    if (url) BK.set(key, url);
    const title = l.img_caption || l.lesson_name;
    const hasImg = !!(l.img && IMG_OK.test(l.img));
    const sp = SPINES[hashOf(l.lesson_name) % SPINES.length];
    return `<button type="button" class="bk" data-a="book" data-b="${key}" data-t="${esc(String(title).toLocaleLowerCase('tr'))}" style="--spine:${sp}"${url ? '' : ' aria-disabled="true"'}>
        <span class="cv"><span class="bk-front${hasImg ? '' : ' gen'}"${hasImg ? ` style="background-image:url(${l.img})"` : ''}>${hasImg ? '' : `<em>${esc(l.lesson_name)}</em>`}</span><span class="bk-spine"><b>${esc(l.lesson_name)}</b></span><i class="bk-pages"></i><i class="bk-back"></i></span>
        <i class="bk-shadow"></i><span class="ttl">${esc(title)}</span><span class="sub">Kitap ${n}</span></button>`;
  };

  const shelfHtml = (id, name, store, list, none) => {
    const sorted = [...list].sort((a, b) => a.id - b.id), open = openSec === id;
    return `<section class="sec" data-sec="${id}">
      <button type="button" class="sec-h" data-a="sec" data-s="${id}" aria-expanded="${open}"><h3>${name}<small>${sorted.length} kitap</small></h3><span class="chev">${CHEV}</span></button>
      <div class="dr${open ? ' open' : ''}"${open ? '' : ' inert'}><div class="dr-in">` +
      (sorted.length ? `<div class="rw"><div class="shelf" aria-hidden="true"><i class="sh-top"></i><i class="sh-front"></i></div>
        <button type="button" class="rnav l" data-a="rail" data-d="-1" aria-label="Sola kaydır">${NAV('m15 6-6 6 6 6')}</button>
        <button type="button" class="rnav r" data-a="rail" data-d="1" aria-label="Sağa kaydır">${NAV('m9 6 6 6-6 6')}</button>
        <div class="rail">${sorted.map((l, i) => bookHtml(store, l, i + 1)).join('')}</div></div>`
        : `<div class="empty"><p>${none}</p></div>`) + `</div></div></section>`;
  };

  const heroHtml = (user, cls, offline) => `<div class="lib">
      <div class="lib-hero"><div class="brand">Öğrenci Bahçesi</div><h2>Dijital kitaplık</h2><p>${esc(cls.class_name)}</p>
        <div class="hero-acts">
          <div class="wel">Hoş Geldin, ${esc(user.username)}!</div>
          ${changeIdle(cls, offline)}
          <button type="button" class="hb" data-a="logout">Çıkış Yap</button>
        </div></div></div>`;

  const libraryHtml = (cls, lessons, topics) => {
    BK.clear();
    if (openSec === null) openSec = lessons.length ? 'lessons' : topics.length ? 'topics' : '';
    return `<div class="lib">
      ${shelfHtml('lessons', 'Soru Bankası', 'lessons', lessons, 'Henüz soru bankası eklenmemiş.')}
      ${shelfHtml('topics', 'Konu Anlatımları', 'topics', topics, 'Henüz konu anlatımı eklenmemiş.')}</div>`;
  };

  /* Kapak görselinden sırt rengi: kapağın ortalama rengi, koyulaştırılmış */
  const spineCache = new Map();
  function paintSpines() {
    app.querySelectorAll('.bk').forEach(bk => {
      const f = bk.querySelector('.bk-front:not(.gen)');
      if (!f) return;
      const key = bk.dataset.b, hit = spineCache.get(key);
      if (hit) return void bk.style.setProperty('--spine', hit);
      const m = /url\("?([^")]+)"?\)/.exec(f.style.backgroundImage || '');
      if (!m) return;
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 8;
          const g = c.getContext('2d'); g.drawImage(im, 0, 0, 8, 8);
          const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gr = 0, b = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
          const k = .55 / 64, col = `rgb(${Math.round(r * k)},${Math.round(gr * k)},${Math.round(b * k)})`;
          spineCache.set(key, col); bk.style.setProperty('--spine', col);
        } catch {}
      };
      im.src = m[1];
    });
  }

  const panelViewHtml = (user, cls, lessons, topics, pkg = null, offline = false) => `
    <div class="card">${cls ? heroHtml(user, cls, offline) : welcome(user)}
      ${offline ? '<div class="alert off" role="status">Çevrimdışı</div>' : ''}
      ${errorHtml()}${noticeHtml()}
      ${cls && !pkg && !offline ? '<button type="button" class="pk" data-a="dl" style="margin:0 0 16px">Paketi İndir</button><div class="pkg-s" id="pkgs" role="status" aria-live="polite"></div>' : ''}
      ${changeBlock(cls, offline)}
      ${cls ? libraryHtml(cls, lessons, topics) : '<div class="warn" style="margin-bottom:16px"><p>Sınıfınız henüz atanmadı.</p></div>'}
      <div class="drawers">
        <details class="drawer tools">
          <summary>Araç ve Gereçlerim</summary>
          <div class="drawer-body">
            <nav class="navbar"><ul class="nl">
              ${LINKS.map(([t, u]) => `<li><a href="${u}" rel="noopener noreferrer">${t}</a></li>`).join('')}
            </ul></nav>
          </div>
        </details>
      </div>
    </div>`;
  const panelView = (...a) => { const h = panelViewHtml(...a); setTimeout(paintSpines, 0); return h; };

  async function currentUser() {
    const a = auth.currentUser;
    const u = a && await DB.get('users', a.uid);
    return u ? { ...u, _fbKey: a.uid } : undefined;
  }

  /* Cihazdaki paketten panel çizer (sunucu yokken). Paket yoksa false döner. */
  async function offlinePanel(uid) {
    const pkg = await Pkg.forUser(uid).catch(() => null);
    if (!pkg) return false;
    if (!Ok.valid(uid)) {
      app.innerHTML = `<div class="card"><div class="alert off" role="status">Güvenlik için en az 10 günde bir internete bağlanman gerekiyor. İnternete bağlanıp uygulamayı yeniden aç; paketin silinmedi.</div><button class="out" data-a="logout" style="width:100%">Çıkış Yap</button></div>`;
      return true;
    }
    app.innerHTML = panelView({ username: pkg.user.username }, pkg.class, pkg.lessons, pkg.topics, pkg, true);
    return true;
  }

  async function render() {
    try { await renderInner(); }
    catch (e) {
      const uid = auth.currentUser && auth.currentUser.uid;
      if (uid && await offlinePanel(uid).catch(() => false)) return void a11y();
      app.innerHTML = `<div class="card"><div class="alert er" role="alert">${esc(errText(e))}</div></div>`;
    }
    a11y();
  }

  /* Çevrimdışı açılışta Firebase modülleri de önbellekten gelsin diye sw.js'e yüklenenleri bildirir */
  async function warmOffline() {
    try {
      if (!('serviceWorker' in navigator)) return;
      await navigator.serviceWorker.ready;
      const urls = [...new Set(performance.getEntriesByType('resource').map(r => r.name)
        .filter(n => n.startsWith('https://www.gstatic.com/firebasejs/')))];
      await Promise.all(urls.map(u => fetch(u).catch(() => {})));
    } catch {}
  }

  /* İndirme penceresi: adım adım ilerleme, bitince başarı / hata durumu */
  const Dl = (() => {
    let el = null, tm = null, cur = 0, ceil = 0, act = null;
    const stop = () => { clearInterval(tm); tm = null; };
    const STEPS = ['Sınıf bilgisi', 'Soru bankası', 'Konu anlatımları', 'Cihaza kaydetme'];
    const css = `
.dlm{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(18,28,52,.6);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:dlf .2s ease}
.dlb{width:100%;max-width:380px;background:#fff;border-radius:26px;padding:30px 24px 24px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.35);animation:dlu .3s cubic-bezier(.2,.9,.3,1.2)}
.dli{width:76px;height:76px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#edf2fb;position:relative}
.dli::before{content:"";width:34px;height:34px;border-radius:50%;border:4px solid #cbd5e8;border-top-color:#2c3e66;animation:dls .9s linear infinite}
.dlb.ok .dli{background:#e6f6ec;animation:dlp .45s ease}.dlb.ok .dli::before{border:0;width:auto;height:auto;animation:none;content:"✓";font-size:40px;font-weight:700;color:#2f855a}
.dlb.er .dli{background:#fdecec;animation:dlp .45s ease}.dlb.er .dli::before{border:0;width:auto;height:auto;animation:none;content:"!";font-size:40px;font-weight:700;color:#c53030}
.dlb h3{font-size:20px;color:#1a2744;margin-bottom:6px}
.dls{font-size:14px;color:#4a5568;line-height:1.5;margin-bottom:16px;min-height:21px}
.dlst{list-style:none;text-align:left;margin:0 0 16px;padding:0}
.dlst li{display:flex;align-items:center;gap:12px;padding:7px 4px;font-size:14px;color:#a0aec0;transition:color .2s}
.dlst li::before{content:"";flex:none;width:22px;height:22px;border-radius:50%;border:2px solid #e2e8f0;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;transition:all .2s}
.dlst li.on{color:#1a2744;font-weight:700}.dlst li.on::before{border-color:#2c3e66;border-top-color:transparent;animation:dls .8s linear infinite}
.dlst li.dn{color:#2f855a}.dlst li.dn::before{content:"✓";background:#38a169;border-color:#38a169}
.dlbar{height:8px;border-radius:99px;background:#e8edf5;overflow:hidden}.dlbar i{display:block;height:100%;width:4%;border-radius:99px;background:linear-gradient(90deg,#2c3e66,#4a6fb5);transition:width .4s ease}
.dlb.ok .dlbar i{background:#38a169}.dlb.er .dlbar i{background:#c53030}
.dlb .dlok{margin-top:18px;width:100%}
.dlb:not(.ok):not(.er) .dlok{display:none}.dlb.ok .dlst,.dlb.er .dlst{display:none}
@keyframes dls{to{transform:rotate(360deg)}}@keyframes dlf{from{opacity:0}}@keyframes dlu{from{opacity:0;transform:translateY(24px) scale(.94)}}@keyframes dlp{0%{transform:scale(.6)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
@media(prefers-reduced-motion:reduce){.dlm,.dlb,.dli,.dlb *{animation:none!important;transition:none!important}}`;
    const set = (cls, title, text, pct) => {
      if (!el) return;
      el.querySelector('.dlb').className = 'dlb' + (cls ? ' ' + cls : '');
      if (title) el.querySelector('h3').textContent = title;
      if (text != null) el.querySelector('.dls').textContent = text;
      if (pct != null) { cur = pct; el.querySelector('.dlbar i').style.width = pct + '%'; }
    };
    return {
      open(title = 'Paket hazırlanıyor') {
        if (!document.getElementById('dl-css')) { const st = document.createElement('style'); st.id = 'dl-css'; st.textContent = css; document.head.appendChild(st); }
        this.close();
        el = document.createElement('div'); el.className = 'dlm'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-live', 'polite');
        el.innerHTML = `<div class="dlb"><div class="dli"></div><h3></h3><p class="dls"></p>
          <ol class="dlst">${STEPS.map(t => `<li>${t}</li>`).join('')}</ol>
          <div class="dlbar"><i></i></div><button type="button" class="dlok">Tamam</button></div>`;
        el.querySelector('.dlok').addEventListener('click', () => { const f = act; act = null; if (f) f(); else this.close(); });
        document.body.appendChild(el);
        set('', title, 'Lütfen bekleyin, sayfayı kapatmayın…', 4);
      },
      step(i, text) {
        if (!el || i == null) return;
        el.querySelectorAll('.dlst li').forEach((li, k) => { li.className = k < i ? 'dn' : k === i ? 'on' : ''; });
        const n = STEPS.length;
        set('', null, text, Math.max(cur, Math.round((i / n) * 100) + 2));
        ceil = Math.round(((i + 1) / n) * 100) - 3;
        stop();                                   // adım içinde çubuk yavaşça ilerler, bir sonraki adımda tamamlanır
        tm = setInterval(() => {
          if (!el) return stop();
          cur += Math.max(0.2, (ceil - cur) * 0.06);
          if (cur > ceil) cur = ceil;
          el.querySelector('.dlbar i').style.width = cur + '%';
        }, 120);
      },
      done(text, o = {}) {
        stop();
        if (!el) return;
        act = o.onOk || null;
        el.querySelector('.dlok').textContent = o.btn || 'Tamam';
        el.querySelectorAll('.dlst li').forEach(li => { li.className = 'dn'; });
        set('ok', o.title || 'Hazır!', text, 100);
        el.querySelector('.dlok').focus();
      },
      fail(text) { stop(); set('er', 'İndirilemedi', text, 100); el && el.querySelector('.dlok').focus(); },
      close() { stop(); act = null; if (el) { el.remove(); el = null; } }
    };
  })();

  const say = (t, i) => { const s = document.getElementById('pkgs'); if (s) s.textContent = t; Dl.step(i, t); };
  const dlErr = e => e && e.ui ? e.ui : e && e.name === 'QuotaExceededError' ? 'Cihazda yeterli boş alan yok.' : errText(e);

  /* Seçilen sınıfın paketini sunucudan alıp cihaza yazar. Hata olursa { ui } fırlatır. */
  async function savePackage(user) {
    if (!Pkg.supported) fail('Bu tarayıcı cihaz depolamasını desteklemiyor.');
    if (!navigator.onLine) fail('Paketi indirmek için internet bağlantısı gerekli.');
    if (!user || !user.class_id) fail('Önce sınıfınızı seçmelisiniz.');
    say('Sınıf bilgisi alınıyor…', 0);
    const [allClasses, allOpts] = await Promise.all([DB.all('classes'), DB.all('options')]);
    const cls = allClasses.find(c => c.id === user.class_id);
    if (!cls) fail('Sınıfınız artık mevcut değil. Lütfen yöneticinize başvurun.');
    say('Soru bankası indiriliyor…', 1);
    const lessons = await DB.byClass('lessons', cls.id);
    say('Konu anlatımları indiriliyor…', 2);
    const topics = await DB.byClass('topics', cls.id).catch(() => []);
    say('Cihaza kaydediliyor…', 3);
    const pkg = Pkg.build(user, cls, lessons, topics, stampOf(cls, allOpts));
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    if (est && est.quota && est.quota - (est.usage || 0) < pkg.bytes * 2) fail('Cihazda yeterli boş alan yok.');
    await Pkg.save(pkg);
    const back = await Pkg.get(pkg.uid, cls.id);          // yazıldığını doğrula
    if (!back || back.lessons.length !== pkg.lessons.length || back.topics.length !== pkg.topics.length) fail('Paket cihaza doğru kaydedilemedi. Lütfen tekrar deneyin.');
    await Pkg.pruneOthers(pkg.uid, pkg.key);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    warmOffline();
  }

  /* Panelden: Güncelle / (ilk indirme başarısız olduysa) tekrar dene */
  async function download() {
    if (busy) return;
    busy = true;
    app.querySelectorAll('.pk').forEach(x => { x.disabled = true; });
    Dl.open();
    try {
      await savePackage(await currentUser());
      notice = 'Paket cihazına indirildi. Artık internet olmadan da açılır.';
      Dl.done('Paket cihazına indirildi. Artık internet olmadan da açılır.');
    } catch (e) { error = dlErr(e); Dl.fail(error); }
    finally { busy = false; }
    render();
  }

  /* Ana ekrana / masaüstüne ekleme: simge tüm paketler için aynıdır (tek uygulama).
     Tarayıcı bunu yalnızca kullanıcı dokunuşu sırasında sorar; bu yüzden await'ten ÖNCE çağrılmalı. */
  let installEv = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; });
  addEventListener('appinstalled', () => { installEv = null; });
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function askInstall() {
    if (standalone()) return Promise.resolve('already');
    if (installEv) {
      const ev = installEv; installEv = null;
      try { ev.prompt(); return ev.userChoice.then(c => c.outcome).catch(() => 'none'); } catch { return Promise.resolve('none'); }
    }
    return Promise.resolve(isIOS() ? 'ios' : 'none');
  }

  async function renderInner() {
    if (awaitInstall) return void (app.innerHTML = '<div class="card"><div class="empty" role="status">Kurulum tamamlanıyor…</div></div>');
    if (!auth.currentUser) return void (app.innerHTML = loginView());
    if (!navigator.onLine && await offlinePanel(auth.currentUser.uid)) return;
    const user = await currentUser();
    if (!user) {
      orphan = true; await signOut(auth);
      error = 'Hesabınız bulunamadı veya devre dışı. Lütfen yöneticinize başvurun.';
      return void (app.innerHTML = loginView());
    }
    const dv = await checkDevice(user._fbKey).catch(() => 'skip');
    if (dv === 'kicked') {
      await Pkg.remove(user._fbKey).catch(() => {}); Ok.clear();
      try { localStorage.removeItem('og-reg-' + user._fbKey); } catch {}
      orphan = true; devChecked = ''; await signOut(auth);
      error = 'Hesabın başka cihazlarda açıldığı için bu cihazdan çıkış yapıldı. Tekrar giriş yaparsan bu cihaz yeniden kaydedilir.';
      return void (app.innerHTML = loginView());
    }
    Ok.set(user._fbKey); kisiDegisti(user._fbKey);
    if (!user.exam || !user.education_status || !user.class_id) {
      const [all, classes] = await Promise.all([DB.all('options'), DB.all('classes')]);
      return void (app.innerHTML = profileView(user, classes, all.filter(o => o.type === 'cgroup').sort((a, b) => a.id - b.id)));
    }
    pend = navigator.onLine ? await get(ref(db, `classRequests/${user._fbKey}`)).then(x => x.exists() ? x.val() : null).catch(() => null) : null;
    // Yerel öncelikli: cihazda paket varsa içerik oradan okunur, sunucudan ders listesi çekilmez.
    let pkg = await Pkg.get(user._fbKey, user.class_id).catch(() => null);
    if (pkg && navigator.onLine && !busy) {
      // Yönetici bu sınıfın çekmecesinde "Güncelle"ye bastıysa paket sessizce yenilenir.
      try {
        // Hafif kontrol: yalnızca stamps/<sınıf> düğümü okunur. Düğüm yoksa/okunamazsa eski yönteme düşer.
        let st = null;
        try { const sn = await get(ref(db, `stamps/${user.class_id}`)); if (sn.exists() && typeof sn.val() === 'string') st = sn.val(); } catch {}
        let changed;
        if (st !== null) changed = pkg.v !== 2 || st !== (pkg.pub ?? '|');
        else {
          const [cl, op] = await Promise.all([DB.all('classes'), DB.all('options')]);
          const c = cl.find(x => x.id === user.class_id);
          changed = !!c && (pkg.v !== 2 || stampOf(c, op) !== (pkg.pub ?? '|'));
        }
        if (changed) {
          busy = true;
          try { await savePackage(user); notice = 'İçerik güncellendi.'; } finally { busy = false; }
          pkg = await Pkg.get(user._fbKey, user.class_id).catch(() => pkg);
        }
      } catch {}
    }
    if (!pkg && navigator.onLine && !busy && Pkg.supported) {
      const old = await Pkg.forUser(user._fbKey).catch(() => null);
      if (old && old.class_id !== user.class_id) {          // sınıf değişti: yeni sınıfın paketi otomatik iner, eskisi silinir
        busy = true; Dl.open('Yeni sınıfın indiriliyor');
        try { await savePackage(user); notice = 'Sınıfın değişti, yeni paket cihazına indirildi.'; Dl.done(notice); }
        catch (e) { error = dlErr(e); Dl.fail(error); }
        finally { busy = false; }
        pkg = await Pkg.get(user._fbKey, user.class_id).catch(() => null);
      }
    }
    if (pkg) return void (app.innerHTML = panelView(user, pkg.class, pkg.lessons, pkg.topics, pkg, false));
    const [classes, lessons, topics] = await Promise.all([DB.all('classes'), DB.byClass('lessons', user.class_id), DB.byClass('topics', user.class_id).catch(() => [])]);
    const cls = classes.find(c => c.id === user.class_id);
    const mine = list => cls ? list.filter(l => l.class_id === cls.id).sort((a, b) => b.id - a.id) : [];
    app.innerHTML = panelView(user, cls, mine(lessons), mine(topics), null, false);
  }

  const forms = {
    async login(d) {
      const un = d.get('un').trim().toLowerCase();
      lastUser = d.get('un').trim(); leftMsg = '';
      try {
        if (!USER_RE.test(un)) throw new Error('bad');
        const s = await get(ref(db, `usernames/${ukey(un)}`));
        if (!s.exists()) throw new Error('none');
        await signInWithEmailAndPassword(auth, s.val().email, d.get('pw'));
        lastUser = '';
      } catch (e) {
        error = e && e.code === 'auth/too-many-requests' ? errText(e) : 'Kullanıcı adı veya şifre hatalı.';
      }
    },
    async classreq(d) {
      const cid = +d.get('class_id');
      if (!cid) { error = 'Lütfen bir sınıf seçiniz.'; return; }
      const user = await currentUser(), cl = ((pickData && pickData.classes) || []).find(c => c.id === cid);
      if (!user || !cl) { error = 'Seçilen sınıf bulunamadı.'; return; }
      await set(ref(db, `classRequests/${user._fbKey}`), { username: user.username, from_class_id: user.class_id, to_class_id: cl.id, to_class_name: cl.class_name, requested_at: now() });
      reqView = false;
      notice = 'İsteğin yöneticiye iletildi. Onaylanınca sınıfın değişecek.';
    },
    /* "Kaydet ve İndir": sınıfı kaydeder, paketi cihaza indirir (yalnızca indirme penceresi görünür). */
    async profile(d, form) {
      const cid = +d.get('class_id');
      if (!cid) { error = 'Lütfen bir sınıf seçiniz.'; return; }
      if (busy) return;
      busy = true;
      const btn = form && form.querySelector('#saveBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'İndiriliyor…'; }
      Dl.open('Paketin hazırlanıyor');
      let okMsg = '', failMsg = '';
      try {
        const user = await currentUser();
        if (!user) { Dl.close(); return; }
        const [classes, opts] = await Promise.all([DB.all('classes'), DB.all('options')]);
        const cls = classes.find(c => c.id === cid);
        if (!cls) throw new Error('Seçilen sınıf bulunamadı.');
        const exam = groupLabel(cls, opts.filter(o => o.type === 'cgroup')) || 'Genel';
        const saved = { ...user, exam, education_status: cls.class_name, class_id: cls.id };
        await DB.put('users', saved);
        try {
          await savePackage(saved);
          notice = okMsg = `${cls.class_name} paketi cihazına indirildi. Artık internet olmadan da açılır.`;
        } catch (e) {                               // sınıf kaydedildi; paket panelden tekrar denenebilir
          error = failMsg = 'Sınıfın kaydedildi ama paket indirilemedi: ' + dlErr(e) + ' "Paketi İndir" ile tekrar deneyebilirsin.';
        }
        if (failMsg) Dl.fail(failMsg);
        else if (standalone()) Dl.done(okMsg);          // zaten uygulamadan açık: panele devam
        else {
          // İndirme bitti → son adım ana ekrana ekleme; sonra çıkış yapılır, giriş uygulamadan yapılır
          awaitInstall = true; notice = '';
          const ev = installEv, ios = isIOS();
          const finish = async msg => {
            awaitInstall = false; leftMsg = msg; Dl.close();
            await signOut(auth); render();
          };
          const DONE = 'Kurulum tamamlandı. Lütfen uygulamadan giriş yapınız.';
          if (ev) Dl.done('Paket indirildi. Son adım: uygulamayı ana ekrana ekle.', {
            title: 'Paket indirildi', btn: 'Ana Ekrana Ekle',
            onOk: async () => {
              installEv = null; let r = 'none';
              try { ev.prompt(); r = (await ev.userChoice).outcome; } catch {}
              finish(r === 'accepted' ? DONE : 'Paket indirildi. Uygulamayı ana ekrana ekleyip ondan giriş yapınız.');
            }
          });
          else Dl.done(ios ? 'Paket indirildi. Tarayıcıda Paylaş → Ana Ekrana Ekle\'ye dokun.' : 'Paket indirildi. Tarayıcı menüsünden "Ana ekrana ekle" ile uygulamayı kur.',
            { title: 'Paket indirildi', onOk: () => finish('Uygulamayı ana ekrana ekleyip ondan giriş yapınız.') });
        }
      } catch (e) { Dl.fail(dlErr(e)); throw e; }
      finally { busy = false; }
    }
  };

  app.addEventListener('submit', async e => {
    e.preventDefault();
    try { await forms[e.target.dataset.f]?.(new FormData(e.target), e.target); } catch (err) { error = dlErr(err); }
    render();
  });

  app.addEventListener('toggle', e => {
    const t = e.target;
    if (!t.open || !t.matches('.drawer, .subdrawer, .itemdrawer')) return;
    const sel = t.matches('.drawer') ? '.drawer[open]' : t.matches('.subdrawer') ? '.subdrawer[open]' : '.itemdrawer[open]';
    t.parentElement.querySelectorAll(':scope > ' + sel).forEach(d => { if (d !== t) d.open = false; });
  }, true);


  /* Araç ve Gereçlerim açılınca raflar kapanır (tek çekmece açık) */
  app.addEventListener('toggle', e => {
    const d = e.target;
    if (!d.matches || !d.matches('details.tools') || !d.open) return;
    app.querySelectorAll('.sec').forEach(x => {
      x.querySelector('.sec-h').setAttribute('aria-expanded', 'false');
      const dr = x.querySelector('.dr'); dr.classList.remove('open'); dr.inert = true;
    });
    openSec = '';
  }, true);

  app.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]');
    if (b?.dataset.a === 'pick') {
      app.querySelectorAll('.pick.sel').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      app.querySelector('input[name="class_id"]').value = b.dataset.id;
      const g = b.closest('details.drawer')?.querySelector('summary')?.textContent.trim();
      document.getElementById('chosen').textContent = 'Seçilen sınıf: ' + (g ? g + ' › ' : '') + b.dataset.label;
      return;
    }
    if (b?.dataset.a === 'book') {               // kitaba dokununca yöneticinin verdiği adres açılır
      const u = BK.get(b.dataset.b);
      if (u) window.open(u, '_blank', 'noopener,noreferrer');
      return;
    }
    if (b?.dataset.a === 'sec') {                // raf aç/kapat: aynı anda tek raf açık
      const id = b.dataset.s, was = b.getAttribute('aria-expanded') === 'true';
      app.querySelectorAll('.sec').forEach(s => {
        const o = s.dataset.sec === id && !was, dr = s.querySelector('.dr');
        s.querySelector('.sec-h').setAttribute('aria-expanded', o);
        dr.classList.toggle('open', o); dr.inert = !o;
      });
      openSec = was ? '' : id;
      if (!was) app.querySelectorAll('details.tools[open]').forEach(d => { d.open = false; });
      return;
    }
    if (b?.dataset.a === 'rail') {
      const rail = b.closest('.rw')?.querySelector('.rail');
      if (rail) rail.scrollBy({ left: +b.dataset.d * rail.clientWidth * .8, behavior: 'smooth' });
      return;
    }
    if (b?.dataset.a === 'dl') return void download();
    if (b?.dataset.a === 'chg') {
      try {
        const [classes, opts] = await Promise.all([DB.all('classes'), DB.all('options')]);
        pickData = { classes, groups: opts.filter(o => o.type === 'cgroup').sort((a, c) => a.id - c.id) };
        reqView = true;
      } catch (err) { error = dlErr(err); }
      return void render();
    }
    if (b?.dataset.a === 'closereq') { reqView = false; return void render(); }
    if (b?.dataset.a === 'cancelreq') {
      try { await remove(ref(db, `classRequests/${auth.currentUser.uid}`)); notice = 'İstek iptal edildi.'; } catch (err) { error = dlErr(err); }
      return void render();
    }
    if (b?.dataset.a !== 'logout') return;
    devChecked = ''; Ok.clear();
    await signOut(auth);
  });

  // Bağlantı durumu değişince panel (sunucu ↔ cihaz paketi) yeniden çizilir
  ['online', 'offline'].forEach(ev => addEventListener(ev, () => { if (!busy && auth.currentUser) render(); }));

  onAuthStateChanged(auth, () => { if (orphan) { orphan = false; return; } render(); });
})();

const a11y = () => { const h = document.querySelector('.header'); if (h) h.hidden = !!document.querySelector('.lib-hero'); document.querySelectorAll('.fg').forEach((g, i) => { const l = g.querySelector('label'), c = g.querySelector('input,select'); if (l && c) { c.id = c.id || 'f' + i; l.htmlFor = c.id; } }); };
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

/* Koruma: kopyalama, kesme, sağ tık, sürükleme, seçme ve kaydet/yazdır/kaynak kısayolları (form alanları hariç) */
(() => {
  const inField = t => { const el = t && (t.nodeType === 1 ? t : t.parentElement); return !!(el && el.closest && el.closest('input,textarea')); };
  ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart'].forEach(ev =>
    document.addEventListener(ev, e => { if (!inField(e.target)) e.preventDefault(); }, true));
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && ['c', 'x', 's', 'p', 'u', 'a'].includes(String(e.key).toLowerCase()) && !inField(e.target)) e.preventDefault();
  }, true);
})();
