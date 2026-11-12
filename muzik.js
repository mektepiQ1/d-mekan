// Arka plan müziği: giriş yapılıp kitaplar görününce (ve her dokunuşta, çalana kadar) başlar.
(() => {
  const a = document.getElementById('arkaMuzik');
  const b = document.getElementById('muzikBtn');
  if (!a || !b) return;
  const KEY = 'og-muzik';
  let want = true;
  try { want = localStorage.getItem(KEY) !== '0'; } catch {}
  a.volume = 0.35;

  const paint = () => b.setAttribute('aria-pressed', String(!a.paused));
  const broken = () => { b.hidden = true; };
  const play = () => { if (!want || !a.paused) return; a.play().then(paint, paint); };

  a.addEventListener('error', broken);
  if (a.error) broken();
  a.addEventListener('play', paint);
  a.addEventListener('pause', paint);
  a.addEventListener('playing', () => { ['pointerdown', 'touchend', 'keydown', 'click'].forEach(e => removeEventListener(e, play, true)); });

  b.addEventListener('click', e => {
    e.stopPropagation();
    if (a.paused) { want = true; a.play().then(paint, paint); } else { want = false; a.pause(); }
    try { localStorage.setItem(KEY, want ? '1' : '0'); } catch {}
  });

  // tarayıcı izin verene kadar her dokunuşta yeniden dene (giriş düğmesi de bir dokunuştur)
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(e => addEventListener(e, play, true));

  // kitaplık ekrana gelince hemen dene (giriş yapıldığında)
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => { if (app.querySelector('.lib')) play(); }).observe(app, { childList: true, subtree: true });

  document.addEventListener('visibilitychange', () => { if (document.hidden) a.pause(); else play(); });
})();
