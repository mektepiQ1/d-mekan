import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

// Not: Firebase web apiKey gizli değildir; güvenlik Database Rules + Authentication ile sağlanır (bkz. KURULUM.md).
export const config = {
  apiKey: "AIzaSyAtqtkB4mYY7t1HCM3umVLxRC2un30_-fQ",
  authDomain: "ogrenciveyonetim.firebaseapp.com",
  databaseURL: "https://ogrenciveyonetim-default-rtdb.firebaseio.com",
  projectId: "ogrenciveyonetim",
  storageBucket: "ogrenciveyonetim.firebasestorage.app",
  messagingSenderId: "660345359561",
  appId: "1:660345359561:web:5c74d90d8624c8e4c75118",
  measurementId: "G-C7TN0GBJL3"
};
export const app = initializeApp(config);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const EMAIL_DOMAIN = 'ogrenci.local';
export const USER_RE = /^[\w.-]{3,30}$/;
export const ukey = u => u.toLowerCase().replace(/\./g, ','); // RTDB anahtarlarında '.' olamaz
export const errText = e => /permission_denied/i.test((e && (e.code + e.message)) || '') ? 'Bu işlem için yetkiniz yok.'
  : e && e.code === 'auth/email-already-in-use' ? 'Bu kullanıcı adı zaten kullanılıyor.'
  : e && e.code === 'auth/too-many-requests' ? 'Çok fazla deneme yapıldı. Lütfen biraz bekleyin.'
  : navigator.onLine ? 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' : 'İnternet bağlantısı yok.';
