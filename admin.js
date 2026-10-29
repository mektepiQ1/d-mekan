
'use strict';

import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { ref, get, set, remove } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { config, db, auth, EMAIL_DOMAIN, USER_RE, ukey, errText } from "./firebase.js";
if (window.top !== window.self) { document.body.textContent = ''; throw new Error('Çerçeve içinde çalışamaz'); }
let startApp;
/* Firebase Realtime Database katmanı */
const DB = (() => {
  return {
    async all(store) {
      const snap = await get(ref(db, store));
      if (!snap.exists()) return [];
      const val = snap.val();
      if (Array.isArray(val)) return val.filter(Boolean);
      return Object.entries(val).map(([k, v]) => ({ ...v, _fbKey: k }));
    },
    async get(store, id) {
      const snap = await get(ref(db, `${store}/${id}`));
      return snap.exists() ? snap.val() : null;
    },
    async put(store, item) {
      let key = item._fbKey;
      if (!key) { item.id = item.id || Date.now(); key = `item_${item.id}`; }
      await set(ref(db, `${store}/${key}`), { ...item, _fbKey: key });
      return item;
    },
    async del(store, idOrKey) {
      const items = await this.all(store);
      const found = items.find(x => x.id === idOrKey || x._fbKey === idOrKey);
      if (found && found._fbKey) {
        await remove(ref(db, `${store}/${found._fbKey}`));
      } else {
        await remove(ref(db, `${store}/${idOrKey}`));
      }
    },
    async load() {
      const [classes, lessons, users, links, options] = await Promise.all(
        ['classes', 'lessons', 'users', 'links', 'options'].map(s => this.all(s)));
      return { classes, lessons, users, links, options };
    },
    async createStudent(username, password) {
      // Yönetici oturumu bozulmasın diye ikinci bir Firebase uygulaması kullanılır.
      const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
      const email = `${username.toLowerCase()}.${rnd}@${EMAIL_DOMAIN}`;
      const sec = initializeApp(config, 'sec');
      try {
        const c = await createUserWithEmailAndPassword(getAuth(sec), email, password);
        await signOut(getAuth(sec));
        return { uid: c.user.uid, email };
      } finally { await deleteApp(sec); }
    }
  };
})();

/* Yardımcılar */
const U = {
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
  now: () => new Date().toISOString(),
  fd(iso, withTime = true) {
    const d = new Date(iso), p = n => String(n).padStart(2, '0');
    const date = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
    return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
  },
  okUrl(u) {
    try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; }
  }
};

(() => {
  const { esc, now, fd, okUrl } = U;
  const WRONG = 'Parola hatalı. Silme işlemi gerçekleştirilemedi.';
  const app = document.getElementById('app');
  const modalEl = document.getElementById('modal');
  const modalBox = document.getElementById('mc');
  let D, flash = null;
  const collapsed = new Set();

  const msg = (type, text) => { flash = { type, text }; return render(); };
  const alertHtml = () => {
    const f = flash; flash = null;
    return f ? `<div class="alert ${f.type}" role="alert">${esc(f.text)}</div>` : '';
  };
  const head = (h, s) => `<div class="header"><h1>${h}</h1><p>${s}</p></div>`;
  const PW_FIELD = '<div class="fg"><label>Yönetici parolanız (doğrulama):</label><input type="password" name="pw" required autocomplete="current-password" placeholder="Parolanızı giriniz"></div>';
  const empty = (a, b) => `<div class="empty"><p>${a}</p><p>${b}</p></div>`;

  const views = {
    dashboard: () => head('Yönetici Paneli', 'Öğrenci Bahçesi - Ana Panel') + `
      <div class="dash">
        <div class="card"><h2>Sınıf Oluştur</h2>${alertHtml()}
          <form data-f="class"><div class="fg"><label>Sınıf Adı</label>
            <input name="n" required maxlength="100" placeholder="Örn: TYT Lise, KPSS Lisans, 10-A">
            <div class="hint">Öğrenci profilini doldurunca otomatik atanır.</div></div>
            <button>Sınıf Ekle</button></form></div>
        <div class="card"><h2>Bilgi</h2>
          <p>Öğrenciler ogrenci.html üzerinden giriş yapar. Sınıf, ders, öğrenci ve bağlantıları bu panelden yönetebilirsiniz.</p>
          <p>Güvenlik: 30 dakika işlem yapılmazsa oturum otomatik kapanır; silme işlemleri parola doğrulaması ister.</p></div>
      </div>`,

    classes() {
      const list = [...D.classes].sort((a, b) => b.id - a.id);
      return head('Sınıf Yönetimi', 'Tüm sınıflar ve dersler') + `<div class="card"><h2>Tüm Sınıflar</h2>${alertHtml()}` +
        (list.length ? list.map(c => {
          const lessons = D.lessons.filter(l => l.class_id === c.id).sort((a, b) => b.id - a.id);
          return `<div class="item">
            <div class="row"><strong class="nm">${esc(c.class_name)}</strong><button class="sm del" data-a="delClass" data-id="${c.id}">Sil</button></div>
            <small>Eklenme: ${fd(c.created_at)}</small>
            <div class="sub"><div class="t">Bu Sınıfa Ait Dersler:</div>
              ${lessons.length ? lessons.map(l => `<div class="les"><span>${esc(l.lesson_name)}</span>
                <button class="sm" data-a="lessonLink" data-id="${l.id}">Link Ekle</button></div>`).join('') : '<div class="mut">Henüz ders eklenmemiş.</div>'}
              <form class="inl" data-f="lesson" data-id="${c.id}">
                <input name="n" required maxlength="100" placeholder="Ders adı"><button>Ders Ekle</button></form>
            </div></div>`;
        }).join('') : empty('Henüz hiç sınıf eklenmemiş.', 'Ana sayfadaki formdan ekleyebilirsiniz.')) + '</div>';
    },

    students() {
      const list = [...D.users].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const order = type => D.options.filter(o => o.type === type).sort((a, b) => a.id - b.id).map(o => o.label);
      const exams = order('exam'), edus = order('edu');
      const rank = (arr, v) => { const i = arr.indexOf(v); return i < 0 ? arr.length : i; };
      const byKey = new Map();
      list.forEach(u => {
        const done = !!(u.exam && u.education_status);
        const key = done ? JSON.stringify([u.exam, u.education_status]) : 'new';
        if (!byKey.has(key)) byKey.set(key, { key, done, exam: u.exam, edu: u.education_status, users: [] });
        byKey.get(key).users.push(u);
      });
      const groups = [...byKey.values()].sort((a, b) =>
        a.done - b.done ||
        rank(exams, a.exam) - rank(exams, b.exam) || String(a.exam).localeCompare(String(b.exam), 'tr') ||
        rank(edus, a.edu) - rank(edus, b.edu) || String(a.edu).localeCompare(String(b.edu), 'tr'));
      return head('Öğrenci Yönetimi', 'Öğrenci hesapları ve giriş bilgileri') + `
        <div class="card"><h2>Yeni Öğrenci Ekle</h2>${alertHtml()}
          <form data-f="student">
            <div class="fg"><label>Kullanıcı Adı</label><input name="un" required maxlength="30" autocomplete="off" autocapitalize="none"></div>
            <div class="fg"><label>Şifre</label><input name="pw" required minlength="8" maxlength="60" autocomplete="new-password"><div class="hint">En az 8 karakter.</div></div>
            <button>Öğrenci Ekle</button></form></div>
        <div class="card"><h2>Kayıtlı Öğrenciler</h2>` +
        (groups.length ? groups.map(g => `<div class="acc stu${collapsed.has(g.key) ? '' : ' open'}">
          <button class="ah" data-a="toggleGroup" data-k="${esc(g.key)}"><span>${g.done ? `${esc(g.exam)} · ${esc(g.edu)}` : 'Yeni Kayıt'} (${g.users.length} öğrenci)</span><span>▼</span></button>
          <div class="ac">${g.users.map(u => {
            const c = D.classes.find(x => x.id === u.class_id);
            const noClass = g.done ? 'Sınıf atanmamış' : 'Profil bekleniyor';
            return `<div class="item"><div class="row"><div>
              <strong class="nm">${esc(u.username)}</strong>
              <small>Kayıt Tarihi: ${fd(u.created_at)}</small>
              <small>${c ? `Atanan Sınıf: <b>${esc(c.class_name)}</b>` : noClass}</small></div>
              <div class="btns"><button class="sm" data-a="creds" data-id="${u.id}">Şifre Sıfırla</button>
                <button class="sm" data-a="assign" data-id="${u.id}">Sınıf Seç</button>
                <button class="sm del" data-a="delUser" data-id="${u.id}">Sil</button></div></div></div>`;
          }).join('')}</div></div>`).join('')
          : empty('Henüz hiç öğrenci eklenmemiş.', 'Yukarıdaki formdan ekleyebilirsiniz.')) + '</div>';
    },

    links() {
      const groups = {};
      D.links.forEach(l => (groups[l.category] = groups[l.category] || []).push(l));
      const cats = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'tr'));
      return head('Bağlantı Yönetimi', 'Kategorilere göre bağlantılar') + `
        <div class="card"><h2>Yeni Bağlantı Ekle</h2>${alertHtml()}
          <form data-f="link">
            <div class="fg"><label>Kategori Seç</label>
              <select name="c" id="cat" required><option value="">-- Kategori Seçiniz --</option>
                ${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
                <option value="__new">+ Yeni kategori ekle...</option></select>
              <input name="nc" id="nc" maxlength="100" placeholder="Yeni kategori adı" hidden style="margin-top:10px"></div>
            <div class="fg"><label>Buton Metni</label><input name="b" required maxlength="100" placeholder="Buton adı"></div>
            <div class="fg"><label>Bağlantı URL</label><input name="u" type="url" required placeholder="https://..."></div>
            <button>Bağlantı Ekle</button></form></div>` +
        (cats.length ? cats.map(c => `<div class="acc"><button class="ah" data-a="toggle"><span>${esc(c)} (${groups[c].length} bağlantı)</span><span>▼</span></button>
          <div class="ac">${[...groups[c]].sort((a, b) => b.id - a.id).map(l => `<div class="li"><div>
            <strong>${esc(l.button_text)}</strong><small>${esc(l.link_url)}</small></div>
            <div class="btns"><a class="sm" href="${esc(l.link_url)}" target="_blank" rel="noopener noreferrer">Git</a>
              <button class="sm del" data-a="delLink" data-id="${l.id}">Sil</button></div></div>`).join('')}</div></div>`).join('')
          : empty('Henüz bağlantı eklenmemiş.', ''));
    },

    options() {
      const section = (type, title, placeholder) => {
        const list = D.options.filter(o => o.type === type).sort((a, b) => a.id - b.id);
        return `<div class="card"><h2>${title}</h2>
          <form class="inl" data-f="option" data-type="${type}" style="margin:0 0 20px">
            <input name="n" required maxlength="60" autocomplete="off" placeholder="${placeholder}"><button>Ekle</button></form>` +
          (list.length ? list.map(o => `<div class="item"><div class="row"><strong class="nm">${esc(o.label)}</strong>
            <button class="sm del" data-a="delOption" data-id="${o.id}">Sil</button></div></div>`).join('')
            : empty('Seçenek yok.', '')) + '</div>';
      };
      return head('Seçenekler', 'Sınav ve öğrenim düzeyi listeleri') + alertHtml() +
        section('exam', 'Sınav Türleri', 'Örn: TYT, AYT...') +
        section('edu', 'Öğrenim Düzeyleri', 'Örn: Lise, Lisans...');
    }
  };

  async function render() {
    try { D = await DB.load(); } catch (e) { app.innerHTML = '<div class="alert er" role="alert">' + esc(errText(e)) + '</div>'; return; }
    let page = location.hash.slice(1);
    if (!views[page]) page = 'dashboard';
    app.innerHTML = views[page]();
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + page));
    a11y();
  }

  const closeModal = () => modalEl.classList.remove('open');
  function modal(title, text, fields, button, onSubmit) {
    modalBox.innerHTML = `<h3>${title}</h3><p>${text}</p><form>${fields}<button>${button}</button><button type="button" class="gray" data-a="close">İptal</button></form>`;
    modalEl.classList.add('open');
    modalBox.querySelector('input,select,button')?.focus();
    modalBox.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const data = new FormData(e.target);
      closeModal();
      try { await onSubmit(data); } catch (err) { msg('er', errText(err)); }
    };
  }
  function confirmDelete(title, name, text, button, run, note = '') {
    modal(title, `<strong>${esc(name)}</strong> ${text}${note}`, PW_FIELD, button, async f => {
      try { await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, f.get('pw'))); }
      catch { return msg('er', WRONG); }
      msg('ok', await run());
    });
  }

  const forms = {
    async class(d) {
      const n = d.get('n').trim();
      if (!n) return msg('er', 'Geçerli bir sınıf adı giriniz.');
      await DB.put('classes', { class_name: n, created_at: now() });
      msg('ok', 'Sınıf başarıyla eklendi.');
    },
    async lesson(d, f) {
      const n = d.get('n').trim();
      if (!n) return;
      await DB.put('lessons', { class_id: +f.dataset.id, lesson_name: n, link_url: '', created_at: now() });
      msg('ok', 'Ders başarıyla eklendi.');
    },
    async student(d) {
      const username = d.get('un').trim(), pw = d.get('pw');
      if (!USER_RE.test(username) || pw.length < 8)
        return msg('er', 'Kullanıcı adı 3-30 karakter (harf, rakam, . _ -), şifre en az 8 karakter olmalı.');
      if ((await get(ref(db, `usernames/${ukey(username)}`))).exists())
        return msg('er', 'Bu kullanıcı adı zaten kullanılıyor.');
      const { uid, email } = await DB.createStudent(username, pw);
      await DB.put('users', { id: uid, _fbKey: uid, username, exam: null, education_status: null, class_id: null, created_at: now() });
      await set(ref(db, `usernames/${ukey(username)}`), { email, uid });
      msg('ok', 'Öğrenci başarıyla eklendi.');
    },
    async option(d, f) {
      const type = f.dataset.type, label = d.get('n').trim();
      if (!label) return;
      await DB.put('options', { type, label, created_at: now() });
      msg('ok', 'Seçenek eklendi.');
    },
    async link(d) {
      const c = d.get('c') === '__new' ? (d.get('nc') || '').trim() : d.get('c');
      const b = d.get('b').trim(), u = d.get('u').trim();
      if (!c || !b || !okUrl(u)) return msg('er', 'Eksik veya hatalı bilgi.');
      await DB.put('links', { category: c, button_text: b, link_url: u, created_at: now() });
      msg('ok', 'Bağlantı eklendi.');
    }
  };

  const actions = {
    close: closeModal,
    toggle: b => b.parentElement.classList.toggle('open'),
    toggleGroup(b) {
      const k = b.dataset.k;
      collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
      b.parentElement.classList.toggle('open');
    },
    delClass(id) {
      const c = D.classes.find(x => x.id === id);
      confirmDelete('Sınıf Silme', c.class_name, 'silinsin mi?', 'Sil', async () => {
        await Promise.all(D.lessons.filter(l => l.class_id === id).map(l => remove(ref(db, `lessons/${l._fbKey}`))));
        await DB.del('classes', id);
        return 'Silindi.';
      });
    },
    lessonLink(id) {
      const l = D.lessons.find(x => x.id === id);
      modal('Link Düzenle', esc(l.lesson_name), `<input type="url" name="u" value="${esc(l.link_url)}" required placeholder="https://...">`, 'Kaydet', async f => {
        const u = f.get('u').trim();
        if (!okUrl(u)) return msg('er', 'Yalnızca http(s) adresleri kabul edilir.');
        await DB.put('lessons', { ...l, link_url: u });
        msg('ok', 'Güncellendi.');
      });
    },
    assign(id) {
      const u = D.users.find(x => x.id === id);
      modal('Sınıf Ata', esc(u.username), `<select name="c">${D.classes.map(c => `<option value="${c.id}">${esc(c.class_name)}</option>`).join('')}</select>`, 'Ata', async f => {
        await DB.put('users', { ...u, class_id: +f.get('c') });
        msg('ok', 'Atandı.');
      });
    },
    creds(id) {
      const u = D.users.find(x => x.id === id);
      modal('Şifre Sıfırla', esc(u.username), '<input name="pw" type="password" minlength="8" maxlength="60" required autocomplete="new-password" placeholder="Yeni şifre (en az 8 karakter)">', 'Şifreyi sıfırla', async f => {
        const { uid, email } = await DB.createStudent(u.username, f.get('pw'));
        await DB.put('users', { ...u, id: uid, _fbKey: uid });
        await set(ref(db, `usernames/${ukey(u.username)}`), { email, uid });
        await remove(ref(db, `users/${u.id}`));
        msg('ok', 'Şifre sıfırlandı. Öğrenci yeni şifreyle giriş yapabilir.');
      });
    },
    delUser(id) {
      const u = D.users.find(x => x.id === id);
      confirmDelete('Öğrenci Sil', u.username, 'silinsin mi?', 'Sil', async () => { await DB.del('users', id); await remove(ref(db, `usernames/${ukey(u.username)}`)); return 'Silindi.'; });
    },
    delOption(id) {
      const o = D.options.find(x => x.id === id);
      confirmDelete('Seçenek Sil', o.label, 'silinsin mi?', 'Sil', async () => { await DB.del('options', id); return 'Silindi.'; });
    },
    delLink(id) {
      const l = D.links.find(x => x.id === id);
      confirmDelete('Bağlantı Sil', l.button_text, 'silinsin mi?', 'Sil', async () => { await DB.del('links', id); return 'Silindi.'; });
    }
  };

  app.addEventListener('submit', async e => { e.preventDefault(); try { await forms[e.target.dataset.f]?.(new FormData(e.target), e.target); } catch (err) { msg('er', errText(err)); } });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  document.addEventListener('click', e => {
    if (e.target === modalEl) return closeModal();
    const b = e.target.closest('[data-a]');
    if (b) actions[b.dataset.a]?.(b.dataset.id ? (/^\d+$/.test(b.dataset.id) ? +b.dataset.id : b.dataset.id) : b);
  });
  document.addEventListener('change', e => {
    if (e.target.id !== 'cat') return;
    document.getElementById('nc').hidden = e.target.value !== '__new';
  });
  addEventListener('hashchange', () => { if (!auth.currentUser) return; flash = null; render(); });

  startApp = render;
})();

const a11y = () => document.querySelectorAll('.fg').forEach((g, i) => { const l = g.querySelector('label'), c = g.querySelector('input,select'); if (l && c) { c.id = c.id || 'f' + i; l.htmlFor = c.id; } });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

const $ = id => document.getElementById(id);
const gerr = t => { $('gerr').innerHTML = t ? `<div class="alert er" role="alert">${U.esc(t)}</div>` : ''; };
setPersistence(auth, browserSessionPersistence).catch(() => {});
$('gform').addEventListener('submit', async e => {
  e.preventDefault(); gerr('');
  const f = new FormData(e.target);
  try { await signInWithEmailAndPassword(auth, f.get('e').trim(), f.get('p')); e.target.reset(); }
  catch (err) { gerr(err.code === 'auth/too-many-requests' ? errText(err) : 'E-posta veya parola hatalı.'); }
});
$('logout').addEventListener('click', () => signOut(auth));
let idle;
const bump = () => { clearTimeout(idle); if (auth.currentUser) idle = setTimeout(() => signOut(auth), 30 * 60 * 1000); };
['click', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, bump, { passive: true }));
onAuthStateChanged(auth, async user => {
  if (!user) { document.body.classList.remove('authed'); $('app').innerHTML = ''; return; }
  let ok = false;
  try { ok = (await get(ref(db, `admins/${user.uid}`))).val() === true; } catch {}
  if (!ok) { await signOut(auth); gerr('Bu hesap yönetici yetkisine sahip değil.'); return; }
  document.body.classList.add('authed'); bump(); startApp();
});

