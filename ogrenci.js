
'use strict';

import { ref, get, set, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { db, auth, USER_RE, ukey, errText } from "./firebase.js";
if (window.top !== window.self) { document.body.textContent = ''; throw new Error('Çerçeve içinde çalışamaz'); }

/* Cihaz paketi (IndexedDB) */
const Pkg = (() => {
/* Cihaz paketi: seçilen sınıfın içeriği IndexedDB'ye (cihazın kendi depolamasına) kopyalanır.
   Merkezi veritabanıyla bağı yalnızca indirme anındadır; sonrasında internet gerekmez. */

const DB_NAME = 'ogrenci-bahcesi', STORE = 'packages', VERSION = 1;
let dbp;

const open = () => dbp || (dbp = new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, VERSION);
  r.onupgradeneeded = () => {
    const s = r.result.createObjectStore(STORE, { keyPath: 'key' });
    s.createIndex('uid', 'uid');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => { dbp = null; rej(r.error); };
  r.onblocked = () => { dbp = null; rej(new Error('blocked')); };
}));

const run = async (mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && req.result);
    t.onerror = t.onabort = () => rej(t.error || new Error('idb'));
  });
};

const keyOf = (uid, cid) => `${uid}:${cid}`;
const slim = (x, extra = []) => {          // yalnızca gerekli alanlar (_fbKey vb. cihaza taşınmaz)
  const o = { id: x.id, lesson_name: x.lesson_name, link_url: x.link_url || '', created_at: x.created_at || '' };
  extra.forEach(k => { if (x[k] !== undefined) o[k] = x[k]; });
  return o;
};

return {
  supported: typeof indexedDB !== 'undefined',

  build(user, cls, lessons, topics, pub = '|') {
    const byId = (a, b) => b.id - a.id;
    const pkg = {
      v: 1,
      key: keyOf(user._fbKey || user.id, cls.id),
      uid: user._fbKey || user.id,
      class_id: cls.id,
      class: { id: cls.id, class_name: cls.class_name, created_at: cls.created_at },
      user: { username: user.username, exam: user.exam || '', education_status: user.education_status || '' },
      lessons: lessons.filter(l => l.class_id === cls.id).sort(byId).map(l => slim(l)),
      topics: topics.filter(l => l.class_id === cls.id).sort(byId).map(l => slim(l)),
      pub,                                   // yöneticinin son "Güncelle" damgası (çekmece|sınıf)
      downloaded_at: new Date().toISOString(),
      bytes: 0
    };
    pkg.bytes = new Blob([JSON.stringify(pkg)]).size;
    return pkg;
  },

  get: (uid, cid) => run('readonly', s => s.get(keyOf(uid, cid))).then(r => r || null),

  async forUser(uid) {                      // bu kullanıcının en yeni paketi (çevrimdışı açılış için)
    const all = await run('readonly', s => s.index('uid').getAll(uid));
    return (all || []).sort((a, b) => String(b.downloaded_at).localeCompare(String(a.downloaded_at)))[0] || null;
  },

  save: pkg => run('readwrite', s => s.put(pkg)),

  async remove(uid) {                       // kullanıcının tüm paketlerini cihazdan siler
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
    ['Ders Programım', 'https://mektepiq1.github.io/d-mekan/dersprogram.html'],
    ['Defter', 'https://mektepiq1.github.io/cay/cizgilideff.html']
  ];
  let error = '', notice = '', leftMsg = '', lastUser = '', orphan = false, busy = false;

  const errorHtml = () => {
    const e = error; error = '';
    return e ? `<div class="alert er">${esc(e)}</div>` : '';
  };
  const noticeHtml = () => {
    const n = notice; notice = '';
    return n ? `<div class="alert ok" role="status">${esc(n)}</div>` : '';
  };
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
          <div class="hint">Seçtiğin sınıfın paketi cihazına indirilir ve uygulama ana ekrana eklenir.</div>
          <div class="pkg-s" id="pkgs" role="status" aria-live="polite"></div>
        </form>` : `<div class="warn"><p>Henüz sınıf eklenmemiş.</p></div>`) + `
      </div>
    </div>`;

  const itemRows = (list, none) => list.length ? list.map(l => `
            <div class="slesson"><span>${esc(l.lesson_name)}</span>
              ${okUrl(l.link_url) ? `<a class="btn" href="${esc(l.link_url)}" target="_blank" rel="noopener noreferrer">İncele</a>` : ''}</div>`).join('')
    : `<div class="empty"><p>${none}</p></div>`;

  const panelView = (user, cls, lessons, topics, pkg = null, offline = false) => `
    <div class="card">${welcome(user)}
      ${offline ? '<div class="alert off" role="status">Paket gösteriliyor.</div>' : ''}
      ${errorHtml()}${noticeHtml()}
      ${cls && !pkg && !offline ? '<button type="button" class="pk" data-a="dl" style="margin:0 0 16px">Paketi İndir</button><div class="pkg-s" id="pkgs" role="status" aria-live="polite"></div>' : ''}
      <div class="drawers">
        <details class="drawer">
          <summary>Sınıfım ve Derslerim</summary>
          <div class="drawer-body">` +
    (cls ? `
            <div class="class-card"><h3>${esc(cls.class_name)}</h3><p>Kayıt: ${fd(cls.created_at, false)}</p></div>
            <details class="subdrawer"><summary>Soru Bankası</summary><div class="sub-body">` +
      itemRows(lessons, 'Ders eklenmemiş.') + `</div></details>
            <details class="subdrawer"><summary>Konu Anlatımlarım</summary><div class="sub-body">` +
      itemRows(topics, 'Konu anlatımı eklenmemiş.') + `</div></details>`
      : `<div class="warn"><p>Sınıfınız henüz atanmadı.</p></div>`) + `
          </div>
        </details>
        <details class="drawer">
          <summary>Araç ve Gereçlerim</summary>
          <div class="drawer-body">
            <nav class="navbar"><ul class="nl">
              ${LINKS.map(([t, u]) => `<li><a href="${u}" rel="noopener noreferrer">${t}</a></li>`).join('')}
            </ul></nav>
          </div>
        </details>
      </div>
    </div>`;

  async function currentUser() {
    const a = auth.currentUser;
    const u = a && await DB.get('users', a.uid);
    return u ? { ...u, _fbKey: a.uid } : undefined;
  }

  /* Cihazdaki paketten panel çizer (sunucu yokken). Paket yoksa false döner. */
  async function offlinePanel(uid) {
    const pkg = await Pkg.forUser(uid).catch(() => null);
    if (!pkg) return false;
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
    let el = null;
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
      if (pct != null) el.querySelector('.dlbar i').style.width = pct + '%';
    };
    return {
      open(title = 'Paket hazırlanıyor') {
        if (!document.getElementById('dl-css')) { const st = document.createElement('style'); st.id = 'dl-css'; st.textContent = css; document.head.appendChild(st); }
        this.close();
        el = document.createElement('div'); el.className = 'dlm'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-live', 'polite');
        el.innerHTML = `<div class="dlb"><div class="dli"></div><h3></h3><p class="dls"></p>
          <ol class="dlst">${STEPS.map(t => `<li>${t}</li>`).join('')}</ol>
          <div class="dlbar"><i></i></div><button type="button" class="dlok">Tamam</button></div>`;
        el.querySelector('.dlok').addEventListener('click', () => this.close());
        document.body.appendChild(el);
        set('', title, 'Lütfen bekleyin, sayfayı kapatmayın…', 4);
      },
      step(i, text) {
        if (!el || i == null) return;
        el.querySelectorAll('.dlst li').forEach((li, k) => { li.className = k < i ? 'dn' : k === i ? 'on' : ''; });
        set('', null, text, Math.round(((i + 0.5) / STEPS.length) * 100));
      },
      done(text) {
        if (!el) return;
        el.querySelectorAll('.dlst li').forEach(li => { li.className = 'dn'; });
        set('ok', 'Hazır!', text, 100);
        el.querySelector('.dlok').focus();
      },
      fail(text) { set('er', 'İndirilemedi', text, 100); el && el.querySelector('.dlok').focus(); },
      close() { if (el) { el.remove(); el = null; } }
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
    if (!auth.currentUser) return void (app.innerHTML = loginView());
    if (!navigator.onLine && await offlinePanel(auth.currentUser.uid)) return;
    const user = await currentUser();
    if (!user) {
      orphan = true; await signOut(auth);
      error = 'Hesabınız bulunamadı veya devre dışı. Lütfen yöneticinize başvurun.';
      return void (app.innerHTML = loginView());
    }
    if (!user.exam || !user.education_status || !user.class_id) {
      const [all, classes] = await Promise.all([DB.all('options'), DB.all('classes')]);
      return void (app.innerHTML = profileView(user, classes, all.filter(o => o.type === 'cgroup').sort((a, b) => a.id - b.id)));
    }
    // Yerel öncelikli: cihazda paket varsa içerik oradan okunur, sunucudan ders listesi çekilmez.
    let pkg = await Pkg.get(user._fbKey, user.class_id).catch(() => null);
    if (pkg && navigator.onLine && !busy) {
      // Yönetici bu sınıfın çekmecesinde "Güncelle"ye bastıysa paket sessizce yenilenir.
      try {
        const [cl, op] = await Promise.all([DB.all('classes'), DB.all('options')]);
        const c = cl.find(x => x.id === user.class_id);
        if (c && stampOf(c, op) !== (pkg.pub ?? '|')) {
          busy = true;
          try { await savePackage(user); notice = 'İçerik güncellendi.'; } finally { busy = false; }
          pkg = await Pkg.get(user._fbKey, user.class_id).catch(() => pkg);
        }
      } catch {}
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
    /* "Kaydet ve İndir": sınıfı kaydeder, paketi cihaza indirir, uygulamayı ana ekrana eklemeyi önerir. */
    async profile(d, form) {
      const cid = +d.get('class_id');
      if (!cid) { error = 'Lütfen bir sınıf seçiniz.'; return; }
      if (busy) return;
      busy = true;
      const btn = form && form.querySelector('#saveBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'İndiriliyor…'; }
      const install = askInstall();                 // dokunuş etkinken, ilk iş olarak
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
        const r = await install;
        if (r === 'accepted') notice = (notice + ' Uygulama ana ekrana eklendi.').trim();
        else if (r === 'ios') notice = (notice + ' Ana ekrana eklemek için tarayıcıda Paylaş → Ana Ekrana Ekle\'ye dokun.').trim();
        if (failMsg) Dl.fail(failMsg);
        else if (r === 'accepted' || r === 'ios') {
          // Paket indirildi: giriş tarayıcıda değil, ana ekrandaki uygulamadan yapılsın
          leftMsg = r === 'accepted'
            ? 'Paket indirildi ve uygulama ana ekrana eklendi. Giriş yapmak için ana ekrandaki uygulamayı aç.'
            : 'Paket indirildi. Paylaş → Ana Ekrana Ekle\'ye dokun, sonra giriş yapmak için ana ekrandaki uygulamayı aç.';
          notice = '';
          Dl.done(leftMsg);
          await signOut(auth);
        } else Dl.done(notice || okMsg);
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
    if (!t.open || !t.matches('.drawer, .subdrawer')) return;
    const sel = t.matches('.drawer') ? '.drawer[open]' : '.subdrawer[open]';
    t.parentElement.querySelectorAll(':scope > ' + sel).forEach(d => { if (d !== t) d.open = false; });
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
    if (b?.dataset.a === 'dl') return void download();
    if (b?.dataset.a !== 'logout') return;
    await signOut(auth);
  });

  // Bağlantı durumu değişince panel (sunucu ↔ cihaz paketi) yeniden çizilir
  ['online', 'offline'].forEach(ev => addEventListener(ev, () => { if (!busy && auth.currentUser) render(); }));

  onAuthStateChanged(auth, () => { if (orphan) { orphan = false; return; } render(); });
})();

const a11y = () => document.querySelectorAll('.fg').forEach((g, i) => { const l = g.querySelector('label'), c = g.querySelector('input,select'); if (l && c) { c.id = c.id || 'f' + i; l.htmlFor = c.id; } });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

