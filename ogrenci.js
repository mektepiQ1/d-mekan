
'use strict';

import { ref, get, set, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { db, auth, USER_RE, ukey, errText } from "./firebase.js";
import { Pkg } from "./paket.js";
if (window.top !== window.self) { document.body.textContent = ''; throw new Error('Çerçeve içinde çalışamaz'); }

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
  let error = '', notice = '', lastUser = '', orphan = false, busy = false;

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

  /* Cihaz paketi kartı: seçilen sınıf cihaza indirilir, sonra internetsiz de açılır */
  const pkgCard = (cls, pkg, offline) => !cls ? '' : `
    <div class="pkg${pkg ? ' ok' : ''}">
      <div class="pkg-t"><strong>📦 ${esc(cls.class_name)} paketi</strong>
        <small>${pkg
          ? `Cihazında hazır · ${fd(pkg.downloaded_at)}<br>${pkg.lessons.length} soru bankası · ${pkg.topics.length} konu anlatımı · ${fmtSize(pkg.bytes)}`
          : 'Henüz cihazına indirilmedi. İndirince bu sınıfın içeriği telefonunda saklanır ve internet olmadan da açılır.'}</small></div>
      <div class="pkg-b">
        ${offline ? '' : `<button type="button" class="pk" data-a="dl">${pkg ? 'Güncelle' : 'Paketi İndir'}</button>`}
        ${pkg ? '<button type="button" class="pk gray" data-a="dlDel">Cihazdan Sil</button>' : ''}</div>
      <div class="pkg-s" id="pkgs" role="status" aria-live="polite"></div>
    </div>`;

  const loginView = () => `
    <div class="card form-card">
      <h2>Hoş Geldiniz</h2>
      <p class="sub-t">Sisteme erişmek için giriş yapın</p>
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
          <button>Kaydet ve Devam Et</button>
        </form>` : `<div class="warn"><p>Henüz sınıf eklenmemiş.</p></div>`) + `
      </div>
    </div>`;

  const itemRows = (list, none) => list.length ? list.map(l => `
            <div class="slesson"><span>${esc(l.lesson_name)}</span>
              ${okUrl(l.link_url) ? `<a class="btn" href="${esc(l.link_url)}" target="_blank" rel="noopener noreferrer">İncele</a>` : ''}</div>`).join('')
    : `<div class="empty"><p>${none}</p></div>`;

  const panelView = (user, cls, lessons, topics, pkg = null, offline = false) => `
    <div class="card">${welcome(user)}
      ${offline ? '<div class="alert off" role="status">Sunucuya ulaşılamıyor. Cihazındaki paket gösteriliyor.</div>' : ''}
      ${errorHtml()}${noticeHtml()}
      ${pkgCard(cls, pkg, offline)}
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

  async function download() {
    if (busy) return;
    busy = true;
    const say = t => { const s = document.getElementById('pkgs'); if (s) s.textContent = t; };
    app.querySelectorAll('.pk').forEach(x => { x.disabled = true; });
    try {
      if (!Pkg.supported) fail('Bu tarayıcı cihaz depolamasını desteklemiyor.');
      if (!navigator.onLine) fail('Paketi indirmek için internet bağlantısı gerekli.');
      const user = await currentUser();
      if (!user || !user.class_id) fail('Önce sınıfınızı seçmelisiniz.');
      say('Sınıf bilgisi alınıyor…');
      const cls = (await DB.all('classes')).find(c => c.id === user.class_id);
      if (!cls) fail('Sınıfınız artık mevcut değil. Lütfen yöneticinize başvurun.');
      say('Soru bankası indiriliyor…');
      const lessons = await DB.byClass('lessons', cls.id);
      say('Konu anlatımları indiriliyor…');
      const topics = await DB.byClass('topics', cls.id).catch(() => []);
      say('Cihaza kaydediliyor…');
      const pkg = Pkg.build(user, cls, lessons, topics);
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
      if (est && est.quota && est.quota - (est.usage || 0) < pkg.bytes * 2) fail('Cihazda yeterli boş alan yok.');
      await Pkg.save(pkg);
      const back = await Pkg.get(pkg.uid, cls.id);          // yazıldığını doğrula
      if (!back || back.lessons.length !== pkg.lessons.length || back.topics.length !== pkg.topics.length) fail('Paket cihaza doğru kaydedilemedi. Lütfen tekrar deneyin.');
      await Pkg.pruneOthers(pkg.uid, pkg.key);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      warmOffline();
      notice = 'Paket cihazına indirildi. Artık internet olmadan da açılır.';
    } catch (e) {
      error = e && e.ui ? e.ui : e && e.name === 'QuotaExceededError' ? 'Cihazda yeterli boş alan yok.' : errText(e);
    } finally { busy = false; }
    render();
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
    const pkg = await Pkg.get(user._fbKey, user.class_id).catch(() => null);
    if (pkg) return void (app.innerHTML = panelView(user, pkg.class, pkg.lessons, pkg.topics, pkg, false));
    const [classes, lessons, topics] = await Promise.all([DB.all('classes'), DB.byClass('lessons', user.class_id), DB.byClass('topics', user.class_id).catch(() => [])]);
    const cls = classes.find(c => c.id === user.class_id);
    const mine = list => cls ? list.filter(l => l.class_id === cls.id).sort((a, b) => b.id - a.id) : [];
    app.innerHTML = panelView(user, cls, mine(lessons), mine(topics), null, false);
  }

  const forms = {
    async login(d) {
      const un = d.get('un').trim().toLowerCase();
      lastUser = d.get('un').trim();
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
    async profile(d) {
      const user = await currentUser();
      const cid = +d.get('class_id');
      if (!user) return;
      if (!cid) { error = 'Lütfen bir sınıf seçiniz.'; return; }
      const [classes, opts] = await Promise.all([DB.all('classes'), DB.all('options')]);
      const cls = classes.find(c => c.id === cid);
      if (!cls) throw new Error('Seçilen sınıf bulunamadı.');
      const exam = groupLabel(cls, opts.filter(o => o.type === 'cgroup')) || 'Genel';
      await DB.put('users', { ...user, exam, education_status: cls.class_name, class_id: cls.id });
    }
  };

  app.addEventListener('submit', async e => {
    e.preventDefault();
    try { await forms[e.target.dataset.f]?.(new FormData(e.target)); } catch (err) { error = errText(err); }
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
    if (b?.dataset.a === 'dlDel') {
      if (!confirm('Paket bu cihazdan silinsin mi? İstediğin zaman tekrar indirebilirsin.')) return;
      const uid = auth.currentUser && auth.currentUser.uid;
      if (uid) await Pkg.remove(uid).catch(() => {});
      notice = 'Paket cihazdan silindi.';
      return void render();
    }
    if (b?.dataset.a !== 'logout') return;
    await signOut(auth);
  });

  // Bağlantı durumu değişince panel (sunucu ↔ cihaz paketi) yeniden çizilir
  ['online', 'offline'].forEach(ev => addEventListener(ev, () => { if (!busy && auth.currentUser) render(); }));

  onAuthStateChanged(auth, () => { if (orphan) { orphan = false; return; } render(); });
})();

const a11y = () => document.querySelectorAll('.fg').forEach((g, i) => { const l = g.querySelector('label'), c = g.querySelector('input,select'); if (l && c) { c.id = c.id || 'f' + i; l.htmlFor = c.id; } });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

