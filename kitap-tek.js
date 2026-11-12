// Her rafta tek kitap gösterir; ok butonları ve kaydırma hareketiyle diğer kitaba geçilir.
(() => {
  const app = document.getElementById('app');
  if (!app) return;
  const state = new WeakMap();
  const list = rw => [...rw.querySelectorAll('.rail > .bk')];
  const shown = rw => list(rw).filter(b => !b.hasAttribute('hidden'));

  function apply(rw, dir) {
    const s = state.get(rw) || { i: 0 };
    const vis = shown(rw);
    rw.dataset.ktN = vis.length;
    if (!vis.length) return;
    s.i = Math.max(0, Math.min(s.i, vis.length - 1));
    const cur = vis[s.i];
    list(rw).forEach(b => {
      if (b !== cur) b.classList.remove('kt-sag', 'kt-sol');
      b.classList.toggle('kt-gizli', b !== cur);
    });
    if (dir) {
      cur.classList.remove('kt-sag', 'kt-sol');
      void cur.offsetWidth;
      cur.classList.add(dir > 0 ? 'kt-sag' : 'kt-sol');
    }
    const c = rw.querySelector('.kt-cnt');
    const t = (s.i + 1) + ' / ' + vis.length;
    if (c && c.textContent !== t) c.textContent = t;
    state.set(rw, s);
  }

  function step(rw, d) {
    const n = shown(rw).length;
    if (n < 2) return;
    const s = state.get(rw) || { i: 0 };
    s.i = (s.i + d + n) % n;
    state.set(rw, s);
    apply(rw, d);
  }

  function scan() {
    app.querySelectorAll('.rw').forEach(rw => {
      if (!rw.dataset.kt) {
        rw.dataset.kt = '1';
        state.set(rw, { i: 0 });
        const c = document.createElement('span');
        c.className = 'kt-cnt';
        c.setAttribute('aria-live', 'polite');
        rw.appendChild(c);
      }
      apply(rw);
    });
  }

  let raf = 0;
  new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan); })
    .observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  scan();

  // eski "kaydır" davranışının yerine kitap değiştir
  addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.rnav[data-a="rail"]');
    if (!b) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const rw = b.closest('.rw');
    if (rw) step(rw, +b.dataset.d || 1);
  }, true);

  // parmakla sağa/sola kaydırma
  let sx = 0, sy = 0, srw = null;
  app.addEventListener('touchstart', e => {
    const t = e.touches[0];
    srw = e.target.closest && e.target.closest('.rw');
    sx = t.clientX; sy = t.clientY;
  }, { passive: true });
  app.addEventListener('touchend', e => {
    if (!srw) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) step(srw, dx < 0 ? 1 : -1);
    srw = null;
  }, { passive: true });
})();
