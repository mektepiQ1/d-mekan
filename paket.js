'use strict';
/* Cihaz paketi: seçilen sınıfın içeriği IndexedDB'ye (cihazın kendi depolamasına) kopyalanır.
   Merkezi veritabanıyla bağı yalnızca indirme anındadır; sonrasında internet gerekmez. */

const DB_NAME = 'ogrenci-bahcesi', STORE = 'packages', VERSION = 1;
let dbp;

const open = () => dbp || (dbp = new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, VERSION);
  r.onupgradeneeded = () => {
    const s = r.result.createObjectStore(STORE, { keyPath: 'key' });
    s.createIndex('uid', 'uid');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => { dbp = null; rej(r.error); };
  r.onblocked = () => { dbp = null; rej(new Error('blocked')); };
}));

const run = async (mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && req.result);
    t.onerror = t.onabort = () => rej(t.error || new Error('idb'));
  });
};

const keyOf = (uid, cid) => `${uid}:${cid}`;
const slim = (x, extra = []) => {          // yalnızca gerekli alanlar (_fbKey vb. cihaza taşınmaz)
  const o = { id: x.id, lesson_name: x.lesson_name, link_url: x.link_url || '', created_at: x.created_at || '' };
  extra.forEach(k => { if (x[k] !== undefined) o[k] = x[k]; });
  return o;
};

export const Pkg = {
  supported: typeof indexedDB !== 'undefined',

  build(user, cls, lessons, topics) {
    const byId = (a, b) => b.id - a.id;
    const pkg = {
      v: 1,
      key: keyOf(user._fbKey || user.id, cls.id),
      uid: user._fbKey || user.id,
      class_id: cls.id,
      class: { id: cls.id, class_name: cls.class_name, created_at: cls.created_at },
      user: { username: user.username, exam: user.exam || '', education_status: user.education_status || '' },
      lessons: lessons.filter(l => l.class_id === cls.id).sort(byId).map(l => slim(l)),
      topics: topics.filter(l => l.class_id === cls.id).sort(byId).map(l => slim(l)),
      downloaded_at: new Date().toISOString(),
      bytes: 0
    };
    pkg.bytes = new Blob([JSON.stringify(pkg)]).size;
    return pkg;
  },

  get: (uid, cid) => run('readonly', s => s.get(keyOf(uid, cid))).then(r => r || null),

  async forUser(uid) {                      // bu kullanıcının en yeni paketi (çevrimdışı açılış için)
    const all = await run('readonly', s => s.index('uid').getAll(uid));
    return (all || []).sort((a, b) => String(b.downloaded_at).localeCompare(String(a.downloaded_at)))[0] || null;
  },

  save: pkg => run('readwrite', s => s.put(pkg)),

  async remove(uid) {                       // kullanıcının tüm paketlerini cihazdan siler
    const all = await run('readonly', s => s.index('uid').getAllKeys(uid));
    if (all && all.length) await run('readwrite', s => { let r; all.forEach(k => { r = s.delete(k); }); return r; });
  },

  async pruneOthers(uid, keepKey) {         // sınıf değiştiyse eski sınıfın paketi yer kaplamasın
    const keys = (await run('readonly', s => s.index('uid').getAllKeys(uid))) || [];
    const old = keys.filter(k => k !== keepKey);
    if (old.length) await run('readwrite', s => { let r; old.forEach(k => { r = s.delete(k); }); return r; });
  }
};
