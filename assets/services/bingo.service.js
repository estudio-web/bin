// =============================================================
// BINGO SERVICE — Capa Services
// -------------------------------------------------------------
// Única puerta de entrada a la colección `bingos`. Ninguna
// página debe importar Firestore directamente: siempre pasa
// por las funciones exportadas acá.
// =============================================================

import { db } from "../config/firebase-config.js";
import { COLLECTIONS, BINGO_STATUS } from "../config/constants.js";
import { generateId } from "../utils/format.utils.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Obtiene un bingo por su ID.
 * @param {string} bingoId
 * @returns {Promise<Object|null>}
 */
export async function getBingoById(bingoId) {
  if (!bingoId) return null;
  const ref = doc(db, COLLECTIONS.BINGOS, bingoId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Suscribe a cambios en tiempo real de un bingo (usado en la
 * landing para reflejar stock de cartones sin recargar, y en
 * la sala del jugador para el estado del sorteo).
 * @returns {Function} unsubscribe
 */
export function subscribeToBingo(bingoId, callback) {
  const ref = doc(db, COLLECTIONS.BINGOS, bingoId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback({ id: snap.id, ...snap.data() });
  });
}

/**
 * Lista los bingos de un organizador (Panel del organizador).
 */
function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => {
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0;
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0;
    return bTime - aTime;
  });
}

export async function getBingosByOrganizer(organizerId) {
  const bingosRef = collection(db, COLLECTIONS.BINGOS);
  const q = query(bingosRef, where("organizerId", "==", organizerId));
  const snap = await getDocs(q);
  return sortByCreatedAtDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

/**
 * Crea un nuevo bingo en estado "published".
 * @param {Object} data
 * @param {string} data.organizerId
 * @param {string} data.name
 * @param {string} data.description
 * @param {string} data.prizes
 * @param {string} data.eventDate  ISO string
 * @param {number} data.cardPrice
 * @param {number} data.totalCards
 * @param {string} data.organizerName
 * @param {string} data.cbu
 * @param {string} data.alias
 * @param {string} [data.youtubeUrl]
 * @param {string} [data.logoUrl]
 * @returns {Promise<string>} id del bingo creado
 */
export async function createBingo(data) {
  const id = generateId("bingo");
  const sessionId = generateId("session");
  const ref = doc(db, COLLECTIONS.BINGOS, id);
  await setDoc(ref, {
    organizerId: data.organizerId,
    name: data.name,
    description: data.description || "",
    prizes: data.prizes || "",
    prizeByType: {
      terna: data.prizeByType?.terna || "",
      linea: data.prizeByType?.linea || "",
      bingo: data.prizeByType?.bingo || ""
    },
    winnerLimits: {
      terna: Number(data.winnerLimits?.terna ?? 1),
      linea: Number(data.winnerLimits?.linea ?? 1),
      bingo: Number(data.winnerLimits?.bingo ?? 1)
    },
    eventDate: data.eventDate,
    cardPrice: Number(data.cardPrice) || 0,
    commissionRate: Math.min(1, Math.max(0, Number(data.commissionRate) || 0)),
    totalCards: Number(data.totalCards) || 0,
    soldCards: 0,
    reservedCards: 0,
    organizerName: data.organizerName || "",
    cbu: data.cbu || "",
    alias: data.alias || "",
    youtubeUrl: data.youtubeUrl || "",
    videoEnabled: true,
    logoUrl: data.logoUrl || "",
    status: BINGO_STATUS.PUBLISHED,
    calledBalls: [],
    currentBall: null,
    winners: { terna: [], linea: [], bingo: [] },
    currentSessionId: sessionId,
    cardSequence: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return id;
}

/**
 * Actualiza campos editables de un bingo existente.
 */
export async function updateBingo(bingoId, changes) {
  const ref = doc(db, COLLECTIONS.BINGOS, bingoId);
  await updateDoc(ref, { ...changes, updatedAt: serverTimestamp() });
}

/**
 * Reserva N cartones de forma optimista (se usa en el flujo de
 * compra antes de redirigir a la página de pago). No descuenta
 * stock definitivo: eso ocurre recién cuando el organizador
 * aprueba el comprobante (ver purchase.service.js).
 */
export async function reserveCards(bingoId, quantity) {
  const ref = doc(db, COLLECTIONS.BINGOS, bingoId);
  await updateDoc(ref, {
    reservedCards: increment(Number(quantity) || 0),
    updatedAt: serverTimestamp()
  });
}

/**
 * Cartones realmente disponibles para la venta (total - vendidos - reservados).
 */
export function getAvailableCards(bingo) {
  if (!bingo) return 0;
  const total = Number(bingo.totalCards) || 0;
  const sold = Number(bingo.soldCards) || 0;
  const reserved = Number(bingo.reservedCards) || 0;
  return Math.max(0, total - sold - reserved);
}

export function getCartonLayoutValues(card) {
  const values = card?.numbers;
  if (Array.isArray(values) && values.length === 27) {
    return Array.from({ length: 3 }, (_, rowIndex) => values.slice(rowIndex * 9, rowIndex * 9 + 9));
  }
  if (Array.isArray(values) && values.length === 9) {
    return [values.slice(0, 9)];
  }
  if (Array.isArray(values) && Array.isArray(values[0])) {
    return values;
  }
  return Array.from({ length: 3 }, () => Array(9).fill(null));
}
