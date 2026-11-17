'use strict';

import { initializeApp, getDatabase, ref, get, set, query, orderByChild, equalTo } from "./yerel-db.js";
import { lisans } from "./kapi.js";

/* Öğrenci sayfası: kullanıcı adı / giriş yok, paket indirme yok.
   Tüm veri bu cihazın IndexedDB'sindedir (yerel-db.js). İçerik, aynı cihazdaki yönetici sayfalarında
   (admin.html, soruadmin.html ...) eklenir ve burada doğrudan okunur. */
const db = getDatabase(initializeApp({}));
const errText = () => 'Beklenmeyen bir hata oluştu. Lütfen sayfayı yenileyip tekrar deneyin.';
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
  }
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
  const { esc, now, okUrl } = U;
  const app = document.getElementById('app');
  const LINKS = [
    ['Ders Programım', 'dersprogram.html'],
    ['Kütüphane', 'ogrencikitap.html'],
    ['Defter', 'defter.html']
  ];
  let reqView = false, pickData = null;
  const BEKLE = { internet: 'İnternet bağlantısı yok. İçeriği indirmek için internete bağlan; bağlanınca sayfa kendiliğinden yenilenir. Bu yalnızca ilk açılışta gerekir.',
    yok: 'Bu sınıfın içeriği henüz yayınlanmamış. Lütfen satış noktasındaki yetkiliye haber ver.', cozulemedi: 'İçerik çözülemedi. Kodunun bu sınıf için verildiğinden emin ol ya da yetkiliye haber ver.' };
  const bekleHtml = () => { const h = window.__paketHata; return `<div class="card"><div class="alert ${h ? 'er' : 'ok'}" role="status" id="bekle">${esc(h ? BEKLE[h] : 'İçeriğin indiriliyor… İnternete bağlı kal; birkaç saniye içinde sayfa kendiliğinden açılır.')}</div></div>`; };
  addEventListener('paket-hata', () => { const b = document.getElementById('bekle'); if (b) { b.className = 'alert er'; b.textContent = BEKLE[window.__paketHata] || ''; } });
  addEventListener('online', () => { if (document.getElementById('bekle')) location.reload(); });
  let OGR = false, SINIF = 0;                 // öğrenci kodu: sınıf koddan gelir, değiştirilemez
  let error = '', notice = '';

  const errorHtml = () => {
    const e = error; error = '';
    return e ? `<div class="alert er">${esc(e)}</div>` : '';
  };
  const noticeHtml = () => {
    const n = notice; notice = '';
    return n ? `<div class="alert ok" role="status">${esc(n)}</div>` : '';
  };

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


  const profileView = (classes, groups) => `
    <div class="card">
      <div class="card form-card" style="box-shadow:none;border:1px solid var(--line)">
        <h2>Sınıf Seçiniz</h2>
        ${errorHtml()}` +
        (classes.length ? `
        <form data-f="profile">
          <input type="hidden" name="class_id" value="">
          ${pickerHtml(classes, groups)}
          <div class="chosen" id="chosen" aria-live="polite">Henüz sınıf seçmediniz.</div>
          <button id="saveBtn">Kaydet</button>
          <div class="hint">Sınıfını istediğin zaman değiştirebilirsin.</div>
        </form>` : `<div class="warn"><p>Henüz sınıf eklenmemiş.</p><p>Önce yönetici panelinden (admin.html) sınıf ve içerik ekleyin.</p></div>`) + `
      </div>
    </div>`;

  /* Sınıf değiştirme: seçilen sınıf hemen uygulanır (onay beklenmez) */
  const changeBlock = cls => {
    if (!cls || OGR || !(reqView && pickData)) return '';
    return `<div style="margin:0 0 16px"><form data-f="classreq"><input type="hidden" name="class_id" value="">
      ${pickerHtml(pickData.classes.filter(c => c.id !== cls.id), pickData.groups)}
      <div class="chosen" id="chosen" aria-live="polite">Henüz sınıf seçmediniz.</div>
      <button>Sınıfı Değiştir</button><button type="button" class="gray" data-a="closereq">Vazgeç</button></form></div>`;
  };
  const changeIdle = cls => (!cls || OGR || (reqView && pickData)) ? '' : '<button type="button" class="hb" data-a="chg">Sınıf Değiştir</button>';

  /* ===== Dijital kitaplık: raflar + 3 boyutlu kitaplar ===== */
  const BK = new Map();                       // kitap anahtarı -> açılacak adres (DOM'da adres tutulmaz)
  const SPINES = ['#7b2d26', '#1f2937', '#2b3d68', '#14532d', '#5b21b6', '#92400e', '#0f4c5c', '#6b2142'];
  const hashOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const IMG_OK = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const NAV = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  let heroOpen = false;                       // hesap butonları (hoş geldin / sınıf değiştir / çıkış) varsayılan gizli
  let openSec = '';                           // açık raf ('' : hepsi kapalı; dokununca açılır, başkasına dokununca kapanır)

  const bookHtml = (store, l, n) => {
    const url = store === 'lessons' ? 'soru.html?ders=' + encodeURIComponent(l.id)
      : store === 'exams' ? 'deneme.html?ders=' + encodeURIComponent(l.id)
      : okUrl(l.img_link) ? l.img_link : okUrl(l.link_url) ? l.link_url : 'konu.html?ders=' + encodeURIComponent(l.id);
    const key = store + ':' + l.id;
    if (url) BK.set(key, url);
    const title = l.img_caption || l.lesson_name;
    const hasImg = !!(l.img && IMG_OK.test(l.img));
    const sp = SPINES[hashOf(l.lesson_name) % SPINES.length];
    return `<button type="button" class="bk" data-a="book" data-b="${key}" data-t="${esc(String(title).toLocaleLowerCase('tr'))}" style="--spine:${sp}"${url ? '' : ' aria-disabled="true"'}>
        <span class="cv"><span class="bk-front${hasImg ? '' : ' gen'}"${hasImg ? ` style="background-image:url(${l.img})"` : ''}>${hasImg ? '' : `<em>${esc(l.lesson_name)}</em>`}<i class="shn"></i></span><span class="bk-spine"><b>${esc(l.lesson_name)}</b></span><i class="bk-pages"></i><i class="bk-back"></i></span>
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

  const heroHtml = cls => `<div class="lib">
      <div class="lib-hero"><div class="brand">Öğrenci Bahçesi</div><h2>Dijital kitaplık</h2><p>${esc(cls.class_name)}</p>
        <div class="hero-dr${heroOpen ? ' open' : ''}"${heroOpen ? '' : ' inert'}><div class="hero-in"><div class="hero-acts">
          ${changeIdle(cls)}
        </div></div></div>
        <button type="button" class="hero-tg" data-a="hero" aria-expanded="${heroOpen}" aria-label="Menüyü aç/kapat">${CHEV}</button></div></div>`;

  const libraryHtml = (cls, lessons, topics, exams = []) => {
    BK.clear();
    return `<div class="lib">
      ${shelfHtml('lessons', 'Soru Bankası', 'lessons', lessons, 'Henüz soru bankası eklenmemiş.')}
      ${shelfHtml('topics', 'Konu Anlatımları', 'topics', topics, 'Henüz konu anlatımı eklenmemiş.')}
      ${shelfHtml('exams', 'Denemeler', 'exams', exams, 'Henüz deneme eklenmemiş.')}</div>`;
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


  const panelViewHtml = (cls, lessons, topics, exams = []) => `
    <div class="card">${heroHtml(cls)}
      ${errorHtml()}${noticeHtml()}
      ${changeBlock(cls)}
      ${libraryHtml(cls, lessons, topics, exams)}
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
  /* Yalnızca ekranda görünen kitapların animasyonu çalışır; kaydırma sırasında animasyonlar durur */
  let bkIO = null;
  function watchBooks() {
    if (bkIO) bkIO.disconnect();
    if (!('IntersectionObserver' in window)) { app.querySelectorAll('.bk').forEach(b => b.classList.add('vis')); return; }
    bkIO = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('vis', e.isIntersecting)), { rootMargin: '40px' });
    app.querySelectorAll('.bk').forEach(b => bkIO.observe(b));
  }
  { let st; const root = document.documentElement;
    document.addEventListener('scroll', () => { root.classList.add('scr'); clearTimeout(st); st = setTimeout(() => root.classList.remove('scr'), 160); }, { passive: true, capture: true }); }
  const panelView = (...a) => { const h = panelViewHtml(...a); setTimeout(() => { paintSpines(); watchBooks(); }, 0); return h; };


  async function render() {
    try { await renderInner(); }
    catch (e) { app.innerHTML = `<div class="card"><div class="alert er" role="alert">${esc(errText(e))}</div></div>`; }
    a11y();
  }

  async function renderInner() {
    const [classes, opts, prof] = await Promise.all([DB.all('classes'), DB.all('options'), get(ref(db, 'profil')).then(s => s.val())]);
    const groups = opts.filter(o => o.type === 'cgroup').sort((a, b) => a.id - b.id);
    const L = await lisans;
    OGR = L.rol === 0; SINIF = L.sinif;
    const cls = OGR ? classes.find(c => c.id === SINIF) : (prof && classes.find(c => c.id === prof.class_id));
    if (!cls && OGR) return void (app.innerHTML = bekleHtml());
    if (!cls) return void (app.innerHTML = profileView(classes, groups));
    pickData = { classes, groups };
    const [lessons, topics, exams] = await Promise.all([DB.byClass('lessons', cls.id), DB.byClass('topics', cls.id), DB.byClass('exams', cls.id)]);
    const mine = list => list.filter(l => l.class_id === cls.id).sort((a, b) => b.id - a.id);
    app.innerHTML = panelView(cls, mine(lessons), mine(topics), mine(exams));
  }

  /* Seçilen sınıf cihazda saklanır (IndexedDB) */
  async function saveClass(d, change) {
    if (OGR) return;                          // öğrenci sınıf seçemez / değiştiremez
    const cid = +d.get('class_id');
    if (!cid) { error = 'Lütfen bir sınıf seçiniz.'; return; }
    const [classes, opts] = await Promise.all([DB.all('classes'), DB.all('options')]);
    const cls = classes.find(c => c.id === cid);
    if (!cls) { error = 'Seçilen sınıf bulunamadı.'; return; }
    await set(ref(db, 'profil'), { class_id: cls.id, exam: groupLabel(cls, opts.filter(o => o.type === 'cgroup')) || 'Genel', education_status: cls.class_name, updated_at: now() });
    reqView = false;
    if (change) notice = 'Sınıfın değiştirildi.';
  }
  const forms = {
    profile: d => saveClass(d, false),
    classreq: d => saveClass(d, true)
  };

  app.addEventListener('submit', async e => {
    e.preventDefault();
    try { await forms[e.target.dataset.f]?.(new FormData(e.target), e.target); } catch (err) { error = errText(err); }
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
      if (u) location.href = u;
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
    if (b?.dataset.a === 'hero') {               // ok tuşu: menü butonunu göster/gizle
      heroOpen = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', heroOpen);
      const dr = b.parentElement.querySelector('.hero-dr');
      dr.classList.toggle('open', heroOpen); dr.inert = !heroOpen;
      return;
    }
    if (b?.dataset.a === 'rail') {
      const rail = b.closest('.rw')?.querySelector('.rail');
      if (rail) rail.scrollBy({ left: +b.dataset.d * rail.clientWidth * .8, behavior: 'smooth' });
      return;
    }
    if (b?.dataset.a === 'chg') { if (OGR) return; reqView = true; return void render(); }
    if (b?.dataset.a === 'closereq') { reqView = false; return void render(); }
  });

  render();
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
