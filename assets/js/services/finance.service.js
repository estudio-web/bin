// =============================================================
// FINANCE SERVICE - Ventas y comisiones sin Cloud Functions
// =============================================================

import { db } from "../config/firebase-config.js";
import { COLLECTIONS, PURCHASE_STATUS } from "../config/constants.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const DEFAULT_COMMISSION_RATE = 0;

function saleIdForPurchase(purchaseId) {
  return `sale_${purchaseId}`;
}

function normalizeRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return DEFAULT_COMMISSION_RATE;
  return Math.min(1, Math.max(0, value));
}

export async function recordSaleForApprovedPurchase(purchase, bingo = null) {
  if (!purchase?.id || purchase.status !== PURCHASE_STATUS.APPROVED) return null;

  const ref = doc(db, COLLECTIONS.SALES, saleIdForPurchase(purchase.id));
  const existing = await getDoc(ref);
  if (existing.exists()) {
    return { id: existing.id, ...existing.data() };
  }

  const commissionRate = normalizeRate(bingo?.commissionRate ?? purchase.commissionRate);
  const grossAmount = Number(purchase.amount) || 0;
  const commissionAmount = Math.round(grossAmount * commissionRate);
  const netAmount = Math.max(0, grossAmount - commissionAmount);

  const sale = {
    purchaseId: purchase.id,
    bingoId: purchase.bingoId,
    bingoName: purchase.bingoName || bingo?.name || "",
    organizerId: purchase.organizerId || bingo?.organizerId || "",
    organizerName: bingo?.organizerName || "",
    buyerName: purchase.fullName || "",
    buyerDni: purchase.dni || "",
    buyerWhatsapp: purchase.whatsapp || "",
    quantity: Number(purchase.quantity) || 0,
    unitPrice: Number(purchase.unitPrice) || 0,
    grossAmount,
    commissionRate,
    commissionAmount,
    netAmount,
    status: "recorded",
    source: "client_approval",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(ref, sale);
  return { id: ref.id, ...sale };
}

export async function syncSalesForApprovedPurchases(purchases = [], bingo = null) {
  const approved = purchases
    .filter((purchase) => purchase?.status === PURCHASE_STATUS.APPROVED)
    .map((purchase) => recordSaleForApprovedPurchase(purchase, bingo).catch((err) => {
      console.warn("No se pudo sincronizar una venta aprobada:", err);
      return null;
    }));

  return Promise.all(approved);
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => {
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0;
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0;
    return bTime - aTime;
  });
}

export async function getSalesByOrganizer(organizerId) {
  const salesRef = collection(db, COLLECTIONS.SALES);
  const q = query(salesRef, where("organizerId", "==", organizerId));
  const snap = await getDocs(q);
  return sortByCreatedAtDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

export async function getAllSales() {
  const snap = await getDocs(collection(db, COLLECTIONS.SALES));
  return sortByCreatedAtDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

export function computeSalesSummary(sales = []) {
  return sales.reduce(
    (summary, sale) => {
      if (sale.status === "void") return summary;
      summary.salesCount += 1;
      summary.grossAmount += Number(sale.grossAmount) || 0;
      summary.commissionAmount += Number(sale.commissionAmount) || 0;
      summary.netAmount += Number(sale.netAmount) || 0;
      summary.cards += Number(sale.quantity) || 0;
      return summary;
    },
    { salesCount: 0, grossAmount: 0, commissionAmount: 0, netAmount: 0, cards: 0 }
  );
}
