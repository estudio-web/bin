// =============================================================
// PAGO PAGE — Capa UI
// -------------------------------------------------------------
// Sin acceso directo a Firestore ni a ImgBB: usa purchase.service,
// bingo.service y storage.service exclusivamente.
// =============================================================

import { getBingoById } from "../services/bingo.service.js";
import { getPurchaseById, attachReceipt, subscribeToPurchase } from "../services/purchase.service.js";
import { uploadReceiptImage, validateReceiptFile } from "../services/storage.service.js";
import { logAuditEvent } from "../services/audit.service.js";
import { ensurePlayerSession } from "../services/auth.service.js";
import { formatCurrency } from "../utils/format.utils.js";
import { showToast } from "../ui/toast.ui.js";
import { PURCHASE_STATUS } from "../config/constants.js";

const els = {
  loading: document.getElementById("loading-state"),
  empty: document.getElementById("empty-state"),
  payContent: document.getElementById("pay-content"),
  reviewContent: document.getElementById("review-content"),
  headerBingoId: document.getElementById("header-bingo-id"),
  bankBingoName: document.getElementById("bank-bingo-name"),
  bankBingoId: document.getElementById("bank-bingo-id"),
  bankOrganizer: document.getElementById("bank-organizer"),
  bankAlias: document.getElementById("bank-alias"),
  bankCbu: document.getElementById("bank-cbu"),
  bankQty: document.getElementById("bank-qty"),
  bankUnitPrice: document.getElementById("bank-unit-price"),
  bankAmount: document.getElementById("bank-amount"),
  payName: document.getElementById("pay-name"),
  payNameError: document.getElementById("pay-name-error"),
  payDni: document.getElementById("pay-dni"),
  payDniError: document.getElementById("pay-dni-error"),
  payWhatsapp: document.getElementById("pay-whatsapp"),
  payWhatsappError: document.getElementById("pay-whatsapp-error"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("receipt-input"),
  fileName: document.getElementById("file-name"),
  receiptPreview: document.getElementById("receipt-preview"),
  receiptPreviewImg: document.getElementById("receipt-preview-img"),
  receiptError: document.getElementById("receipt-error"),
  form: document.getElementById("receipt-form"),
  btnConfirmar: document.getElementById("btn-confirmar"),
  reviewIcon: document.getElementById("review-icon"),
  reviewTitle: document.getElementById("review-title"),
  reviewText: document.getElementById("review-text"),
  reviewActions: document.getElementById("review-actions"),
  reviewCta: document.getElementById("review-cta"),
  reviewCopy: document.getElementById("review-copy"),
  reviewLink: document.getElementById("review-link")
};

let currentPurchase = null;
let currentBingo = null;
let selectedFile = null;
let purchaseUnsubscribe = null;

function getPurchaseIdFromUrl() {
  return new URLSearchParams(window.location.search).get("purchase");
}

function showState(state) {
  els.loading.hidden = state !== "loading";
  els.empty.hidden = state !== "empty";
  els.payContent.hidden = state !== "pay";
  els.reviewContent.hidden = state !== "review";
}

function getSalaUrl(purchaseId) {
  const url = new URL("/pages/sala.html", window.location.origin);
  url.searchParams.set("purchase", purchaseId);
  return url.toString();
}

function isFreePurchase(purchase, bingo) {
  return purchase?.paymentMode === "free" || purchase?.source === "promotional_free" || bingo?.saleMode === "free" || Number(purchase?.amount) === 0;
}

function getSalaPurchaseId(purchase) {
  return purchase?.salaPurchaseId || purchase?.parentPurchaseId || purchase?.id;
}

function renderBankData(purchase, bingo) {
  els.headerBingoId.textContent = `#${bingo.id}`;
  els.bankBingoName.textContent = bingo.name;
  els.bankBingoId.textContent = bingo.id;
  els.bankOrganizer.textContent = bingo.organizerName || "—";
  els.bankAlias.textContent = bingo.alias || "—";
  els.bankCbu.textContent = bingo.cbu || "—";
  els.bankQty.textContent = purchase.quantity;
  els.bankUnitPrice.textContent = formatCurrency(purchase.unitPrice);
  els.bankAmount.textContent = formatCurrency(purchase.amount);

  els.payName.value = purchase.fullName || "";
  els.payDni.value = purchase.dni || "";
  els.payWhatsapp.value = purchase.whatsapp || "";
}

function setupCopyButtons() {
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = btn.dataset.copyTarget;
      const text = document.getElementById(targetId)?.textContent?.trim();
      if (!text || text === "—") return;
      try {
        await navigator.clipboard.writeText(text);
        showToast("Copiado al portapapeles");
      } catch {
        showToast("No pudimos copiar automáticamente", { type: "error" });
      }
    });
  });
}

function setupDropzone() {
  els.dropzone.addEventListener("click", () => els.fileInput.click());

  els.dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropzone.classList.add("is-dragover");
  });

  els.dropzone.addEventListener("dragleave", () => {
    els.dropzone.classList.remove("is-dragover");
  });

  els.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("is-dragover");
    if (e.dataTransfer.files?.[0]) handleFileSelected(e.dataTransfer.files[0]);
  });

  els.fileInput.addEventListener("change", () => {
    if (els.fileInput.files?.[0]) handleFileSelected(els.fileInput.files[0]);
  });
}

function handleFileSelected(file) {
  const error = validateReceiptFile(file);
  if (error) {
    els.receiptError.textContent = error;
    selectedFile = null;
    els.receiptPreview.hidden = true;
    return;
  }

  els.receiptError.textContent = "";
  selectedFile = file;
  els.fileName.textContent = file.name;

  const reader = new FileReader();
  reader.onload = () => {
    els.receiptPreviewImg.src = reader.result;
    els.receiptPreview.hidden = false;
  };
  reader.readAsDataURL(file);
}

function validateForm() {
  let valid = true;

  if (els.payName.value.trim().length < 3) {
    els.payNameError.textContent = "Ingresá tu nombre completo.";
    valid = false;
  } else {
    els.payNameError.textContent = "";
  }

  const dni = els.payDni.value.trim().replace(/\D/g, "");
  if (dni.length < 6 || dni.length > 10) {
    els.payDniError.textContent = "Ingresá un DNI válido.";
    valid = false;
  } else {
    els.payDniError.textContent = "";
  }

  const whatsapp = normalizeWhatsapp(els.payWhatsapp.value);
  if (whatsapp.length < 8 || whatsapp.length > 15) {
    els.payWhatsappError.textContent = "Ingresá un WhatsApp válido.";
    valid = false;
  } else {
    els.payWhatsappError.textContent = "";
  }

  if (!selectedFile) {
    els.receiptError.textContent = "Subí una imagen del comprobante.";
    valid = false;
  }

  return valid;
}

function normalizeWhatsapp(value) {
  return value.trim().replace(/\D/g, "");
}

function renderReviewState(purchase) {
  if (purchase.status === PURCHASE_STATUS.APPROVED) {
    const salaUrl = getSalaUrl(getSalaPurchaseId(purchase));

    els.reviewIcon.className = "review-state__icon approved";
    els.reviewIcon.textContent = "✅";
    els.reviewTitle.textContent = "¡Pago aprobado!";
    els.reviewText.textContent = `Tus ${purchase.quantity} cartón(es) ya están confirmados. Entrá a tu sala para verlos.`;
    els.reviewCta.href = salaUrl;
    els.reviewCta.hidden = false;
    els.reviewCopy.hidden = false;
    els.reviewActions.hidden = false;
    els.reviewLink.textContent = salaUrl;
    els.reviewLink.hidden = false;
  } else if (purchase.status === PURCHASE_STATUS.REJECTED) {
    els.reviewIcon.className = "review-state__icon rejected";
    els.reviewIcon.textContent = "✕";
    els.reviewTitle.textContent = "Pago rechazado";
    els.reviewText.textContent = "El organizador no pudo validar tu comprobante. Contactalo directamente para resolverlo.";
    els.reviewActions.hidden = true;
    els.reviewLink.hidden = true;
  } else {
    els.reviewIcon.className = "review-state__icon pending";
    els.reviewIcon.textContent = "⏳";
    els.reviewTitle.textContent = "Comprobante recibido";
    els.reviewText.textContent = "El organizador está revisando tu pago. Esta página se actualiza sola cuando lo confirme.";
    els.reviewActions.hidden = true;
    els.reviewLink.hidden = true;
  }
  showState("review");
}

async function handleCopyLink() {
  if (!currentPurchase?.id) return;

  try {
    await navigator.clipboard.writeText(getSalaUrl(getSalaPurchaseId(currentPurchase)));
    showToast("Enlace copiado al portapapeles");
  } catch {
    showToast("No pudimos copiar el enlace automáticamente", { type: "error" });
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validateForm() || !currentPurchase) return;

  els.btnConfirmar.disabled = true;
  els.btnConfirmar.textContent = "Subiendo comprobante...";

  try {
    const receiptUrl = await uploadReceiptImage(selectedFile);

    await attachReceipt(currentPurchase.id, {
      receiptUrl,
      fullName: els.payName.value,
      dni: els.payDni.value,
      whatsapp: normalizeWhatsapp(els.payWhatsapp.value)
    });

    await logAuditEvent({
      bingoId: currentPurchase.bingoId,
      type: "receipt_uploaded",
      detail: `${els.payName.value.trim()} subió su comprobante de pago`
    });

    watchPurchase(currentPurchase.id);
    renderReviewState({ ...currentPurchase, status: PURCHASE_STATUS.REVIEW });
  } catch (err) {
    console.error(err);
    showToast(err.message || "No pudimos confirmar tu pago. Probá de nuevo.", { type: "error" });
    els.btnConfirmar.disabled = false;
    els.btnConfirmar.textContent = "Confirmar pago";
  }
}

function watchPurchase(purchaseId) {
  if (purchaseUnsubscribe) purchaseUnsubscribe();
  purchaseUnsubscribe = subscribeToPurchase(purchaseId, (purchase) => {
    if (!purchase) return;
    currentPurchase = purchase;
    if (purchase.status !== PURCHASE_STATUS.PENDING) {
      renderReviewState(purchase);
    }
  });
}

async function init() {
  const purchaseId = getPurchaseIdFromUrl();
  if (!purchaseId) {
    showState("empty");
    return;
  }

  showState("loading");
  await ensurePlayerSession();

  const purchase = await getPurchaseById(purchaseId);
  if (!purchase) {
    showState("empty");
    return;
  }

  const bingo = await getBingoById(purchase.bingoId);
  if (!bingo) {
    showState("empty");
    return;
  }

  currentPurchase = purchase;
  currentBingo = bingo;

  if (isFreePurchase(purchase, bingo)) {
    window.location.replace(getSalaUrl(getSalaPurchaseId(purchase)));
    return;
  }

  renderBankData(purchase, bingo);
  setupCopyButtons();
  setupDropzone();
  els.reviewCopy.addEventListener("click", handleCopyLink);
  els.form.addEventListener("submit", handleSubmit);

  if (purchase.status === PURCHASE_STATUS.PENDING) {
    showState("pay");
  } else {
    watchPurchase(purchaseId);
    renderReviewState(purchase);
  }
}

window.addEventListener("beforeunload", () => purchaseUnsubscribe?.());

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    console.error(err);
    showToast("Ocurrió un error al cargar el pago", { type: "error" });
    showState("empty");
  });
});
