'use strict';

import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getDatabase, ref, get, set, remove } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
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
      const [classes, lessons, users, links, options, topics, requests] = await Promise.all(
        ['classes', 'lessons', 'users', 'links', 'options', 'topics', 'classRequests'].map(s => this.all(s).catch(() => [])));
      return { classes, lessons, users, links, options, topics, requests };
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
  const openG = new Set();           // açık öğrenci grupları (yeniden çizimlerde korunur)
  const openS = new Set();           // açık alt çekmeceler (yeniden çizimlerde korunur)
  let openClass = null;              // açık sınıf çekmecesi (yeniden çizimlerde korunur)
  const openF = new Set();           // açık klasörler (yeniden çizimlerde korunur)
  let migrating = false;

  /* Bağlantı ağacı yardımcıları */
  const isFolder = x => x.type === 'folder';
  const parentOf = x => x.parent_id || 0;
  let seq = 0;
  const nid = () => (seq = Math.max(seq + 1, Date.now()));
  const byId = id => D.links.find(x => x.id === id);
  const pathOf = pid => {               // "Ana › Alt › Daha alt" (eski öğrenci sayfası için uyumluluk)
    const names = []; let cur = pid, n = 0;
    while (cur && n++ < 200) { const f = byId(cur); if (!f) break; names.unshift(String(f.name)); cur = parentOf(f); }
    return names.join(' › ') || 'Genel';
  };
  const descendants = id => {
    const out = [], q = [id], seen = new Set([id]);
    while (q.length) {
      const p = q.shift();
      D.links.forEach(x => {
        if (parentOf(x) === p && !seen.has(x.id)) { seen.add(x.id); out.push(x); if (isFolder(x)) q.push(x.id); }
      });
    }
    return out;
  };
  const linkKey = x => x._fbKey || `item_${x.id}`;
  const sameName = (a, b) => String(a).trim().toLocaleLowerCase('tr') === String(b).trim().toLocaleLowerCase('tr');
  const folderField = (label, name, value = '', ph = '') =>
    `<div class="fg"><label>${label}<input name="${name}" required maxlength="100" autocomplete="off" value="${esc(value)}" placeholder="${ph}"></label></div>`;
  const urlField = (value = '') =>
    `<div class="fg"><label>Bağlantı URL<input name="u" type="url" required value="${esc(value)}" placeholder="https://..."></label></div>`;

  async function migrateLegacy() {      // eski düz "category" kayıtlarını klasör yapısına çevirir
    const legacy = D.links.filter(x => !x.type);
    const map = new Map();
    D.links.filter(x => isFolder(x) && !parentOf(x)).forEach(f => map.set(String(f.name), f.id));
    for (const l of legacy) {
      const c = String(l.category || '').trim() || 'Genel';
      if (!map.has(c)) {
        const id = nid();
        await DB.put('links', { id, type: 'folder', name: c, parent_id: 0, created_at: now() });
        map.set(c, id);
      }
      await DB.put('links', { ...l, type: 'link', parent_id: map.get(c), category: c });
    }
    return legacy.length > 0;
  }

  /* Ekranda sabit duran bildirim: sayfa aşağıda kaydırılmış olsa da görünür */
  const toast = (type, text) => {
    if (!document.getElementById('toast-css')) {
      const st = document.createElement('style'); st.id = 'toast-css';
      st.textContent = '.toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 14px);transform:translate(-50%,-20px);z-index:99999;max-width:min(92vw,460px);padding:13px 20px;border-radius:14px;font-size:14px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.22);opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;text-align:center}.toast.show{opacity:1;transform:translate(-50%,0)}.toast.ok{background:#276749;color:#fff}.toast.er{background:#c53030;color:#fff}';
      document.head.appendChild(st);
    }
    document.querySelectorAll('.toast').forEach(x => x.remove());
    const t = document.createElement('div'); t.className = 'toast ' + (type === 'er' ? 'er' : 'ok'); t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
  };
  const msg = (type, text) => { flash = { type, text }; toast(type, text); return render(); };
  const alertHtml = () => {
    const f = flash; flash = null;
    return f ? `<div class="alert ${f.type}" role="alert">${esc(f.text)}</div>` : '';
  };
  const head = (h, s) => `<div class="header"><h1>${h}</h1><p>${s}</p></div>`;
  const PW_FIELD = '<div class="fg"><label>Yönetici parolanız (doğrulama):</label><input type="password" name="pw" required autocomplete="current-password" placeholder="Parolanızı giriniz"></div>';
  const empty = (a, b) => `<div class="empty"><p>${a}</p><p>${b}</p></div>`;
  const cgroups = () => D.options.filter(o => o.type === 'cgroup').sort((a, b) => a.id - b.id);
  const clsName = c => { const g = cgroups().find(o => o.id === c.group_id); return g ? `${g.label} › ${c.class_name}` : c.class_name; };

  function studentBlocks() {
      const list = [...D.users].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const nk = v => String(v == null ? '' : v).toLocaleLowerCase('tr').replace(/[\s._-]+/g, '');
      const EDU = ['ilkokul', 'ortaokul', 'lise', 'önlisans', 'lisans', 'yükseklisans'];
      const eduRank = k => { const i = EDU.indexOf(k); return i < 0 ? EDU.length : i; };
      const fresh = [], exams = new Map();
      list.forEach(u => {
        if (!(u.exam && u.education_status)) { fresh.push(u); return; }
        const ek = nk(u.exam), lk = nk(u.education_status);
        if (!exams.has(ek)) exams.set(ek, { key: ek, name: u.exam, count: 0, edus: new Map() });
        const e = exams.get(ek); e.count++;
        if (!e.edus.has(lk)) e.edus.set(lk, { key: lk, name: u.education_status, users: [] });
        e.edus.get(lk).users.push(u);
      });
      const add = `<form data-f="student">
            <div class="fg"><label>Kullanıcı Adı</label><input name="un" required maxlength="30" autocomplete="off" autocapitalize="none"></div>
            <div class="fg"><label>Şifre</label><input name="pw" required minlength="8" maxlength="60" autocomplete="new-password"><div class="hint">En az 8 karakter.</div></div>
            <button>Öğrenci Ekle</button></form>`;
      const userCard = u => {
        const c = D.classes.find(x => x.id === u.class_id);
        const noClass = u.exam && u.education_status ? 'Sınıf atanmamış' : 'Profil bekleniyor';
        return `<div class="item scard"><div class="row"><div>
              <strong class="nm">${esc(u.username)}</strong>
              <small>Kayıt Tarihi: ${fd(u.created_at)}</small>
              <small>${c ? `Atanan Sınıf: <b>${esc(clsName(c))}</b>` : noClass}</small></div>
              <div class="btns sb"><button class="sm" data-a="creds" data-id="${u.id}">Şifre Sıfırla</button>
                <button class="sm" data-a="assign" data-id="${u.id}">Sınıf Seç</button>
                <button class="sm del" data-a="delUser" data-id="${u.id}">Sil</button></div></div></div>`;
      };
      const drawer = (key, title, body) => `<div class="acc stu${openG.has(key) ? ' open' : ''}" data-key="${esc(key)}">
          <button class="ah" type="button" data-a="toggleGroup" data-k="${esc(key)}"><span>${title}</span><span>▼</span></button>
          <div class="ac">${body}</div></div>`;
      const examList = [...exams.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr'));
      const reqCard = r => `<div class="item scard"><div class="row"><div>
              <strong class="nm">${esc(r.username)}</strong>
              <small>İstenen sınıf: <b>${esc(r.to_class_name)}</b></small>
              <small>İstek: ${fd(r.requested_at)}</small></div>
              <div class="btns sb"><button class="sm" data-a="approveReq" data-id="${esc(r._fbKey)}">Onayla</button>
                <button class="sm del" data-a="rejectReq" data-id="${esc(r._fbKey)}">Reddet</button></div></div></div>`;
      const reqs = (D.requests || []).filter(r => D.users.some(u => u._fbKey === r._fbKey))
        .sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
      const reg = (reqs.length ? drawer('req', `Sınıf Değiştirme İstekleri (${reqs.length})`, reqs.map(reqCard).join('')) : '') + (fresh.length ? drawer('new', `Yeni Kayıt (${fresh.length} öğrenci)`, fresh.map(userCard).join('')) : '') +
        examList.map(e => drawer('e:' + e.key, `${esc(e.name)} (${e.count} öğrenci)`,
          [...e.edus.values()].sort((a, b) => eduRank(a.key) - eduRank(b.key) || String(a.name).localeCompare(String(b.name), 'tr'))
            .map(l => drawer(`e:${e.key}|l:${l.key}`, `${esc(l.name)} (${l.users.length} öğrenci)`, l.users.map(userCard).join(''))).join(''))).join('') ||
        (fresh.length ? '' : empty('Henüz hiç öğrenci eklenmemiş.', 'Yukarıdaki formdan ekleyebilirsiniz.'));
      return { add, reg };
  }

  function linkBlock() {
      const ids = new Set(D.links.map(x => x.id)), kids = new Map();
      D.links.forEach(x => {
        let p = parentOf(x); if (p && !ids.has(p)) p = 0;      // sahipsiz kayıt kök düzeye çıkar
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p).push(x);
      });
      const kidsOf = p => (kids.get(p) || []).slice().sort((a, b) =>
        isFolder(b) - isFolder(a) ||
        (isFolder(a) ? String(a.name).localeCompare(String(b.name), 'tr') : a.id - b.id));
      const stats = p => kidsOf(p).reduce((s, x) => {
        if (isFolder(x)) { const t = stats(x.id); s.f += 1 + t.f; s.l += t.l; } else s.l++;
        return s;
      }, { f: 0, l: 0 });
      const list = p => kidsOf(p).map(node).join('');
      const node = x => {
        if (!isFolder(x)) {
          return `<li class="tnode"><div class="trow lk"><div class="ltxt"><strong>🔗 ${esc(x.button_text)}</strong><small>${esc(x.link_url)}</small></div>
            <div class="tact">${okUrl(x.link_url) ? `<a class="sm" href="${esc(x.link_url)}" target="_blank" rel="noopener noreferrer">Git</a>` : ''}
              <button class="sm" type="button" data-a="editLink" data-id="${x.id}">Düzenle</button>
              <button class="sm del" type="button" data-a="delLink" data-id="${x.id}">Sil</button></div></div></li>`;
        }
        const s = stats(x.id), open = openF.has(x.id), inner = list(x.id);
        return `<li class="tnode acc tr${open ? ' open' : ''}" data-n="${x.id}">
          <button class="ah" type="button" data-a="tfold" data-id="${x.id}" aria-expanded="${open}">
            <span class="tt">${esc(x.name)} <span class="cnt">${s.f} alt kategori · ${s.l} bağlantı</span></span><span>▼</span></button>
          <div class="ac"><div class="tact">
            <button class="sm" type="button" data-a="addFolder" data-id="${x.id}">+ Alt kategori</button>
            <button class="sm" type="button" data-a="addLink" data-id="${x.id}">+ Bağlantı</button>
            <button class="sm" type="button" data-a="renFolder" data-id="${x.id}">Yeniden adlandır</button>
            <button class="sm del" type="button" data-a="delFolder" data-id="${x.id}">Sil</button></div>
          <ul>${inner || '<li class="mut">Bu kategori boş. Alt kategori veya bağlantı ekleyin.</li>'}</ul></div></li>`;
      };
      return `<div class="tbar">
            <button class="sm" type="button" data-a="addFolder" data-id="0">+ Ana kategori</button>
            <button class="sm" type="button" data-a="addLink" data-id="0">+ Ana düzeye bağlantı</button>
            <button class="sm" type="button" data-a="expandAll">Tümünü aç</button>
            <button class="sm" type="button" data-a="collapseAll">Tümünü kapat</button></div>` +
        (D.links.length ? `<ul class="tree">${list(0)}</ul>`
          : empty('Henüz kategori veya bağlantı eklenmemiş.', 'Yukarıdaki düğmeyle ilk ana kategoriyi ekleyebilirsiniz.')) ;
    }


  /* Görsel: küçültülüp JPEG data-URL olarak kaydedilir (yalnızca yönetici ekler) */
  const toDataUrl = file => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('Dosya okunamadı.'));
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => rej(new Error('Görsel okunamadı.'));
      im.onload = () => {
        const s = Math.min(1, 1000 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.width * s)); c.height = Math.max(1, Math.round(im.height * s));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.75));
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
  const IMG_OK = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  const imgBlock = (l, store) => `<div class="pimg">
      ${l.img && IMG_OK.test(l.img) ? `<div class="bkp" style="background-image:url(${l.img})" role="img" aria-label="${esc(l.lesson_name)}"></div>${l.img_caption ? `<small><b>Kitabın altındaki yazı:</b> ${esc(l.img_caption)}</small>` : ''}${okUrl(l.img_link) ? `<small>Dokununca açılacak link: ${esc(l.img_link)}</small>` : ''}` : '<div class="mut">Henüz kitap kapağı eklenmemiş.</div>'}
      <form class="inl wrap" data-f="itemimg" data-k="${store}" data-id="${l.id}">
        <input name="img" type="file" accept="image/*" aria-label="Kapak görseli">
        <input name="c" maxlength="200" autocomplete="off" placeholder="Kitabın altında görünecek yazı (boşsa ders adı görünür)" value="${esc(l.img_caption || '')}">
        <input name="u" type="url" autocomplete="off" placeholder="Kitaba dokununca açılacak link (https://...)" value="${esc(l.img_link || '')}">
        <button>Kaydet</button></form>
      <div class="hint">En iyi görünüm için dikey kapak kullanın (yaklaşık 247×385 oranı). Öğrenci panelinde 3 boyutlu kitap olarak raflanır.</div>
      ${l.img ? `<div class="tact"><button class="sm" type="button" data-a="editImg" data-k="${store}" data-id="${l.id}">Düzenle</button>
        <button class="sm del" type="button" data-a="delImg" data-k="${store}" data-id="${l.id}">Görseli Kaldır</button></div>` : ''}</div>`;

  const views = {
    dashboard() {
      const sub = (k, title, body, cls = '') => `<div class="acc sdr${cls}${openS.has(String(k)) ? ' open' : ''}" data-key="${k}">
          <button class="ah" type="button" data-a="toggleSub" data-k="${k}" aria-expanded="${openS.has(String(k))}"><span>${title}</span><span>▼</span></button>
          <div class="ac">${body}</div></div>`;
      const list = [...D.classes].sort((a, b) => b.id - a.id);
      const cgs = cgroups(), gids = new Set(cgs.map(g => g.id));
      const classBox = (c, loose) => {
        const lessons = D.lessons.filter(l => l.class_id === c.id).sort((a, b) => b.id - a.id);
        const topics = D.topics.filter(l => l.class_id === c.id).sort((a, b) => b.id - a.id);
        const qb = sub('q' + c.id, `Soru Bankası (${lessons.length})`,
          (lessons.length ? lessons.map(l => sub('l' + l.id, esc(l.lesson_name), `<div class="tact">
            <button class="sm" data-a="lessonLink" data-id="${l.id}">Düzenle</button>
            <button class="sm del" data-a="delLesson" data-id="${l.id}">Sil</button></div>${imgBlock(l, 'lessons')}`, ' lsn')).join('') : '<div class="mut">Henüz soru bankası eklenmemiş.</div>') +
          `<form class="inl" data-f="lesson" data-id="${c.id}">
            <input name="n" required maxlength="100" placeholder="Ders adı"><button>Ekle</button></form>`);
        const ka = sub('t' + c.id, `Konu Anlatımları (${topics.length})`,
          (topics.length ? topics.map(l => sub('p' + l.id, esc(l.lesson_name), `<div class="tact">
            <button class="sm" data-a="topicLink" data-id="${l.id}">Düzenle</button>
            <button class="sm del" data-a="delTopic" data-id="${l.id}">Sil</button></div>${imgBlock(l, 'topics')}`, ' lsn')).join('') : '<div class="mut">Henüz konu anlatımı eklenmemiş.</div>') +
          `<form class="inl wrap" data-f="topic" data-id="${c.id}">
            <input name="n" required maxlength="100" autocomplete="off" placeholder="Başlık (örn: TÜRKÇE KONU ANLATIMI)">
            <input name="u" type="url" required autocomplete="off" placeholder="https://...">
            <button>Konu Anlatımı Ekle</button></form>`);
        return sub(String(c.id), esc(c.class_name), `<div class="tact" style="margin-bottom:8px">
            ${loose ? `<button class="sm" data-a="pubClass" data-id="${c.id}">Güncelle</button>` : ''}<button class="sm" data-a="renClass" data-id="${c.id}">Düzenle</button>
            <button class="sm del" data-a="delClass" data-id="${c.id}">Sil</button></div>
            <small style="margin:0 0 8px">Eklenme: ${fd(c.created_at)}</small>${qb}${ka}`);
      };
      const groupBox = g => {
        const kids = list.filter(c => c.group_id === g.id);
        return sub('g' + g.id, `${esc(g.label)} (${kids.length})`,
          `<div class="tact" style="margin-bottom:8px"><button class="sm" data-a="pubGroup" data-id="${g.id}">Güncelle</button>
            <button class="sm" data-a="renCGroup" data-id="${g.id}">Adlandır</button>
            <button class="sm del" data-a="delCGroup" data-id="${g.id}">Sil</button></div>` +
          (kids.length ? kids.map(c => classBox(c)).join('') : '<div class="mut">Henüz sınıf eklenmemiş.</div>'));
      };
      const loose = list.filter(c => !gids.has(c.group_id));
      const drawers = cgs.length || loose.length
        ? cgs.map(groupBox).join('') + loose.map(c => classBox(c, true)).join('')
        : empty('Henüz hiç sınıf eklenmemiş.', 'Yukarıdaki formdan ekleyebilirsiniz.');
      const st = studentBlocks();
      const nwOpen = openClass === 'new', clOpen = openClass === 'cls', stOpen = openClass === 'std', lkOpen = openClass === 'lnk';
      return head('Yönetici Paneli', 'Öğrenci Bahçesi - Ana Panel') + `
${alertHtml()}
      <div class="card"><div class="acc cls big${nwOpen ? ' open' : ''}">
        <button class="ah" type="button" data-a="toggleClass" data-k="new" aria-expanded="${nwOpen}"><span>Sınıf Oluştur</span><span>▼</span></button>
        <div class="ac pad cpt">
          <div class="t">1. İsim oluştur</div>
          <form class="inl" data-f="cgroup">
            <input name="n" required maxlength="60" autocomplete="off" aria-label="İsim oluştur" placeholder="Örn: TYT, KPSS"><button>İsim Ekle</button></form>
          <div class="t">2. Sınıfı bir isme ekle</div>
          <form class="inl" data-f="class">
            <input name="n" required maxlength="100" autocomplete="off" aria-label="Sınıf adı" placeholder="Sınıf adı (örn: TYT Lise)">
            <select name="g" aria-label="Hangi çekmeceye eklensin"><option value="0">Doğrudan Tüm Sınıflar</option>${cgroups().map(g => `<option value="${g.id}">${esc(g.label)}</option>`).join('')}</select>
            <button>Kaydet</button></form>
          <div class="hint">Öğrenci profilini doldurunca sınıf adına göre otomatik atanır.</div></div></div>
        <div class="acc cls big${clOpen ? ' open' : ''}">
        <button class="ah" type="button" data-a="toggleClass" data-k="cls" aria-expanded="${clOpen}"><span>Tüm Sınıflar</span><span>▼</span></button>
        <div class="ac">${drawers}</div></div>
        <div class="acc cls big${stOpen ? ' open' : ''}">
        <button class="ah" type="button" data-a="toggleClass" data-k="std" aria-expanded="${stOpen}"><span>Öğrenciler</span><span>▼</span></button>
        <div class="ac">${sub('add', 'Yeni Öğrenci Ekle', st.add)}${sub('list', `Kayıtlı Öğrenciler (${D.users.length})`, st.reg)}</div></div>
        <div class="acc cls big${lkOpen ? ' open' : ''}">
        <button class="ah" type="button" data-a="toggleClass" data-k="lnk" aria-expanded="${lkOpen}"><span>Bağlantılar</span><span>▼</span></button>
        <div class="ac">${sub('tree', 'Bağlantı Ağacı', linkBlock())}</div></div></div>`;
    },
  };

  /* Öğrenci uygulaması açılışta yalnızca stamps/<sınıf> düğümünü okur (tüm tabloları değil).
     Yazma başarısız olursa (kurallar henüz yüklenmediyse) sessizce geçilir; öğrenci eski yönteme düşer. */
  const stampFor = (c, opts) => { const g = opts.find(o => o.type === 'cgroup' && o.id === c.group_id); return (g && g.published_at || '') + '|' + (c.published_at || ''); };
  const putStamps = list => Promise.all(list.map(([id, v]) => set(ref(db, `stamps/${id}`), v))).catch(() => {});
  let stampsSynced = false;
  async function syncStamps() {
    try {
      const sn = await get(ref(db, 'stamps')), cur = sn.exists() ? sn.val() : {};
      await putStamps(D.classes.filter(c => cur[c.id] !== stampFor(c, D.options)).map(c => [c.id, stampFor(c, D.options)]));
    } catch {}
  }
  async function render() {
    try { D = await DB.load(); } catch (e) { app.innerHTML = '<div class="alert er" role="alert">' + esc(errText(e)) + '</div>'; return; }
    if (!stampsSynced) { stampsSynced = true; syncStamps(); }
    let page = location.hash.slice(1);
    if (!views[page]) page = 'dashboard';
    if (page === 'dashboard' && !migrating && D.links.some(x => !x.type)) {
      migrating = true;
      try { if (await migrateLegacy()) D = await DB.load(); }
      catch (e) { flash = { type: 'er', text: 'Eski bağlantılar yeni yapıya aktarılamadı: ' + errText(e) }; }
      finally { migrating = false; }
    }
    app.innerHTML = views[page]();
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + page));
    a11y();
    if (page === 'dashboard') app.querySelector('.alert')?.scrollIntoView({ block: 'nearest' });
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
      const g = +d.get('g') || 0;
      if (g && !cgroups().some(x => x.id === g)) return msg('er', 'Seçilen çekmece bulunamadı.');
      await DB.put('classes', { class_name: n, group_id: g, created_at: now() });
      msg('ok', 'Sınıf başarıyla eklendi.');
    },
    async cgroup(d) {
      const n = d.get('n').trim();
      if (!n) return msg('er', 'Geçerli bir isim giriniz.');
      if (cgroups().some(x => sameName(x.label, n))) return msg('er', 'Bu adlı bir çekmece zaten var.');
      await DB.put('options', { type: 'cgroup', label: n, created_at: now() });
      msg('ok', 'İsim eklendi. Şimdi sınıfı bu isme ekleyebilirsiniz.');
    },
    async itemimg(d, f) {
      const store = f.dataset.k === 'topics' ? 'topics' : 'lessons', id = +f.dataset.id;
      const l = D[store].find(x => x.id === id);
      if (!l) return msg('er', 'Kayıt bulunamadı.');
      const file = d.get('img'), u = d.get('u').trim();
      if (u && !okUrl(u)) return msg('er', 'Yalnızca http(s) adresleri kabul edilir.');
      const has = file && file.size;
      if (!has && !l.img) return msg('er', 'Lütfen bir görsel seçiniz.');
      if (has && !file.type.startsWith('image/')) return msg('er', 'Yalnızca görsel dosyası seçebilirsiniz.');
      const img = has ? await toDataUrl(file) : l.img;
      const cap = d.get('c') == null ? (l.img_caption || '') : d.get('c').trim();
      await DB.put(store, { ...l, img, img_link: u, img_caption: cap });
      msg('ok', 'Kitap kapağı kaydedildi.');
    },
    async lesson(d, f) {
      const n = d.get('n').trim();
      if (!n) return;
      await DB.put('lessons', { class_id: +f.dataset.id, lesson_name: n, link_url: '', created_at: now() });
      msg('ok', 'Ders başarıyla eklendi.');
    },
    async topic(d, f) {
      const n = d.get('n').trim(), u = d.get('u').trim();
      if (!n || !okUrl(u)) return msg('er', 'Başlık ve geçerli bir http(s) adresi giriniz.');
      await DB.put('topics', { class_id: +f.dataset.id, lesson_name: n, link_url: u, created_at: now() });
      msg('ok', 'Konu anlatımı eklendi.');
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
    }
  };

  const actions = {
    close: closeModal,
    toggle: b => b.parentElement.classList.toggle('open'),
    toggleGroup(b) {                   // öğrenci grubu: biri açılınca kardeşleri kapanır
      const k = b.dataset.k, acc = b.parentElement, o = !acc.classList.contains('open');
      const shut = a => [a, ...a.querySelectorAll('.acc.stu')].forEach(x => { x.classList.remove('open'); openG.delete(x.dataset.key); });
      acc.parentElement.querySelectorAll(':scope > .acc.stu').forEach(x => { if (x !== acc) shut(x); });
      if (o) { acc.classList.add('open'); openG.add(k); } else shut(acc);
    },
    toggleClass(b) {                   // çekmece: biri açılınca diğerleri kapanır
      const acc = b.parentElement, willOpen = !acc.classList.contains('open');
      app.querySelectorAll('.acc.cls').forEach(a => {
        a.classList.remove('open');
        a.querySelector(':scope > .ah').setAttribute('aria-expanded', 'false');
      });
      if (willOpen) { acc.classList.add('open'); b.setAttribute('aria-expanded', 'true'); }
      openClass = willOpen ? (/^\d+$/.test(b.dataset.k) ? +b.dataset.k : b.dataset.k) : null;
    },
    toggleSub(b) {                     // alt çekmeceler: biri açılınca kardeşleri kapanır
      const acc = b.parentElement, willOpen = !acc.classList.contains('open');
      const shut = a => [a, ...a.querySelectorAll('.acc.sdr')].forEach(x => {
        x.classList.remove('open'); openS.delete(x.dataset.key);
        x.querySelector(':scope > .ah').setAttribute('aria-expanded', 'false');
      });
      acc.parentElement.querySelectorAll(':scope > .acc.sdr').forEach(a => { if (a !== acc) shut(a); });
      if (willOpen) { acc.classList.add('open'); openS.add(acc.dataset.key); b.setAttribute('aria-expanded', 'true'); }
      else shut(acc);
    },
    async pubGroup(id, btn) {          // çekmece güncellendi: bu çekmecedeki sınıfların öğrencileri yeni içeriği otomatik alır
      const o = D.options.find(x => x.id === id);
      if (!o) return msg('er', 'Çekmece bulunamadı. Sayfayı yenileyin.');
      if (btn) { btn.disabled = true; btn.textContent = 'Güncelleniyor…'; }
      try {
        const ts = now();
        await DB.put('options', { ...o, published_at: ts });
        await putStamps(D.classes.filter(c => c.group_id === o.id).map(c => [c.id, ts + '|' + (c.published_at || '')]));
        msg('ok', `${o.label} çekmecesi güncellendi.`);
      }
      catch (e) { msg('er', 'Güncellenemedi: ' + errText(e)); }
    },
    async pubClass(id, btn) {
      const c = D.classes.find(x => x.id === id);
      if (!c) return msg('er', 'Sınıf bulunamadı. Sayfayı yenileyin.');
      if (btn) { btn.disabled = true; btn.textContent = 'Güncelleniyor…'; }
      try {
        const ts = now(), g = D.options.find(x => x.type === 'cgroup' && x.id === c.group_id);
        await DB.put('classes', { ...c, published_at: ts });
        await putStamps([[c.id, (g && g.published_at || '') + '|' + ts]]);
        msg('ok', `${c.class_name} güncellendi.`);
      }
      catch (e) { msg('er', 'Güncellenemedi: ' + errText(e)); }
    },
    renCGroup(id) {
      const o = D.options.find(x => x.id === id);
      modal('Çekmeceyi Yeniden Adlandır', esc(o.label), folderField('Yeni ad', 'n', o.label), 'Kaydet', async d => {
        const n = d.get('n').trim();
        if (!n) return msg('er', 'Geçerli bir isim giriniz.');
        if (cgroups().some(x => x.id !== id && sameName(x.label, n))) return msg('er', 'Bu adlı bir çekmece zaten var.');
        await DB.put('options', { ...o, label: n });
        msg('ok', 'Ad güncellendi.');
      });
    },
    delCGroup(id) {
      const o = D.options.find(x => x.id === id), kids = D.classes.filter(c => c.group_id === id);
      confirmDelete('Çekmece Sil', o.label, 'çekmecesi silinsin mi?', 'Sil', async () => {
        await Promise.all(kids.map(c => DB.put('classes', { ...c, group_id: 0 })));
        await DB.del('options', id);
        openS.delete('g' + id);
        return 'Çekmece silindi.';
      }, `<br><small>İçindeki ${kids.length} sınıf silinmez, doğrudan Tüm Sınıflar altına taşınır.</small>`);
    },
    renClass(id) {
      const c = D.classes.find(x => x.id === id);
      const sel = `<div class="fg"><label>Çekmece<select name="g"><option value="0"${!c.group_id ? ' selected' : ''}>Doğrudan Tüm Sınıflar</option>${cgroups().map(g => `<option value="${g.id}"${g.id === c.group_id ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label></div>`;
      modal('Sınıfı Düzenle', esc(c.class_name), folderField('Sınıf adı', 'n', c.class_name) + sel, 'Kaydet', async d => {
        const n = d.get('n').trim();
        if (!n) return msg('er', 'Geçerli bir sınıf adı giriniz.');
        const g = +d.get('g') || 0;
        if (g && !cgroups().some(x => x.id === g)) return msg('er', 'Seçilen çekmece bulunamadı.');
        await DB.put('classes', { ...c, class_name: n, group_id: g });
        msg('ok', 'Sınıf güncellendi.');
      });
    },
    delClass(id) {
      const c = D.classes.find(x => x.id === id);
      confirmDelete('Sınıf Silme', c.class_name, 'silinsin mi?', 'Sil', async () => {
        await Promise.all(D.lessons.filter(l => l.class_id === id).map(l => remove(ref(db, `lessons/${l._fbKey}`))));
        await Promise.all(D.topics.filter(l => l.class_id === id).map(l => remove(ref(db, `topics/${l._fbKey}`))));
        await DB.del('classes', id);
        openS.delete(String(id));
        return 'Silindi.';
      });
    },
    lessonLink(id) {
      const l = D.lessons.find(x => x.id === id);
      modal('Dersi Düzenle', esc(l.lesson_name), folderField('Ders adı', 'n', l.lesson_name), 'Kaydet', async f => {
        const n = f.get('n').trim();
        if (!n) return msg('er', 'Geçerli bir ders adı giriniz.');
        await DB.put('lessons', { ...l, lesson_name: n });
        msg('ok', 'Güncellendi.');
      });
    },
    delLesson(id) {
      const l = D.lessons.find(x => x.id === id);
      confirmDelete('Soru Bankası Sil', l.lesson_name, 'silinsin mi?', 'Sil', async () => { await DB.del('lessons', id); return 'Silindi.'; });
    },
    topicLink(id) {
      const l = D.topics.find(x => x.id === id);
      modal('Konu Anlatımını Düzenle', esc(l.lesson_name), folderField('Başlık', 'n', l.lesson_name), 'Kaydet', async f => {
        const n = f.get('n').trim();
        if (!n) return msg('er', 'Geçerli bir başlık giriniz.');
        await DB.put('topics', { ...l, lesson_name: n });
        msg('ok', 'Güncellendi.');
      });
    },
    editImg(id, b) {
      const store = b.dataset.k === 'topics' ? 'topics' : 'lessons', l = D[store].find(x => x.id === id);
      if (!l) return;
      modal('Görseli Düzenle', esc(l.lesson_name),
        `<div class="fg"><label>Görsel linki<input name="u" type="url" autocomplete="off" value="${esc(l.img_link || '')}" placeholder="https://..."></label></div>
         <div class="fg"><label>Görselin altında görünecek yazı<input name="c" maxlength="200" autocomplete="off" value="${esc(l.img_caption || '')}" placeholder="Örn: Konuyu anlatan sayfa"></label></div>`,
        'Kaydet', async f => {
          const u = f.get('u').trim(), c = f.get('c').trim();
          if (u && !okUrl(u)) return msg('er', 'Yalnızca http(s) adresleri kabul edilir.');
          await DB.put(store, { ...l, img_link: u, img_caption: c });
          msg('ok', 'Görsel bilgileri güncellendi.');
        });
    },
    delImg(id, b) {
      const store = b.dataset.k === 'topics' ? 'topics' : 'lessons', l = D[store].find(x => x.id === id);
      if (!l) return;
      modal('Kitap Kapağını Kaldır', `<strong>${esc(l.lesson_name)}</strong> kapak görseli, yazısı ve linki kaldırılsın mı?`, '', 'Kaldır', async () => {
        const { img, img_link, img_caption, ...rest } = l;
        await DB.put(store, rest);
        msg('ok', 'Kapak kaldırıldı.');
      });
    },
    delTopic(id) {
      const l = D.topics.find(x => x.id === id);
      confirmDelete('Konu Anlatımı Sil', l.lesson_name, 'silinsin mi?', 'Sil', async () => { await DB.del('topics', id); return 'Silindi.'; });
    },
    assign(id) {
      const u = D.users.find(x => x.id === id);
      modal('Sınıf Ata', esc(u.username), `<select name="c">${D.classes.map(c => `<option value="${c.id}">${esc(clsName(c))}</option>`).join('')}</select>`, 'Ata', async f => {
        await DB.put('users', { ...u, class_id: +f.get('c') });
        msg('ok', 'Atandı.');
      });
    },
    approveReq(uid) {
      const r = D.requests.find(x => x._fbKey === uid), u = D.users.find(x => x._fbKey === uid), c = r && D.classes.find(x => x.id === r.to_class_id);
      if (!r || !u || !c) return msg('er', 'İstek, öğrenci veya sınıf bulunamadı.');
      modal('Sınıf Değişikliğini Onayla', `<strong>${esc(u.username)}</strong> sınıfı <strong>${esc(clsName(c))}</strong> olarak değiştirilsin mi?`, '', 'Onayla', async () => {
        const g = cgroups().find(o => o.id === c.group_id);
        await DB.put('users', { ...u, exam: g ? g.label : 'Genel', education_status: c.class_name, class_id: c.id });
        await remove(ref(db, `classRequests/${uid}`));
        msg('ok', 'Sınıf değiştirildi.');
      });
    },
    rejectReq(uid) {
      const r = D.requests.find(x => x._fbKey === uid);
      if (!r) return;
      modal('İsteği Reddet', `<strong>${esc(r.username)}</strong> kullanıcısının sınıf değiştirme isteği reddedilsin mi?`, '', 'Reddet', async () => {
        await remove(ref(db, `classRequests/${uid}`));
        msg('ok', 'İstek reddedildi.');
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
      confirmDelete('Öğrenci Sil', u.username, 'silinsin mi?', 'Sil', async () => { await DB.del('users', id); await remove(ref(db, `usernames/${ukey(u.username)}`)); await remove(ref(db, `classRequests/${id}`)).catch(() => {}); await remove(ref(db, `userData/${u._fbKey || id}`)).catch(() => {}); return 'Silindi.'; });
    },
    delOption(id) {
      const o = D.options.find(x => x.id === id);
      confirmDelete('Seçenek Sil', o.label, 'silinsin mi?', 'Sil', async () => { await DB.del('options', id); return 'Silindi.'; });
    },
    tfold(id) {                        // klasör çekmecesi: aynı düzeydeki kardeşler kapanır
      const li = app.querySelector(`li[data-n="${id}"]`);
      if (!li) return;
      const o = !li.classList.contains('open');
      const shut = el => {
        [el, ...el.querySelectorAll('li.tr[data-n]')].forEach(x => {
          x.classList.remove('open'); openF.delete(+x.dataset.n);
          x.querySelector(':scope > .ah').setAttribute('aria-expanded', 'false');
        });
      };
      [...li.parentElement.children].forEach(x => { if (x !== li && x.matches('li.tr[data-n]')) shut(x); });
      li.classList.toggle('open', o);
      o ? openF.add(id) : openF.delete(id);
      li.querySelector(':scope > .ah').setAttribute('aria-expanded', o);
    },
    expandAll: () => app.querySelectorAll('li.tr[data-n]').forEach(li => {
      li.classList.add('open'); openF.add(+li.dataset.n);
      li.querySelector(':scope > .ah').setAttribute('aria-expanded', 'true');
    }),
    collapseAll: () => app.querySelectorAll('li.tr[data-n]').forEach(li => {
      li.classList.remove('open'); openF.delete(+li.dataset.n);
      li.querySelector(':scope > .ah').setAttribute('aria-expanded', 'false');
    }),
    addFolder(pid) {
      const p = pid ? byId(pid) : null;
      modal(p ? 'Alt Kategori Ekle' : 'Ana Kategori Ekle', p ? `<strong>${esc(p.name)}</strong> içine eklenecek` : 'En üst düzeye eklenecek',
        folderField('Kategori adı', 'n', '', 'Örn: Matematik'), 'Ekle', async f => {
          const n = f.get('n').trim();
          if (!n) return msg('er', 'Geçerli bir kategori adı giriniz.');
          if (D.links.some(x => isFolder(x) && parentOf(x) === pid && sameName(x.name, n)))
            return msg('er', 'Bu düzeyde aynı adlı bir kategori zaten var.');
          await DB.put('links', { id: nid(), type: 'folder', name: n, parent_id: pid, created_at: now() });
          if (pid) openF.add(pid);
          msg('ok', 'Kategori eklendi.');
        });
    },
    addLink(pid) {
      const p = pid ? byId(pid) : null;
      modal('Bağlantı Ekle', p ? `<strong>${esc(p.name)}</strong> içine eklenecek` : 'En üst düzeye eklenecek',
        folderField('Buton metni', 'b', '', 'Buton adı') + urlField(), 'Ekle', async f => {
          const b = f.get('b').trim(), u = f.get('u').trim();
          if (!b || !okUrl(u)) return msg('er', 'Eksik veya hatalı bilgi (yalnızca http/https adresleri kabul edilir).');
          await DB.put('links', { id: nid(), type: 'link', parent_id: pid, category: pathOf(pid), button_text: b, link_url: u, created_at: now() });
          if (pid) openF.add(pid);
          msg('ok', 'Bağlantı eklendi.');
        });
    },
    renFolder(id) {
      const f = byId(id);
      modal('Kategoriyi Yeniden Adlandır', esc(f.name), folderField('Yeni ad', 'n', f.name), 'Kaydet', async d => {
        const n = d.get('n').trim();
        if (!n) return msg('er', 'Geçerli bir kategori adı giriniz.');
        if (D.links.some(x => isFolder(x) && x.id !== id && parentOf(x) === parentOf(f) && sameName(x.name, n)))
          return msg('er', 'Bu düzeyde aynı adlı bir kategori zaten var.');
        const old = { ...f };
        f.name = n;
        await DB.put('links', { ...old, name: n });
        // alttaki bağlantıların "category" yolunu güncel tut
        for (const x of descendants(id).filter(x => !isFolder(x))) {
          const c = pathOf(parentOf(x));
          if (x.category !== c) await DB.put('links', { ...x, category: c });
        }
        msg('ok', 'Kategori adı güncellendi.');
      });
    },
    editLink(id) {
      const l = byId(id);
      modal('Bağlantıyı Düzenle', esc(l.button_text), folderField('Buton metni', 'b', l.button_text) + urlField(l.link_url), 'Kaydet', async f => {
        const b = f.get('b').trim(), u = f.get('u').trim();
        if (!b || !okUrl(u)) return msg('er', 'Eksik veya hatalı bilgi (yalnızca http/https adresleri kabul edilir).');
        await DB.put('links', { ...l, button_text: b, link_url: u });
        msg('ok', 'Bağlantı güncellendi.');
      });
    },
    delFolder(id) {
      const f = byId(id), sub = descendants(id);
      const nf = sub.filter(isFolder).length, nl = sub.length - nf;
      confirmDelete('Kategori Sil', f.name, `kategorisi silinsin mi?`, 'Sil', async () => {
        await Promise.all([f, ...sub].map(x => remove(ref(db, `links/${linkKey(x)}`))));
        openF.delete(id);
        return 'Kategori ve içindekiler silindi.';
      }, `<br><small>İçindeki ${nf} alt kategori ve ${nl} bağlantı da silinecek. Bu işlem geri alınamaz.</small>`);
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
    if (!b) return;
    const arg = b.dataset.id ? (/^\d+$/.test(b.dataset.id) ? +b.dataset.id : b.dataset.id) : b;
    try {
      const r = actions[b.dataset.a]?.(arg, b);
      if (r && r.catch) r.catch(err => toast('er', errText(err)));
    } catch (err) { toast('er', errText(err)); }
  });
  addEventListener('hashchange', () => { if (!auth.currentUser) return; flash = null; render(); });

  addEventListener('unhandledrejection', e => { toast('er', errText(e.reason)); });
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
