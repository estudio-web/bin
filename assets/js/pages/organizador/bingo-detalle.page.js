// =============================================================
// BINGO DETALLE PAGE (Organizador) — Capa UI
// -------------------------------------------------------------
// Combina: Resumen/Estadísticas, control del Motor del bingo,
// revisión de Comprobantes, listado de Jugadores y Edición.
// Cada acción del panel (crear, editar, ver jugadores, ver
// comprobantes, aprobar, rechazar, iniciar, sacar bolillas,
// finalizar) está implementada de punta a punta.
// =============================================================

import { onAuthChanged, logoutOrganizer } from "../../services/auth.service.js";
import { subscribeToBingo, updateBingo } from "../../services/bingo.service.js";
import {
  subscribeToBingoPurchases,
  approvePurchase,
  rejectPurchase,
  ensurePurchaseCards,
  deletePurchaseWithCards
} from "../../services/purchase.service.js";
import { getCardsByPurchase, getCardById, subscribeToBingoCards } from "../../services/card.service.js";
import { startBingo, drawNextBall, addManualBall, finishBingo, declareWinner, getBallLetter, removeLastBall, resetVisibleDrawState } from "../../services/draw.service.js";
import { subscribeToAuditLog } from "../../services/audit.service.js";
import { subscribeToBingoChat, sendChatMessage, clearBingoChat } from "../../services/chat.service.js";
import { computeBingoStats } from "../../utils/stats.utils.js";
import { formatCurrency, formatDate, formatDateTimeLocalInput } from "../../utils/format.utils.js";
import { showToast } from "../../ui/toast.ui.js";
import { isAnnouncerSupported, setAnnouncerEnabled, isAnnouncerEnabled, speakBall } from "../../ui/announcer.ui.js";
import { BINGO_STATUS, PURCHASE_STATUS, TOTAL_BALLS } from "../../config/constants.js";

const els = {
  loading: document.getElementById("loading-state"),
  empty: document.getElementById("empty-state"),
  detail: document.getElementById("bingo-detail"),
  userName: document.getElementById("user-name"),
  userInitial: document.getElementById("user-initial"),
  btnLogout: document.getElementById("btn-logout"),

  status: document.getElementById("detail-status"),
  name: document.getElementById("detail-name"),
  shareLink: document.getElementById("detail-share-link"),
  btnCopyLink: document.getElementById("btn-copy-link"),
  btnVerLanding: document.getElementById("btn-ver-landing"),

  statSold: document.getElementById("stat-sold"),
  statAvailable: document.getElementById("stat-available"),
  statRevenue: document.getElementById("stat-revenue"),
  statPlayers: document.getElementById("stat-players"),
  badgeReview: document.getElementById("badge-review"),

  tabs: document.querySelectorAll(".org-tab"),
  panels: document.querySelectorAll(".tab-panel"),
  chatTab: document.querySelector('[data-tab="chat"]'),
  chatList: document.getElementById("admin-chat-list"),
  chatForm: document.getElementById("admin-chat-form"),
  chatKind: document.getElementById("admin-chat-kind"),
  chatInput: document.getElementById("admin-chat-input"),
  btnClearChat: document.getElementById("btn-clear-chat"),

  drawCurrentBall: document.getElementById("draw-current-ball"),
  drawCountLabel: document.getElementById("draw-count-label"),
  drawStatusText: document.getElementById("draw-status-text"),
  btnStartBingo: document.getElementById("btn-start-bingo"),
  btnToggleAnnouncer: document.getElementById("btn-toggle-announcer"),
  btnToggleVideo: document.getElementById("btn-toggle-video"),
  btnResetDrawState: document.getElementById("btn-reset-draw-state"),
  btnDrawBall: document.getElementById("btn-draw-ball"),
  manualBallInput: document.getElementById("manual-ball-input"),
  btnAddManualBall: document.getElementById("btn-add-manual-ball"),
  btnRemoveLastBall: document.getElementById("btn-remove-last-ball"),
  btnFinishBingo: document.getElementById("btn-finish-bingo"),
  drawHistory: document.getElementById("draw-history"),

  winnerName: document.getElementById("winner-name"),
  winnerDni: document.getElementById("winner-dni"),
  winnerType: document.getElementById("winner-type"),
  btnDeclareWinner: document.getElementById("btn-declare-winner"),
  winnersSummary: document.getElementById("winners-summary"),

  receiptsBody: document.getElementById("receipts-table-body"),
  receiptsEmpty: document.getElementById("receipts-empty"),
  playersBody: document.getElementById("players-table-body"),
  playersEmpty: document.getElementById("players-empty"),
  auditLogList: document.getElementById("audit-log-list"),

  editForm: document.getElementById("edit-form"),
  btnSaveEdit: document.getElementById("btn-save-edit"),
  eName: document.getElementById("e-name"),
  eDescription: document.getElementById("e-description"),
  ePrizes: document.getElementById("e-prizes"),
  ePrizeTerna: document.getElementById("e-prize-terna"),
  ePrizeLinea: document.getElementById("e-prize-linea"),
  ePrizeBingo: document.getElementById("e-prize-bingo"),
  eLimitTerna: document.getElementById("e-limit-terna"),
  eLimitLinea: document.getElementById("e-limit-linea"),
  eLimitBingo: document.getElementById("e-limit-bingo"),
  eDate: document.getElementById("e-date"),
  eYoutube: document.getElementById("e-youtube"),
  ePrice: document.getElementById("e-price"),
  eTotal: document.getElementById("e-total"),
  eLogo: document.getElementById("e-logo"),
  eOrganizerName: document.getElementById("e-organizer-name"),
  eAlias: document.getElementById("e-alias"),
  eCbu: document.getElementById("e-cbu")
};

let currentUser = null;
let currentBingoId = null;
let currentBingo = null;
let currentPurchases = [];
let currentCards = [];
let editFormInitialized = false;
let knownAuditLogIds = new Set();
let auditNotificationsReady = false;
let seenClaimKeys = new Set();
let knownWinnerKeys = new Set();
let automaticWinnerCheckRunning = false;
let lastAnnouncedBall = null;
let chatUnsubscribe = null;
let chatSessionKey = "";
let knownChatIds = new Set();
let chatReady = false;

function getBingoIdFromUrl() {
  return new URLSearchParams(window.location.search).get("id");
}

function showState(state) {
  els.loading.hidden = state !== "loading";
  els.empty.hidden = state !== "empty";
  els.detail.hidden = state !== "detail";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function labelForWinType(type) {
  return { terna: "Terna", linea: "Línea", bingo: "Bingo" }[type] || "Premio";
}

function isCurrentSessionItem(item) {
  const sessionId = currentBingo?.currentSessionId || null;
  if (!sessionId) return true;
  return item?.sessionId === sessionId || item?.bingoSessionId === sessionId || item?.meta?.sessionId === sessionId;
}

function getVisibleCardId(cardOrWinner) {
  return cardOrWinner?.visibleId || cardOrWinner?.cardVisibleId || cardOrWinner?.cardId || cardOrWinner?.id || "—";
}

function prizeForType(bingo, winType) {
  return bingo?.prizeByType?.[winType] || "";
}

function winnerLimitForType(bingo, winType) {
  const raw = bingo?.winnerLimits?.[winType];
  if (raw === undefined || raw === null || raw === "") return 1;
  return Math.max(0, Number(raw) || 0);
}

function winnerCountForType(bingo, winType) {
  return bingo?.winners?.[winType]?.length || 0;
}

function hasWinnerSlot(winType) {
  return winnerCountForType(currentBingo, winType) < winnerLimitForType(currentBingo, winType);
}

// ---------------- Tabs ----------------
function setupTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.tabs.forEach((t) => t.classList.remove("is-active"));
      els.panels.forEach((p) => p.classList.remove("is-active"));
      tab.classList.add("is-active");
      tab.classList.remove("has-new");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("is-active");
    });
  });
}

// ---------------- Resumen ----------------
const STATUS_LABEL = {
  [BINGO_STATUS.DRAFT]: { text: "Borrador", cls: "badge-soon" },
  [BINGO_STATUS.PUBLISHED]: { text: "Publicado", cls: "badge-soon" },
  [BINGO_STATUS.LIVE]: { text: "En vivo", cls: "badge-live" },
  [BINGO_STATUS.FINISHED]: { text: "Finalizado", cls: "badge-closed" },
  [BINGO_STATUS.CANCELLED]: { text: "Cancelado", cls: "badge-closed" }
};

function renderHeader(bingo) {
  const status = STATUS_LABEL[bingo.status] || STATUS_LABEL[BINGO_STATUS.PUBLISHED];
  els.status.className = `badge ${status.cls}`;
  els.status.textContent = status.text;
  els.name.textContent = bingo.name;

  const basePath = window.location.pathname.replace("pages/organizador/bingo.html", "");
  const shareUrl = `${window.location.origin}${basePath}index.html?bingo=${bingo.id}`;
  els.shareLink.textContent = shareUrl;
  els.btnVerLanding.href = shareUrl;
}

function renderStats(bingo, purchases) {
  const stats = computeBingoStats(bingo, purchases);
  els.statSold.textContent = stats.soldCards;
  els.statAvailable.textContent = stats.availableCards;
  els.statRevenue.textContent = formatCurrency(stats.revenue);
  els.statPlayers.textContent = stats.players;
  els.badgeReview.textContent = stats.pendingReview > 0 ? `(${stats.pendingReview})` : "";
}

function updateAnnouncerButton() {
  if (!els.btnToggleAnnouncer) return;
  els.btnToggleAnnouncer.disabled = !isAnnouncerSupported();
  els.btnToggleAnnouncer.textContent = isAnnouncerEnabled() ? "Desactivar relator" : "Activar relator";
}

function setupAnnouncer() {
  if (!els.btnToggleAnnouncer) return;
  updateAnnouncerButton();
  els.btnToggleAnnouncer.addEventListener("click", () => {
    const enabled = setAnnouncerEnabled(!isAnnouncerEnabled());
    updateAnnouncerButton();
    showToast(enabled ? "Relator activado." : "Relator desactivado.");
    if (enabled && currentBingo?.currentBall) {
      speakBall(currentBingo.currentBall);
      lastAnnouncedBall = currentBingo.currentBall;
    }
  });
}

// ---------------- Sorteo ----------------
function renderDraw(bingo) {
  const calledBalls = bingo.calledBalls || [];
  const isLive = bingo.status === BINGO_STATUS.LIVE;
  const isFinished = bingo.status === BINGO_STATUS.FINISHED;

  els.drawCurrentBall.textContent = bingo.currentBall ? `${getBallLetter(bingo.currentBall)}${bingo.currentBall}` : "--";
  if (bingo.currentBall && bingo.currentBall !== lastAnnouncedBall) {
    speakBall(bingo.currentBall);
    lastAnnouncedBall = bingo.currentBall;
  }
  els.drawCountLabel.textContent = `${calledBalls.length} de ${TOTAL_BALLS} bolillas cantadas`;

  els.btnStartBingo.hidden = isLive;
  els.btnStartBingo.textContent = isFinished ? "Iniciar nueva partida" : "Iniciar bingo";
  els.btnToggleVideo.textContent = bingo.videoEnabled === false ? "Activar video" : "Desactivar video";
  els.btnDrawBall.hidden = !isLive;
  els.manualBallInput.hidden = !isLive;
  els.btnAddManualBall.hidden = !isLive;
  els.btnFinishBingo.hidden = !isLive;
  els.btnDrawBall.disabled = calledBalls.length >= TOTAL_BALLS;
  els.btnAddManualBall.disabled = calledBalls.length >= TOTAL_BALLS;
  els.btnRemoveLastBall.disabled = calledBalls.length === 0;
  els.btnResetDrawState.disabled = calledBalls.length === 0 && !bingo.currentBall && !Object.values(bingo.winners || {}).some((items) => items?.length);

  if (isFinished) {
    els.drawStatusText.textContent = "Este bingo ya finalizó.";
  } else if (isLive) {
    els.drawStatusText.textContent = "El bingo está en vivo. Sacá bolillas cuando quieras.";
  } else {
    els.drawStatusText.textContent = "El bingo todavía no comenzó. Iniciá para habilitar la sala de jugadores.";
  }

  els.drawHistory.innerHTML = [...calledBalls]
    .sort((a, b) => b - a)
    .map((n) => `<span class="draw-chip">${getBallLetter(n)}${n}</span>`)
    .join("");

  renderWinners(bingo);
}

function renderWinners(bingo) {
  const winners = bingo.winners || { terna: [], linea: [], bingo: [] };
  const sections = ["terna", "linea", "bingo"]
    .map((type) => {
      const list = winners[type] || [];
      const limit = winnerLimitForType(bingo, type);
      if (list.length === 0) return `<p style="font-weight:600; margin-top:10px; text-transform:capitalize;">${type}: 0 de ${limit}</p>`;
      const items = list
        .map((w) => `<li>${escapeHtml(w.ownerName)} — DNI ${escapeHtml(w.ownerDni)}${w.cardVisibleId || w.cardId ? ` — Cartón ${escapeHtml(getVisibleCardId(w))}` : ""}${w.prize ? ` — Premio: ${escapeHtml(w.prize)}` : ""}</li>`)
        .join("");
      return `<p style="font-weight:600; margin-top:10px; text-transform:capitalize;">${type}: ${list.length} de ${limit}</p><ul style="margin:4px 0 0 18px; color:#4a4636;">${items}</ul>`;
    })
    .join("");
  els.winnersSummary.innerHTML = sections || "<p style='color:#6b664f;'>Todavía no hay ganadores registrados.</p>";
}

async function handleStartBingo() {
  els.btnStartBingo.disabled = true;
  try {
    await startBingo(currentBingo.id);
    showToast("¡Bingo iniciado! La sala de jugadores ya está habilitada.");
  } catch (err) {
    console.error(err);
    showToast("No pudimos iniciar el bingo.", { type: "error" });
  } finally {
    els.btnStartBingo.disabled = false;
  }
}

async function handleDrawBall() {
  els.btnDrawBall.disabled = true;
  try {
    const ball = await drawNextBall(currentBingo);
    if (ball === null) {
      showToast(`Ya se cantaron las ${TOTAL_BALLS} bolillas.`, { type: "error" });
    }
  } catch (err) {
    console.error(err);
    showToast("No pudimos sortear la bolilla.", { type: "error" });
  } finally {
    els.btnDrawBall.disabled = false;
  }
}

async function handleAddManualBall() {
  if (!currentBingo) return;
  const value = Number(els.manualBallInput.value);
  els.btnAddManualBall.disabled = true;
  try {
    await addManualBall(currentBingo, value);
    els.manualBallInput.value = "";
    showToast(`Bolilla ${value} cargada.`);
  } catch (err) {
    console.error(err);
    showToast(err.message || "No pudimos cargar la bolilla manual.", { type: "error" });
  } finally {
    els.btnAddManualBall.disabled = false;
  }
}

async function handleToggleVideo() {
  if (!currentBingo) return;
  const enabled = currentBingo.videoEnabled !== false;
  els.btnToggleVideo.disabled = true;
  try {
    await updateBingo(currentBingo.id, { videoEnabled: !enabled });
    showToast(!enabled ? "Video en vivo habilitado." : "Video en vivo deshabilitado.");
  } catch (err) {
    console.error(err);
    showToast("No pudimos cambiar el estado del video.", { type: "error" });
  } finally {
    els.btnToggleVideo.disabled = false;
  }
}

async function handleResetDrawState() {
  if (!currentBingo) return;

  const calledCount = currentBingo.calledBalls?.length || 0;
  const winnerCount = Object.values(currentBingo.winners || {}).reduce((total, items) => total + (items?.length || 0), 0);
  if (calledCount === 0 && winnerCount === 0 && !currentBingo.currentBall) {
    showToast("No hay bolillas ni ganadores visibles para limpiar.", { type: "error" });
    return;
  }

  const liveWarning = currentBingo.status === BINGO_STATUS.LIVE
    ? "\n\nEl bingo está EN VIVO. Si seguís, se corta esta partida visible y los jugadores verán todo en cero."
    : "";
  const ok = confirm(`¿Limpiar bolillas anteriores y dejar esta sala en cero?${liveWarning}\n\nLos registros históricos quedan guardados en Firebase, pero ocultos para organizador y jugadores.`);
  if (!ok) return;

  els.btnResetDrawState.disabled = true;
  try {
    await resetVisibleDrawState(currentBingo);
    knownAuditLogIds = new Set();
    auditNotificationsReady = false;
    seenClaimKeys = new Set();
    knownWinnerKeys = new Set();
    currentCards = [];
    showToast("Bolillas anteriores ocultadas. La sala quedó lista para iniciar de cero.");
  } catch (err) {
    console.error(err);
    showToast("No pudimos limpiar las bolillas anteriores.", { type: "error" });
  } finally {
    els.btnResetDrawState.disabled = false;
  }
}

async function handleRemoveLastBall() {
  if (!currentBingo) return;
  const calledBalls = currentBingo.calledBalls || [];
  if (calledBalls.length === 0) {
    showToast("No hay bolillas para borrar.", { type: "error" });
    return;
  }

  const lastBall = calledBalls[calledBalls.length - 1];
  const reason = prompt(`Motivo para borrar la bolilla ${lastBall}:`, "Presionada por error") || "";
  if (!reason.trim()) return;

  const liveWarning = currentBingo.status === BINGO_STATUS.LIVE
    ? "\n\nEl sorteo ya está en vivo: esta anulación quedará visible para los participantes en el log de la sala."
    : "";
  if (!confirm(`¿Confirmás borrar la bolilla ${lastBall}?${liveWarning}`)) return;

  els.btnRemoveLastBall.disabled = true;
  try {
    await removeLastBall(currentBingo, reason.trim());
    showToast("Bolilla anulada y registrada en logs.");
  } catch (err) {
    console.error(err);
    showToast("No pudimos borrar la bolilla.", { type: "error" });
  } finally {
    els.btnRemoveLastBall.disabled = false;
  }
}

async function handleFinishBingo() {
  if (!confirm("¿Seguro que querés finalizar este bingo? No se podrán cantar más bolillas.")) return;
  els.btnFinishBingo.disabled = true;
  try {
    await finishBingo(currentBingo);
    showToast("Bingo finalizado.");
  } catch (err) {
    console.error(err);
    showToast("No pudimos finalizar el bingo.", { type: "error" });
  } finally {
    els.btnFinishBingo.disabled = false;
  }
}

async function handleDeclareWinner() {
  const ownerName = els.winnerName.value.trim();
  const ownerDni = els.winnerDni.value.trim();
  const winType = els.winnerType.value;

  if (ownerName.length < 3 || ownerDni.length < 6) {
    showToast("Completá nombre y DNI del ganador.", { type: "error" });
    return;
  }
  if (!hasWinnerSlot(winType)) {
    showToast(`Ya se completó el cupo de ${labelForWinType(winType)}.`, { type: "error" });
    return;
  }

  els.btnDeclareWinner.disabled = true;
  try {
    await declareWinner(currentBingo.id, winType, {
      ownerName,
      ownerDni,
      sessionId: currentBingo.currentSessionId || null,
      prize: prizeForType(currentBingo, winType),
      declaredAt: new Date().toISOString()
    });
    showToast("¡Ganador registrado!");
    els.winnerName.value = "";
    els.winnerDni.value = "";
  } catch (err) {
    console.error(err);
    showToast("No pudimos registrar el ganador.", { type: "error" });
  } finally {
    els.btnDeclareWinner.disabled = false;
  }
}

// ---------------- Comprobantes ----------------
function renderReceipts(purchases) {
  const pending = purchases.filter(
    (p) => p.status === PURCHASE_STATUS.PENDING || p.status === PURCHASE_STATUS.REVIEW
  );

  els.receiptsEmpty.hidden = pending.length > 0;
  els.receiptsBody.innerHTML = pending
    .map((p) => {
      const statusCls = p.status === PURCHASE_STATUS.REVIEW ? "review" : "pending";
      const statusText = p.status === PURCHASE_STATUS.REVIEW ? "A revisar" : "Esperando comprobante";
      const receiptCell = p.receiptUrl
        ? `<a class="link-receipt" href="${p.receiptUrl}" target="_blank" rel="noopener">Ver imagen</a>`
        : "—";
      const actions =
        p.status === PURCHASE_STATUS.REVIEW
          ? `<button class="btn btn-primary btn-small" data-action="approve" data-id="${p.id}">Aprobar</button>
             <button class="btn btn-danger btn-small" data-action="reject" data-id="${p.id}">Rechazar</button>
             <button class="btn btn-ghost btn-small" data-action="delete" data-id="${p.id}">Borrar</button>`
          : `<button class="btn btn-ghost btn-small" data-action="delete" data-id="${p.id}">Borrar</button>`;

      return `
        <tr>
          <td>${escapeHtml(p.fullName)}</td>
          <td class="mono">${escapeHtml(p.dni)}</td>
          <td class="mono">${escapeHtml(p.whatsapp || "—")}</td>
          <td>${p.quantity}</td>
          <td class="mono">${formatCurrency(p.amount)}</td>
          <td>${receiptCell}</td>
          <td><span class="status-pill ${statusCls}">${statusText}</span></td>
          <td class="table-actions">${actions}</td>
        </tr>`;
    })
    .join("");

  els.receiptsBody.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleReceiptAction(btn.dataset.action, btn.dataset.id));
  });
}

async function handleReceiptAction(action, purchaseId) {
  const purchase = currentPurchases.find((item) => item.id === purchaseId);
  if (action === "delete" && purchase) {
    await handleDeletePlayer(purchase);
    return;
  }

  if (action === "reject") {
    const reason = prompt("Motivo del rechazo (opcional):") || "";
    try {
      await rejectPurchase(purchaseId, reason);
      showToast("Pago rechazado. El stock fue liberado.");
    } catch (err) {
      console.error(err);
      showToast("No pudimos rechazar el pago.", { type: "error" });
    }
    return;
  }

  try {
    await approvePurchase(purchaseId);
    showToast("Pago aprobado. Se generaron los cartones del jugador.");
  } catch (err) {
    console.error(err);
    showToast("No pudimos aprobar el pago.", { type: "error" });
  }
}

// ---------------- Jugadores ----------------
function getPlayerSalaUrl(purchase) {
  const url = new URL("/pages/sala.html", window.location.origin);
  url.searchParams.set("purchase", purchase.salaPurchaseId || purchase.parentPurchaseId || purchase.id);
  return url.toString();
}

async function handleSendPlayerLink(purchase) {
  const salaUrl = getPlayerSalaUrl(purchase);
  const whatsapp = formatWhatsappForLink(purchase.whatsapp);
  const message = `Hola ${purchase.fullName}, tu pago fue aprobado. Entrá a tu sala de bingo para ver tus cartones: ${salaUrl}`;

  if (whatsapp) {
    window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
    showToast("Abriendo WhatsApp del jugador.");
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: "Tu sala de bingo",
        text: "Ingresá a tu sala para ver tus cartones",
        url: salaUrl
      });
      showToast("Enlace compartido");
      return;
    }

    await navigator.clipboard.writeText(salaUrl);
    showToast("Enlace del jugador copiado");
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast("No pudimos compartir el enlace. Intentá copiarlo manualmente.", { type: "error" });
  }
}

function formatWhatsappForLink(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  if (digits.startsWith("54")) return digits;
  return `54${digits.replace(/^0+/, "")}`;
}

function getCardMatrix(card) {
  const values = card?.numbers;
  if (Array.isArray(values) && Array.isArray(values[0])) return values;
  if (Array.isArray(values) && values.length === 27) {
    return Array.from({ length: 3 }, (_, rowIndex) => values.slice(rowIndex * 9, rowIndex * 9 + 9));
  }
  return [];
}

function isCellMarked(value, calledSet) {
  return value !== null && value !== "" && calledSet.has(value);
}

function checkWinCondition(card, calledSet, type) {
  const grid = getCardMatrix(card);
  const numberRows = grid.map((row) => row.filter((value) => value !== null && value !== ""));

  if (type === "linea") {
    return numberRows.some((row) => row.length > 0 && row.every((value) => calledSet.has(value)));
  }
  if (type === "terna") {
    return numberRows.some((row) => row.filter((value) => calledSet.has(value)).length >= 3);
  }
  if (type === "bingo") {
    const numbers = numberRows.flat();
    return numbers.length > 0 && numbers.every((value) => calledSet.has(value));
  }
  return false;
}

function winnerKey(cardId, winType) {
  return cardId && winType ? `${cardId}:${winType}` : "";
}

function syncKnownWinnerKeys(bingo) {
  const winners = bingo?.winners || {};
  ["terna", "linea", "bingo"].forEach((type) => {
    (winners[type] || []).forEach((winner) => {
      if (winner.cardId) knownWinnerKeys.add(winnerKey(winner.cardId, type));
    });
  });
}

function isWinnerAlreadyDeclared(cardId, winType) {
  const key = winnerKey(cardId, winType);
  if (!key || knownWinnerKeys.has(key)) return true;
  const existing = currentBingo?.winners?.[winType] || [];
  return existing.some((winner) => winner.cardId === cardId);
}

function renderAdminCardPreview(card, { calledSet = new Set(), winType = "" } = {}) {
  const effectiveWinType = card.__verificationType || winType;
  const rows = getCardMatrix(card)
    .map(
      (row) => `
        <div class="admin-card-grid__row">
          ${row
            .map((value) => {
              const empty = value === null || value === "";
              const marked = !empty && calledSet.has(value);
              const cls = `${empty ? "is-empty" : ""} ${marked ? "is-marked" : ""}`.trim();
              return `<span class="${cls}">${value ?? ""}</span>`;
            })
            .join("")}
        </div>`
    )
    .join("");
  const valid = effectiveWinType ? checkWinCondition(card, calledSet, effectiveWinType) : false;
  const status = effectiveWinType
    ? `<span class="admin-card-validation-pill ${valid ? "is-valid" : "is-invalid"}">${valid ? "Válido" : "No válido"} para ${labelForWinType(effectiveWinType)}</span>`
    : "";

  return `
    <article class="admin-card-preview ${valid ? "is-valid" : ""}">
      <div class="admin-card-preview__head">
        <div>
          <div class="admin-card-preview__title">Cartón ${escapeHtml(getVisibleCardId(card))}</div>
          <p>${escapeHtml(card.ownerName || "Sin nombre")} · DNI ${escapeHtml(card.ownerDni || "—")}</p>
        </div>
        ${status}
      </div>
      <div class="admin-card-grid">${rows}</div>
    </article>`;
}

function ensureCardsModal() {
  let modal = document.getElementById("cards-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "cards-modal";
  modal.className = "cards-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="cards-modal__backdrop" data-close-cards></div>
    <section class="cards-modal__panel" role="dialog" aria-modal="true" aria-labelledby="cards-modal-title">
      <div class="cards-modal__head">
        <div>
          <h2 id="cards-modal-title">Cartones del jugador</h2>
          <p id="cards-modal-subtitle"></p>
        </div>
        <button class="btn btn-ghost btn-small" type="button" data-close-cards>Cerrar</button>
      </div>
      <div class="cards-modal__summary" id="cards-modal-summary"></div>
      <div class="cards-modal__body" id="cards-modal-body"></div>
    </section>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-cards]").forEach((el) => {
    el.addEventListener("click", () => {
      modal.hidden = true;
    });
  });
  return modal;
}

function renderCardsModal(purchase, cards, options = {}) {
  const modal = ensureCardsModal();
  const calledSet = new Set(currentBingo?.calledBalls || []);
  const title = options.title || "Cartones del jugador";
  const subtitle = options.subtitle || `${purchase.fullName} · DNI ${purchase.dni} · WhatsApp ${purchase.whatsapp || "—"} · ${cards.length} cartón(es)`;
  modal.querySelector("#cards-modal-title").textContent = title;
  modal.querySelector("#cards-modal-subtitle").textContent = subtitle;
  modal.querySelector("#cards-modal-summary").innerHTML = options.summary || "";
  modal.querySelector("#cards-modal-body").innerHTML = cards
    .map((card) => renderAdminCardPreview(card, { calledSet, winType: options.winType || "" }))
    .join("");
  modal.hidden = false;
}

async function handleViewPlayerCards(purchase) {
  try {
    await ensurePurchaseCards(purchase.id);
    const cards = (await getCardsByPurchase(purchase.id)).filter(isCurrentSessionItem);
    if (cards.length === 0) {
      showToast("Todavía no hay cartones para este jugador.", { type: "error" });
      return;
    }
    renderCardsModal(purchase, cards);
  } catch (err) {
    console.error(err);
    showToast("No pudimos cargar o generar los cartones.", { type: "error" });
  }
}

async function handleDeletePlayer(purchase) {
  const ok = confirm(`¿Borrar a ${purchase.fullName}? Se eliminarán su compra y sus cartones, y se ajustará el stock.`);
  if (!ok) return;

  try {
    await deletePurchaseWithCards(purchase.id);
    showToast("Jugador eliminado.");
  } catch (err) {
    console.error(err);
    showToast("No pudimos borrar este jugador.", { type: "error" });
  }
}

function renderPlayers(purchases) {
  const approved = purchases.filter((p) => p.status === PURCHASE_STATUS.APPROVED);
  els.playersEmpty.hidden = approved.length > 0;
  els.playersBody.innerHTML = approved
    .map(
      (p) => `
      <tr>
        <td>${escapeHtml(p.fullName)}</td>
        <td class="mono">${escapeHtml(p.dni)}</td>
        <td class="mono">${escapeHtml(p.whatsapp || "—")}</td>
        <td>${p.quantity}</td>
        <td class="mono">${formatCurrency(p.amount)}</td>
        <td>${formatDate(p.createdAt)}</td>
        <td class="table-actions">
          <button class="btn btn-small btn-ghost" data-action="view-cards" data-id="${p.id}">Ver cartones</button>
          <button class="btn btn-small btn-primary" data-action="send-link" data-id="${p.id}">Enviar WhatsApp</button>
          <button class="btn btn-small btn-danger" data-action="delete-player" data-id="${p.id}">Borrar</button>
        </td>
      </tr>`
    )
    .join("");

  els.playersBody.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const purchase = approved.find((item) => item.id === btn.dataset.id);
      if (!purchase) return;
      if (btn.dataset.action === "send-link") handleSendPlayerLink(purchase);
      if (btn.dataset.action === "view-cards") handleViewPlayerCards(purchase);
      if (btn.dataset.action === "delete-player") handleDeletePlayer(purchase);
    });
  });
}

function formatAuditTime(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Ahora";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatChatTime(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function renderChat(messages) {
  if (!els.chatList) return;
  if (!messages.length) {
    els.chatList.innerHTML = `<p class="live-chat-empty">Todavía no hay mensajes.</p>`;
    return;
  }

  els.chatList.innerHTML = messages
    .map((message) => {
      const isOrganizer = message.senderRole === "organizer";
      const isAnnouncement = message.kind === "announcement";
      return `
        <article class="live-chat-message ${isOrganizer ? "is-organizer" : ""} ${isAnnouncement ? "is-announcement" : ""}">
          <div class="live-chat-message__meta">
            <strong>${isAnnouncement ? "Aviso del organizador" : escapeHtml(message.senderName || (isOrganizer ? "Organizador" : "Jugador"))}</strong>
            <span>${formatChatTime(message.createdAt)}</span>
          </div>
          <p>${escapeHtml(message.text || "")}</p>
        </article>`;
    })
    .join("");
  els.chatList.scrollTop = els.chatList.scrollHeight;
}

function handleChatUpdate(messages) {
  renderChat(messages);
  const newPlayerMessage = messages.find((message) => {
    return !knownChatIds.has(message.id) && message.senderRole !== "organizer";
  });
  messages.forEach((message) => knownChatIds.add(message.id));

  if (!chatReady) {
    chatReady = true;
    return;
  }
  if (newPlayerMessage && !els.chatTab?.classList.contains("is-active")) {
    els.chatTab?.classList.add("has-new");
    showToast(`Nuevo mensaje de ${newPlayerMessage.senderName || "un jugador"}.`);
  }
}

function subscribeChatForBingo(bingo) {
  if (!bingo?.id) return;
  const nextKey = `${bingo.id}:${bingo.currentSessionId || ""}`;
  if (chatSessionKey === nextKey) return;
  if (chatUnsubscribe) chatUnsubscribe();
  chatSessionKey = nextKey;
  knownChatIds = new Set();
  chatReady = false;
  chatUnsubscribe = subscribeToBingoChat(bingo.id, bingo.currentSessionId || null, handleChatUpdate);
}

function setupChatForm() {
  if (!els.chatForm) return;
  els.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentBingo) return;
    const text = els.chatInput.value.trim();
    if (!text) return;

    els.chatInput.value = "";
    try {
      await sendChatMessage({
        bingoId: currentBingo.id,
        sessionId: currentBingo.currentSessionId || null,
        senderRole: "organizer",
        senderName: currentBingo.organizerName || currentUser?.displayName || "Organizador",
        text,
        kind: els.chatKind?.value || "announcement"
      });
    } catch (err) {
      console.error(err);
      showToast("No pudimos enviar el mensaje.", { type: "error" });
      els.chatInput.value = text;
    }
  });
}

function setupClearChatButton() {
  if (!els.btnClearChat) return;
  els.btnClearChat.addEventListener("click", async () => {
    if (!currentBingo) return;
    const ok = confirm("¿Limpiar el chat visible de esta partida? Los mensajes desaparecerán para todos los jugadores conectados.");
    if (!ok) return;

    els.btnClearChat.disabled = true;
    try {
      const deleted = await clearBingoChat(currentBingo.id, currentBingo.currentSessionId || null);
      knownChatIds = new Set();
      showToast(deleted > 0 ? "Chat limpiado para todos." : "El chat ya estaba vacío.");
    } catch (err) {
      console.error(err);
      showToast("No pudimos limpiar el chat.", { type: "error" });
    } finally {
      els.btnClearChat.disabled = false;
    }
  });
}

function renderAuditLog(logs) {
  if (!els.auditLogList) return;
  const visibleLogs = logs.filter(isCurrentSessionItem);
  if (!visibleLogs.length) {
    els.auditLogList.innerHTML = `<p class="audit-empty">Todavía no hay registros.</p>`;
    return;
  }

  els.auditLogList.innerHTML = visibleLogs
    .map(
      (log) => `
        <article class="audit-item">
          <span class="audit-item__time">${formatAuditTime(log.createdAt)}</span>
          <div>
            <strong>${escapeHtml(log.type || "evento")}</strong>
            <p>${escapeHtml(log.detail || "")}</p>
          </div>
        </article>`
    )
    .join("");
}

function ensureAdminClaimModal() {
  let modal = document.getElementById("admin-claim-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "admin-claim-modal";
  modal.className = "admin-claim-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="admin-claim-modal__backdrop" data-close-admin-claim></div>
    <section class="admin-claim-modal__panel" role="dialog" aria-modal="true" aria-labelledby="admin-claim-title">
      <span class="admin-claim-modal__eyebrow">Reclamo recibido</span>
      <h2 id="admin-claim-title"></h2>
      <p id="admin-claim-detail"></p>
      <div class="admin-claim-modal__actions">
        <button type="button" class="btn btn-primary" id="admin-claim-go">Ver jugadores</button>
        <button type="button" class="btn btn-ghost" data-close-admin-claim>Cerrar</button>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-admin-claim]").forEach((el) => {
    el.addEventListener("click", () => {
      modal.hidden = true;
    });
  });
  modal.querySelector("#admin-claim-go").addEventListener("click", () => {
    modal.hidden = true;
    const tab = [...els.tabs].find((item) => item.dataset.tab === "jugadores");
    tab?.click();
  });
  return modal;
}

function showAdminClaimModal(log) {
  const modal = ensureAdminClaimModal();
  const type = labelForWinType(log.meta?.winType);
  const owner = log.meta?.ownerName || "Un jugador";
  modal.querySelector("#admin-claim-title").textContent = `${owner} cantó ${type}`;
  modal.querySelector("#admin-claim-detail").textContent = log.detail || "Revisá el cartón y validá el reclamo en vivo.";
  modal.hidden = false;
}

async function declareVerifiedWinner(card, winType, source = "auto") {
  const key = winnerKey(card.id, winType);
  if (!key || isWinnerAlreadyDeclared(card.id, winType)) return false;
  if (!hasWinnerSlot(winType)) return false;

  knownWinnerKeys.add(key);
  await declareWinner(currentBingo.id, winType, {
    ownerName: card.ownerName,
    ownerDni: card.ownerDni,
    cardId: card.id,
    cardVisibleId: getVisibleCardId(card),
    sessionId: currentBingo.currentSessionId || null,
    prize: prizeForType(currentBingo, winType),
    winType,
    verified: true,
    source,
    calledBalls: currentBingo.calledBalls || [],
    declaredAt: new Date().toISOString()
  });
  return true;
}

function showVerifiedCardsModal({ title, subtitle, detail, cards, winType }) {
  const summary = `
    <div class="cards-modal-verification">
      <strong>${escapeHtml(detail)}</strong>
      <span>Verificación automática contra ${currentBingo?.calledBalls?.length || 0} bolilla(s) cantadas.</span>
    </div>`;
  renderCardsModal(
    {
      fullName: cards[0]?.ownerName || "Jugador",
      dni: cards[0]?.ownerDni || "—",
      whatsapp: ""
    },
    cards,
    { title, subtitle, summary, winType }
  );
}

async function verifyAndShowClaim({ cardId, winType, ownerName, ownerDni, detail }) {
  const card = await getCardById(cardId);
  if (!card || !currentBingo) {
    showAdminClaimModal({
      detail: detail || "No pudimos cargar el cartón reclamado.",
      meta: { cardId, winType, ownerName, ownerDni }
    });
    return;
  }

  const calledSet = new Set(currentBingo.calledBalls || []);
  const valid = checkWinCondition(card, calledSet, winType);
  if (valid) {
    await declareVerifiedWinner(card, winType, "claim");
  }

  showVerifiedCardsModal({
    title: `${card.ownerName || ownerName || "Jugador"} cantó ${labelForWinType(winType)}`,
    subtitle: `Cartón ${getVisibleCardId(card)} · DNI ${card.ownerDni || ownerDni || "—"}`,
    detail: valid
      ? `${labelForWinType(winType)} válido. El ganador quedó registrado automáticamente.`
      : `${labelForWinType(winType)} no válido todavía con las bolillas cantadas.`,
    cards: [card],
    winType
  });
}

async function verifyAndShowAutomaticWinners(cards) {
  if (!currentBingo || currentBingo.status !== BINGO_STATUS.LIVE) return;
  if ((currentBingo.calledBalls || []).length === 0) return;
  if (automaticWinnerCheckRunning) return;
  automaticWinnerCheckRunning = true;

  const calledSet = new Set(currentBingo.calledBalls || []);
  const winners = [];
  const remainingSlots = {
    terna: Math.max(0, winnerLimitForType(currentBingo, "terna") - winnerCountForType(currentBingo, "terna")),
    linea: Math.max(0, winnerLimitForType(currentBingo, "linea") - winnerCountForType(currentBingo, "linea")),
    bingo: Math.max(0, winnerLimitForType(currentBingo, "bingo") - winnerCountForType(currentBingo, "bingo"))
  };

  try {
    cards.forEach((card) => {
      const winType = ["bingo", "linea", "terna"].find((type) => {
        return remainingSlots[type] > 0 && !isWinnerAlreadyDeclared(card.id, type) && checkWinCondition(card, calledSet, type);
      });
      if (winType) {
        remainingSlots[winType] -= 1;
        winners.push({ card, winType });
      }
    });

    if (winners.length === 0) return;

    for (const winner of winners) {
      await declareVerifiedWinner(winner.card, winner.winType, "auto");
    }

    const firstType = winners[0].winType;
    showVerifiedCardsModal({
      title: winners.length === 1
        ? `Ganador automático: ${labelForWinType(firstType)}`
        : `${winners.length} ganadores automáticos`,
      subtitle: winners.map(({ card, winType }) => `${card.ownerName} · ${labelForWinType(winType)}`).join(" | "),
      detail: "Los cartones mostrados cumplen con las bolillas cantadas y quedaron registrados.",
      cards: winners.map((winner) => ({ ...winner.card, __verificationType: winner.winType })),
      winType: firstType
    });
  } finally {
    automaticWinnerCheckRunning = false;
  }
}

function claimKey(cardId, winType) {
  return cardId && winType ? `${cardId}:${winType}` : "";
}

function loadSeenClaimKeys(bingoId) {
  try {
    const raw = sessionStorage.getItem(`seenClaimKeys:${bingoId}`);
    seenClaimKeys = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    seenClaimKeys = new Set();
  }
}

function rememberClaimKey(bingoId, key) {
  if (!key) return;
  seenClaimKeys.add(key);
  try {
    sessionStorage.setItem(`seenClaimKeys:${bingoId}`, JSON.stringify([...seenClaimKeys]));
  } catch {
    // Si el navegador bloquea sessionStorage, igual evitamos duplicados en memoria.
  }
}

async function showUnseenClaim({ bingoId, cardId, winType, ownerName, ownerDni, detail }) {
  const key = claimKey(cardId, winType);
  if (!key || seenClaimKeys.has(key)) return false;

  rememberClaimKey(bingoId, key);
  await verifyAndShowClaim({
    cardId,
    winType,
    ownerName,
    ownerDni,
    detail: detail || `${ownerName || "Un jugador"} reclamó ${labelForWinType(winType)} con el cartón ${cardId}.`
  });
  return true;
}

async function handleAuditUpdate(logs) {
  renderAuditLog(logs);
  const sessionLogs = logs.filter(isCurrentSessionItem);

  const newClaims = sessionLogs
    .filter((log) => {
      const isNewLog = !knownAuditLogIds.has(log.id);
      const isInitialUnseenClaim = !auditNotificationsReady && !seenClaimKeys.has(claimKey(log.meta?.cardId, log.meta?.winType));
      return log.type === "claim_submitted" && (isNewLog || isInitialUnseenClaim);
    })
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });

  sessionLogs.forEach((log) => knownAuditLogIds.add(log.id));
  auditNotificationsReady = true;

  for (const log of newClaims) {
    if (await showUnseenClaim({
      bingoId: currentBingoId,
      cardId: log.meta?.cardId,
      winType: log.meta?.winType,
      ownerName: log.meta?.ownerName,
      ownerDni: log.meta?.ownerDni,
      detail: log.detail
    })) {
      break;
    }
  }
}

async function handleCardClaimUpdate(cards) {
  currentCards = currentBingo?.currentSessionId
    ? cards.filter((card) => card.bingoSessionId === currentBingo.currentSessionId)
    : cards;
  await verifyAndShowAutomaticWinners(currentCards);

  const claims = [];
  currentCards.forEach((card) => {
    ["bingo", "linea", "terna"].forEach((winType) => {
      if (card.claims?.[winType]) {
        claims.push({
          cardId: card.id,
          winType,
          ownerName: card.ownerName,
          ownerDni: card.ownerDni
        });
      }
    });
  });

  const unseen = claims.find((claim) => !seenClaimKeys.has(claimKey(claim.cardId, claim.winType)));
  if (unseen) {
    await showUnseenClaim({ bingoId: currentBingoId, ...unseen });
  }
}

// ---------------- Editar ----------------
function fillEditForm(bingo) {
  if (editFormInitialized) return; // no pisar lo que el organizador está tipeando
  els.eName.value = bingo.name || "";
  els.eDescription.value = bingo.description || "";
  els.ePrizes.value = bingo.prizes || "";
  els.ePrizeTerna.value = bingo.prizeByType?.terna || "";
  els.ePrizeLinea.value = bingo.prizeByType?.linea || "";
  els.ePrizeBingo.value = bingo.prizeByType?.bingo || "";
  els.eLimitTerna.value = winnerLimitForType(bingo, "terna");
  els.eLimitLinea.value = winnerLimitForType(bingo, "linea");
  els.eLimitBingo.value = winnerLimitForType(bingo, "bingo");
  els.eDate.value = formatDateTimeLocalInput(bingo.eventDate);
  els.eYoutube.value = bingo.youtubeUrl || "";
  els.ePrice.value = bingo.cardPrice || 0;
  els.eTotal.value = bingo.totalCards || 0;
  els.eLogo.value = bingo.logoUrl || "";
  els.eOrganizerName.value = bingo.organizerName || "";
  els.eAlias.value = bingo.alias || "";
  els.eCbu.value = bingo.cbu || "";
  editFormInitialized = true;
}

async function handleEditSubmit(event) {
  event.preventDefault();
  if (!currentBingo) return;

  els.btnSaveEdit.disabled = true;
  els.btnSaveEdit.textContent = "Guardando...";

  try {
    await updateBingo(currentBingo.id, {
      name: els.eName.value.trim(),
      description: els.eDescription.value.trim(),
      prizes: els.ePrizes.value.trim(),
      prizeByType: {
        terna: els.ePrizeTerna.value.trim(),
        linea: els.ePrizeLinea.value.trim(),
        bingo: els.ePrizeBingo.value.trim()
      },
      winnerLimits: {
        terna: Number(els.eLimitTerna.value) || 0,
        linea: Number(els.eLimitLinea.value) || 0,
        bingo: Number(els.eLimitBingo.value) || 0
      },
      eventDate: new Date(els.eDate.value).toISOString(),
      youtubeUrl: els.eYoutube.value.trim(),
      cardPrice: Number(els.ePrice.value),
      totalCards: Number(els.eTotal.value),
      logoUrl: els.eLogo.value.trim(),
      organizerName: els.eOrganizerName.value.trim(),
      alias: els.eAlias.value.trim(),
      cbu: els.eCbu.value.trim()
    });
    showToast("Cambios guardados.");
  } catch (err) {
    console.error(err);
    showToast("No pudimos guardar los cambios.", { type: "error" });
  } finally {
    els.btnSaveEdit.disabled = false;
    els.btnSaveEdit.textContent = "Guardar cambios";
  }
}

// ---------------- Init ----------------
function renderAll(bingo, purchases) {
  currentBingo = bingo;
  currentPurchases = purchases;
  syncKnownWinnerKeys(bingo);
  renderHeader(bingo);
  renderStats(bingo, purchases);
  renderDraw(bingo);
  renderReceipts(purchases);
  renderPlayers(purchases);
  fillEditForm(bingo);
  subscribeChatForBingo(bingo);
  showState("detail");
  if (currentCards.length > 0) {
    verifyAndShowAutomaticWinners(currentCards).catch((err) => {
      console.error("No se pudo verificar ganadores automáticamente:", err);
    });
  }
}

function init() {
  const bingoId = getBingoIdFromUrl();
  if (!bingoId) {
    showState("empty");
    return;
  }
  currentBingoId = bingoId;
  loadSeenClaimKeys(bingoId);

  showState("loading");

  els.btnLogout.addEventListener("click", async () => {
    await logoutOrganizer();
    window.location.href = "login.html";
  });

  setupTabs();
  setupAnnouncer();
  setupChatForm();
  setupClearChatButton();

  els.btnCopyLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.shareLink.textContent);
      showToast("Enlace copiado.");
    } catch {
      showToast("No pudimos copiar el enlace.", { type: "error" });
    }
  });

  els.btnStartBingo.addEventListener("click", handleStartBingo);
  els.btnResetDrawState.addEventListener("click", handleResetDrawState);
  els.btnToggleVideo.addEventListener("click", handleToggleVideo);
  els.btnDrawBall.addEventListener("click", handleDrawBall);
  els.btnAddManualBall.addEventListener("click", handleAddManualBall);
  els.manualBallInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddManualBall();
    }
  });
  els.btnRemoveLastBall.addEventListener("click", handleRemoveLastBall);
  els.btnFinishBingo.addEventListener("click", handleFinishBingo);
  els.btnDeclareWinner.addEventListener("click", handleDeclareWinner);
  els.editForm.addEventListener("submit", handleEditSubmit);

  onAuthChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    currentUser = user;
    els.userName.textContent = user.displayName || user.email;
    els.userInitial.textContent = (user.displayName || user.email || "?").charAt(0).toUpperCase();

    let purchasesUnsub = null;
    let auditUnsub = null;
    let cardsUnsub = null;
    let lastBingo = null;

    subscribeToBingo(bingoId, (bingo) => {
      if (!bingo) {
        showState("empty");
        return;
      }

      lastBingo = bingo;

      if (!purchasesUnsub) {
        purchasesUnsub = subscribeToBingoPurchases(bingoId, (purchases) => {
          renderAll(lastBingo, purchases);
        });
        auditUnsub = subscribeToAuditLog(bingoId, handleAuditUpdate);
        cardsUnsub = subscribeToBingoCards(bingoId, handleCardClaimUpdate);
      } else {
        renderAll(lastBingo, currentPurchases);
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
