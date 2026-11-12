// Arka plan müziği: ilk dokunuşta başlar, düğmeyle kapatılır/açılır; tercih hatırlanır.
(() => {
  const a = document.getElementById('arkaMuzik');
  const b = document.getElementById('muzikBtn');
  if (!a || !b) return;
  const KEY = 'og-muzik';
  let want = true;
  try { want = localStorage.getItem(KEY) !== '0'; } catch {}
  a.volume = 0.35;

  const paint = () => b.setAttribute('aria-pressed', String(!a.paused));
  const play = () => a.play().then(paint, paint);

  // dosya yoksa düğme hiç görünmesin
  a.addEventListener('error', () => { b.hidden = true; });
  a.addEventListener('loadedmetadata', () => { b.hidden = false; });
  a.addEventListener('play', paint);
  a.addEventListener('pause', paint);
  a.load();

  b.addEventListener('click', () => {
    if (a.paused) { want = true; play(); } else { want = false; a.pause(); }
    try { localStorage.setItem(KEY, want ? '1' : '0'); } catch {}
  });

  // tarayıcılar kendiliğinden ses çaldırmaz: ilk dokunuşta başlat
  const first = () => { if (want && a.paused) play(); };
  ['pointerdown', 'keydown', 'touchend'].forEach(e => addEventListener(e, first, { once: true, passive: true }));

  // sekme arka plana gidince dursun, dönünce devam etsin
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) a.pause(); else if (want) play();
  });
})();
