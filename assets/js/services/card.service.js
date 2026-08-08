// =============================================================
// CARD SERVICE — Capa Services
// -------------------------------------------------------------
// Única puerta de entrada a la colección `cards`. Genera
// cartones clásicos (5x5, columnas B-I-N-G-O, centro libre),
// garantizando que no se repitan dentro de un mismo bingo.
// =============================================================

import { db } from "../config/firebase-config.js";
import { COLLECTIONS, CARD_RANGES } from "../config/constants.js";
import { generateId } from "../utils/format.utils.js";
import { logAuditEvent } from "./audit.service.js";
import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  runTransaction,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Genera la matriz de números de un cartón clásico 5x5.
 * El centro (fila 2, columna N) queda libre (null).
 */
export function generateCardNumbers() {
  const grid = Array.from({ length: 3 }, () => Array(9).fill(null));
  const columnCounts = [2, 2, 2, 2, 2, 2, 1, 1, 1];
  shuffle(columnCounts);

  const rowCounts = [0, 0, 0];
  const assignments = [];

  CARD_RANGES.forEach((range, colIndex) => {
    const [min, max] = range;
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    shuffle(pool);

    const needed = columnCounts[colIndex];
    const chosenNumbers = pool.slice(0, needed).sort((a, b) => a - b);
    const rowCandidates = rowCounts
      .map((count, rowIndex) => ({ rowIndex, count }))
      .sort((a, b) => a.count - b.count || a.rowIndex - b.rowIndex);

    const chosenRows = [];
    for (let i = 0; i < needed; i++) {
      const candidate = rowCandidates.shift();
      if (!candidate) break;
      chosenRows.push(candidate.rowIndex);
      rowCounts[candidate.rowIndex] += 1;
      rowCandidates.push({ rowIndex: candidate.rowIndex, count: rowCounts[candidate.rowIndex] });
      rowCandidates.sort((a, b) => a.count - b.count || a.rowIndex - b.rowIndex);
    }

    assignments.push({ colIndex, rows: chosenRows.sort((a, b) => a - b), numbers: chosenNumbers });
  });

  assignments.forEach(({ colIndex, rows, numbers }) => {
    rows.forEach((rowIndex, idx) => {
      grid[rowIndex][colIndex] = numbers[idx];
    });
  });

  return grid;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function hashGrid(grid) {
  return toGrid(grid).map((row) => row.map((v) => (v === null ? "F" : v)).join(",")).join("|");
}

export function flattenGrid(grid) {
  return Array.isArray(grid?.[0]) ? grid.flat() : grid;
}

function toGrid(values) {
  if (Array.isArray(values) && Array.isArray(values[0])) return values;
  if (Array.isArray(values) && values.length === 27) {
    return Array.from({ length: 3 }, (_, rowIndex) => values.slice(rowIndex * 9, rowIndex * 9 + 9));
  }
  return Array.from({ length: 3 }, () => Array(9).fill(null));
}

export function getCardHash(cardNumbers) {
  return hashGrid(cardNumbers);
}

function normalizeSelectedCards(selectedCards) {
  if (Array.isArray(selectedCards)) return selectedCards;
  if (selectedCards && typeof selectedCards === "object") {
    return Object.keys(selectedCards)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => selectedCards[key]);
  }
  return [];
}

function formatVisibleCardId(sequence) {
  return `A${String(sequence).padStart(5, "0")}`;
}

export function generateAvailableCardOptions({ existingHashes = [], count = 10 }) {
  const used = new Set(existingHashes || []);
  const options = [];
  const localHashes = new Set();
  const target = Math.max(0, Number(count) || 0);
  let attempts = 0;

  while (options.length < target && attempts < target * 80) {
    const numbers = generateCardNumbers();
    const hash = hashGrid(numbers);
    attempts++;
    if (used.has(hash) || localHashes.has(hash)) continue;
    localHashes.add(hash);
    options.push({ numbers, hash });
  }

  return options;
}

/**
 * Genera `quantity` cartones únicos para una compra aprobada.
 * @param {Object} params
 * @param {string} params.bingoId
 * @param {string} params.purchaseId
 * @param {string} params.ownerName
 * @param {string} params.ownerDni
 * @param {number} params.quantity
 * @returns {Promise<string[]>} IDs de los cartones creados
 */
export async function generateCardsForPurchase({ bingoId, purchaseId, playerUid = null, ownerName, ownerDni, quantity, selectedCards = [] }) {
  const bingoRef = doc(db, COLLECTIONS.BINGOS, bingoId);
  const selectedList = normalizeSelectedCards(selectedCards);
  const requested = Math.max(0, Number(quantity) || 0);

  return runTransaction(db, async (transaction) => {
    const bingoSnap = await transaction.get(bingoRef);
    const bingo = bingoSnap.exists() ? bingoSnap.data() : {};
    const existingHashes = new Set(bingo.cardHashes || []);
    const currentSequence = Number(bingo.cardSequence) || 0;
    const sessionId = bingo.currentSessionId || null;
    const newCardIds = [];
    const newHashes = [];

    for (let i = 0; i < requested; i++) {
      let grid;
      let hash;
      const selected = selectedList[i];

      if (Array.isArray(selected)) {
        grid = toGrid(selected);
        hash = hashGrid(grid);
      } else {
        let attempts = 0;
        do {
          grid = generateCardNumbers();
          hash = hashGrid(grid);
          attempts++;
        } while ((existingHashes.has(hash) || newHashes.includes(hash)) && attempts < 80);
      }

      newHashes.push(hash);
      existingHashes.add(hash);

      const visibleId = formatVisibleCardId(currentSequence + i + 1);
      const cardId = generateId("card");
      const cardRef = doc(db, COLLECTIONS.CARDS, cardId);
      transaction.set(cardRef, {
        bingoId,
        bingoSessionId: sessionId,
        purchaseId,
        playerUid: playerUid || null,
        ownerName,
        ownerDni,
        visibleId,
        numbers: flattenGrid(grid),
        markedIndexes: Array(27).fill(false),
        claims: { terna: false, linea: false, bingo: false },
        createdAt: serverTimestamp()
      });
      newCardIds.push(cardId);
    }

    transaction.update(bingoRef, {
      cardSequence: currentSequence + requested,
      cardHashes: arrayUnion(...newHashes),
      updatedAt: serverTimestamp()
    });

    return newCardIds;
  });
}

/**
 * Obtiene un cartón por ID (Sala del jugador).
 */
export async function getCardById(cardId) {
  if (!cardId) return null;
  const ref = doc(db, COLLECTIONS.CARDS, cardId);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Obtiene todos los cartones de una compra.
 */
export async function getCardsByPurchase(purchaseId) {
  const cardsRef = collection(db, COLLECTIONS.CARDS);
  const q = query(cardsRef, where("purchaseId", "==", purchaseId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Registra el reclamo de un premio hecho por el jugador desde la
 * Sala (botones Terna/Línea/Bingo). No declara ganador por sí
 * solo: queda auditado para que el organizador lo confirme
 * manualmente desde su panel.
 */
export async function claimPrize(cardId, winType) {
  const ref = doc(db, COLLECTIONS.CARDS, cardId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("El cartón no existe.");
  const card = snap.data();

  await updateDoc(ref, { [`claims.${winType}`]: true });

  await logAuditEvent({
    bingoId: card.bingoId,
    sessionId: card.bingoSessionId || null,
    type: "claim_submitted",
    detail: `${card.ownerName} reclamó ${winType.toUpperCase()} con el cartón ${card.visibleId || cardId}`,
    meta: { cardId, visibleId: card.visibleId || cardId, winType, ownerName: card.ownerName, ownerDni: card.ownerDni }
  });
}

/**
 * Cuenta los cartones vendidos de un bingo (Estadísticas).
 */
export async function countCardsByBingo(bingoId) {
  const cardsRef = collection(db, COLLECTIONS.CARDS);
  const q = query(cardsRef, where("bingoId", "==", bingoId));
  const snap = await getDocs(q);
  return snap.size;
}

export function subscribeToBingoCards(bingoId, callback) {
  const cardsRef = collection(db, COLLECTIONS.CARDS);
  const q = query(cardsRef, where("bingoId", "==", bingoId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
