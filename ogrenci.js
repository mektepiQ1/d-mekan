
'use strict';

import { ref, get, set } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { db, auth, USER_RE, ukey, errText } from "./firebase.js";
if (window.top !== window.self) { document.body.textContent = ''; throw new Error('Çerçeve içinde çalışamaz'); }

const DB = {
  async all(store) {
    const snap = await get(ref(db, store));
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
  let error = '', lastUser = '', orphan = false;

  const errorHtml = () => {
    const e = error; error = '';
    return e ? `<div class="alert er">${esc(e)}</div>` : '';
  };

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

  const optionTags = list => list.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');

  const profileView = (user, opts) => `
    <div class="card">${welcome(user)}
      <div class="card form-card" style="box-shadow:none;border:1px solid var(--line)">
        <h2>Profilinizi Tamamlayın</h2>
        ${errorHtml()}` +
        (opts.exam.length && opts.edu.length ? `
        <form data-f="profile">
          <div class="fg"><label>Sınav Seçiniz:</label>
            <select name="exam" required><option value="">-- Seçiniz --</option>${optionTags(opts.exam)}</select></div>
          <div class="fg"><label>Öğrenim Durumunuz:</label>
            <select name="education_status" required><option value="">-- Seçiniz --</option>${optionTags(opts.edu)}</select></div>
          <button>Kaydet ve Devam Et</button>
        </form>` : `<div class="warn"><p>Seçenekler henüz eklenmemiş.</p></div>`) + `
      </div>
    </div>`;

  const panelView = (user, cls, lessons) => `
    <div class="card">${welcome(user)}
      <nav class="navbar"><ul class="nl">
        <li><a class="active" href="ogrenci.html">Sınıfım ve Derslerim</a></li>
        ${LINKS.map(([t, u]) => `<li><a href="${u}" rel="noopener noreferrer">${t}</a></li>`).join('')}
      </ul></nav>
      <h2>Sınıfım ve Derslerim</h2>` +
    (cls ? `
      <div class="class-card"><h3>${esc(cls.class_name)}</h3><p>Kayıt: ${fd(cls.created_at, false)}</p></div>
      <div class="lbl">Derslerim:</div>` +
      (lessons.length ? lessons.map(l => `
        <div class="slesson"><span>${esc(l.lesson_name)}</span>
          ${okUrl(l.link_url) ? `<a class="btn" href="${esc(l.link_url)}" target="_blank" rel="noopener noreferrer">İncele</a>` : ''}</div>`).join('')
        : '<div class="empty"><p>Ders eklenmemiş.</p></div>')
      : `<div class="warn"><p>Sınıfınız henüz atanmadı.</p></div>`) + '</div>';

  async function currentUser() {
    const a = auth.currentUser;
    const u = a && await DB.get('users', a.uid);
    return u ? { ...u, _fbKey: a.uid } : undefined;
  }

  async function render() {
    try { await renderInner(); }
    catch (e) { app.innerHTML = `<div class="card"><div class="alert er" role="alert">${esc(errText(e))}</div></div>`; }
    a11y();
  }

  async function renderInner() {
    if (!auth.currentUser) return void (app.innerHTML = loginView());
    const user = await currentUser();
    if (!user) {
      orphan = true; await signOut(auth);
      error = 'Hesabınız bulunamadı veya devre dışı. Lütfen yöneticinize başvurun.';
      return void (app.innerHTML = loginView());
    }
    if (!user.exam || !user.education_status) {
      const opts = (await DB.all('options')).sort((a, b) => a.id - b.id);
      const by = type => opts.filter(o => o.type === type).map(o => o.label);
      return void (app.innerHTML = profileView(user, { exam: by('exam'), edu: by('edu') }));
    }
    const [classes, lessons] = await Promise.all([DB.all('classes'), DB.all('lessons')]);
    const cls = classes.find(c => c.id === user.class_id);
    app.innerHTML = panelView(user, cls, cls ? lessons.filter(l => l.class_id === cls.id).sort((a, b) => b.id - a.id) : []);
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
      const exam = d.get('exam'), edu = d.get('education_status');
      if (!user || !exam || !edu) return;
      const match = matchClass(await DB.all('classes'), exam, edu);
      await DB.put('users', { ...user, exam, education_status: edu, class_id: match ? match.id : user.class_id });
    }
  };

  app.addEventListener('submit', async e => {
    e.preventDefault();
    try { await forms[e.target.dataset.f]?.(new FormData(e.target)); } catch (err) { error = errText(err); }
    render();
  });

  app.addEventListener('click', async e => {
    if (e.target.closest('[data-a]')?.dataset.a !== 'logout') return;
    await signOut(auth);
  });

  onAuthStateChanged(auth, () => { if (orphan) { orphan = false; return; } render(); });
})();

const a11y = () => document.querySelectorAll('.fg').forEach((g, i) => { const l = g.querySelector('label'), c = g.querySelector('input,select'); if (l && c) { c.id = c.id || 'f' + i; l.htmlFor = c.id; } });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

