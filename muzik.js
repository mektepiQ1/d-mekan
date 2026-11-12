// Arka plan müziği. Giriş yapılıp kitaplık görününce (ve çalana kadar her dokunuşta) başlar.
// Dosya bulunamazsa düğme görünür kalır; dokununca sebebi söyler.
(() => {
  const a = document.getElementById('arkaMuzik');
  const b = document.getElementById('muzikBtn');
  if (!a || !b) return;
  const KEY = 'og-muzik';
  const SRC = ['muzik/ai-se-eu-te-pego.mp3', 'ai-se-eu-te-pego.mp3', 'muzik.mp3'];
  let si = 0, yok = false, want = true, tip = null;
  try { want = localStorage.getItem(KEY) !== '0'; } catch {}
  a.volume = 0.35;

  const paint = () => {
    b.setAttribute('aria-pressed', String(!a.paused));
    b.classList.toggle('yok', yok);
  };
  const toast = msg => {
    if (!tip) { tip = document.createElement('div'); tip.className = 'muzik-ipucu'; tip.setAttribute('role', 'status'); document.body.appendChild(tip); }
    tip.textContent = msg; tip.classList.add('show');
    clearTimeout(tip._t); tip._t = setTimeout(() => tip.classList.remove('show'), 4500);
  };
  const next = () => {
    if (si + 1 < SRC.length) { si++; a.src = SRC[si]; a.load(); }
    else { yok = true; console.warn('[müzik] dosya yüklenemedi:', SRC.join(' | ')); paint(); }
  };
  const play = () => {
    if (!want || yok || !a.paused) return;
    a.play().then(paint, err => { if (err && err.name === 'NotSupportedError' && a.error) next(); paint(); });
  };

  a.addEventListener('error', next);
  if (a.error) next();                       // hata, script yüklenmeden önce olmuş olabilir
  a.addEventListener('play', paint);
  a.addEventListener('pause', paint);
  a.addEventListener('playing', () => { yok = false; paint(); ['pointerdown', 'touchend', 'keydown', 'click'].forEach(e => removeEventListener(e, play, true)); });

  b.addEventListener('click', e => {
    e.stopPropagation();
    if (yok) { toast('Müzik dosyası bulunamadı. Dosyayı "muzik/ai-se-eu-te-pego.mp3" yoluna ekle.'); return; }
    if (a.paused) { want = true; a.play().then(paint, () => toast('Müzik başlatılamadı. Bir kez daha dokun.')); }
    else { want = false; a.pause(); }
    try { localStorage.setItem(KEY, want ? '1' : '0'); } catch {}
  });

  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(e => addEventListener(e, play, true));

  const app = document.getElementById('app');
  if (app) new MutationObserver(() => { if (app.querySelector('.lib')) play(); }).observe(app, { childList: true, subtree: true });

  document.addEventListener('visibilitychange', () => { if (document.hidden) a.pause(); else play(); });
  paint();
})();
