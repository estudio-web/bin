// =============================================================
// COMPRA PAGE — Capa UI
// -------------------------------------------------------------
// Sin acceso directo a Firestore: usa bingo.service y
// purchase.service exclusivamente.
// =============================================================

import { subscribeToBingo, getAvailableCards } from "../services/bingo.service.js";
import { createFreePurchase, createPurchase, getPurchaseById } from "../services/purchase.service.js";
import { generateAvailableCardOptions } from "../services/card.service.js";
import { ensurePlayerSession } from "../services/auth.service.js";
import { formatCurrency, formatDate, formatTime } from "../utils/format.utils.js";
import { showToast } from "../ui/toast.ui.js";

const els = {
  loading: document.getElementById("loading-state"),
  empty: document.getElementById("empty-state"),
  content: document.getElementById("flow-content"),
  btnVolver: document.getElementById("btn-volver"),
  paymentStep: document.getElementById("payment-step"),
  purchaseTitle: document.getElementById("purchase-title"),
  purchaseHint: document.getElementById("purchase-hint"),
  qtyInput: document.getElementById("qty-input"),
  qtyMinus: document.getElementById("qty-minus"),
  qtyPlus: document.getElementById("qty-plus"),
  qtyError: document.getElementById("qty-error"),
  cardsGrid: document.getElementById("available-cards-grid"),
  cardsPrev: document.getElementById("cards-prev"),
  cardsNext: document.getElementById("cards-next"),
  cardsPageLabel: document.getElementById("cards-page-label"),
  cardsError: document.getElementById("cards-error"),
  selectedCardsCount: document.getElementById("selected-cards-count"),
  fullName: document.getElementById("full-name"),
  nameError: document.getElementById("name-error"),
  dni: document.getElementById("dni"),
  dniError: document.getElementById("dni-error"),
  whatsapp: document.getElementById("whatsapp"),
  whatsappField: document.getElementById("whatsapp-field"),
  whatsappError: document.getElementById("whatsapp-error"),
  form: document.getElementById("purchase-form"),
  btnContinuar: document.getElementById("btn-continuar"),
  summaryName: document.getElementById("summary-bingo-name"),
  summaryDate: document.getElementById("summary-bingo-date"),
  summaryUnitLabel: document.getElementById("summary-unit-label"),
  summaryUnitPrice: document.getElementById("summary-unit-price"),
  summaryQty: document.getElementById("summary-qty"),
  summaryAvailable: document.getElementById("summary-available"),
  summaryTotalLabel: document.getElementById("summary-total-label"),
  summaryTotal: document.getElementById("summary-total")
};

let currentBingo = null;
let appendToPurchase = null;
let cardOptions = [];
let selectedCards = new Map();
let cardsPage = 0;
let lastCardHashSignature = "";
let lastAvailableCount = -1;
const CARDS_PER_PAGE = 10;

function getBingoIdFromUrl() {
  return new URLSearchParams(window.location.search).get("bingo");
}

function getAppendToPurchaseIdFromUrl() {
  return new URLSearchParams(window.location.search).get("appendTo");
}

function showState(state) {
  els.loading.hidden = state !== "loading";
  els.empty.hidden = state !== "empty";
  els.content.hidden = state !== "content";
}

function getAvailable() {
  return currentBingo ? getAvailableCards(currentBingo) : 0;
}

function isFreeBingo() {
  return currentBingo?.saleMode === "free" || Number(currentBingo?.cardPrice) === 0;
}

function getMaxQuantity() {
  const available = getAvailable();
  const freeLimit = isFreeBingo() ? Math.max(1, Number(currentBingo.freeCardsPerPerson) || 1) : available;
  return Math.max(0, Math.min(available, freeLimit));
}

function clampQuantity() {
  const max = getMaxQuantity();
  let qty = parseInt(els.qtyInput.value, 10);
  if (Number.isNaN(qty) || qty < 1) qty = 1;
  if (max > 0 && qty > max) qty = max;
  els.qtyInput.value = qty;
  return qty;
}

function buildCardOptions() {
  const available = getAvailable();
  cardOptions = generateAvailableCardOptions({
    existingHashes: currentBingo?.cardHashes || [],
    count: available
  });

  const availableHashes = new Set(cardOptions.map((card) => card.hash));
  selectedCards = new Map([...selectedCards].filter(([hash]) => availableHashes.has(hash)));
  cardsPage = Math.min(cardsPage, Math.max(0, Math.ceil(cardOptions.length / CARDS_PER_PAGE) - 1));
}

function trimSelectionToQuantity(qty) {
  while (selectedCards.size > qty) {
    const lastKey = [...selectedCards.keys()].at(-1);
    selectedCards.delete(lastKey);
  }
}

function renderCardOption(card, index) {
  const isSelected = selectedCards.has(card.hash);
  const rows = card.numbers
    .map(
      (row) => `
        <div class="mini-card__row">
          ${row.map((value) => `<span class="${value === null || value === "" ? "is-empty" : ""}">${value ?? ""}</span>`).join("")}
        </div>`
    )
    .join("");

  return `
    <button type="button" class="mini-card ${isSelected ? "is-selected" : ""}" data-hash="${card.hash}">
      <span class="mini-card__title">Cartón ${index + 1}</span>
      <span class="mini-card__grid">${rows}</span>
    </button>
  `;
}

function renderCardPicker() {
  const qty = clampQuantity();
  trimSelectionToQuantity(qty);

  const pageCount = Math.max(1, Math.ceil(cardOptions.length / CARDS_PER_PAGE));
  cardsPage = Math.min(cardsPage, pageCount - 1);
  const start = cardsPage * CARDS_PER_PAGE;
  const pageCards = cardOptions.slice(start, start + CARDS_PER_PAGE);

  els.cardsGrid.innerHTML = pageCards
    .map((card, idx) => renderCardOption(card, start + idx))
    .join("");

  els.cardsPageLabel.textContent = cardOptions.length > 0
    ? `${start + 1}-${Math.min(start + CARDS_PER_PAGE, cardOptions.length)} de ${cardOptions.length}`
    : "0 disponibles";
  els.cardsPrev.disabled = cardsPage === 0;
  els.cardsNext.disabled = cardsPage >= pageCount - 1;
  els.selectedCardsCount.textContent = `${selectedCards.size} de ${qty} seleccionados`;
  els.cardsError.textContent = selectedCards.size < qty ? `Elegí ${qty} cartón(es) para continuar.` : "";

  els.cardsGrid.querySelectorAll("[data-hash]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = cardOptions.find((item) => item.hash === btn.dataset.hash);
      if (!card) return;
      if (selectedCards.has(card.hash)) {
        selectedCards.delete(card.hash);
      } else if (selectedCards.size < qty) {
        selectedCards.set(card.hash, card.numbers);
      } else {
        showToast(`Ya elegiste ${qty} cartón(es).`, { type: "error" });
      }
      renderSummary();
    });
  });
}

function renderSummary() {
  if (!currentBingo) return;
  const available = getAvailable();
  const max = getMaxQuantity();
  const qty = clampQuantity();
  const total = qty * (Number(currentBingo.cardPrice) || 0);
  const free = isFreeBingo();

  els.summaryName.textContent = currentBingo.name;
  els.summaryDate.textContent = `${formatDate(currentBingo.eventDate)} · ${formatTime(currentBingo.eventDate)}`;
  els.summaryUnitLabel.textContent = free ? "Tipo de acceso" : "Precio por carton";
  els.summaryUnitPrice.textContent = free ? "Gratis" : formatCurrency(currentBingo.cardPrice);
  els.summaryQty.textContent = qty;
  els.summaryAvailable.textContent = available;
  els.summaryTotalLabel.textContent = free ? "Total a pagar" : "Importe total";
  els.summaryTotal.textContent = free ? "$0" : formatCurrency(total);

  els.qtyError.textContent = available === 0 ? "No quedan cartones disponibles." : "";
  els.qtyInput.max = max || 1;
  els.qtyMinus.disabled = qty <= 1;
  els.qtyPlus.disabled = max <= 0 || qty >= max;
  renderCardPicker();
  els.btnContinuar.disabled = available === 0 || selectedCards.size !== qty;
}

function renderAccessMode() {
  const free = isFreeBingo();
  els.paymentStep.hidden = free;
  els.whatsappField.hidden = free;
  els.whatsapp.required = !free;
  els.purchaseTitle.textContent = free ? "Elegi tus cartones gratuitos" : "Cuantos cartones queres?";
  els.purchaseHint.textContent = free
    ? `Ingresa tu nombre y DNI. El organizador permite hasta ${Math.max(1, Number(currentBingo.freeCardsPerPerson) || 1)} carton(es) gratis por persona.`
    : "Cada carton es unico y se genera automaticamente al confirmar tu pago.";
  els.btnContinuar.textContent = free ? "Entrar a la sala gratis ->" : "Continuar al pago ->";
}

function renderBingo(bingo) {
  currentBingo = bingo;
  els.btnVolver.href = `../index.html?bingo=${encodeURIComponent(bingo.id)}`;
  const hashSignature = (bingo.cardHashes || []).join("|");
  const available = getAvailable();
  if (hashSignature !== lastCardHashSignature || available !== lastAvailableCount || cardOptions.length === 0) {
    lastCardHashSignature = hashSignature;
    lastAvailableCount = available;
    buildCardOptions();
  }
  renderAccessMode();
  renderSummary();
  showState("content");
}

function prefillBuyerFromPurchase(purchase) {
  if (!purchase) return;
  els.fullName.value = purchase.fullName || "";
  els.dni.value = purchase.dni || "";
  els.whatsapp.value = purchase.whatsapp || "";
}

function validateForm() {
  let valid = true;

  const name = els.fullName.value.trim();
  if (name.length < 3) {
    els.nameError.textContent = "Ingresá tu nombre completo.";
    valid = false;
  } else {
    els.nameError.textContent = "";
  }

  const dni = els.dni.value.trim().replace(/\D/g, "");
  if (dni.length < 6 || dni.length > 10) {
    els.dniError.textContent = "Ingresá un DNI válido.";
    valid = false;
  } else {
    els.dniError.textContent = "";
  }

  const whatsapp = normalizeWhatsapp(els.whatsapp.value);
  if (!isFreeBingo() && (whatsapp.length < 8 || whatsapp.length > 15)) {
    els.whatsappError.textContent = "Ingresá un WhatsApp válido.";
    valid = false;
  } else {
    els.whatsappError.textContent = "";
  }

  if (getAvailable() === 0) {
    valid = false;
  }

  const quantity = clampQuantity();
  if (selectedCards.size !== quantity) {
    els.cardsError.textContent = `Elegí ${quantity} cartón(es) para continuar.`;
    valid = false;
  } else {
    els.cardsError.textContent = "";
  }

  return valid;
}

function normalizeWhatsapp(value) {
  return value.trim().replace(/\D/g, "");
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validateForm() || !currentBingo) return;

  const quantity = clampQuantity();
  const fullName = els.fullName.value.trim();
  const dni = els.dni.value.trim().replace(/\D/g, "");
  const whatsapp = normalizeWhatsapp(els.whatsapp.value);

  els.btnContinuar.disabled = true;
  els.btnContinuar.textContent = "Procesando...";

  try {
    const player = await ensurePlayerSession();
    const createFn = isFreeBingo() ? createFreePurchase : createPurchase;
    const { purchaseId } = await createFn({
      bingoId: currentBingo.id,
      fullName,
      dni,
      whatsapp,
      quantity,
      selectedCards: [...selectedCards.values()],
      parentPurchaseId: appendToPurchase?.id || null,
      salaPurchaseId: appendToPurchase?.salaPurchaseId || appendToPurchase?.id || null,
      playerUid: appendToPurchase?.playerUid || player?.uid || null
    });

    window.location.href = isFreeBingo()
      ? `sala.html?purchase=${encodeURIComponent(purchaseId)}`
      : `pago.html?purchase=${encodeURIComponent(purchaseId)}`;
  } catch (err) {
    console.error(err);
    showToast(err.message || "No pudimos procesar tu reserva. Probá de nuevo.", { type: "error" });
    els.btnContinuar.disabled = false;
    renderAccessMode();
  }
}

function init() {
  const bingoId = getBingoIdFromUrl();
  if (!bingoId) {
    showState("empty");
    return;
  }

  showState("loading");

  const appendToId = getAppendToPurchaseIdFromUrl();
  if (appendToId) {
    getPurchaseById(appendToId)
      .then((purchase) => {
        if (purchase?.bingoId === bingoId) {
          appendToPurchase = purchase;
          prefillBuyerFromPurchase(purchase);
        }
      })
      .catch((err) => console.warn("No se pudo precargar la compra anterior:", err));
  }

  subscribeToBingo(bingoId, (bingo) => {
    if (!bingo) {
      showState("empty");
      return;
    }
    renderBingo(bingo);
  });

  els.qtyMinus.addEventListener("click", () => {
    els.qtyInput.value = Math.max(1, (parseInt(els.qtyInput.value, 10) || 1) - 1);
    renderSummary();
  });

  els.qtyPlus.addEventListener("click", () => {
    els.qtyInput.value = Math.min(getMaxQuantity() || 1, (parseInt(els.qtyInput.value, 10) || 1) + 1);
    renderSummary();
  });

  els.qtyInput.addEventListener("input", renderSummary);
  els.cardsPrev.addEventListener("click", () => {
    cardsPage = Math.max(0, cardsPage - 1);
    renderSummary();
  });
  els.cardsNext.addEventListener("click", () => {
    cardsPage += 1;
    renderSummary();
  });
  els.form.addEventListener("submit", handleSubmit);
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    init();
  } catch (err) {
    console.error(err);
    showToast("Ocurrió un error al cargar la compra", { type: "error" });
    showState("empty");
  }
});
