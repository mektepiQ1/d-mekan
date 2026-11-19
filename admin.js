'use strict';

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getDatabase, ref, get, set, remove } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
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
/* Kitap kapakları artık yalnızca öğrencinin cihazında (IndexedDB) durur */
const COVER_STORES = ['lessons', 'topics', 'exams'], COVER_KEYS = ['img', 'img_link', 'img_caption'];
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
      if (COVER_STORES.includes(store)) COVER_KEYS.forEach(k => { delete item[k]; });   // kapak görselleri artık veritabanında tutulmaz
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
      const [classes, lessons, users, links, options, topics, licenses, exams] = await Promise.all(
        ['classes', 'lessons', 'users', 'links', 'options', 'topics', 'licenses', 'exams'].map(s => this.all(s).catch(() => [])));
      const out = { classes, lessons, users, links, options, topics, licenses, exams };
      await this.purgeCovers(out);
      return out;
    },
    /* Veritabanında kalmış eski kapak görsellerini (base64) tek seferde siler */
    async purgeCovers(data) {
      const jobs = [];
      COVER_STORES.forEach(s => (data[s] || []).forEach(x => {
        const dirty = COVER_KEYS.filter(k => x[k] !== undefined);
        if (!dirty.length || !x._fbKey) return;
        dirty.forEach(k => { delete x[k]; });
        jobs.push(Promise.all(dirty.map(k => remove(ref(db, `${s}/${x._fbKey}/${k}`)))).catch(() => {}));
      }));
      await Promise.all(jobs);
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

  /* ===== Öğrenci kodları: cihaz kodu → sınıf + ad/soyad/telefon → aktivasyon kodu ===== */
  const CODE_AB = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // 0/O ve 1/I karışmasın (32 karakter)
  const rndCode = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => CODE_AB[b % 32]).join('');
  const cleanCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const fmtCode = (v, n) => v.slice(0, n) + '-' + v.slice(n);
  const PHONE_RE = /^[0-9+\s()-]{10,18}$/;
  const nk = v => String(v == null ? '' : v).toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
  const stuLim = new Map();                                // sınıf başına gösterilen öğrenci sayısı

  async function findDevice(raw) {                         // öğrencinin ekranındaki cihaz kodu → anonim kimlik
    const c = cleanCode(raw);
    if (!/^[A-Z2-9]{8}$/.test(c)) return { err: 'Cihaz kodu 8 karakter olmalı (örn: K7M2-9QXP).' };
    const sn = await get(ref(db, `pairing/${c}`));
    if (!sn.exists() || !sn.val().uid) return { err: 'Bu cihaz kodu bulunamadı. Kodu kontrol edin; öğrencinin telefonu internete bağlı ve kod ekranı açık olmalı.' };
    return { code: c, uid: sn.val().uid };
  }
  const writeLicense = (uid, o) => set(ref(db, `licenses/${uid}`), {
    code: o.code, ad: o.ad, soyad: o.soyad, telefon: o.telefon, device: o.device, created_at: o.created_at,
    pub: { class_id: o.cls.id, class_name: o.cls.class_name, ad: o.ad }
  });
  const codeModal = (title, l, code, note = '') => modal(title, `<strong>${esc(l.ad)} ${esc(l.soyad)}</strong> için aktivasyon kodu:`,
    `<span style="display:block;margin:14px 0;padding:16px;border-radius:14px;background:#edf2fb;color:#1a2744;font:800 36px/1 monospace;letter-spacing:6px;text-align:center">${fmtCode(code, 3)}</span>
     <div class="hint" style="margin-bottom:12px">${note || 'Bu kodu öğrenciye söyleyin; öğrenci kendi cihazında "Aktivasyon kodu" alanına yazacak.'}</div>`, 'Tamam', async () => {});
  const licOf = uid => D.licenses.find(x => x._fbKey === uid);
  const licName = l => `${l.ad} ${l.soyad}`;

  function licCard(l) {
    const act = D.users.find(u => u._fbKey === l._fbKey), p = l.pub || {};
    const c = D.classes.find(x => x.id === p.class_id), cn = c ? clsName(c) : (p.class_name || '—'), k = esc(l._fbKey);
    return `<div class="item scard"><div class="row"><div>
        <strong class="nm">${esc(licName(l))}</strong>
        <small>Telefon: <b>${esc(l.telefon)}</b></small>
        <small>Verilen içerik: <b>${esc(cn)}</b></small>
        <small>Kod üretildi: ${fd(l.created_at)}</small>
        <small>${act ? '✅ Aktifleştirildi: ' + fd(act.created_at) : '⏳ Kod henüz girilmedi'}</small></div>
        <div class="btns sb"><button class="sm" data-a="showCode" data-id="${k}">Kodu Göster</button>
          <button class="sm" data-a="chgClass" data-id="${k}">Sınıf</button>
          <button class="sm" data-a="moveDev" data-id="${k}">Yeni Cihaz</button>
          <button class="sm del" data-a="delStudent" data-id="${k}">Sil</button></div></div></div>`;
  }

  function studentBlocks() {
    const classes = [...D.classes].sort((a, b) => String(clsName(a)).localeCompare(String(clsName(b)), 'tr'));
    const add = classes.length ? `<form data-f="student">
        <div class="fg"><label>Cihaz kodu (öğrencinin ekranındaki)</label><input name="dc" required maxlength="9" autocomplete="off" autocapitalize="characters" placeholder="XXXX-XXXX"></div>
        <div class="fg"><label>Verilecek sınıf</label><select name="c" required><option value="" disabled selected>Sınıf seçin</option>${classes.map(c => `<option value="${c.id}">${esc(clsName(c))}</option>`).join('')}</select></div>
        <div class="fg"><label>Ad</label><input name="ad" required maxlength="50" autocomplete="off"></div>
        <div class="fg"><label>Soyad</label><input name="soyad" required maxlength="50" autocomplete="off"></div>
        <div class="fg"><label>Telefon</label><input name="tel" type="tel" required maxlength="18" inputmode="tel" autocomplete="off" placeholder="05xx xxx xx xx"></div>
        <button>Kod Üret</button>
        <div class="hint">Önce Sınıf Oluştur bölümünden sınıfı ve içeriğini hazırlayın.</div></form>`
      : empty('Önce bir sınıf oluşturun.', 'Kod üretmek için en az bir sınıf gerekir.');
    const find = `<input data-search type="search" autocomplete="off" placeholder="Ad, soyad, telefon veya cihaz kodu" style="width:100%;margin:6px 0 10px"><div id="found" class="hint">En az 2 karakter yazın.</div>`;
    const drawer = (key, title, body) => `<div class="acc stu${openG.has(key) ? ' open' : ''}" data-key="${esc(key)}">
        <button class="ah" type="button" data-a="toggleGroup" data-k="${esc(key)}"><span>${title}</span><span>▼</span></button>
        <div class="ac">${body}</div></div>`;
    const byCls = new Map();
    [...D.licenses].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).forEach(l => {
      const k = l.pub && l.pub.class_id; if (!byCls.has(k)) byCls.set(k, []); byCls.get(k).push(l);
    });
    const groups = [...byCls.entries()].map(([k, arr]) => {
      const c = D.classes.find(x => x.id === k);
      return { k, arr, name: c ? clsName(c) : (arr[0].pub.class_name + ' (silinmiş sınıf)') };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr'));
    const reg = D.licenses.length
      ? `<div class="tact" style="margin:8px"><button class="sm" type="button" data-a="exportCsv">Listeyi indir (Excel/CSV)</button></div>` +
        groups.map(g => {
          const n = stuLim.get(g.k) || 30;
          return drawer('c:' + g.k, `${esc(g.name)} (${g.arr.length} öğrenci)`, g.arr.slice(0, n).map(licCard).join('') +
            (g.arr.length > n ? `<div class="tact" style="margin:8px"><button class="sm" type="button" data-a="moreStu" data-id="${g.k}">Daha fazla göster (${g.arr.length - n} kişi daha)</button></div>` : ''));
        }).join('')
      : empty('Henüz öğrenciye kod üretilmemiş.', 'Yukarıdaki formdan ilk kodu üretebilirsiniz.');
    return { add, find, reg };
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
        const exams = D.exams.filter(l => l.class_id === c.id).sort((a, b) => b.id - a.id);
        const qb = sub('q' + c.id, `Soru Bankası (${lessons.length})`,
          (lessons.length ? lessons.map(l => sub('l' + l.id, esc(l.lesson_name), `<div class="tact">
            <button class="sm" data-a="lessonLink" data-id="${l.id}">Düzenle</button>
            <button class="sm del" data-a="delLesson" data-id="${l.id}">Sil</button></div>`, ' lsn')).join('') : '<div class="mut">Henüz soru bankası eklenmemiş.</div>') +
          `<form class="inl" data-f="lesson" data-id="${c.id}">
            <input name="n" required maxlength="100" placeholder="Ders adı"><button>Ekle</button></form>`);
        const ka = sub('t' + c.id, `Konu Anlatımları (${topics.length})`,
          (topics.length ? topics.map(l => sub('p' + l.id, esc(l.lesson_name), `<div class="tact">
            <button class="sm" data-a="topicLink" data-id="${l.id}">Düzenle</button>
            <button class="sm del" data-a="delTopic" data-id="${l.id}">Sil</button></div>`, ' lsn')).join('') : '<div class="mut">Henüz konu anlatımı eklenmemiş.</div>') +
          `<form class="inl wrap" data-f="topic" data-id="${c.id}">
            <input name="n" required maxlength="100" autocomplete="off" placeholder="Başlık (örn: TÜRKÇE KONU ANLATIMI)">
            <input name="u" type="url" autocomplete="off" placeholder="Boş bırakın: konu.html otomatik (veya https://...)">
            <button>Konu Anlatımı Ekle</button></form>`);
        const dn = sub('e' + c.id, `Denemeler (${exams.length})`,
          (exams.length ? exams.map(l => sub('x' + l.id, esc(l.lesson_name), `<div class="tact">
            <button class="sm" data-a="examLink" data-id="${l.id}">Düzenle</button>
            <button class="sm del" data-a="delExam" data-id="${l.id}">Sil</button></div>`, ' lsn')).join('') : '<div class="mut">Henüz deneme eklenmemiş.</div>') +
          `<form class="inl" data-f="exam" data-id="${c.id}">
            <input name="n" required maxlength="100" autocomplete="off" placeholder="Deneme başlığı (örn: TYT DENEMELERİ)"><button>Ekle</button></form>`);
        return sub(String(c.id), esc(c.class_name), `<div class="tact" style="margin-bottom:8px">
            ${loose ? `<button class="sm" data-a="pubClass" data-id="${c.id}">Güncelle</button>` : ''}<button class="sm" data-a="renClass" data-id="${c.id}">Düzenle</button>
            <button class="sm del" data-a="delClass" data-id="${c.id}">Sil</button></div>
            <small style="margin:0 0 8px">Eklenme: ${fd(c.created_at)}</small>${qb}${ka}${dn}`);
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
          <div class="hint">Kod üretirken öğrenciye bu sınıflardan birini verirsiniz.</div></div></div>
        <div class="acc cls big${clOpen ? ' open' : ''}">
        <button class="ah" type="button" data-a="toggleClass" data-k="cls" aria-expanded="${clOpen}"><span>Tüm Sınıflar</span><span>▼</span></button>
        <div class="ac">${drawers}</div></div>
        <div class="acc cls big${stOpen ? ' open' : ''}">
        <button class="ah" type="button" data-a="toggleClass" data-k="std" aria-expanded="${stOpen}"><span>Öğrenciler</span><span>▼</span></button>
        <div class="ac">${sub('add', 'Yeni Öğrenciye Kod Üret', st.add)}${sub('find', 'Öğrenci Ara', st.find)}${sub('list', `Kime Ne Verdim (${D.licenses.length})`, st.reg)}</div></div>
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
    async lesson(d, f) {
      const n = d.get('n').trim();
      if (!n) return;
      await DB.put('lessons', { class_id: +f.dataset.id, lesson_name: n, link_url: '', created_at: now() });
      msg('ok', 'Ders başarıyla eklendi.');
    },
    async exam(d, f) {
      const n = d.get('n').trim();
      if (!n) return;
      await DB.put('exams', { class_id: +f.dataset.id, lesson_name: n, link_url: '', created_at: now() });
      msg('ok', 'Deneme başlığı eklendi.');
    },
    async topic(d, f) {
      const n = d.get('n').trim(), u = d.get('u').trim();
      if (!n || (u && !okUrl(u))) return msg('er', 'Başlık giriniz; adres yazacaksanız geçerli bir http(s) adresi olmalı.');
      await DB.put('topics', { class_id: +f.dataset.id, lesson_name: n, link_url: u, created_at: now() });
      msg('ok', 'Konu anlatımı eklendi.');
    },
    async student(d) {
      const ad = d.get('ad').trim(), soyad = d.get('soyad').trim(), tel = d.get('tel').trim();
      const cls = D.classes.find(x => x.id === +d.get('c'));
      if (!ad || !soyad) return msg('er', 'Ad ve soyad giriniz.');
      if (!PHONE_RE.test(tel)) return msg('er', 'Geçerli bir telefon numarası giriniz.');
      if (!cls) return msg('er', 'Lütfen verilecek sınıfı seçiniz.');
      const dev = await findDevice(d.get('dc'));
      if (dev.err) return msg('er', dev.err);
      if ((await get(ref(db, `licenses/${dev.uid}`))).exists()) return msg('er', 'Bu cihaza zaten kod üretilmiş. "Öğrenci Ara"dan bulup kodu tekrar görebilirsiniz.');
      const rec = { code: rndCode(6), ad, soyad, telefon: tel, device: dev.code, created_at: now(), cls };
      await writeLicense(dev.uid, rec);
      await remove(ref(db, `pairing/${dev.code}`)).catch(() => {});
      msg('ok', 'Kod üretildi.');
      codeModal('Kod Üretildi', rec, rec.code);
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
        await Promise.all(D.exams.filter(l => l.class_id === id).map(l => remove(ref(db, `exams/${l._fbKey}`))));
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
    examLink(id) {
      const l = D.exams.find(x => x.id === id);
      modal('Deneme Başlığını Düzenle', esc(l.lesson_name), folderField('Başlık', 'n', l.lesson_name), 'Kaydet', async f => {
        const n = f.get('n').trim();
        if (!n) return msg('er', 'Geçerli bir başlık giriniz.');
        await DB.put('exams', { ...l, lesson_name: n });
        msg('ok', 'Güncellendi.');
      });
    },
    delExam(id) {
      const l = D.exams.find(x => x.id === id);
      confirmDelete('Deneme Sil', l.lesson_name, 'silinsin mi?', 'Sil', async () => { await DB.del('exams', id); return 'Silindi.'; });
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
    delTopic(id) {
      const l = D.topics.find(x => x.id === id);
      confirmDelete('Konu Anlatımı Sil', l.lesson_name, 'silinsin mi?', 'Sil', async () => { await DB.del('topics', id); return 'Silindi.'; });
    },
    showCode(uid) {
      const l = licOf(uid); if (!l) return;
      codeModal('Aktivasyon Kodu', l, l.code, `Cihaz kodu: <b>${fmtCode(l.device || '', 4)}</b>. ` + (D.users.some(u => u._fbKey === uid) ? 'Bu kod girilmiş ve içerik indirilmiş.' : 'Bu kodu öğrenciye söyleyin.'));
    },
    chgClass(uid) {
      const l = licOf(uid); if (!l) return;
      const sel = `<div class="fg"><label>Sınıf<select name="c">${D.classes.map(c => `<option value="${c.id}"${c.id === l.pub.class_id ? ' selected' : ''}>${esc(clsName(c))}</option>`).join('')}</select></label></div>`;
      modal('Verilen Sınıfı Değiştir', `<strong>${esc(licName(l))}</strong>`, sel, 'Kaydet', async f => {
        const cls = D.classes.find(c => c.id === +f.get('c'));
        if (!cls) return msg('er', 'Sınıf bulunamadı.');
        await writeLicense(uid, { ...l, cls });
        const u = D.users.find(x => x._fbKey === uid);
        if (u) await set(ref(db, `users/${uid}`), { id: u.id, code: u.code, class_id: cls.id, class_name: cls.class_name, ad: u.ad, created_at: u.created_at });
        msg('ok', u ? 'Sınıf değişti. Öğrencinin cihazı internete bağlanınca yeni içerik iner.' : 'Sınıf değişti. Öğrenci kodu girince bu sınıfın içeriği iner.');
      });
    },
    moveDev(uid) {                     // telefon bozuldu / değişti: kayıt ve yedek veriler yeni cihaza geçer
      const l = licOf(uid); if (!l) return;
      modal('Yeni Cihaza Taşı', `<strong>${esc(licName(l))}</strong> için yeni cihazın kodunu girin. Eski cihazdaki içerik erişimi kapanır; Defter ve Ders Programı yedeği yeni cihaza taşınır.`,
        `<div class="fg"><label>Yeni cihazın kodu<input name="dc" required maxlength="9" autocomplete="off" autocapitalize="characters" placeholder="XXXX-XXXX"></label></div>`, 'Taşı', async f => {
          const dev = await findDevice(f.get('dc'));
          if (dev.err) return msg('er', dev.err);
          if (dev.uid === uid) return msg('er', 'Bu zaten öğrencinin mevcut cihazı.');
          if ((await get(ref(db, `licenses/${dev.uid}`))).exists()) return msg('er', 'Bu cihaza başka bir öğrenci için kod üretilmiş.');
          const rec = { ...l, code: rndCode(6), device: dev.code, cls: D.classes.find(c => c.id === l.pub.class_id) || { id: l.pub.class_id, class_name: l.pub.class_name } };
          await writeLicense(dev.uid, rec);
          try { const ud = await get(ref(db, `userData/${uid}`)); if (ud.exists()) { await set(ref(db, `userData/${dev.uid}`), ud.val()); await remove(ref(db, `userData/${uid}`)); } } catch {}
          await Promise.all([`users/${uid}`, `licenses/${uid}`, `devices/${uid}`, `keys/${uid}`, `pairing/${dev.code}`].map(p => remove(ref(db, p)).catch(() => {})));
          msg('ok', 'Yeni cihaza taşındı.');
          codeModal('Yeni Cihaz Kodu', rec, rec.code);
        });
    },
    delStudent(uid) {
      const l = licOf(uid); if (!l) return;
      confirmDelete('Öğrenci Sil', licName(l), 'kaydı silinsin mi?', 'Sil', async () => {
        await Promise.all([`users/${uid}`, `licenses/${uid}`, `devices/${uid}`, `keys/${uid}`, `userData/${uid}`].map(p => remove(ref(db, p)).catch(() => {})));
        return 'Silindi.';
      }, '<br><small>Öğrencinin cihazındaki içerik internete bağlanınca silinir; bulut yedeği (Defter, Ders Programı) de silinir.</small>');
    },
    moreStu(k) { stuLim.set(k, (stuLim.get(k) || 30) + 50); render(); },
    exportCsv() {
      const safe = v => { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; };
      const q = v => '"' + safe(v).replace(/"/g, '""') + '"';
      const rows = [['Ad', 'Soyad', 'Telefon', 'Verilen içerik (sınıf)', 'Kod üretim tarihi', 'Aktifleştirme tarihi', 'Cihaz kodu']];
      [...D.licenses].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).forEach(l => {
        const c = D.classes.find(x => x.id === (l.pub || {}).class_id), u = D.users.find(x => x._fbKey === l._fbKey);
        rows.push([l.ad, l.soyad, '\t' + l.telefon, c ? clsName(c) : (l.pub || {}).class_name, fd(l.created_at), u ? fd(u.created_at) : 'Girilmedi', fmtCode(l.device || '', 4)]);
      });
      const blob = new Blob(['\ufeff' + rows.map(r => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ogrenciler-' + now().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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
  app.addEventListener('input', e => {             // öğrenci arama: sayfayı yeniden çizmeden sonuç listeler
    if (!e.target.matches || !e.target.matches('[data-search]')) return;
    const q = nk(e.target.value), out = document.getElementById('found');
    if (!out) return;
    if (q.length < 2) { out.className = 'hint'; out.textContent = 'En az 2 karakter yazın.'; return; }
    const hits = D.licenses.filter(l => nk([l.ad, l.soyad, l.telefon, l.device, l.code].join(' ')).includes(q)).slice(0, 30);
    out.className = ''; out.innerHTML = hits.length ? hits.map(licCard).join('') : '<div class="mut">Sonuç bulunamadı.</div>';
  });
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
