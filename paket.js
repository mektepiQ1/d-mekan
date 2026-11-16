/* İçerik paketi: yönetici dışa aktarır (icerik.json, AES-GCM ile şifreli), öğrenci cihazı açılışta
   internet varsa günceller. Anahtar lisans kodunun içindedir; kod olmadan dosya okunamaz. */
import { lisans } from './kapi.js';
import { paketAl, paketYaz } from './yerel-db.js';

const KOKLER = ['classes', 'lessons', 'links', 'options', 'topics', 'exams', 'sb', 'dn'];
const SURUM = 'ob_paket_v';
const b64e = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const akis = async (veri, S, ...a) => new Uint8Array(await new Response(new Blob([veri]).stream().pipeThrough(new S(...a))).arrayBuffer());

async function anahtar() { const l = await lisans; return crypto.subtle.importKey('raw', l.key, 'AES-GCM', false, ['encrypt', 'decrypt']); }

export async function disaAktar() {
  const v = Date.now();
  let ham = new TextEncoder().encode(JSON.stringify({ v, d: await paketAl(KOKLER) })), z = 0;
  if (self.CompressionStream) { ham = await akis(ham, CompressionStream, 'gzip'); z = 1; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await anahtar(), ham));
  return JSON.stringify({ s: 1, v, z, iv: b64e(iv), c: b64e(c) });
}

export async function iceAktar(metin) {
  const j = JSON.parse(metin);
  let ham = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(j.iv) }, await anahtar(), b64d(j.c)));
  if (j.z) ham = await akis(ham, DecompressionStream, 'gzip');
  const p = JSON.parse(new TextDecoder().decode(ham));
  await paketYaz(p.d, KOKLER);
  try { localStorage.setItem(SURUM, String(j.v)); } catch (_) {}
}

async function guncelle() {                          // → içerik değişti mi
  if (!navigator.onLine) return false;
  try {
    const r = await fetch('icerik.json', { cache: 'no-store' });
    if (!r.ok) return false;
    const t = await r.text(), j = JSON.parse(t);
    if ((+localStorage.getItem(SURUM) || 0) >= j.v) return false;
    await iceAktar(t); return true;
  } catch (_) { return false; }
}

const yonetici = /admin\.html$/i.test(location.pathname);
lisans.then(() => {
  if (!yonetici) { guncelle().then(d => { if (d) location.reload(); }); return; }
  const app = document.getElementById('app');
  const kart = '<div class="card" id="paketKart"><h2>Satış paketi</h2><p>Tüm içeriği tek bir şifreli dosya olarak indirin. Dosyayı <b>icerik.json</b> adıyla siteye (GitHub) yükleyin; öğrenciler internete bağlandıklarında güncellemeyi kendiliğinden alır.</p><button type="button" id="paketIndir">icerik.json indir</button><div class="hint" id="paketNot"></div></div>';
  const koy = () => { if (app && !document.getElementById('paketKart') && (location.hash.slice(1) || 'dashboard') === 'dashboard' && app.firstElementChild) app.insertAdjacentHTML('afterbegin', kart); };
  new MutationObserver(koy).observe(app, { childList: true }); koy();
  document.addEventListener('click', async e => {
    if (e.target.id !== 'paketIndir') return;
    const not = document.getElementById('paketNot'); not.textContent = 'Hazırlanıyor…';
    try {
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([await disaAktar()], { type: 'application/json' }));
      a.href = url; a.download = 'icerik.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000); not.textContent = 'İndirildi: ' + new Date().toLocaleString('tr');
    } catch (_) { not.textContent = 'Paket oluşturulamadı.'; }
  });
});
