/* sekil.js — şekil/görsel hafifletme (görünümü değiştirmez)
 *
 * YÖNETİCİ TARAFI (soruadmin / denemeadmin / konuadmin):
 *   SK.hazirla(html)   → {ham, paket}  görselleri küçültür, SVG'yi sadeleştirir, deflate+base64 paketler
 *   SK.paketle(str)    → 'z1:...'      (yalnız sıkıştırır; etkileşimli HTML için)
 * ÖĞRENCİ TARAFI (soru / deneme / konu):
 *   SK.govde(h)        → placeholder HTML; görünür olunca açılır, temizlenir, çizilir
 *   SK.tembel(el,z,cb) → öğe görünür olunca z'yi açıp cb(html) çağırır
 *   SK.temiz(h)        → önbellekli temizleyici (eski hvTemiz ile aynı kurallar)
 * Eski (paketlenmemiş) veri olduğu gibi çalışmaya devam eder.
 */
(function (g) {
  'use strict';
  const SK = g.SK = g.SK || {};
  const PRE = 'z1:';
  const enc = new TextEncoder(), dec = new TextDecoder();

  /* ───────────── 1) Güvenli temizleyici (önbellekli) ───────────── */
  const OK = new Set('svg g path circle ellipse line polyline polygon rect text tspan defs marker lineargradient radialgradient stop clippath mask pattern title desc symbol table thead tbody tfoot tr td th caption colgroup col div span p br b i u strong em sub sup small figure figcaption img'.split(' '));
  const IMG_OK = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+\/=]+$/;
  const tc = new Map();
  SK.temiz = function (h) {
    if (!h) return '';
    h = String(h);
    const hit = tc.get(h); if (hit !== undefined) return hit;
    const d = new DOMParser().parseFromString('<!doctype html><body>' + h, 'text/html');
    [...d.body.querySelectorAll('*')].forEach(e => {
      const t = e.localName.toLowerCase();
      if (!OK.has(t)) { e.remove(); return; }
      if (t === 'img' && !IMG_OK.test(e.getAttribute('src') || '')) { e.remove(); return; }
      [...e.attributes].forEach(a => {
        const n = a.name.toLowerCase(), v = a.value;
        if (n.startsWith('on') || n === 'srcset' || /javascript:/i.test(v)) e.removeAttribute(a.name);
        else if (n === 'style') { if (/url\s*\(|expression|@import|behavior|position\s*:\s*(fixed|absolute)/i.test(v)) e.removeAttribute(a.name); }
        else if (n === 'href' || n === 'xlink:href') { if (!v.trim().startsWith('#')) e.removeAttribute(a.name); }
        else if (n === 'src' && t !== 'img') e.removeAttribute(a.name);
      });
    });
    const out = d.body.innerHTML;
    if (tc.size > 120) tc.delete(tc.keys().next().value);
    tc.set(h, out);
    return out;
  };

  /* ───────────── 2) Deflate (raw) — yerel + yedek açıcı ───────────── */
  async function stream(kind, bytes) {
    const s = new (kind === 'c' ? CompressionStream : DecompressionStream)('deflate-raw');
    const w = s.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(s.readable).arrayBuffer());
  }
  /* küçük inflate (tiny-inflate algoritması): DecompressionStream olmayan eski tarayıcılar için */
  const inflateRaw = (function () {
    function Tree() { this.table = new Uint16Array(16); this.trans = new Uint16Array(288); }
    function Data(src, dest) { this.s = src; this.i = 0; this.tag = 0; this.bc = 0; this.dest = dest; this.dl = 0; this.lt = new Tree(); this.dt = new Tree(); }
    const sl = new Tree(), sd = new Tree();
    const lb = new Uint8Array(30), lbase = new Uint16Array(30), db = new Uint8Array(30), dbase = new Uint16Array(30);
    const clc = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
    const ct = new Tree(), lens = new Uint8Array(320), offs = new Uint16Array(16);
    function bb(bits, base, delta, first) { let i, sum; for (i = 0; i < delta; ++i) bits[i] = 0; for (i = 0; i < 30 - delta; ++i) bits[i + delta] = i / delta | 0; for (sum = first, i = 0; i < 30; ++i) { base[i] = sum; sum += 1 << bits[i]; } }
    function fixed(lt, dt) { let i; for (i = 0; i < 7; ++i) lt.table[i] = 0; lt.table[7] = 24; lt.table[8] = 152; lt.table[9] = 112; for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i; for (i = 0; i < 144; ++i) lt.trans[24 + i] = i; for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i; for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i; for (i = 0; i < 5; ++i) dt.table[i] = 0; dt.table[5] = 32; for (i = 0; i < 32; ++i) dt.trans[i] = i; }
    function build(t, l, off, num) { let i, sum; for (i = 0; i < 16; ++i) t.table[i] = 0; for (i = 0; i < num; ++i) t.table[l[off + i]]++; t.table[0] = 0; for (sum = 0, i = 0; i < 16; ++i) { offs[i] = sum; sum += t.table[i]; } for (i = 0; i < num; ++i) if (l[off + i]) t.trans[offs[l[off + i]]++] = i; }
    function bit(d) { if (!d.bc--) { d.tag = d.s[d.i++]; d.bc = 7; } const b = d.tag & 1; d.tag >>>= 1; return b; }
    function rb(d, num, base) { if (!num) return base; while (d.bc < 24) { d.tag |= d.s[d.i++] << d.bc; d.bc += 8; } const v = d.tag & (0xffff >>> (16 - num)); d.tag >>>= num; d.bc -= num; return v + base; }
    function sym(d, t) { while (d.bc < 24) { d.tag |= d.s[d.i++] << d.bc; d.bc += 8; } let sum = 0, cur = 0, len = 0, tag = d.tag; do { cur = 2 * cur + (tag & 1); tag >>>= 1; ++len; sum += t.table[len]; cur -= t.table[len]; } while (cur >= 0); d.tag = tag; d.bc -= len; return t.trans[sum + cur]; }
    function trees(d, lt, dt) { const hlit = rb(d, 5, 257), hdist = rb(d, 5, 1), hclen = rb(d, 4, 4); let i, num, length; for (i = 0; i < 19; ++i) lens[i] = 0; for (i = 0; i < hclen; ++i) lens[clc[i]] = rb(d, 3, 0); build(ct, lens, 0, 19); for (num = 0; num < hlit + hdist;) { const s = sym(d, ct); switch (s) { case 16: { const prev = lens[num - 1]; for (length = rb(d, 2, 3); length; --length) lens[num++] = prev; break; } case 17: for (length = rb(d, 3, 3); length; --length) lens[num++] = 0; break; case 18: for (length = rb(d, 7, 11); length; --length) lens[num++] = 0; break; default: lens[num++] = s; } } build(lt, lens, 0, hlit); build(dt, lens, hlit, hdist); }
    function block(d, lt, dt) { for (;;) { let s = sym(d, lt); if (s === 256) return 0; if (s < 256) d.dest[d.dl++] = s; else { s -= 257; const length = rb(d, lb[s], lbase[s]), dist = sym(d, dt), o = d.dl - rb(d, db[dist], dbase[dist]); for (let i = o; i < o + length; ++i) d.dest[d.dl++] = d.dest[i]; } } }
    function raw(d) { while (d.bc > 8) { d.i--; d.bc -= 8; } let length = d.s[d.i + 1]; length = 256 * length + d.s[d.i]; let inv = d.s[d.i + 3]; inv = 256 * inv + d.s[d.i + 2]; if (length !== (~inv & 0xffff)) return -4; d.i += 4; for (let i = length; i; --i) d.dest[d.dl++] = d.s[d.i++]; d.bc = 0; return 0; }
    fixed(sl, sd); bb(lb, lbase, 4, 3); bb(db, dbase, 2, 1); lb[28] = 0; lbase[28] = 258;
    return function (src, size) {
      const d = new Data(src, new Uint8Array(size)); let fin, type, res;
      do { fin = bit(d); type = rb(d, 2, 0); switch (type) { case 0: res = raw(d); break; case 1: res = block(d, sl, sd); break; case 2: trees(d, d.lt, d.dt); res = block(d, d.lt, d.dt); break; default: res = -3; } if (res !== 0) throw new Error('inflate'); } while (!fin);
      return d.dest;
    };
  })();
  SK._inflateRaw = inflateRaw;

  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  /* biçim: z1:<en/boy oranı veya 0>:<açık bayt uzunluğu>:<base64(deflate-raw)> */
  SK.paketMi = s => typeof s === 'string' && s.startsWith(PRE);
  SK.orani = function (z) { const m = /^z1:([\d.]+):/.exec(z || ''); return m ? parseFloat(m[1]) : 0; };

  SK.paketle = async function (str, oran) {
    str = String(str || '');
    if (!str || typeof CompressionStream === 'undefined') return str;
    const bytes = enc.encode(str), z = await stream('c', bytes);
    const out = PRE + (oran ? (+oran).toFixed(3) : '0') + ':' + bytes.length + ':' + b64(z);
    return out.length < str.length ? out : str;           // kazanç yoksa ham kalsın
  };
  SK.ac = async function (z) {
    if (!SK.paketMi(z)) return String(z || '');
    const p = z.split(':'), size = +p[2], data = unb64(p.slice(3).join(':'));
    let out;
    if (!SK._yedek && typeof DecompressionStream !== 'undefined') {
      try { out = await stream('d', data); } catch (e) { out = null; }
    }
    if (!out) out = inflateRaw(data, size);
    return dec.decode(out);
  };

  /* ───────────── 3) SVG sadeleştirme (görünüm aynı kalır) ───────────── */
  function ondalik(svg) {
    const m = /viewBox\s*=\s*"\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg), W = m ? Math.max(+m[1], +m[2]) : 100;
    return W >= 50 ? 3 : 5;
  }
  const SAYI = new Set('d points transform viewbox x y x1 x2 y1 y2 cx cy r rx ry width height dx dy fx fy offset opacity stroke-width stroke-dasharray stroke-dashoffset stroke-miterlimit fill-opacity stroke-opacity stop-opacity font-size letter-spacing gradienttransform patterntransform style refx refy markerwidth markerheight'.split(' '));
  function sayilar(v, dp) {
    return v.replace(/(\d*)\.(\d+)/g, (m, a, b, off, s) => {
      if (b.length <= dp) return m;
      const nx = s[off + m.length] || '';
      if (/[eE]/.test(nx)) return m;                                   // bilimsel gösterim
      const x = parseFloat(m); if (!isFinite(x)) return m;
      let o = x.toFixed(dp);
      if (nx !== '.') o = String(+o);                                  // "3.000.5" tuzağı: ardından '.' gelirse sıfırlar kalır
      return o.indexOf('e') >= 0 ? m : o;
    });
  }
  function yuvarla(tag, dp) {
    if (tag.indexOf('data:') >= 0) return tag;
    return tag.replace(/(\s)([a-zA-Z:-]+)(\s*=\s*")([^"]*)(")/g, (m, sp, n, eq, v, q) => SAYI.has(n.toLowerCase()) ? sp + n + eq + sayilar(v, dp) + q : m);
  }
  SK.sik = function (h) {
    h = String(h || '');
    h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ');
    return h.split(/(<svg\b[\s\S]*?<\/svg>)/gi).map((p, i) => {
      if (!(i % 2)) return p;
      const dp = ondalik(p);
      p = p.replace(/<[a-zA-Z][^>]*>/g, t => yuvarla(t, dp));
      return p.split(/(<text\b[\s\S]*?<\/text>)/gi).map((q, j) => j % 2 ? q : q.replace(/>\s+</g, '><')).join('');
    }).join('').trim();
  };

  /* ───────────── 4) Raster görselleri küçült (PNG→kayıpsız WebP, büyükse yeniden boyutla) ───────────── */
  const gc = new Map();
  function oku(blob) { return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); }); }
  async function kucult(url) {
    if (gc.has(url)) return gc.get(url);
    let sonuc = url;
    try {
      if (url.length > 4000) {
        const png = /^data:image\/png/i.test(url), img = new Image(); img.src = url; await img.decode();
        const W = img.naturalWidth, H = img.naturalHeight, s = Math.min(1, 1600 / Math.max(W, H));
        if (!png && s === 1) { gc.set(url, url); return url; }        // JPEG'i yeniden kodlama (ikinci kayıp olmasın); yalnız aşırı büyükse küçült
        const c = document.createElement('canvas'); c.width = Math.round(W * s); c.height = Math.round(H * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const blob = await new Promise(r => c.toBlob(r, 'image/webp', png && s === 1 ? 1 : 0.9));
        if (blob && blob.type === 'image/webp') { const u2 = await oku(blob); if (u2.length < url.length * 0.9) sonuc = u2; }
      }
    } catch (e) { }
    gc.set(url, sonuc); return sonuc;
  }
  SK.gorsel = async function (h) {
    h = String(h || '');
    const re = /(<img\b[^>]*?\bsrc=")(data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+\/=]+)(")/gi, hit = [];
    let m; while ((m = re.exec(h))) hit.push(m[2]);
    if (!hit.length) return h;
    const map = new Map(); for (const u of new Set(hit)) map.set(u, await kucult(u));
    return h.replace(re, (a, p1, u, p3) => p1 + map.get(u) + p3);
  };

  /* ───────────── 5) Yönetici: tek çağrıda hazırla ───────────── */
  function oranBul(h) {
    if ((h.match(/<svg\b/gi) || []).length !== 1 || /<(table|img|figure)\b/i.test(h)) return 0;
    const m = /<svg\b[^>]*viewBox\s*=\s*"\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(h);
    return m && +m[2] > 0 ? +m[1] / +m[2] : 0;
  }
  SK.hazirla = async function (html) {
    let ham = String(html || '');
    if (!ham) return { ham: '', paket: '' };
    try { ham = await SK.gorsel(ham); ham = SK.sik(ham); } catch (e) { }
    let paket = ham; try { paket = await SK.paketle(ham, oranBul(ham)); } catch (e) { }
    return { ham, paket };
  };

  /* ───────────── 6) Öğrenci: tembel gösterim ───────────── */
  const st = document.createElement('style');
  st.textContent = '.sk-bekle{min-height:60px}.sk-bekle>div:empty{width:100%}';
  (document.head || document.documentElement).appendChild(st);

  async function varsayilanAc(el) {
    const z = el.getAttribute('data-sk'); if (z == null) return;
    el.removeAttribute('data-sk');
    let h = ''; try { h = await SK.ac(z); } catch (e) { }
    el.classList.remove('sk-bekle'); el.innerHTML = SK.temiz(h);
  }
  const IO = 'IntersectionObserver' in g ? new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; IO.unobserve(e.target);
    const f = e.target.__sk; if (f) { e.target.__sk = null; f(); } else varsayilanAc(e.target);
  }), { rootMargin: '1200px 0px' }) : null;

  SK.tembel = function (el, z, cb) {
    const run = async () => { let h = ''; try { h = await SK.ac(z); } catch (e) { } cb(h); };
    if (!IO) { run(); return; }
    el.__sk = run; IO.observe(el);
  };
  SK.govde = function (h) {
    if (!h) return '';
    if (SK.paketMi(h)) {
      const r = SK.orani(h);
      return '<div class="soru-govde sk-bekle" data-sk="' + h + '">' + (r ? '<div style="aspect-ratio:' + r + '"></div>' : '') + '</div>';
    }
    const t = SK.temiz(h); return t ? '<div class="soru-govde">' + t + '</div>' : '';
  };
  SK.hepsiniAc = function () { return Promise.all([...document.querySelectorAll('[data-sk]')].map(varsayilanAc)); };

  let bekle = 0;
  function tara() {
    bekle = 0;
    document.querySelectorAll('[data-sk]:not([data-skw])').forEach(e => { e.setAttribute('data-skw', '1'); IO ? IO.observe(e) : varsayilanAc(e); });
  }
  function basla() { new MutationObserver(() => { if (!bekle) bekle = requestAnimationFrame(tara); }).observe(document.documentElement, { childList: true, subtree: true }); tara(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', basla); else basla();
})(window);
