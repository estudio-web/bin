// =============================================================
// FIREBASE CONFIG — Capa base (Firebase)
// -------------------------------------------------------------
// Único punto donde se inicializa Firebase. Ningún archivo de
// /pages ni de /services (salvo este) debe importar el SDK
// directamente: todos consumen las instancias exportadas aquí.
// =============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ⚠️ Reemplazar con las credenciales del proyecto Firebase real.
// Estas keys son públicas por diseño (Firebase las protege con
// las Reglas de Seguridad de Firestore/Storage, no ocultándolas).
const firebaseConfig = {
  apiKey: "AIzaSyBSzf5JDVPVciFYXhGy1yviAjVBq144LAw",
  authDomain: "bingo-73e59.firebaseapp.com",
  projectId: "bingo-73e59",
  storageBucket: "bingo-73e59.firebasestorage.app",
  messagingSenderId: "736775897533",
  appId: "1:736775897533:web:045b50a30221ef6fddd2d4"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch(() => {
  // Si el navegador bloquea storage (modo incógnito estricto),
  // Firebase cae a memoria automáticamente; no es bloqueante.
});

// =============================================================
// CONFIGURACIÓN EXTERNA (no Firebase)
// =============================================================

// ImgBB: usado por storage.service.js para subir comprobantes
// de pago sin depender de Firebase Storage (más económico y
// suficiente para el MVP).
export const IMGBB_API_KEY = "c55bcf041e7a89959416549128911fb1";
export const IMGBB_ENDPOINT = "https://api.imgbb.com/1/upload";
