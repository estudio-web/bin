// =============================================================
// PURCHASE SERVICE — Capa Services
// -------------------------------------------------------------
// Única puerta de entrada a la colección `purchases`. Cubre el
// ciclo: reserva → carga de comprobante → aprobación/rechazo.
// =============================================================

import { db } from "../config/firebase-config.js";
import { COLLECTIONS, BINGO_STATUS, PURCHASE_STATUS } from "../config/constants.js";
import { generateId } from "../utils/format.utils.js";
import { getAvailableCards } from "./bingo.service.js";
import { logAuditEvent } from "./audit.service.js";
import { flattenGrid, generateCardsForPurchase, getCardHash, getCardsByPurchase } from "./card.service.js";
import { recordSaleForApprovedPurchase } from "./finance.service.js";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
  increment,
  runTransaction,
  writeBatch,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

async function getBingoSessionId(bingoId) {
  const bingoSnap = await getDoc(doc(db, COLLECTIONS.BINGOS, bingoId));
  if (!bingoSnap.exists()) return null;
  const bingo = bingoSnap.data();
  if (bingo.currentSessionId) return bingo.currentSessionId;
  if (bingo.status === BINGO_STATUS.FINISHED) return null;

  const sessionId = generateId("session");
  try {
    await updateDoc(doc(db, COLLECTIONS.BINGOS, bingoId), {
      currentSessionId: sessionId,
      updatedAt: serverTimestamp()
    });
    return sessionId;
  } catch {
    return null;
  }
}

function filterCardsForSession(cards, sessionId) {
  if (!sessionId) return cards;
  return cards.filter((card) => card.bingoSessionId === sessionId);
}

/**
 * Crea una compra en estado "pending" y reserva los cartones
 * correspondientes en el bingo. Se llama desde la página de
 * Compra, antes de redirigir a Pago.
 *
 * @param {Object} params
 * @param {string} params.bingoId
 * @param {string} params.fullName
 * @param {string} params.dni
 * @param {number} params.quantity
 * @param {string} params.whatsapp
 * @returns {Promise<{purchaseId:string, purchase:Object}>}
 */
export async function createPurchase({ bingoId, fullName, dni, whatsapp = "", quantity, selectedCards = [], parentPurchaseId = null, salaPurchaseId = null, playerUid = null }) {
  const qty = Math.max(1, Number(quantity) || 1);
  const purchaseId = generateId("purchase");
  const bingoRef = doc(db, COLLECTIONS.BINGOS, bingoId);
  const ref = doc(db, COLLECTIONS.PURCHASES, purchaseId);
  let purchase;

  await runTransaction(db, async (transaction) => {
    const bingoSnap = await transaction.get(bingoRef);
    if (!bingoSnap.exists()) throw new Error("El bingo no existe o fue eliminado.");

    const bingo = { id: bingoSnap.id, ...bingoSnap.data() };
    if ([BINGO_STATUS.FINISHED, BINGO_STATUS.CANCELLED].includes(bingo.status)) {
      throw new Error("La venta de cartones para este bingo está cerrada.");
    }
    if (qty > getAvailableCards(bingo)) {
      throw new Error("No quedan suficientes cartones disponibles.");
    }

    const selected = Array.isArray(selectedCards) ? selectedCards.slice(0, qty) : [];
    if (selected.length !== qty) {
      throw new Error("Elegí los cartones antes de continuar al pago.");
    }

    const selectedHashes = selected.map((card) => getCardHash(card));
    const selectedCardMap = Object.fromEntries(selected.map((card, index) => [String(index), flattenGrid(card)]));
    const existingHashes = new Set(bingo.cardHashes || []);
    if (selectedHashes.some((hash) => existingHashes.has(hash))) {
      throw new Error("Uno de los cartones elegidos ya fue reservado. Elegí otro disponible.");
    }

    const unitPrice = Number(bingo.cardPrice) || 0;
    const amount = qty * unitPrice;
    purchase = {
      bingoId,
      bingoName: bingo.name,
      organizerId: bingo.organizerId,
      playerUid: playerUid || null,
      fullName: fullName.trim(),
      dni: dni.trim(),
      whatsapp: whatsapp.trim(),
      quantity: qty,
      unitPrice,
      amount,
      receiptUrl: null,
      status: PURCHASE_STATUS.PENDING,
      cardIds: [],
      parentPurchaseId: parentPurchaseId || null,
      salaPurchaseId: salaPurchaseId || parentPurchaseId || null,
      selectedCards: selectedCardMap,
      selectedCardHashes: selectedHashes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    transaction.set(ref, purchase);
    transaction.update(bingoRef, {
      reservedCards: increment(qty),
      cardHashes: arrayUnion(...selectedHashes),
      updatedAt: serverTimestamp()
    });
  });

  await logAuditEvent({
    bingoId,
    type: "purchase_created",
    detail: `${fullName.trim()} reservó ${qty} cartón(es) por ${purchase.amount}`
  });

  return { purchaseId, purchase };
}

/**
 * Obtiene una compra por ID (usado en la página de Pago).
 */
export async function getPurchaseById(purchaseId) {
  if (!purchaseId) return null;
  const ref = doc(db, COLLECTIONS.PURCHASES, purchaseId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Suscripción en tiempo real a una compra (para reflejar en
 * Pago el momento en que el organizador aprueba/rechaza).
 */
export function subscribeToPurchase(purchaseId, callback) {
  const ref = doc(db, COLLECTIONS.PURCHASES, purchaseId);
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/**
 * Adjunta el comprobante subido a ImgBB y pasa la compra a
 * revisión por parte del organizador.
 */
export async function attachReceipt(purchaseId, { receiptUrl, fullName, dni, whatsapp }) {
  const ref = doc(db, COLLECTIONS.PURCHASES, purchaseId);
  const changes = {
    receiptUrl,
    fullName: fullName.trim(),
    dni: dni.trim(),
    status: PURCHASE_STATUS.REVIEW,
    updatedAt: serverTimestamp()
  };
  if (whatsapp !== undefined) {
    changes.whatsapp = whatsapp.trim();
  }
  await updateDoc(ref, changes);
}

/**
 * Lista las compras de un bingo (Panel del organizador →
 * Ver jugadores / Ver comprobantes).
 */
function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => {
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0;
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0;
    return bTime - aTime;
  });
}

export async function getPurchasesByBingo(bingoId) {
  const purchasesRef = collection(db, COLLECTIONS.PURCHASES);
  const q = query(purchasesRef, where("bingoId", "==", bingoId));
  const snap = await getDocs(q);
  return sortByCreatedAtDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

export async function getPurchasesForSala(rootPurchase) {
  if (!rootPurchase?.bingoId || !rootPurchase?.id) return [];
  const rootId = rootPurchase.salaPurchaseId || rootPurchase.id;
  const purchases = await getPurchasesByBingo(rootPurchase.bingoId);
  return purchases.filter((purchase) => purchase.id === rootId || purchase.salaPurchaseId === rootId);
}

/**
 * Suscripción en tiempo real a todas las compras de un bingo
 * (usado en el panel del organizador).
 */
export function subscribeToBingoPurchases(bingoId, callback) {
  const purchasesRef = collection(db, COLLECTIONS.PURCHASES);
  const q = query(purchasesRef, where("bingoId", "==", bingoId));
  return onSnapshot(q, (snap) => {
    callback(sortByCreatedAtDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  });
}

/**
 * Aprueba un pago: genera los cartones únicos del jugador, pasa
 * el stock de "reservado" a "vendido" y marca la compra como
 * aprobada. Llamado desde el panel del organizador.
 */
export async function approvePurchase(purchaseId) {
  const purchase = await getPurchaseById(purchaseId);
  if (!purchase) throw new Error("La compra no existe.");
  if (purchase.status === PURCHASE_STATUS.APPROVED) return purchase;
  if (purchase.status === PURCHASE_STATUS.REJECTED) {
    throw new Error("No se puede aprobar una compra rechazada.");
  }
  if (purchase.status !== PURCHASE_STATUS.REVIEW) {
    throw new Error("La compra todavía no tiene un comprobante para revisar.");
  }

  const bingoSnap = await getDoc(doc(db, COLLECTIONS.BINGOS, purchase.bingoId));
  const bingo = bingoSnap.exists() ? { id: bingoSnap.id, ...bingoSnap.data() } : null;
  const activeSessionId = await getBingoSessionId(purchase.bingoId);
  let cardIds = Array.isArray(purchase.cardIds) ? purchase.cardIds.filter(Boolean) : [];
  if (cardIds.length === 0) {
    const existingCards = filterCardsForSession(await getCardsByPurchase(purchaseId), activeSessionId);
    cardIds = existingCards.map((card) => card.id);
  } else if (activeSessionId) {
    const existingCards = filterCardsForSession(await getCardsByPurchase(purchaseId), activeSessionId);
    cardIds = existingCards.map((card) => card.id);
  }
  if (cardIds.length === 0) {
    cardIds = await generateCardsForPurchase({
      bingoId: purchase.bingoId,
      purchaseId,
      playerUid: purchase.playerUid || null,
      ownerName: purchase.fullName,
      ownerDni: purchase.dni,
      quantity: purchase.quantity,
      selectedCards: purchase.selectedCards || []
    });
  }

  const purchaseRef = doc(db, COLLECTIONS.PURCHASES, purchaseId);
  await updateDoc(purchaseRef, {
    cardIds,
    status: PURCHASE_STATUS.APPROVED,
    updatedAt: serverTimestamp()
  });

  const bingoRef = doc(db, COLLECTIONS.BINGOS, purchase.bingoId);
  await updateDoc(bingoRef, {
    soldCards: increment(purchase.quantity),
    reservedCards: increment(-purchase.quantity),
    updatedAt: serverTimestamp()
  });

  try {
    await recordSaleForApprovedPurchase({ ...purchase, id: purchaseId, status: PURCHASE_STATUS.APPROVED }, bingo);
  } catch (saleErr) {
    console.warn("No se pudo registrar la venta/comision:", saleErr);
  }

  try {
    await logAuditEvent({
      bingoId: purchase.bingoId,
      sessionId: activeSessionId,
      type: "payment_approved",
      detail: `Pago aprobado de ${purchase.fullName} (${purchase.quantity} cartón/es)`
    });
  } catch (auditErr) {
    console.warn("No se pudo registrar la auditoría del pago aprobado:", auditErr);
  }

  return { ...purchase, status: PURCHASE_STATUS.APPROVED, cardIds };
}

export async function ensurePurchaseCards(purchaseId) {
  const purchase = await getPurchaseById(purchaseId);
  if (!purchase || purchase.status !== PURCHASE_STATUS.APPROVED) return purchase;

  const activeSessionId = await getBingoSessionId(purchase.bingoId);
  const existingCards = filterCardsForSession(await getCardsByPurchase(purchaseId), activeSessionId);
  if (existingCards.length > 0) return { ...purchase, cardIds: existingCards.map((card) => card.id) };

  const cardIds = await generateCardsForPurchase({
    bingoId: purchase.bingoId,
    purchaseId,
    playerUid: purchase.playerUid || null,
    ownerName: purchase.fullName,
    ownerDni: purchase.dni,
    quantity: purchase.quantity,
    selectedCards: purchase.selectedCards || []
  });

  try {
    const purchaseRef = doc(db, COLLECTIONS.PURCHASES, purchaseId);
    await updateDoc(purchaseRef, {
      cardIds,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("No se pudieron vincular los cartones a la compra:", err);
  }

  return { ...purchase, cardIds };
}

/**
 * Rechaza un pago: libera el stock reservado y marca la compra
 * como rechazada. No genera cartones.
 */
export async function rejectPurchase(purchaseId, reason = "") {
  const purchase = await getPurchaseById(purchaseId);
  if (!purchase) throw new Error("La compra no existe.");
  if (purchase.status === PURCHASE_STATUS.REJECTED) return purchase;
  if (purchase.status === PURCHASE_STATUS.APPROVED) {
    throw new Error("No se puede rechazar una compra aprobada.");
  }

  const purchaseRef = doc(db, COLLECTIONS.PURCHASES, purchaseId);
  await updateDoc(purchaseRef, {
    status: PURCHASE_STATUS.REJECTED,
    rejectionReason: reason,
    updatedAt: serverTimestamp()
  });

  const bingoRef = doc(db, COLLECTIONS.BINGOS, purchase.bingoId);
  const bingoUpdates = {
    reservedCards: increment(-purchase.quantity),
    updatedAt: serverTimestamp()
  };
  if (Array.isArray(purchase.selectedCardHashes) && purchase.selectedCardHashes.length > 0) {
    bingoUpdates.cardHashes = arrayRemove(...purchase.selectedCardHashes);
  }
  await updateDoc(bingoRef, bingoUpdates);

  await logAuditEvent({
    bingoId: purchase.bingoId,
    type: "payment_rejected",
    detail: `Pago rechazado de ${purchase.fullName}${reason ? `: ${reason}` : ""}`
  });

  return { ...purchase, status: PURCHASE_STATUS.REJECTED };
}

export async function deletePurchaseWithCards(purchaseId) {
  const purchase = await getPurchaseById(purchaseId);
  if (!purchase) throw new Error("La compra no existe.");

  const cards = await getCardsByPurchase(purchaseId);
  const batch = writeBatch(db);

  cards.forEach((card) => {
    batch.delete(doc(db, COLLECTIONS.CARDS, card.id));
  });

  batch.delete(doc(db, COLLECTIONS.PURCHASES, purchaseId));

  const bingoUpdates = { updatedAt: serverTimestamp() };
  const quantity = Number(purchase.quantity) || 0;
  if (purchase.status === PURCHASE_STATUS.APPROVED) {
    bingoUpdates.soldCards = increment(-quantity);
  } else if (purchase.status === PURCHASE_STATUS.PENDING || purchase.status === PURCHASE_STATUS.REVIEW) {
    bingoUpdates.reservedCards = increment(-quantity);
  }
  if (Array.isArray(purchase.selectedCardHashes) && purchase.selectedCardHashes.length > 0) {
    bingoUpdates.cardHashes = arrayRemove(...purchase.selectedCardHashes);
  }

  if (quantity > 0 && (bingoUpdates.soldCards || bingoUpdates.reservedCards)) {
    batch.update(doc(db, COLLECTIONS.BINGOS, purchase.bingoId), bingoUpdates);
  }

  await batch.commit();

  await logAuditEvent({
    bingoId: purchase.bingoId,
    type: "purchase_deleted",
    detail: `Compra eliminada de ${purchase.fullName} (${purchase.quantity} cartón/es)`
  });

  return purchase;
}
