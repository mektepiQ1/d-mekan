/* Ortak yardımcılar — hem öğrenci sayfası (konu.html) hem yönetici sayfaları kullanır.
   - temizle / hazirla / cocuklar : HTML'yi güvenli ve biçimini koruyarak temizler
   - sorulariOku : A) B) C) şıklı soru HTML dosyasını ayrıştırır
   - notuOku     : konu anlatımı HTML dosyasını (biçimiyle) sayfalara ayırır */
(function (W) {
  'use strict';
  var ISARET = '<!--h-->';   // sb/aicerik içinde HTML olarak saklanan sayfaların başındaki işaret
  var kume = function (s) { var o = {}; s.split(' ').forEach(function (k) { o[k] = 1; }); return o; };
  var IZIN = kume('P BR STRONG B EM I U S STRIKE DEL INS SUB SUP H1 H2 H3 H4 H5 H6 UL OL LI DL DT DD TABLE THEAD TBODY TFOOT TR TH TD CAPTION COLGROUP COL BLOCKQUOTE HR SPAN DIV CODE PRE MARK SMALL A IMG FIGURE FIGCAPTION SECTION ARTICLE ABBR CITE Q KBD');
  var YASAK = kume('SCRIPT STYLE IFRAME OBJECT EMBED LINK META TITLE HEAD SVG MATH VIDEO AUDIO FORM INPUT BUTTON TEXTAREA SELECT NOSCRIPT TEMPLATE CANVAS APPLET BASE FRAME FRAMESET');
  var STIL = kume('color background-color background font-weight font-style text-decoration text-align vertical-align border border-top border-bottom border-left border-right border-collapse padding text-transform');

  function ayristir(h) { return new DOMParser().parseFromString('<!doctype html><body>' + h, 'text/html'); }

  /* style="" içinden yalnızca izinli ve zararsız biçim özelliklerini bırakır */
  function stilTemizle(s) {
    var out = [];
    String(s || '').split(';').forEach(function (d) {
      var i = d.indexOf(':'); if (i < 1) return;
      var p = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).replace(/!important/i, '').trim();
      if (!STIL[p] || !v || v.length > 80 || !/^[#\w\s,.()%\-+]+$/.test(v) || /url|expression|javascript|import/i.test(v)) return;
      if (/^(inherit|initial|unset|transparent)$/i.test(v) && p !== 'background' && p !== 'background-color') return;
      out.push(p + ':' + v);
    });
    return out.join(';');
  }

  function ozellik(k, y) {
    var t = k.tagName, st = stilTemizle(k.getAttribute('style'));
    if (st) y.setAttribute('style', st);
    if (t === 'TD' || t === 'TH') ['colspan', 'rowspan'].forEach(function (a) {
      var v = parseInt(k.getAttribute(a), 10); if (v > 1 && v < 50) y.setAttribute(a, String(v));
    });
    var al = (k.getAttribute('align') || '').toLowerCase();
    if (/^(left|right|center|justify)$/.test(al)) y.setAttribute('align', al);
    if (t === 'A') {
      var h = (k.getAttribute('href') || '').trim();
      if (/^(https?:|mailto:)/i.test(h)) { y.setAttribute('href', h); y.setAttribute('target', '_blank'); y.setAttribute('rel', 'noopener noreferrer'); }
    }
    if (t === 'IMG') {
      var s = (k.getAttribute('src') || '').trim();
      if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(s)) {
        y.setAttribute('src', s); y.setAttribute('alt', (k.getAttribute('alt') || '').slice(0, 200));
      }
    }
  }

  function kopya(kaynak, hedef, doc) {
    for (var c = kaynak.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { hedef.appendChild(doc.createTextNode(c.data)); continue; }
      if (c.nodeType !== 1) continue;
      var t = c.tagName;
      if (YASAK[t]) continue;
      if (!IZIN[t]) { kopya(c, hedef, doc); continue; }        // bilinmeyen etiket: açılır, içeriği kalır
      var e = doc.createElement(t.toLowerCase());
      ozellik(c, e);
      if (t === 'IMG') { if (!e.getAttribute('src')) continue; }
      else kopya(c, e, doc);
      hedef.appendChild(e);
    }
  }

  /* Ham HTML -> güvenli HTML metni (script, olay, dış bağlantılı görsel vb. atılır; kalın, tablo, liste, renk kalır) */
  function temizle(ham) {
    var doc = ayristir(String(ham || '')), out = doc.createElement('div');
    kopya(doc.body, out, doc);
    return out.innerHTML;
  }
  /* Saklanan sayfa -> { html: temiz HTML, text: ekranda görünen düz metin } (işaretleme konumları bu metne göre tutulur) */
  function hazirla(ham) {
    var h = temizle(String(ham || '').replace(ISARET, ''));
    return { html: h, text: ayristir(h).body.textContent };
  }
  function cocuklar(h) {
    return Array.prototype.map.call(ayristir(h).body.childNodes, function (n) { return document.importNode(n, true); });
  }

  /* <style> içindeki sınıf kurallarını öğelerin üstüne satır içi yazar (biçim, sınıflar atıldığında kaybolmasın) */
  function stilleriIsle(doc) {
    var harita = new Map();
    Array.prototype.forEach.call(doc.querySelectorAll('style'), function (st) {
      var g = document.createElement('style'); g.textContent = st.textContent; document.head.appendChild(g);
      try {
        Array.prototype.forEach.call(g.sheet.cssRules, function (r) {
          if (r.type !== 1) return;
          var s = stilTemizle(r.style.cssText); if (!s) return;
          var els; try { els = doc.querySelectorAll(r.selectorText); } catch (e) { return; }
          Array.prototype.forEach.call(els, function (el) { harita.set(el, (harita.get(el) || '') + s + ';'); });
        });
      } catch (e) { }
      g.remove();
    });
    harita.forEach(function (s, el) { el.setAttribute('style', s + (el.getAttribute('style') || '')); });
  }

  /* ---------- Soru dosyası ---------- */
  function secenekler(kap) {
    var adaylar = kap.querySelectorAll('.opt > *, .secenekler > *, .siklar > *, .cevap-option, .sik, li, label'), m = {};
    Array.prototype.forEach.call(adaylar, function (e) {
      var t = e.textContent.replace(/\s+/g, ' ').trim(), r = t.match(/^\(?([A-Ea-e])[\)\.\:]\s*(.+)$/);
      if (r && !m[r[1].toUpperCase()]) m[r[1].toUpperCase()] = r[2].trim();
    });
    return Object.keys(m).length >= 2 ? m : null;
  }
  function kapBul(doc) {
    var ad = ['.q', 'article', '.soru', '.question', 'section'];
    for (var i = 0; i < ad.length; i++) {
      var l = Array.prototype.filter.call(doc.querySelectorAll(ad[i]), function (k) { return secenekler(k); });
      if (l.length) return l;
    }
    return [];
  }
  function cevapAnahtari(doc) {
    var harita = {};
    Array.prototype.forEach.call(doc.querySelectorAll('table'), function (t) {
      var s = Array.prototype.map.call(t.querySelectorAll('tr'), function (tr) {
        return Array.prototype.map.call(tr.children, function (c) { return c.textContent.trim(); });
      });
      for (var i = 0; i + 1 < s.length; i++) {
        if (s[i].length > 1 && s[i].every(function (x) { return /^\d+$/.test(x); }) && s[i + 1].length === s[i].length &&
          s[i + 1].every(function (x) { return /^[A-Ea-e]$/.test(x); }))
          s[i].forEach(function (n, j) { harita[n] = s[i + 1][j].toUpperCase(); });
      }
    });
    return harita;
  }
  function dosyaBasligi(doc) {
    var h1 = doc.querySelector('h1');
    return ((doc.title || '').trim() || (h1 ? h1.textContent : '')).replace(/\s+/g, ' ').trim();
  }

  /* -> { sorular: [{ no, metin, siklar:{A..E}, dogru, sekil }], baslik } ; hiç soru yoksa sorular boş döner */
  function sorulariOku(metin) {
    var doc = new DOMParser().parseFromString(metin, 'text/html'), kaplar = kapBul(doc), anahtar = cevapAnahtari(doc);
    var sorular = kaplar.map(function (k, i) {
      var noEl = k.querySelector('.no'), no = ((noEl ? noEl.textContent : '').match(/\d+/) || [i + 1])[0];
      var mt = Array.prototype.filter.call(k.querySelectorAll('p'), function (p) { return !p.closest('details,.opt'); })
        .map(function (p) { return p.textContent.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
      if (!mt) { var e = k.querySelector('.soru-metni,.metin,h3,h4'); mt = e ? e.textContent.trim() : ''; }
      var dogru = ((k.dataset && k.dataset.dogru) || '').toUpperCase().slice(0, 1), ct = '';
      var cz = k.querySelector('.cz');
      if (cz) ct = cz.textContent;
      else { var d = k.querySelector('details'); if (d) { var c = d.cloneNode(true); Array.prototype.forEach.call(c.querySelectorAll('summary'), function (x) { x.remove(); }); ct = c.textContent; } }
      var m = ct.replace(/\s+/g, ' ').trim().match(/Cevap\s*:?\s*([A-Ea-e])\b/i);
      if (m && !dogru) dogru = m[1].toUpperCase();
      if (!dogru && anahtar[no]) dogru = anahtar[no];
      return { no: no, metin: mt, siklar: secenekler(k), dogru: dogru, sekil: !!k.querySelector('svg,img,canvas') };
    });
    return { sorular: sorular, baslik: dosyaBasligi(doc) };
  }

  /* ---------- Konu anlatımı dosyası ---------- */
  function sarmalMi(r) {
    var els = r.children;
    if (els.length !== 1 || !/^(DIV|SECTION|ARTICLE)$/.test(els[0].tagName)) return false;
    return Array.prototype.every.call(r.childNodes, function (n) { return n.nodeType === 1 || !n.textContent.trim(); });
  }
  function sayfalaraBol(h, varsayilan) {
    var d = ayristir(h), r = d.body;
    while (sarmalMi(r)) r = r.firstElementChild;
    var bolumler = [], cur = { ad: '', dugumler: [] };
    Array.prototype.forEach.call(r.childNodes, function (n) {
      if (n.nodeType === 1 && /^H[12]$/.test(n.tagName)) {
        if (cur.dugumler.length) bolumler.push(cur);
        cur = { ad: n.textContent.replace(/\s+/g, ' ').trim(), dugumler: [n] };
      } else cur.dugumler.push(n);
    });
    bolumler.push(cur);
    return bolumler.filter(function (b) { return b.dugumler.some(function (n) { return n.nodeType === 1 || n.textContent.trim(); }); })
      .map(function (b, i) {
        var c = d.createElement('div');
        b.dugumler.forEach(function (n) { c.appendChild(n.cloneNode(true)); });
        return { ad: (b.ad || (i === 0 ? varsayilan : '') || 'Sayfa ' + (i + 1)).slice(0, 150), html: c.innerHTML };
      });
  }

  /* -> { baslik, sayfalar: [{ ad, html }] } ; bol=true ise H1/H2 başlıklarında yeni sayfa açılır */
  function notuOku(metin, bol) {
    var doc = new DOMParser().parseFromString(metin, 'text/html'), baslik = dosyaBasligi(doc);
    stilleriIsle(doc);
    var h = temizle(doc.body ? doc.body.innerHTML : metin);
    if (!ayristir(h).body.textContent.trim() && !/<(img|table)\b/i.test(h)) return { baslik: baslik, sayfalar: [] };
    return { baslik: baslik, sayfalar: bol ? sayfalaraBol(h, baslik) : [{ ad: (baslik || 'Sayfa').slice(0, 150), html: h }] };
  }

  W.Ortak = { ISARET: ISARET, temizle: temizle, hazirla: hazirla, cocuklar: cocuklar, sorulariOku: sorulariOku, notuOku: notuOku };
})(window);
