/* Öğrenci Bahçesi · Plan Motoru
   Çözüm geçmişinden (konu · D/Y/B · süre · saat) öğrenci profilini çıkarır ve boş ders programı saatlerine
   taslak çalışma önerisi üretir. Saf hesap: ağ, depolama, ekran yok. soru.html ve dersprogram.html kullanır.

   Kayıt biçimi: { t:zaman, test, konu, d, y, b, k:'soru'|'deneme'|'tekrar', s:saniye, di:dersId }
*/
(function (g) {
  'use strict';
  var GUN = 864e5, YARI = 21, ON = 0.6, K = 6;               // yarı ömür (gün) · ön başarı · ön ağırlık (soru)
  var gunBasi = function (ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  var pazGun = function (ts) { return (new Date(ts).getDay() + 6) % 7; };   // 0 = Pazartesi (ders programıyla aynı)
  var medyan = function (a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  var topla = function (a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); };

  /* Sınıf türüne göre ayarlar (oturum süresi, yanlış cezası, haftalık varsayılan süre, günlük en çok oturum) */
  var PROFIL = {
    ilk:   { ad: 'İlkokul',        oturum: 20, ceza: 0, haftaDk: 120, gunCap: 1, soruCap: 20 },
    orta:  { ad: 'Ortaokul',       oturum: 35, ceza: 0, haftaDk: 240, gunCap: 1, soruCap: 30 },
    lise:  { ad: 'Lise',           oturum: 50, ceza: 0, haftaDk: 360, gunCap: 2, soruCap: 50 },
    sinav: { ad: 'Sınav hazırlık', oturum: 75, ceza: 4, haftaDk: 600, gunCap: 2, soruCap: 60 }
  };
  function profilTahmin(grup, sinif) {
    var s = (String(grup || '') + ' ' + String(sinif || '')).toLocaleLowerCase('tr');
    if (/tyt|ayt|kpss|dgs|ales|yks|lgs|yds|msü|sınav|sinav/.test(s)) return 'sinav';
    if (/ilkokul|ilköğretim/.test(s)) return 'ilk';
    if (/ortaokul/.test(s)) return 'orta';
    if (/lise/.test(s)) return 'lise';
    var m = s.match(/(\d{1,2})/);
    if (m) { var n = +m[1]; if (n <= 4) return 'ilk'; if (n <= 8) return 'orta'; if (n <= 12) return 'lise'; }
    return 'lise';
  }

  /* Konu tanıları: etiket · haftalık en çok oturum · rozet rengi · açıklama */
  var TUR = {
    temel:    { e: '🔴 Temel eksik',     f: 3, renk: '#b91c1c', m: 'Temel eksik var: önce konu anlatımı/video, sonra kolay sorular.' },
    dikkat:   { e: '🟠 Çok yanlış',      f: 3, renk: '#c2410c', m: 'Konuyu biliyorsun ama yanlış yapıyorsun: önce yanlışlarını çöz, sonra yeni test.' },
    bos:      { e: '🟡 Çok boş',         f: 2, renk: '#a16207', m: 'Boşların fazla: konu özetine bak, şık eleyerek işaretlemeyi dene.' },
    pekistir: { e: '🔵 Pekiştir',        f: 2, renk: '#1e3a8a', m: 'Yolun yarısındasın: düzenli test ile %75 üstüne çık.' },
    guclu:    { e: '🟢 Tekrar',          f: 1, renk: '#15803d', m: 'Güçlü konu; unutmamak için kısa tekrar yeter.' },
    veri:     { e: '🟣 Seviye netleşsin', f: 1, renk: '#6d28d9', m: 'Veri az: seviyeni netleştirmek için bir test daha çöz.' }
  };

  function nedenYaz(k) {
    var p = ['%' + k.acc + ' başarı (' + k.d + 'D ' + k.y + 'Y ' + k.b + 'B)'];
    if (k.hiz === 'hizli' && k.acc < 65) p.push('soru başı ' + Math.round(k.ortSn) + ' sn: hızlı çözüp yanlış yapıyorsun, okuyarak yavaşla');
    else if (k.hiz === 'yavas' && k.acc < 65) p.push('soru başı ' + Math.round(k.ortSn) + ' sn: yavaş çözüp de yanlış yapıyorsun, konu eksiği var');
    if (k.trend <= -10) p.push('son testlerde düşüş var');
    else if (k.trend >= 10) p.push('son testlerde yükseliş var');
    if (k.gec >= 7) p.push(k.gec + ' gündür çalışılmadı');
    return p.join(' · ') + '. ' + TUR[k.tur].m;
  }

  /* ---------- 1) Analiz ---------- */
  function analiz(kayit, opt) {
    opt = opt || {};
    var simdi = opt.simdi || Date.now(), bugun = gunBasi(simdi);
    var tum = (kayit || []).filter(function (x) { return x && x.t && ((x.d | 0) + (x.y | 0) + (x.b | 0)) > 0; });
    var sureli = tum.filter(function (x) { return x.s > 0; });

    // genel süre alışkanlığı
    var topSn = topla(sureli, function (x) { return x.s; }), topSoruS = topla(sureli, function (x) { return (x.d | 0) + (x.y | 0) + (x.b | 0); });
    var ortSn = topSoruS ? topSn / topSoruS : 0;

    // haftalık süre: son 4 haftanın medyanı (verisi olan haftalar kadar)
    var hafta = [0, 0, 0, 0];
    sureli.forEach(function (x) { var w = Math.floor((bugun - gunBasi(x.t)) / GUN / 7); if (w >= 0 && w < 4) hafta[w] += x.s / 60; });
    var ilk = tum.length ? Math.min.apply(null, tum.map(function (x) { return x.t; })) : simdi;
    var kapsam = Math.min(4, Math.max(1, Math.ceil((bugun - gunBasi(ilk) + 1) / GUN / 7)));
    var haftaDk = Math.round(medyan(hafta.slice(0, kapsam)));

    // düzenlilik: son 28 günde hangi günler (haftanın günü) çalışılmış
    var gunler = new Set(), gunSkor = [0, 0, 0, 0, 0, 0, 0];
    tum.forEach(function (x) { var gb = gunBasi(x.t); if (bugun - gb < 28 * GUN) gunler.add(gb); });
    gunler.forEach(function (gb) { gunSkor[pazGun(gb)]++; });

    // saat dilimi: testin başladığı saat (bitiş − süre) ve o saatlerdeki başarı
    var saatSoru = new Array(24).fill(0), saatDogru = new Array(24).fill(0);
    tum.filter(function (x) { return bugun - gunBasi(x.t) < 56 * GUN; }).forEach(function (x) {
      var h = new Date(x.t - (x.s || 0) * 1000).getHours(), n = (x.d | 0) + (x.y | 0) + (x.b | 0);
      saatSoru[h] += n; saatDogru[h] += (x.d | 0);
    });
    var enIyiSaat = null;
    for (var h = 0; h < 24; h++) {
      if (saatSoru[h] >= 20) { var ac = Math.round(saatDogru[h] / saatSoru[h] * 100); if (!enIyiSaat || ac > enIyiSaat.acc) enIyiSaat = { saat: h, acc: ac, soru: saatSoru[h] }; }
    }

    // konu bazlı (yalnızca soru bankası testleri)
    var m = new Map();
    tum.filter(function (x) { return !x.k || x.k === 'soru'; }).forEach(function (x) {
      var w = Math.pow(0.5, (simdi - x.t) / (YARI * GUN)), n = (x.d | 0) + (x.y | 0) + (x.b | 0);
      var k = m.get(x.konu) || { ad: x.konu, d: 0, y: 0, b: 0, wd: 0, wy: 0, wb: 0, son: 0, sn: 0, snS: 0, liste: [], dis: {} };
      k.d += x.d | 0; k.y += x.y | 0; k.b += x.b | 0; k.wd += (x.d | 0) * w; k.wy += (x.y | 0) * w; k.wb += (x.b | 0) * w;
      k.son = Math.max(k.son, x.t); k.liste.push(x);
      if (x.s > 0) { k.sn += x.s; k.snS += n; }
      if (x.di) k.dis[x.di] = (k.dis[x.di] || 0) + 1;
      m.set(x.konu, k);
    });
    var konular = Array.from(m.values()).map(function (k) {
      var N = k.d + k.y + k.b, W = k.wd + k.wy + k.wb;
      var acc = (k.wd + ON * K) / (W + K) * 100;                       // az veride %60'a yaklaşan düzeltilmiş başarı
      var yr = W ? k.wy / W * 100 : 0, br = W ? k.wb / W * 100 : 0;
      var gec = Math.max(0, Math.round((bugun - gunBasi(k.son)) / GUN));
      var s = k.liste.slice().sort(function (a, b) { return a.t - b.t; }), trend = 0;
      if (s.length >= 3) {
        var so = s.slice(-2), on = s.slice(0, -2);
        var sT = topla(so, function (x) { return (x.d | 0) + (x.y | 0) + (x.b | 0); }), oT = topla(on, function (x) { return (x.d | 0) + (x.y | 0) + (x.b | 0); });
        if (sT >= 5 && oT >= 5) trend = topla(so, function (x) { return x.d | 0; }) / sT * 100 - topla(on, function (x) { return x.d | 0; }) / oT * 100;
      }
      var tur;
      if (N < 10) tur = 'veri';
      else if (acc < 50) tur = 'temel';
      else if (acc < 75 && yr >= 30) tur = 'dikkat';
      else if (acc < 75 && br >= 25) tur = 'bos';
      else if (acc < 75) tur = 'pekistir';
      else tur = 'guclu';
      var pr = (100 - acc) + Math.min(yr, 50) * 0.4 + Math.min(br, 50) * 0.3 + Math.min(gec, 14) * (acc < 85 ? 1.2 : 0.6);
      if (trend <= -10) pr += 12; else if (trend >= 10) pr -= 6;
      if (tur === 'veri') pr = Math.max(pr, 42);
      var plan = true;
      if (tur === 'guclu') { plan = gec >= 7; pr = (100 - acc) + gec * 1.5; }     // güçlü konu ancak 7+ gündür çalışılmadıysa gündeme gelir
      var kOrt = k.snS ? k.sn / k.snS : (ortSn || 60), hiz = 'normal';
      if (k.snS >= 15 && ortSn) { var r = kOrt / ortSn; hiz = r < 0.7 ? 'hizli' : (r > 1.4 ? 'yavas' : 'normal'); }
      var di = Object.keys(k.dis).sort(function (a, b) { return k.dis[b] - k.dis[a]; })[0] || '';
      var o = { ad: k.ad, di: di, N: N, d: k.d, y: k.y, b: k.b, acc: Math.round(acc), yr: yr, br: br, gec: gec, trend: trend, tur: tur, pr: pr, plan: plan,
        ortSn: kOrt, hiz: hiz, dk: Math.round(k.sn / 60), son: k.son };
      o.neden = nedenYaz(o);
      return o;
    }).sort(function (a, b) { return b.pr - a.pr; });

    var T = tum.filter(function (x) { return !x.k || x.k === 'soru'; });
    return {
      konular: konular,
      toplam: { soru: topla(tum, function (x) { return (x.d | 0) + (x.y | 0) + (x.b | 0); }), d: topla(tum, function (x) { return x.d | 0; }), y: topla(tum, function (x) { return x.y | 0; }), b: topla(tum, function (x) { return x.b | 0; }), dk: Math.round(topSn / 60), test: tum.length },
      haftaDk: haftaDk, aktifGun28: gunler.size, gunSkor: gunSkor, saatSoru: saatSoru, enIyiSaat: enIyiSaat, ortSn: ortSn,
      veriYeterli: topla(T, function (x) { return (x.d | 0) + (x.y | 0) + (x.b | 0); }) >= 15 && konular.length > 0
    };
  }

  /* ---------- 2) Program önerisi: yalnızca BOŞ hücrelere taslak ---------- */
  function programOner(a, tt, slots, profilKey, opt) {
    opt = opt || {};
    var P = PROFIL[profilKey] || PROFIL.lise, haric = opt.haric || new Set();
    var cells = [];
    for (var d = 0; d < 7; d++) for (var h = 0; h < slots.length; h++) {
      if ((tt[d] && tt[d][h] && tt[d][h].name) || haric.has(d + '-' + h)) continue;
      cells.push({ d: d, h: h, saat: parseInt(String(slots[h]).split(':')[0], 10) || 0 });
    }
    if (!cells.length) return { yer: [], mesaj: 'Programda boş saat yok. Önce bir saat boşalt ya da yeni saat ekle.' };
    var konular = a.konular.filter(function (k) { return k.plan; });
    if (!a.veriYeterli || !konular.length) return { yer: [], mesaj: 'Öneri için en az 15 soru çözmen gerekiyor. Biraz test çözdükten sonra tekrar dene.' };

    // haftalık kapasite: kendi gerçek süren (+%10), veri yoksa profil varsayılanı
    var hedefDk = a.haftaDk > 0 ? a.haftaDk * 1.1 : P.haftaDk;
    var n = Math.round(hedefDk / P.oturum);
    n = Math.max(3, Math.min(n, cells.length, 14));

    // saat/gün alışkanlığına göre hücre puanı
    var maxG = Math.max.apply(null, [1].concat(a.gunSkor)), maxS = Math.max.apply(null, [1].concat(a.saatSoru));
    cells.forEach(function (c) { c.skor = 1 + (a.gunSkor[c.d] / maxG) * 2 + ((a.saatSoru[c.saat] || 0) / maxS) * 2; });
    var sirali = cells.slice().sort(function (x, y) { return y.skor - x.skor || x.d - y.d || x.h - y.h; });
    var secili = [], gunSay = [0, 0, 0, 0, 0, 0, 0], cap = 1;                 // önce her güne en çok 1 oturum: haftaya yayılsın
    while (secili.length < n && cap <= 4) {
      sirali.forEach(function (c) { if (secili.length < n && secili.indexOf(c) < 0 && gunSay[c.d] < cap) { secili.push(c); gunSay[c.d]++; } });
      cap++;
    }
    n = secili.length;

    // konulara oturum hakkı: önceliğe orantılı, haftalık üst sınırı tanıya göre
    var top = konular.slice(0, Math.min(8, Math.max(2, Math.ceil(n / 1.7))));      // az oturumda az konu: odak dağılmasın
    var tp = topla(top, function (k) { return k.pr; }) || 1;
    var hak = top.map(function (k) { return Math.min(TUR[k.tur].f, Math.max(1, Math.round(n * k.pr / tp))); });
    var guard = 60;
    while (topla(hak, function (x) { return x; }) > n && guard--) { for (var i = hak.length - 1; i >= 0; i--) { if (hak[i] > 0) { hak[i]--; break; } } }
    guard = 60;
    while (topla(hak, function (x) { return x; }) < n && guard--) {
      var ok = false;
      for (var j = 0; j < top.length; j++) { if (hak[j] < TUR[top[j].tur].f) { hak[j]++; ok = true; break; } }
      if (!ok) break;
    }

    // en iyi hücrelere en öncelikli konular; aynı gün aynı konu ve komşu gün tekrarını kaçır
    var yer = [], gunKonu = {};
    secili.forEach(function (c) {
      var best = -1, bs = -1e9;
      top.forEach(function (k, ix) {
        if (hak[ix] <= 0) return;
        var s = k.pr + hak[ix] * 8;
        if ((gunKonu[c.d] || []).indexOf(k.ad) >= 0) s -= 100;
        if ((gunKonu[c.d - 1] || []).indexOf(k.ad) >= 0 || (gunKonu[c.d + 1] || []).indexOf(k.ad) >= 0) s -= 25;
        if (s > bs) { bs = s; best = ix; }
      });
      if (best < 0) return;
      hak[best]--;
      var k = top[best];
      (gunKonu[c.d] = gunKonu[c.d] || []).push(k.ad);
      var soru = Math.round(P.oturum * 60 * 0.7 / (k.ortSn || 60));            // sürenin %70'i soru çözümü, kalanı yanlış/konu bakışı
      soru = Math.max(5, Math.min(P.soruCap, Math.round(soru / 5) * 5));
      if (k.tur === 'veri') soru = Math.min(soru, 15);                          // az veri: kısa bir ölçme testi yeter
      yer.push({ d: c.d, h: c.h, konu: k.ad, di: k.di, tur: k.tur, soru: soru, dk: P.oturum, renk: TUR[k.tur].renk, neden: k.neden });
    });
    yer.sort(function (x, y) { return x.d - y.d || x.h - y.h; });
    return { yer: yer, ozet: { oturum: yer.length, haftaDk: a.haftaDk, hedefDk: yer.length * P.oturum, profil: P.ad, konu: top.length, oturumDk: P.oturum }, mesaj: '' };
  }

  g.PlanMotor = { PROFIL: PROFIL, TUR: TUR, profilTahmin: profilTahmin, analiz: analiz, programOner: programOner };
})(typeof window !== 'undefined' ? window : globalThis);
