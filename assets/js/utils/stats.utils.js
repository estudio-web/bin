// =============================================================
// STATS UTILS — funciones puras, no acceden a Firestore.
// Reciben datos ya obtenidos desde los Services y los combinan.
// =============================================================

import { PURCHASE_STATUS } from "../config/constants.js";
import { getAvailableCards } from "../services/bingo.service.js";

/**
 * Calcula las estadísticas de un bingo a partir del propio
 * documento y su lista de compras.
 * @param {Object} bingo
 * @param {Object[]} purchases
 */
export function computeBingoStats(bingo, purchases = []) {
  const approved = purchases.filter((p) => p.status === PURCHASE_STATUS.APPROVED);
  const inReview = purchases.filter((p) => p.status === PURCHASE_STATUS.REVIEW);
  const rejected = purchases.filter((p) => p.status === PURCHASE_STATUS.REJECTED);

  const soldCards = approved.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const revenue = approved.reduce((sum, p) => sum + (p.amount || 0), 0);
  const uniquePlayers = new Set(approved.map((p) => p.dni)).size;

  return {
    soldCards,
    availableCards: getAvailableCards(bingo),
    totalCards: Number(bingo.totalCards) || 0,
    revenue,
    players: uniquePlayers,
    pendingReview: inReview.length,
    rejected: rejected.length,
    totalPurchases: purchases.length
  };
}
