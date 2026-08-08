// =============================================================
// COMPRA PAGE — Capa UI
// -------------------------------------------------------------
// Sin acceso directo a Firestore: usa bingo.service y
// purchase.service exclusivamente.
// =============================================================

import { subscribeToBingo, getAvailableCards } from "../services/bingo.service.js";
import { createPurchase, getPurchaseById } from "../services/purchase.service.js";
import { generateAvailableCardOptions } from "../services/card.service.js";
import { ensurePlayerSession } from "../services/auth.service.js";
import { formatCurrency, formatDate, formatTime } from "../utils/format.utils.js";
import { showToast } from "../ui/toast.ui.js";

const els = {
  loading: document.getElementById("loading-state"),
  empty: document.getElementById("empty-state"),
  content: document.getElementById("flow-content"),
  btnVolver: document.getElementById("btn-volver"),
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
  whatsappError: document.getElementById("whatsapp-error"),
  form: document.getElementById("purchase-form"),
  btnContinuar: document.getElementById("btn-continuar"),
  summaryName: document.getElementById("summary-bingo-name"),
  summaryDate: document.getElementById("summary-bingo-date"),
  summaryUnitPrice: document.getElementById("summary-unit-price"),
  summaryQty: document.getElementById("summary-qty"),
  summaryAvailable: document.getElementById("summary-available"),
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

function clampQuantity() {
  const available = getAvailable();
  let qty = parseInt(els.qtyInput.value, 10);
  if (Number.isNaN(qty) || qty < 1) qty = 1;
  if (available > 0 && qty > available) qty = available;
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
  const qty = clampQuantity();
  const total = qty * (Number(currentBingo.cardPrice) || 0);

  els.summaryName.textContent = currentBingo.name;
  els.summaryDate.textContent = `${formatDate(currentBingo.eventDate)} · ${formatTime(currentBingo.eventDate)}`;
  els.summaryUnitPrice.textContent = formatCurrency(currentBingo.cardPrice);
  els.summaryQty.textContent = qty;
  els.summaryAvailable.textContent = available;
  els.summaryTotal.textContent = formatCurrency(total);

  els.qtyError.textContent = available === 0 ? "No quedan cartones disponibles." : "";
  renderCardPicker();
  els.btnContinuar.disabled = available === 0 || selectedCards.size !== qty;
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
  if (whatsapp.length < 8 || whatsapp.length > 15) {
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
    const { purchaseId } = await createPurchase({
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

    window.location.href = `pago.html?purchase=${encodeURIComponent(purchaseId)}`;
  } catch (err) {
    console.error(err);
    showToast(err.message || "No pudimos procesar tu reserva. Probá de nuevo.", { type: "error" });
    els.btnContinuar.disabled = false;
    els.btnContinuar.textContent = "Continuar al pago →";
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
    els.qtyInput.value = (parseInt(els.qtyInput.value, 10) || 1) + 1;
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
