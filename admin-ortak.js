'use strict';
/* soruadmin.html, denemeadmin.html ve konuadmin.html'in ortak motoru (stil dahil).
   Akış: sınıf › ders seç → HTML dosyasını seç → önizlemede düzelt → gönder.
   Hangi bölüme yazılacağı sayfanın window.ADMIN.tur değerinden gelir (soru | deneme | konu). */
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getDatabase, ref, get, push, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";

/* Sayfa stili (ayrı css dosyası yok; tek dosyada) */
const STIL = document.createElement('style');
STIL.textContent = `
:root{--bg:#f4f7fc;--card:#fff;--ink:#0a1f44;--muted:#5b6b8c;--line:#c9d5ea;--accent:#2a4d8f;--fill:rgba(42,77,143,.14);--ok:#198754;--okbg:#d4edda;--bad:#dc3545;--badbg:#f8d7da}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#131d33;--ink:#e6ecf7;--muted:#9fb3d6;--line:#2a3a5c;--accent:#6f93d6;--fill:rgba(111,147,214,.22);--ok:#a7e3bd;--okbg:#123524;--bad:#f5b3bb;--badbg:#3d1a20}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:16px 14px 70px}
h1{font-size:22px;margin:4px 0 2px}
.alt{color:var(--muted);font-size:14px;margin:0 0 12px}
.kutu{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:14px}
.kutu h2{font-size:16px;margin:0 0 6px}
label{display:block;margin-top:10px;font-weight:600;font-size:14px}
label.satirl{display:flex;align-items:center;gap:8px;font-weight:600}
input[type=checkbox]{width:20px;height:20px;accent-color:var(--accent);flex:none}
.alan,select,textarea{display:block;width:100%;min-height:44px;margin-top:4px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit;font-size:15px}
textarea{min-height:70px;resize:vertical}
input[type=file]{display:block;width:100%;margin-top:6px;padding:10px;border:1px dashed var(--line);border-radius:10px;background:transparent;color:var(--ink);font:inherit}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 16px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:700;font-size:15px;cursor:pointer}
.btn.ikinci{background:transparent;color:var(--ink);border:1px solid var(--line)}
.btn.tehlike{background:transparent;color:var(--bad);border:1px solid var(--bad)}
.btn.kucuk{min-height:36px;padding:4px 12px;font-size:13px}
.btn:disabled{opacity:.45;cursor:default}
.btn.tam{width:100%;margin-top:12px}
.durum{margin:10px 0 0;padding:9px 12px;border-radius:10px;font-size:14px;background:var(--fill)}
.durum.ok{background:var(--okbg);color:var(--ok)}
.durum.hata{background:var(--badbg);color:var(--bad)}
#mesaj{position:sticky;top:8px;z-index:5;margin:0 0 12px;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.ipucu{color:var(--muted);font-size:13px;margin:6px 0 0}
.onizle{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:12px}
.onizle.eksik{border-color:var(--bad)}
.onizle.pasif{opacity:.55}
.ust{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.ust label{display:flex;align-items:center;gap:8px;margin:0;font-weight:700}
.rozet{font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--badbg);color:var(--bad)}
.rozet.uyari{background:#fff3cd;color:#856404}
.sik{display:flex;align-items:center;gap:8px;margin-top:6px}
.sik b{flex:none;width:22px}
.sik .alan{margin:0}
.dz{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}
.dz select{width:auto;margin:0}
.konu{border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:10px}
.konu .ust{margin-bottom:4px}
.alt-satir{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)}
.alt-satir span{min-width:0;overflow-wrap:anywhere}
.alt-satir small{color:var(--muted)}
.oturum{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:14px}
.onz-html{max-height:260px;overflow:auto;margin-top:8px;padding:12px;border-radius:10px;background:#fff;color:#1b2433;font-size:15px;line-height:1.6}
.onz-html h1,.onz-html h2,.onz-html h3,.onz-html h4{line-height:1.3;margin:.9em 0 .4em;color:#0f1b33}
.onz-html h1{font-size:1.35em}.onz-html h2{font-size:1.2em}.onz-html h3{font-size:1.08em}
.onz-html p{margin:.5em 0}
.onz-html ul,.onz-html ol{margin:.5em 0;padding-left:1.4em}
.onz-html table{border-collapse:collapse;margin:.7em 0}
.onz-html th,.onz-html td{border:1px solid #b8c2d6;padding:5px 8px;vertical-align:top}
.onz-html th{background:#eef2fa}
.onz-html blockquote{margin:.7em 0;padding:.1em 1em;border-left:4px solid #9fb3d6}
.onz-html img{max-width:100%;height:auto}
.onz-html pre{white-space:pre-wrap;background:#f3f5f9;padding:8px;border-radius:8px}
`;
document.head.append(STIL);

const fb = initializeApp({
  apiKey: "AIzaSyAtqtkB4mYY7t1HCM3umVLxRC2un30_-fQ", authDomain: "ogrenciveyonetim.firebaseapp.com",
  projectId: "ogrenciveyonetim", storageBucket: "ogrenciveyonetim.firebasestorage.app",
  messagingSenderId: "660345359561", appId: "1:660345359561:web:5c74d90d8624c8e4c75118",
  measurementId: "G-C7TN0GBJL3", databaseURL: "https://ogrenciveyonetim-default-rtdb.firebaseio.com"
});
const auth = getAuth(fb), db = getDatabase(fb), O = window.Ortak;

const TUR = {
  soru:   { ad: 'Soru Bankası', kok: 'sb', ders: 'lessons', dersAd: 'Ders',                 birim: 'Test',   max: 500 },
  deneme: { ad: 'Deneme',       kok: 'dn', ders: 'exams',   dersAd: 'Deneme başlığı',       birim: 'Deneme', max: 120 },
  konu:   { ad: 'Konu Anlatımı', kok: 'sb', ders: 'topics', dersAd: 'Konu anlatımı başlığı', birim: 'Sayfa' }
}[window.ADMIN.tur];
const KONU = window.ADMIN.tur === 'konu', KOK = TUR.kok;
const KT = KONU ? 'akonular' : 'konular', AT = KONU ? 'asayfalar' : 'testler';
const HARF = ['A', 'B', 'C', 'D', 'E'];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tr = (a, b) => String(a).localeCompare(String(b), 'tr');
const lc = s => String(s ?? '').trim().toLocaleLowerCase('tr');
const vals = s => Object.values(s.val() || {}).filter(Boolean);
const hata = e => { const k = String((e && (e.code || e.message)) || ''); return /permission/i.test(k) ? 'Yetki yok veya güvenlik kuralları engelledi.' : /network|offline|unavailable/i.test(k) ? 'Bağlantı sorunu, tekrar deneyin.' : (k || 'Bilinmeyen hata'); };
const LS = k => 'admin_' + window.ADMIN.tur + '_' + k;
const lsGet = k => { try { return localStorage.getItem(LS(k)) || ''; } catch (_) { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS(k), v); } catch (_) { } };

let sinifler = [], dersler = [], konular = [], altlar = [];
let okunan = [], dosyaMetni = '', dosyaAdi = '', dosyaBaslik = '', mesajT;

/* ---------- Sayfa iskeleti ---------- */
document.title = TUR.ad + ' Admin | Öğrenci Bahçesi';
$('app').innerHTML = `
<h1>${TUR.ad} Admin</h1>
<p class="alt">HTML dosyasını okur, önizlemede düzeltmene izin verir ve seçtiğin sınıfın <b>${TUR.ad}</b> bölümüne gönderir.</p>
<div id="mesaj" class="durum" hidden></div>
<section id="giris" class="kutu"><h2>Yönetici girişi</h2>
  <form id="gForm"><label>E-posta<input class="alan" id="gEposta" type="email" autocomplete="username" required></label>
  <label>Şifre<input class="alan" id="gSifre" type="password" autocomplete="current-password" required></label>
  <button class="btn tam" type="submit">Giriş yap</button><div id="gHata" class="durum hata" hidden></div></form></section>
<div id="panel" hidden>
  <div class="kutu"><h2>1) Nereye gönderilecek?</h2>
    <label>Sınıf<select id="sinif"></select></label>
    <label>${TUR.dersAd}<select id="ders"></select></label>
    <p class="ipucu" id="dersIpucu"></p></div>
  <div class="kutu"><h2>2) HTML dosyası</h2>
    <input type="file" id="dosya" accept=".html,.htm,text/html">
    <div id="okuDurum" class="durum" hidden></div></div>
  <div id="gonderAlani" hidden>
    <div class="kutu"><h2>3) Konu${KONU ? '' : ' ve ' + TUR.birim.toLowerCase() + ' adı'}</h2>
      <label>Konu<select id="konuSec"></select></label>
      <label id="yeniKonuL">Yeni konu adı<input class="alan" id="yeniKonu" maxlength="100" autocomplete="off"></label>
      ${KONU ? '<label class="satirl"><input type="checkbox" id="bol" checked> Sayfaları başlıklara (H1/H2) göre böl</label>'
             : `<label>${TUR.birim} adı<input class="alan" id="testAdi" maxlength="150" autocomplete="off"></label>`}</div>
    <div class="kutu"><h2>4) Önizleme <span id="sayi"></span></h2>
      <p class="ipucu">Metni, şıkları ${KONU ? 've sayfa adlarını' : 've doğru cevabı'} burada düzeltebilirsin. Göndermek istemediğin kutunun işaretini kaldır.</p>
      <div id="onizleme" style="margin-top:10px"></div></div>
    <div class="kutu"><button class="btn tam" id="gonder" type="button">${TUR.ad} bölümüne gönder</button></div>
  </div>
  <div class="kutu"><h2>Bu başlıktaki içerik</h2><div id="icerik"></div></div>
  <div class="oturum"><span id="oturum"></span><button class="btn ikinci kucuk" id="cikis" type="button">Çıkış</button></div>
</div>`;

function mesaj(t, tur) {
  const m = $('mesaj'); m.hidden = false; m.className = 'durum' + (tur ? ' ' + tur : ''); m.textContent = t;
  clearTimeout(mesajT); if (tur === 'ok') mesajT = setTimeout(() => { m.hidden = true; }, 6000);
}
function okuDurum(t, tur) { const d = $('okuDurum'); d.hidden = !t; d.className = 'durum' + (tur ? ' ' + tur : ''); d.textContent = t || ''; }

/* ---------- Giriş ---------- */
$('gForm').addEventListener('submit', async e => {
  e.preventDefault();
  const h = $('gHata'); h.hidden = true;
  try { await signInWithEmailAndPassword(auth, $('gEposta').value.trim(), $('gSifre').value); $('gSifre').value = ''; }
  catch (err) {
    h.hidden = false;
    h.textContent = err.code === 'auth/invalid-credential' ? 'E-posta veya şifre hatalı.' : err.code === 'auth/too-many-requests' ? 'Çok fazla deneme, biraz sonra tekrar deneyin.' : 'Giriş yapılamadı: ' + (err.code || err.message);
  }
});
$('cikis').addEventListener('click', () => signOut(auth));
onAuthStateChanged(auth, async user => {
  if (!user) { $('giris').hidden = false; $('panel').hidden = true; return; }
  let yonetici = false;
  try { yonetici = (await get(ref(db, 'admins/' + user.uid))).val() === true; } catch (_) { }
  if (!yonetici) {
    $('giris').hidden = false; $('panel').hidden = true;
    const h = $('gHata'); h.hidden = false; h.textContent = 'Bu hesap yönetici değil.';
    await signOut(auth); return;
  }
  $('giris').hidden = true; $('panel').hidden = false; $('oturum').textContent = user.email || user.uid;
  try { await hedefleriYukle(); } catch (err) { mesaj('Sınıflar okunamadı: ' + hata(err), 'hata'); }
});

/* ---------- Sınıf › ders seçimi ---------- */
async function hedefleriYukle() {
  const [c, l, o] = await Promise.all(['classes', TUR.ders, 'options'].map(a => get(ref(db, a))));
  const gr = new Map(vals(o).filter(x => x.type === 'cgroup').map(g => [g.id, g.label]));
  sinifler = vals(c).map(x => ({ id: String(x.id), ad: (gr.get(x.group_id) ? gr.get(x.group_id) + ' › ' : '') + x.class_name })).sort((a, b) => tr(a.ad, b.ad));
  dersler = vals(l).map(x => ({ id: String(x.id), sinif: String(x.class_id), ad: String(x.lesson_name) })).sort((a, b) => tr(a.ad, b.ad));
  $('sinif').innerHTML = '<option value="">Sınıf seçin</option>' + sinifler.map(s => `<option value="${esc(s.id)}">${esc(s.ad)}</option>`).join('');
  const son = lsGet('sinif'); if (sinifler.some(s => s.id === son)) $('sinif').value = son;
  dersDoldur();
}
function dersDoldur() {
  const s = $('sinif').value, l = dersler.filter(d => d.sinif === s);
  $('ders').innerHTML = `<option value="">${TUR.dersAd} seçin</option>` + l.map(d => `<option value="${esc(d.id)}">${esc(d.ad)}</option>`).join('');
  $('dersIpucu').textContent = s && !l.length ? `Bu sınıfta henüz ${TUR.dersAd.toLowerCase()} yok. admin.html'de sınıfın ilgili bölümüne ekleyin.` : '';
  const son = lsGet('ders'); if (l.some(d => d.id === son)) $('ders').value = son;
  icerikYukle();
}
$('sinif').addEventListener('change', () => { lsSet('sinif', $('sinif').value); lsSet('ders', ''); dersDoldur(); });
$('ders').addEventListener('change', () => { lsSet('ders', $('ders').value); icerikYukle(); });

/* ---------- Seçili dersin mevcut içeriği ---------- */
async function icerikYukle() {
  const d = $('ders').value; konular = []; altlar = [];
  if (d) {
    try {
      const [k, a] = await Promise.all([get(ref(db, KOK + '/' + KT)), get(ref(db, KOK + '/' + AT))]);
      konular = Object.entries(k.val() || {}).filter(([, v]) => v && String(v.ders_id) === d).map(([id, v]) => ({ id, ...v })).sort((x, y) => (x.olusturma || 0) - (y.olusturma || 0));
      const ids = new Set(konular.map(x => x.id));
      altlar = Object.entries(a.val() || {}).filter(([, v]) => v && ids.has(v.konu_id)).map(([id, v]) => ({ id, ...v }))
        .sort((x, y) => KONU ? (x.sira || 0) - (y.sira || 0) : (x.olusturma || 0) - (y.olusturma || 0));
    } catch (err) { mesaj('İçerik okunamadı: ' + hata(err), 'hata'); }
  }
  konuSecDoldur(); icerikCiz();
}
function icerikCiz() {
  const kutu = $('icerik');
  if (!$('ders').value) { kutu.innerHTML = '<p class="alt">Önce sınıf ve ders seçin.</p>'; return; }
  if (!konular.length) { kutu.innerHTML = '<p class="alt">Bu başlıkta henüz konu yok.</p>'; return; }
  kutu.innerHTML = konular.map(k => {
    const al = altlar.filter(a => a.konu_id === k.id);
    return `<div class="konu"><div class="ust"><b>${esc(k.konu_adi)}</b><button class="btn tehlike kucuk" data-a="konuSil" data-id="${esc(k.id)}">Konuyu sil</button></div>` +
      (al.length ? al.map(a => `<div class="alt-satir"><span>${esc(KONU ? a.sayfa_adi : a.test_adi)}${KONU ? '' : ` <small>(${Number(a.soru_sayisi) || 0} soru)</small>`}</span>
        <button class="btn ikinci kucuk" data-a="altSil" data-id="${esc(a.id)}">Sil</button></div>`).join('') : '<p class="ipucu">İçerik yok.</p>') + '</div>';
  }).join('');
}
$('icerik').addEventListener('click', async e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const id = b.dataset.id, g = {};
  try {
    if (b.dataset.a === 'konuSil') {
      if (!confirm('Konu ve altındaki her şey silinecek. Emin misin?')) return;
      g[KT + '/' + id] = null;
      altlar.filter(a => a.konu_id === id).forEach(a => { g[AT + '/' + a.id] = null; g[(KONU ? 'aicerik/' : 'sorular/') + a.id] = null; });
    } else {
      if (!confirm((KONU ? 'Sayfa' : TUR.birim + ' ve soruları') + ' silinecek. Emin misin?')) return;
      g[AT + '/' + id] = null; g[(KONU ? 'aicerik/' : 'sorular/') + id] = null;
    }
    if (!KONU) g['meta/guncelleme'] = serverTimestamp();
    await update(ref(db, KOK), g);
    mesaj('Silindi.', 'ok'); await icerikYukle();
  } catch (err) { mesaj('Silinemedi: ' + hata(err), 'hata'); }
});

/* ---------- Dosyayı oku ---------- */
$('dosya').addEventListener('change', async () => {
  const f = $('dosya').files[0]; if (!f) return;
  try { dosyaMetni = await f.text(); dosyaAdi = f.name.replace(/\.[^.]+$/, ''); oku(); }
  catch (_) { okuDurum('Dosya okunamadı.', 'hata'); }
});
function oku() {
  if (KONU) {
    const r = O.notuOku(dosyaMetni, $('bol').checked);
    dosyaBaslik = r.baslik;
    okunan = r.sayfalar.map(p => ({ ekle: true, ad: p.ad, html: p.html }));
    if (!okunan.length) { okuDurum('Bu dosyada okunabilir bir metin bulunamadı.', 'hata'); $('gonderAlani').hidden = true; return; }
    okuDurum(`${okunan.length} sayfa okundu (${dosyaAdi}). Biçimlendirme (kalın, renk, tablo, liste…) korunur.`, 'ok');
  } else {
    const r = O.sorulariOku(dosyaMetni);
    dosyaBaslik = r.baslik;
    okunan = r.sorular.map(q => ({ ekle: !q.sekil, no: q.no, metin: q.metin, siklar: q.siklar, dogru: q.dogru, sekil: q.sekil }));
    if (!okunan.length) { okuDurum('Bu dosyada şıklı soru bulunamadı. (Her soru A) B) C) … şıklarıyla bir kutu içinde olmalı.)', 'hata'); $('gonderAlani').hidden = true; return; }
    const eksik = okunan.filter(q => !q.dogru).length, sekilli = okunan.filter(q => q.sekil).length;
    okuDurum(`${okunan.length} soru okundu (${dosyaAdi}).` + (eksik ? ` ${eksik} sorunun doğru cevabı bulunamadı, aşağıdan seçmen gerekiyor.` : ' Hepsinin doğru cevabı bulundu.') +
      (sekilli ? ` ${sekilli} soruda şekil var; ${TUR.ad} şekil göstermediği için bunlar işaretsiz bırakıldı.` : ''), eksik || sekilli ? '' : 'ok');
    $('testAdi').value = dosyaAdi.slice(0, 150);
  }
  $('yeniKonu').value = (dosyaBaslik || dosyaAdi).slice(0, 100);
  $('gonderAlani').hidden = false;
  konuSecDoldur(); onizleCiz();
}
if (KONU) $('bol').addEventListener('change', () => { if (dosyaMetni) oku(); });

/* ---------- Konu seçimi ---------- */
function konuSecDoldur() {
  const s = $('konuSec'), onceki = s.value;
  s.innerHTML = '<option value="">➕ Yeni konu aç</option>' + konular.map(k => `<option value="${esc(k.id)}">${esc(k.konu_adi)}</option>`).join('');
  if (konular.some(k => k.id === onceki)) s.value = onceki;
  else { const e = konular.find(k => lc(k.konu_adi) === lc($('yeniKonu').value)); if (e) s.value = e.id; }
  $('yeniKonuL').hidden = !!s.value;
}
$('konuSec').addEventListener('change', () => { $('yeniKonuL').hidden = !!$('konuSec').value; });

/* ---------- Önizleme ---------- */
function onizleCiz() {
  const secili = okunan.filter(q => q.ekle).length;
  $('sayi').textContent = `(${secili}/${okunan.length})`;
  $('onizleme').innerHTML = okunan.map((q, i) => KONU ? `
    <div class="onizle${q.ekle ? '' : ' pasif'}" data-i="${i}">
      <div class="ust"><label><input type="checkbox" data-alan="ekle" ${q.ekle ? 'checked' : ''}> Sayfa ${i + 1}</label><span class="ipucu">${Math.max(1, Math.round(q.html.length / 1024))} KB</span></div>
      <input class="alan" data-alan="ad" maxlength="150" value="${esc(q.ad)}" aria-label="Sayfa adı">
      <div class="onz-html">${q.html}</div>
    </div>` : `
    <div class="onizle${q.dogru ? '' : ' eksik'}${q.ekle ? '' : ' pasif'}" data-i="${i}">
      <div class="ust"><label><input type="checkbox" data-alan="ekle" ${q.ekle ? 'checked' : ''}> Soru ${esc(q.no)}</label>
        <span>${q.sekil ? '<span class="rozet uyari">Şekil var, gösterilmez</span> ' : ''}<span class="rozet" data-r="dogru" ${q.dogru ? 'hidden' : ''}>Doğru cevap seçilmedi</span></span></div>
      <textarea data-alan="metin" aria-label="Soru metni">${esc(q.metin)}</textarea>
      ${HARF.map(h => `<div class="sik"><b>${h})</b><input class="alan" data-alan="sik" data-h="${h}" value="${esc(q.siklar[h] || '')}"></div>`).join('')}
      <div class="dz"><label style="margin:0">Doğru cevap:</label>
        <select data-alan="dogru"><option value="">— seç —</option>${HARF.map(h => `<option ${q.dogru === h ? 'selected' : ''}>${h}</option>`).join('')}</select></div>
    </div>`).join('');
}
$('onizleme').addEventListener('input', e => {
  const k = e.target.closest('[data-i]'); if (!k) return;
  const q = okunan[+k.dataset.i], a = e.target.dataset.alan;
  if (a === 'metin') q.metin = e.target.value; else if (a === 'ad') q.ad = e.target.value; else if (a === 'sik') q.siklar[e.target.dataset.h] = e.target.value;
});
$('onizleme').addEventListener('change', e => {
  const k = e.target.closest('[data-i]'); if (!k) return;
  const q = okunan[+k.dataset.i], a = e.target.dataset.alan;
  if (a === 'ekle') { q.ekle = e.target.checked; k.classList.toggle('pasif', !q.ekle); $('sayi').textContent = `(${okunan.filter(x => x.ekle).length}/${okunan.length})`; }
  else if (a === 'dogru') { q.dogru = e.target.value; k.classList.toggle('eksik', !q.dogru); const r = k.querySelector('[data-r="dogru"]'); if (r) r.hidden = !!q.dogru; }
});

/* ---------- Gönder ---------- */
$('gonder').addEventListener('click', async () => {
  const dersId = $('ders').value;
  if (!dersId) return mesaj(`Önce sınıf ve ${TUR.dersAd.toLowerCase()} seçin.`, 'hata');
  const sec = okunan.filter(q => q.ekle);
  if (!sec.length) return mesaj('Gönderilecek bir öğe seçilmedi.', 'hata');

  let konuId = $('konuSec').value, konuAdi = '';
  if (!konuId) {
    konuAdi = $('yeniKonu').value.trim().replace(/\s+/g, ' ');
    if (!konuAdi) return mesaj('Yeni konu adı boş olamaz.', 'hata');
    if (konular.some(k => lc(k.konu_adi) === lc(konuAdi))) return mesaj('Bu derste aynı adlı bir konu var; listeden seçin.', 'hata');
  }
  const g = {}, simdi = Date.now();
  let ozet;
  if (KONU) {
    const adlar = new Set(konuId ? altlar.filter(a => a.konu_id === konuId).map(a => lc(a.sayfa_adi)) : []);
    for (const p of sec) {
      const ad = p.ad.trim().replace(/\s+/g, ' ');
      if (!ad) return mesaj('Sayfa adı boş olamaz.', 'hata');
      if (adlar.has(lc(ad))) return mesaj(`“${ad}” adlı sayfa bu konuda zaten var; adı değiştirin.`, 'hata');
      if (p.html.length > 390000) return mesaj(`“${ad}” sayfası çok büyük (en fazla ~390 KB). Başlıklara göre bölmeyi deneyin.`, 'hata');
      adlar.add(lc(ad)); p.adT = ad;
    }
    if (!konuId) { konuId = push(ref(db, KOK + '/akonular')).key; g['akonular/' + konuId] = { konu_adi: konuAdi, ders_id: dersId, olusturma: simdi }; }
    sec.forEach((p, i) => {
      const id = push(ref(db, KOK + '/asayfalar')).key;
      g['asayfalar/' + id] = { konu_id: konuId, sayfa_adi: p.adT, sira: simdi + i, olusturma: simdi, guncelleme: simdi };
      g['aicerik/' + id] = O.ISARET + p.html;
    });
    ozet = `${sec.length} sayfa gönderildi.`;
  } else {
    const testAdi = $('testAdi').value.trim().replace(/\s+/g, ' ');
    if (!testAdi) return mesaj(`${TUR.birim} adı boş olamaz.`, 'hata');
    if (konuId && altlar.some(a => a.konu_id === konuId && lc(a.test_adi) === lc(testAdi))) return mesaj(`Bu konuda “${testAdi}” adlı bir ${TUR.birim.toLowerCase()} zaten var.`, 'hata');
    if (sec.length > TUR.max) return mesaj(`En fazla ${TUR.max} soru gönderilebilir (${sec.length} seçili).`, 'hata');
    for (const q of sec) {
      const t = `Soru ${q.no}: `;
      if (!q.dogru) return mesaj(t + 'doğru cevap seçilmeli.', 'hata');
      if (!q.metin.trim()) return mesaj(t + 'soru metni boş.', 'hata');
      if (q.metin.trim().length > 2000) return mesaj(t + 'soru metni en fazla 2000 karakter olabilir.', 'hata');
      if (HARF.some(h => (q.siklar[h] || '').trim().length > 500)) return mesaj(t + 'şıklar en fazla 500 karakter olabilir.', 'hata');
      if (!(q.siklar[q.dogru] || '').trim()) return mesaj(t + 'doğru cevap olarak seçilen şık boş.', 'hata');
    }
    if (!konuId) { konuId = push(ref(db, KOK + '/konular')).key; g['konular/' + konuId] = { konu_adi: konuAdi, ders_id: dersId, olusturma: serverTimestamp() }; }
    const tid = push(ref(db, KOK + '/testler')).key;
    g['testler/' + tid] = { konu_id: konuId, test_adi: testAdi, soru_sayisi: sec.length, olusturma: serverTimestamp(), guncelleme: serverTimestamp() };
    sec.forEach((q, i) => {
      const sid = push(ref(db, KOK + '/sorular/' + tid)).key;
      g[`sorular/${tid}/${sid}`] = {
        soru_metni: q.metin.trim(), dogru_cevap: q.dogru, sira: i + 1, olusturma: serverTimestamp(),
        ...Object.fromEntries(HARF.map(h => ['cevap_' + h.toLowerCase(), (q.siklar[h] || '').trim()]))
      };
    });
    g['meta/guncelleme'] = serverTimestamp();
    ozet = `${sec.length} soru “${testAdi}” olarak gönderildi.`;
  }
  const btn = $('gonder'); btn.disabled = true; mesaj('Gönderiliyor…');
  try {
    await update(ref(db, KOK), g);
    mesaj('✓ ' + ozet, 'ok');
    okunan = []; dosyaMetni = ''; $('dosya').value = ''; okuDurum(''); $('gonderAlani').hidden = true; $('onizleme').innerHTML = '';
    await icerikYukle();
  } catch (err) { mesaj('Gönderilemedi: ' + hata(err), 'hata'); }
  btn.disabled = false;
});
