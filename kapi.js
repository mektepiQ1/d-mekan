/* Lisans kapısı — internetsiz doğrulama.
   Kod = 26 bayt yük (rol, cihaz no, bitiş günü, sınıf no, anahtar) + 64 bayt ECDSA imzası (base64url).
   Uygulamada yalnızca AÇIK anahtar vardır; kodu yalnızca kod-uret.html (gizli anahtar) üretebilir.
   Kod, üretildiği cihaza bağlıdır: başka telefonda çalışmaz. */
const PUB = {"kty": "EC", "crv": "P-256", "x": "A8ZQFjMXKFCOI7WFvP2mbHnHy647mK1Y9pRG5_8Vllk", "y": "n9zuJX6VZGiZ3lAqdnFep6EDItFFL47SqGrcKPUtllw"};
const KOD = 'ob_lisans', CIH = 'ob_cihaz', A32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ls = { al: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, yaz: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };

const b32 = u => { let v = 0, b = 0, o = ''; for (const x of u) { v = (v << 8) | x; b += 8; while (b >= 5) { o += A32[(v >>> (b - 5)) & 31]; b -= 5; } v &= (1 << b) - 1; } return o; };
const b64d = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export const cihazNo = (() => {
  let c = ls.al(CIH);
  if (!/^[A-Z2-9]{8}$/.test(c || '')) { c = b32(crypto.getRandomValues(new Uint8Array(5))); ls.yaz(CIH, c); }
  return c;
})();
export const cihazGoster = cihazNo.slice(0, 4) + '-' + cihazNo.slice(4);

async function dogrula(kod) {                      // → {rol, key} | {hata}
  try {
    const u = b64d(String(kod).replace(/\s+/g, ''));
    if (u.length !== 90) return { hata: 'Kod eksik ya da hatalı.' };
    const yuk = u.slice(0, 26), imza = u.slice(26);
    const k = await crypto.subtle.importKey('jwk', PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, imza, yuk)) return { hata: 'Kod geçersiz.' };
    if (b32(yuk.slice(1, 6)) !== cihazNo) return { hata: 'Bu kod başka bir cihaz için üretilmiş.' };
    const gun = (yuk[6] << 8) | yuk[7];
    if (gun !== 0xFFFF) {                          // süreli kod: saat geri alınarak süre uzatılamaz
      const simdi = Date.now(), son = +ls.al('ob_son') || 0;
      if (simdi < son - 2 * 864e5) return { hata: 'Telefonun saati geriye alınmış görünüyor. Saati düzeltip uygulamayı yeniden aç.' };
      if (simdi >= Date.UTC(2025, 0, 1) + (gun + 1) * 864e5) return { hata: 'Kodun süresi dolmuş.' };
      if (simdi > son) ls.yaz('ob_son', String(simdi));
    }
    const sinif = (yuk[8] << 8) | yuk[9];
    if (yuk[0] === 0 && !sinif) return { hata: 'Kod bir sınıfa ait değil.' };
    return { rol: yuk[0], sinif, key: yuk.slice(10) };   // öğrenci: sınıfın anahtarı · yönetici: ana anahtar
  } catch (_) { return { hata: 'Kod okunamadı.' }; }
}

const yonetici = /admin\.html$/i.test(location.pathname);
const kurulu = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

function ekran(mesaj) {
  document.documentElement.style.overflow = 'hidden';
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,#f5f7fa,#c3cfe2);display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;overflow:auto';
  d.innerHTML = '<div style="background:#fff;border-radius:20px;padding:28px;max-width:440px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.12);color:#2d3748;text-align:center">' +
    '<div style="font-size:42px">🌱</div><h2 style="color:#2c3e66;margin:8px 0 4px">Öğrenci Bahçesi</h2>' +
    '<p style="color:#718096;font-size:14px;margin-bottom:18px">' + (yonetici ? 'Yönetici etkinleştirme kodu gerekli.' : 'Uygulamayı kullanmak için etkinleştirme kodu gerekli.') + '</p>' +
    '<div style="background:#f7fafc;border:1.5px dashed #cbd5e0;border-radius:12px;padding:12px;margin-bottom:14px"><div style="font-size:12px;color:#718096">Cihaz numaranız</div>' +
    '<div id="obNo" style="font-size:26px;font-weight:700;letter-spacing:3px;color:#2c3e66">' + cihazGoster + '</div></div>' +
    (yonetici || kurulu ? '' : '<p style=\"color:#975a16;background:#fffaf0;border:1px solid #fbd38d;border-radius:10px;padding:9px;font-size:12.5px;margin:0 0 12px\"><b>Önemli:</b> uygulamayı önce tarayıcı menüsünden <b>“Ana ekrana ekle”</b> ile telefonuna ekleyin ve oradan açın. Numara ve kod yalnızca açtığınız yerde geçerlidir.</p>') +
    '<textarea id="obKod" rows="4" placeholder="Etkinleştirme kodunu buraya yapıştırın" style="width:100%;padding:12px;border:1.5px solid #e2e8f0;border-radius:12px;font:14px monospace;resize:none"></textarea>' +
    '<div id="obMsg" style="color:#c53030;font-size:13px;min-height:20px;margin:8px 0">' + (mesaj || '') + '</div>' +
    '<button id="obBtn" style="width:100%;padding:13px;border:0;border-radius:12px;background:linear-gradient(135deg,#2c3e66,#1a2744);color:#fff;font-size:16px;font-weight:500">Etkinleştir</button>' +
    '<p style="color:#718096;font-size:12px;margin-top:14px">Cihaz numaranızı satış noktasına iletin, size kodu verelim.</p></div>';
  document.documentElement.appendChild(d);
  const g = id => d.querySelector(id);
  g('#obBtn').onclick = async () => {
    const kod = g('#obKod').value.trim(), s = await dogrula(kod);
    if (s.hata) return void (g('#obMsg').textContent = s.hata);
    if (yonetici && s.rol !== 1) return void (g('#obMsg').textContent = 'Bu sayfa için yönetici kodu gerekli.');
    ls.yaz(KOD, kod); location.reload();
  };
}

export const lisans = (async () => {
  const h = /^#k=([\w-]+)$/.exec(location.hash);
  if (h) { ls.yaz(KOD, h[1]); history.replaceState(null, '', location.pathname + location.search); }
  const kayit = ls.al(KOD), s = kayit ? await dogrula(kayit) : { hata: '' };
  if (s.hata !== undefined || (yonetici && s.rol !== 1)) {
    const goster = () => ekran(kayit ? (s.hata || 'Bu sayfa için yönetici kodu gerekli.') : '');
    document.body ? goster() : addEventListener('DOMContentLoaded', goster);
    return new Promise(() => {});                  // kapı kapalı: bekleyen sayfa hiçbir şey yüklemez
  }
  return s;
})();
