// =============================================================
// AUTH SERVICE — Capa Services
// -------------------------------------------------------------
// Única puerta de entrada a Firebase Authentication. Cubre el
// login/registro de organizadores. Los jugadores nunca se
// autentican: acceden por enlace directo a su cartón (Módulo 6).
// =============================================================

import { auth, db } from "../config/firebase-config.js";
import { COLLECTIONS } from "../config/constants.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Registra un nuevo organizador (cuenta + perfil en Firestore).
 */
export async function registerOrganizer({ name, email, password }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: name });

  const ref = doc(db, COLLECTIONS.ORGANIZERS, credential.user.uid);
  await setDoc(ref, {
    name,
    email,
    role: "organizer",
    createdAt: serverTimestamp()
  });

  return credential.user;
}

/**
 * Inicia sesión de un organizador existente.
 */
export async function loginOrganizer({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/**
 * Cierra la sesión actual.
 */
export function logoutOrganizer() {
  return signOut(auth);
}

/**
 * Se suscribe a cambios de sesión. Devuelve función de desuscripción.
 */
export function onAuthChanged(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function ensurePlayerSession() {
  // Los jugadores entran por enlaces aleatorios de compra/sala.
  // No usamos Auth anonimo para evitar depender de un proveedor de Firebase
  // que puede estar deshabilitado en proyectos nuevos o deploys externos.
  return null;
}

/**
 * Trae el perfil extendido del organizador (nombre, email) desde Firestore.
 */
export async function getOrganizerProfile(uid) {
  const ref = doc(db, COLLECTIONS.ORGANIZERS, uid);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Traduce los códigos de error de Firebase Auth a mensajes en español.
 */
export function translateAuthError(error) {
  const map = {
    "auth/email-already-in-use": "Ese email ya tiene una cuenta registrada.",
    "auth/invalid-email": "El email ingresado no es válido.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/user-not-found": "No encontramos una cuenta con ese email.",
    "auth/wrong-password": "La contraseña es incorrecta.",
    "auth/invalid-credential": "Email o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos. Probá de nuevo en unos minutos."
  };
  return map[error?.code] || "Ocurrió un error inesperado. Probá de nuevo.";
}
