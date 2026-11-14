/* Araç kapısı: geçerli oturum + cihaz anahtarı + 10 günlük doğrulama yoksa ogrenci.html'e döner. */
(function () {
  var go = function () { location.replace('ogrenci.html'); };
  var GUN = 10 * 864e5;
  try {
    var o = JSON.parse(localStorage.getItem('og-ok') || 'null'), n = Date.now();
    if (!o || !o.uid || n - o.t > GUN || n < (o.s || o.t) - 36e5) return go();
    o.s = Math.max(o.s || 0, n); localStorage.setItem('og-ok', JSON.stringify(o));
    document.documentElement.style.visibility = 'hidden';
    var r = indexedDB.open('ogrenci-bahcesi');
    r.onerror = go;
    r.onsuccess = function () {
      var d = r.result;
      try {
        if (!d.objectStoreNames.contains('keys')) { d.close(); return go(); }
        var q = d.transaction('keys').objectStore('keys').get(o.uid);
        q.onerror = function () { d.close(); go(); };
        q.onsuccess = function () { d.close(); if (q.result && q.result.key) document.documentElement.style.visibility = ''; else go(); };
      } catch (e) { go(); }
    };
  } catch (e) { go(); }
})();
