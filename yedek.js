/* yedek.js — Öğrenci verisinin Firebase hesabına yedeklenmesi.
   Uygulama indirildikten sonra Firebase/GitHub ile başka bir bağlantı kurulmaz. Yalnızca şu dört veri,
   İNTERNET VARKEN hesaba yazılır (internet yoksa cihazda bekler, açılınca gönderilir):
     defter · program (ders programı) · soru (soru bankası "neler yaptım") · konu (konu anlatımı çizimleri)
   Yol: userData/<uid>/<arac>/<anahtar>
   Kullanım:  const y = yedekle('soru', async k => metin | null);   y.put(k); y.del(k); */
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getDatabase, ref, get, update } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

const config = {
  apiKey: "AIzaSyAtqtkB4mYY7t1HCM3umVLxRC2un30_-fQ",
  authDomain: "ogrenciveyonetim.firebaseapp.com",
  databaseURL: "https://ogrenciveyonetim-default-rtdb.firebaseio.com",
  projectId: "ogrenciveyonetim",
  appId: "1:660345359561:web:5c74d90d8624c8e4c75118"
};
const IZINLI = ['defter', 'program', 'soru', 'konu'];
const MAX = 400000, PARCA = 1500000;          // bir kaydın en büyük boyutu (kurallarla aynı) / tek gönderimde toplam
const db = getDatabase(initializeApp(config)), auth = getAuth();

const chip = (() => {
  let e = null, t;
  return (m, ms = 3500) => {
    if (!e) {
      e = document.createElement('div'); e.setAttribute('role', 'status');
      e.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:99999;max-width:260px;padding:6px 10px;border-radius:10px;font:12px/1.35 system-ui,sans-serif;background:rgba(30,43,92,.92);color:#fff;display:none;cursor:pointer';
      e.addEventListener('click', () => { e.style.display = 'none'; });
      document.body.appendChild(e);
    }
    e.textContent = m; e.style.display = 'block'; clearTimeout(t); t = setTimeout(() => { e.style.display = 'none'; }, ms);
  };
})();

/* Başarılı bir yedekleme, 10 günlük "internete bağlandı" damgasını da yeniler (ogrenci.js / kapi.js aynı damgayı okur). */
function okTazele(uid) {
  try {
    const o = JSON.parse(localStorage.getItem('og-ok') || 'null'), n = Date.now();
    if (o && o.uid === uid) { o.t = n; o.s = Math.max(o.s || 0, n); Storage.prototype.setItem.call(localStorage, 'og-ok', JSON.stringify(o)); }
  } catch {}
}

export function yedekle(arac, oku) {
  if (!IZINLI.includes(arac)) throw new Error('İzin verilmeyen yedek alanı: ' + arac);
  const BEK = 'og-bekle-' + arac;
  let uid = null, calisiyor = false, tm = null;
  const yol = k => `userData/${uid}/${arac}/${k}`;
  const bekle = () => { try { return JSON.parse(localStorage.getItem(BEK) || '{}') || {}; } catch { return {}; } };
  const yaz = o => { try { Object.keys(o).length ? Storage.prototype.setItem.call(localStorage, BEK, JSON.stringify(o)) : localStorage.removeItem(BEK); } catch {} };
  const hazir = new Promise(res => { const off = onAuthStateChanged(auth, u => { off(); uid = u ? u.uid : null; res(uid); }); });

  /* Bekleyen kayıtları (yazılan/silinen) hesaba gönderir. İnternet yoksa hiçbir şey yapmaz; kayıtlar cihazda bekler. */
  async function bosalt() {
    if (!uid || !navigator.onLine || calisiyor) return false;
    const b = bekle(), anahtarlar = Object.keys(b);
    if (!anahtarlar.length) return true;
    calisiyor = true;
    try {
      let parca = {}, boyut = 0, buyuk = false;
      const gonder = async () => { if (Object.keys(parca).length) await update(ref(db), parca); parca = {}; boyut = 0; };
      for (const k of anahtarlar) {
        const metin = b[k].startsWith('p') ? await oku(k) : null;
        if (metin == null) parca[yol(k)] = null;                   // silinmiş (ya da cihazda yok): hesaptan da kaldır
        else if (metin.length > MAX) { buyuk = true; continue; }
        else { if (boyut + metin.length > PARCA) await gonder(); parca[yol(k)] = metin; boyut += metin.length; }
      }
      await gonder();
      const simdi = bekle();                                       // gönderirken değişen kayıtlar bekleyenlerde kalır
      anahtarlar.forEach(k => { if (simdi[k] === b[k]) delete simdi[k]; });
      yaz(simdi);
      okTazele(uid);
      if (buyuk) chip('Bazı kayıtlar çok büyük olduğu için yedeklenemedi.', 6000);
      return true;
    } catch (e) {
      if (navigator.onLine) chip('Yedeklenemedi. Daha sonra yeniden denenecek.');
      return false;
    } finally { calisiyor = false; }
  }
  const planla = () => { clearTimeout(tm); tm = setTimeout(() => bosalt().catch(() => {}), 2500); };

  addEventListener('online', planla);                              // internet açılınca bekleyenler gider
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bosalt().catch(() => {}); });
  hazir.then(() => bosalt()).catch(() => {});

  return {
    hazir, chip, bosalt,
    put(k) { const b = bekle(); b[k] = 'p' + Date.now(); yaz(b); planla(); },
    del(k) { const b = bekle(); b[k] = 'd' + Date.now(); yaz(b); planla(); },
    async uzak() { return (await get(ref(db, `userData/${uid}/${arac}`))).val() || {}; }   // geri yükleme için
  };
}
