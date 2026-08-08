// =============================================================
// SALA PAGE — Capa UI
// -------------------------------------------------------------
// Sin acceso directo a Firestore: usa purchase.service,
// bingo.service y card.service exclusivamente.
// =============================================================

import { getPurchaseById, getPurchasesForSala, ensurePurchaseCards } from "../services/purchase.service.js";
import { getBingoById, subscribeToBingo, getCartonLayoutValues } from "../services/bingo.service.js";
import { getCardsByPurchase, getCardById, claimPrize } from "../services/card.service.js";
import { subscribeToAuditLog } from "../services/audit.service.js";
import { subscribeToBingoChat, sendChatMessage } from "../services/chat.service.js";
import { ensurePlayerSession } from "../services/auth.service.js";
import { showToast } from "../ui/toast.ui.js";
import { isAnnouncerSupported, setAnnouncerEnabled, isAnnouncerEnabled, speak, speakBall } from "../ui/announcer.ui.js";
import { BINGO_STATUS, PURCHASE_STATUS } from "../config/constants.js";

const els = {
  loading: document.getElementById("loading-state"),
  empty: document.getElementById("empty-state"),
  content: document.getElementById("sala-content"),
  headerStatus: document.getElementById("header-status"),
  bingoName: document.getElementById("sala-bingo-name"),
  waitingBanner: document.getElementById("waiting-banner"),
  finishedBanner: document.getElementById("finished-banner"),
  actionsPanel: document.getElementById("sala-actions-panel"),
  actionsTitle: document.getElementById("sala-actions-title"),
  actionsCopy: document.getElementById("sala-actions-copy"),
  btnBuyMoreCards: document.getElementById("btn-buy-more-cards"),
  btnViewNextBingos: document.getElementById("btn-view-next-bingos"),
  videoWrap: document.getElementById("video-wrap"),
  currentBallValue: document.getElementById("current-ball-value"),
  btnToggleAnnouncer: document.getElementById("btn-toggle-announcer"),
  historyTrack: document.getElementById("history-track"),
  publicAuditLog: document.getElementById("public-audit-log"),
  chatList: document.getElementById("live-chat-list"),
  chatForm: document.getElementById("live-chat-form"),
  chatInput: document.getElementById("live-chat-input"),
  btnEnableChatAudio: document.getElementById("btn-enable-chat-audio"),
  cardSwitcher: document.getElementById("card-switcher"),
  cardsStack: document.getElementById("cards-stack"),
  claimButtons: {
    terna: document.getElementById("btn-claim-terna"),
    linea: document.getElementById("btn-claim-linea"),
    bingo: document.getElementById("btn-claim-bingo")
  }
};

let cards = [];
let activeCardIndex = 0;
let currentBingo = null;
let videoRendered = false;
let claimHandlersReady = false;
let knownPublicLogIds = new Set();
let publicNotificationsReady = false;
let knownPublicWinnerKeys = new Set();
let publicWinnersReady = false;
let pendingWinnerTimers = new Set();
let lastAnnouncedBall = null;
let currentPurchase = null;
let chatUnsubscribe = null;
let chatSessionKey = "";
let knownChatIds = new Set();
let chatReady = false;
let chatAudioHintShown = false;

function getPurchaseIdFromUrl() {
  return new URLSearchParams(window.location.search).get("purchase");
}

function showState(state) {
  els.loading.hidden = state !== "loading";
  els.empty.hidden = state !== "empty";
  els.content.hidden = state !== "content";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function getBallLetter() {
  return "";
}

function labelFor(type) {
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

function isWinnerDeclaredForCard(card, winType) {
  const winners = currentBingo?.winners?.[winType] || [];
  return winners.some((winner) => winner.cardId === card?.id || winner.cardVisibleId === card?.visibleId);
}

function winnerLimitForType(winType) {
  const raw = currentBingo?.winnerLimits?.[winType];
  if (raw === undefined || raw === null || raw === "") return 1;
  return Math.max(0, Number(raw) || 0);
}

function isWinnerSlotAvailable(winType) {
  return (currentBingo?.winners?.[winType]?.length || 0) < winnerLimitForType(winType);
}

function extractYoutubeId(url) {
  if (!url) return null;
  const patterns = [/youtu\.be\/([\w-]{6,})/, /v=([\w-]{6,})/, /embed\/([\w-]{6,})/, /live\/([\w-]{6,})/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function getBingoLandingUrl(bingoId) {
  return `../index.html?bingo=${encodeURIComponent(bingoId)}`;
}

function getOrganizerBingosUrl(bingo) {
  const url = new URL("../index.html", window.location.href);
  if (bingo?.organizerId) url.searchParams.set("organizer", bingo.organizerId);
  if (bingo?.id) url.searchParams.set("from", bingo.id);
  return url.toString();
}

function getBingoPurchaseUrl(bingoId) {
  const url = new URL("compra.html", window.location.href);
  url.searchParams.set("bingo", bingoId);
  const currentPurchaseId = getPurchaseIdFromUrl();
  if (currentPurchaseId) url.searchParams.set("appendTo", currentPurchaseId);
  return url.toString();
}

function renderSalaActions(bingo) {
  if (!bingo?.id) {
    els.actionsPanel.hidden = true;
    return;
  }

  els.actionsPanel.hidden = false;
  els.btnBuyMoreCards.href = getBingoPurchaseUrl(bingo.id);
  els.btnViewNextBingos.href = getOrganizerBingosUrl(bingo);

  const buyingClosed = bingo.status === BINGO_STATUS.FINISHED || bingo.status === BINGO_STATUS.CANCELLED;
  els.btnBuyMoreCards.hidden = buyingClosed;

  if (bingo.status === BINGO_STATUS.FINISHED) {
    els.actionsTitle.textContent = "Este bingo terminó";
    els.actionsCopy.textContent = "Podés volver al inicio para comprar cartones de próximos bingos.";
    els.btnViewNextBingos.textContent = "Comprar cartones para próximos bingos";
  } else if (bingo.status === BINGO_STATUS.LIVE) {
    els.actionsTitle.textContent = "¿Querés sumar cartones?";
    els.actionsCopy.textContent = "Mientras la venta siga habilitada, podés comprar más cartones para este bingo o ver otros próximos.";
    els.btnBuyMoreCards.textContent = "Comprar más cartones";
    els.btnViewNextBingos.textContent = "Ver próximos bingos";
  } else {
    els.actionsTitle.textContent = "Prepará tu próxima jugada";
    els.actionsCopy.textContent = "Podés comprar más cartones para este bingo o volver al inicio.";
    els.btnBuyMoreCards.textContent = "Comprar más cartones";
    els.btnViewNextBingos.textContent = "Ver próximos bingos";
  }
}

function renderVideo(bingo) {
  if (bingo?.videoEnabled === false) {
    els.videoWrap.innerHTML = `<div class="video-placeholder">El video en vivo está deshabilitado por el organizador.</div>`;
    videoRendered = false;
    return;
  }
  if (videoRendered) return;
  const videoId = extractYoutubeId(bingo.youtubeUrl);
  if (!videoId) {
    els.videoWrap.innerHTML = `<div class="video-placeholder">El organizador todavía no cargó un video en vivo.</div>`;
    videoRendered = false;
    return;
  }
  els.videoWrap.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=0" title="Transmisión en vivo del bingo" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  videoRendered = true;
}

function setupClaimButtons() {
  if (claimHandlersReady) return;
  Object.entries(els.claimButtons).forEach(([type, btn]) => {
    btn.addEventListener("click", () => handleClaim(type));
  });
  claimHandlersReady = true;
}

function updateAnnouncerButton() {
  if (!els.btnToggleAnnouncer) return;
  els.btnToggleAnnouncer.disabled = !isAnnouncerSupported();
  els.btnToggleAnnouncer.textContent = isAnnouncerEnabled() ? "Desactivar audio" : "Activar audio de sala";
  if (els.btnEnableChatAudio) {
    els.btnEnableChatAudio.disabled = !isAnnouncerSupported();
    els.btnEnableChatAudio.textContent = isAnnouncerEnabled() ? "Audio activo" : "Activar audio";
  }
}

function setupAnnouncer() {
  if (!els.btnToggleAnnouncer) return;
  updateAnnouncerButton();
  els.btnToggleAnnouncer.addEventListener("click", () => {
    const enabled = setAnnouncerEnabled(!isAnnouncerEnabled());
    updateAnnouncerButton();
    showToast(enabled ? "Audio de sala activado." : "Audio de sala desactivado.");
    if (enabled && currentBingo?.currentBall) {
      speakBall(currentBingo.currentBall);
      lastAnnouncedBall = currentBingo.currentBall;
    }
  });
}

function setupChatAudioButton() {
  if (!els.btnEnableChatAudio) return;
  updateAnnouncerButton();
  els.btnEnableChatAudio.addEventListener("click", () => {
    const enabled = setAnnouncerEnabled(true);
    updateAnnouncerButton();
    showToast(enabled ? "Vas a escuchar los avisos del organizador." : "Tu navegador no permite audio automático.");
    if (enabled) {
      speak("Audio de avisos activado.", "chat-audio-enabled");
    }
  });
}

function renderEmptyCardState(purchase, message) {
  els.cardSwitcher.hidden = true;
  els.cardsStack.innerHTML = `
    <article class="paper-card bingo-card-visual">
      <div class="bingo-card-header">
        <span class="bingo-card-badge">CARTONES</span>
      </div>
      <p class="owner-info">${escapeHtml(purchase.fullName)} · DNI ${escapeHtml(purchase.dni)}</p>
      <p class="owner-info">${escapeHtml(message)}</p>
    </article>
  `;
  Object.values(els.claimButtons).forEach((btn) => {
    btn.disabled = true;
    btn.classList.remove("is-claimed");
  });
}

function renderHeaderStatus(bingo) {
  els.bingoName.textContent = bingo?.name || "Sala de juego";
  document.title = `Sala — ${bingo?.name || "Bingo"}`;

  if (bingo?.status === BINGO_STATUS.LIVE) {
    els.headerStatus.className = "badge badge-live";
    els.headerStatus.textContent = "En vivo";
    els.waitingBanner.hidden = true;
    els.finishedBanner.hidden = true;
  } else if (bingo.status === BINGO_STATUS.FINISHED) {
    els.headerStatus.className = "badge badge-closed";
    els.headerStatus.textContent = "Finalizado";
    els.waitingBanner.hidden = true;
    els.finishedBanner.hidden = false;
  } else {
    els.headerStatus.className = "badge badge-soon";
    els.headerStatus.textContent = "Esperando inicio";
    els.waitingBanner.hidden = false;
    els.finishedBanner.hidden = true;
  }
  renderSalaActions(bingo);
}

function renderBallState(bingo) {
  const calledBalls = bingo?.calledBalls || [];
  els.currentBallValue.textContent = bingo?.currentBall ? `${getBallLetter(bingo.currentBall)}${bingo.currentBall}` : "--";
  if (bingo?.currentBall && bingo.currentBall !== lastAnnouncedBall) {
    speakBall(bingo.currentBall);
    lastAnnouncedBall = bingo.currentBall;
  }

  const sorted = [...calledBalls].sort((a, b) => b - a);
  els.historyTrack.innerHTML = sorted
    .map((n, idx) => `<span class="history-chip ${idx === 0 ? "is-recent" : ""}">${getBallLetter(n)}${n}</span>`)
    .join("");
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

function speakOrganizerMessage(message) {
  if (!message?.text || message.senderRole !== "organizer" || message.kind !== "announcement") return;
  if (!isAnnouncerEnabled()) {
    if (!chatAudioHintShown) {
      chatAudioHintShown = true;
      showToast("Activá el audio para escuchar los avisos del organizador.");
    }
    return;
  }
  speak(`Aviso del organizador. ${message.text}`, `chat:${message.id || message.createdAt?.seconds || message.text}`);
}

function handleChatUpdate(messages) {
  renderChat(messages);
  const newOrganizerMessages = messages.filter((message) => {
    return message.senderRole === "organizer" && message.kind === "announcement" && !knownChatIds.has(message.id);
  });
  messages.forEach((message) => knownChatIds.add(message.id));

  if (!chatReady) {
    chatReady = true;
    return;
  }

  const latestOrganizerMessage = newOrganizerMessages[newOrganizerMessages.length - 1];
  if (latestOrganizerMessage) {
    speakOrganizerMessage(latestOrganizerMessage);
  }
}

function setupChatForm() {
  if (!els.chatForm) return;
  els.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentBingo || !currentPurchase) return;
    const text = els.chatInput.value.trim();
    if (!text) return;

    els.chatInput.value = "";
    try {
      await sendChatMessage({
        bingoId: currentBingo.id,
        sessionId: currentBingo.currentSessionId || null,
        senderRole: "player",
        senderName: currentPurchase.fullName || "Jugador",
        text
      });
    } catch (err) {
      console.error(err);
      showToast("No pudimos enviar el mensaje.", { type: "error" });
      els.chatInput.value = text;
    }
  });
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

function renderPublicAudit(logs) {
  const publicTypes = new Set([
    "bingo_started",
    "ball_drawn",
    "ball_removed",
    "winner_declared",
    "claim_submitted",
    "bingo_finished"
  ]);
  const publicLogs = logs.filter((log) => publicTypes.has(log.type) && isCurrentSessionItem(log)).slice(0, 25);

  els.publicAuditLog.innerHTML = publicLogs.length
    ? publicLogs
        .map(
          (log) => `
            <article class="public-audit-item ${log.type === "ball_removed" ? "is-warning" : ""}">
              <span>${formatAuditTime(log.createdAt)}</span>
              <p>${escapeHtml(log.detail || "")}</p>
            </article>`
        )
        .join("")
    : `<p class="public-audit-empty">Los eventos del sorteo aparecerán acá.</p>`;
}

function ensurePublicClaimModal() {
  let modal = document.getElementById("public-claim-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "public-claim-modal";
  modal.className = "public-claim-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="public-claim-modal__backdrop" data-close-public-claim></div>
    <section class="public-claim-modal__panel" role="dialog" aria-modal="true" aria-labelledby="public-claim-title">
      <span class="public-claim-modal__eyebrow">Atención</span>
      <h2 id="public-claim-title"></h2>
      <p id="public-claim-detail"></p>
      <button type="button" class="btn btn-primary" data-close-public-claim>Entendido</button>
    </section>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-public-claim]").forEach((el) => {
    el.addEventListener("click", () => {
      modal.hidden = true;
    });
  });
  return modal;
}

function showPublicClaimModal(log) {
  const modal = ensurePublicClaimModal();
  const type = labelFor(log.meta?.winType);
  modal.querySelector("#public-claim-title").textContent = `Alguien cantó ${type}`;
  modal.querySelector("#public-claim-detail").textContent = "Estamos verificando el cartón con las bolillas cantadas. Se informará el resultado cuando el organizador lo valide.";
  modal.hidden = false;
  speak(`Alguien cantó ${type}. Estamos verificando.`, `claim:${log.id || log.meta?.cardId || Date.now()}`);
}

function showPublicWinnerModal(winner, winType) {
  const modal = ensurePublicClaimModal();
  const type = labelFor(winType || winner?.winType);
  const owner = winner?.ownerName || "Un participante";
  const cardText = winner?.cardId || winner?.cardVisibleId ? ` Cartón ganador: ${getVisibleCardId(winner)}.` : "";
  const prizeText = winner?.prize ? ` Premio: ${winner.prize}.` : "";
  modal.querySelector("#public-claim-title").textContent = `${owner} ganó ${type}`;
  modal.querySelector("#public-claim-detail").textContent = `El organizador validó el cartón en vivo.${cardText}${prizeText}`;
  modal.hidden = false;
  speak(`${owner} ganó ${type}${winner?.prize ? `. Premio: ${winner.prize}` : ""}`, `winner:${winnerKey(winner, winType)}`);
}

function showPublicVerificationModal(winType) {
  const modal = ensurePublicClaimModal();
  modal.querySelector("#public-claim-title").textContent = `Alguien cantó ${labelFor(winType)}`;
  modal.querySelector("#public-claim-detail").textContent = "Estamos verificando el cartón con las bolillas cantadas. En unos segundos se informa el resultado.";
  modal.hidden = false;
  speak(`Alguien cantó ${labelFor(winType)}. Estamos verificando.`, `verify:${winType}:${Date.now()}`);
}

function schedulePublicWinnerModal(winner, winType) {
  const key = winnerKey(winner, winType);
  if (pendingWinnerTimers.has(key)) return;
  pendingWinnerTimers.add(key);
  showPublicVerificationModal(winType || winner?.winType);
  window.setTimeout(() => {
    pendingWinnerTimers.delete(key);
    showPublicWinnerModal(winner, winType);
  }, 25000);
}

function winnerKey(winner, winType) {
  const cardId = winner?.cardId || winner?.cardVisibleId || `${winner?.ownerDni || ""}:${winner?.ownerName || ""}`;
  return `${winType || winner?.winType || "premio"}:${cardId}`;
}

function handleWinnerUpdate(bingo) {
  const winners = bingo?.winners || {};
  const entries = [];
  ["bingo", "linea", "terna"].forEach((winType) => {
    (winners[winType] || []).forEach((winner) => {
      entries.push({ winner, winType, key: winnerKey(winner, winType) });
    });
  });

  if (!publicWinnersReady) {
    knownPublicWinnerKeys = new Set(entries.map((entry) => entry.key));
    publicWinnersReady = true;
    return;
  }

  const newWinner = entries.find((entry) => !knownPublicWinnerKeys.has(entry.key));
  entries.forEach((entry) => knownPublicWinnerKeys.add(entry.key));
  if (newWinner) {
    schedulePublicWinnerModal(newWinner.winner, newWinner.winType);
  }
}

function handlePublicAuditUpdate(logs) {
  renderPublicAudit(logs);
  const sessionLogs = logs.filter(isCurrentSessionItem);

  if (!publicNotificationsReady) {
    knownPublicLogIds = new Set(sessionLogs.map((log) => log.id));
    publicNotificationsReady = true;
    return;
  }

  const ownedCardIds = new Set(cards.map((card) => card.id));
  const newClaims = sessionLogs.filter((log) => {
    return !knownPublicLogIds.has(log.id)
      && log.type === "claim_submitted"
      && !ownedCardIds.has(log.meta?.cardId);
  });
  const winnerLog = sessionLogs.find((log) => !knownPublicLogIds.has(log.id) && log.type === "winner_declared");

  sessionLogs.forEach((log) => knownPublicLogIds.add(log.id));

  if (winnerLog) {
    schedulePublicWinnerModal(winnerLog.meta, winnerLog.meta?.winType);
    return;
  }
  if (newClaims.length > 0) {
    showPublicClaimModal(newClaims[0]);
  }
}

function renderCardSwitcher() {
  if (cards.length <= 1) {
    els.cardSwitcher.hidden = true;
    return;
  }
  els.cardSwitcher.hidden = false;
  els.cardSwitcher.innerHTML = cards
    .map((card, idx) => `<button data-idx="${idx}" class="${idx === activeCardIndex ? "is-active" : ""}">${escapeHtml(getVisibleCardId(card))}</button>`)
    .join("");
  els.cardSwitcher.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCardIndex = Number(btn.dataset.idx);
      renderActiveCard();
    });
  });
}

function getCardMatrix(card) {
  const values = card?.numbers;
  if (Array.isArray(values) && Array.isArray(values[0])) {
    return values;
  }
  return getCartonLayoutValues(card);
}
function isCellMarked(value, calledSet) {
  return value !== null && value !== "" && calledSet.has(value);
}

function renderActiveCard() {
  const card = cards[activeCardIndex];
  if (!card || !currentBingo) return;

  const calledSet = new Set(currentBingo.calledBalls || []);
  const grid = getCardMatrix(card);

  els.cardsStack.innerHTML = cards
    .map((item, index) => {
      const itemGrid = getCardMatrix(item);
      const cardId = `card-${index + 1}`;
      const rowsMarkup = itemGrid
        .map((row) => {
          const cellsMarkup = row
            .map((value) => {
              const isEmpty = value === null || value === "";
              const isNumber = !isEmpty;
              const marked = isNumber && calledSet.has(value);
              return `<div class="bingo-cell ${isNumber ? "is-number" : "is-empty"} ${marked ? "is-marked" : ""}">${isNumber ? value : ""}</div>`;
            })
            .join("");
          return `<div class="bingo-row">${cellsMarkup}</div>`;
        })
        .join("");

      return `
        <article class="paper-card bingo-card-visual ${index === activeCardIndex ? "is-active-card" : ""}" id="${cardId}" data-card-index="${index}" tabindex="0">
          <div class="bingo-card-header">
            <span class="bingo-card-badge">CARTON ${escapeHtml(getVisibleCardId(item))}</span>
          </div>
          <div class="bingo-card-shell">
            <div class="bingo-grid">${rowsMarkup}</div>
          </div>
          <p class="owner-info">${escapeHtml(item.ownerName)} · DNI ${escapeHtml(item.ownerDni)}</p>
        </article>`;
    })
    .join("");

  els.cardSwitcher.hidden = true;
  els.cardSwitcher.innerHTML = "";
  els.cardsStack.querySelectorAll("[data-card-index]").forEach((cardEl) => {
    cardEl.addEventListener("click", () => {
      activeCardIndex = Number(cardEl.dataset.cardIndex);
      renderActiveCard();
    });
    cardEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activeCardIndex = Number(cardEl.dataset.cardIndex);
        renderActiveCard();
      }
    });
  });
  renderClaimButtons(card, calledSet);
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

function renderClaimButtons(card, calledSet) {
  ["terna", "linea", "bingo"].forEach((type) => {
    const btn = els.claimButtons[type];
    const alreadyClaimed = card.claims?.[type];
    const alreadyWinner = isWinnerDeclaredForCard(card, type);
    const slotAvailable = isWinnerSlotAvailable(type);
    btn.classList.toggle("is-claimed", Boolean(alreadyClaimed || alreadyWinner));
    btn.textContent = !slotAvailable
      ? `${labelFor(type)} agotado`
      : alreadyWinner
      ? `${labelFor(type)} ✓ ganador`
      : alreadyClaimed
      ? `${labelFor(type)} ✓ enviado`
      : labelFor(type);
    btn.disabled = !slotAvailable || Boolean(alreadyClaimed || alreadyWinner) || currentBingo.status !== BINGO_STATUS.LIVE;
  });
}

async function handleClaim(type) {
  const card = cards[activeCardIndex];
  if (!card || !currentBingo) return;

  if (!isWinnerSlotAvailable(type)) {
    showToast(`El cupo de ${labelFor(type)} ya está completo.`, { type: "error" });
    renderActiveCard();
    return;
  }

  if (isWinnerDeclaredForCard(card, type)) {
    showToast("Este cartón ya fue validado como ganador. No hace falta enviar reclamo.", { type: "error" });
    renderActiveCard();
    return;
  }

  const calledSet = new Set(currentBingo.calledBalls || []);
  if (!checkWinCondition(card, calledSet, type)) {
    showToast("Todavía no completaste esta jugada con las bolillas cantadas.", { type: "error" });
    return;
  }

  try {
    await claimPrize(card.id, type);
    card.claims = { ...(card.claims || {}), [type]: true };
    showToast("¡Reclamo enviado! El organizador lo va a validar en vivo.");
    renderActiveCard();
  } catch (err) {
    console.error(err);
    showToast("No pudimos enviar tu reclamo. Probá de nuevo.", { type: "error" });
  }
}

async function loadCardsForPurchase(purchase, purchaseId) {
  const groupedPurchases = (await getPurchasesForSala({ ...purchase, id: purchaseId }))
    .filter((item) => item.status === PURCHASE_STATUS.APPROVED || item.status === "approved");
  const purchaseList = groupedPurchases.length > 0 ? groupedPurchases : [{ ...purchase, id: purchaseId }];
  const purchaseCardIds = purchaseList.flatMap((item) => Array.isArray(item?.cardIds) ? item.cardIds.filter(Boolean) : []);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const cardsByPurchase = (await Promise.all(purchaseList.map((item) => getCardsByPurchase(item.id))))
      .flat()
      .filter(isCurrentSessionItem);
    if (cardsByPurchase.length > 0) {
      return cardsByPurchase;
    }

    if (purchaseCardIds.length > 0) {
      const resolvedCards = (await Promise.all(purchaseCardIds.map((cardId) => getCardById(cardId)))).filter(Boolean).filter(isCurrentSessionItem);
      if (resolvedCards.length > 0) {
        return resolvedCards;
      }
    }

    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  return [];
}

async function init() {
  const purchaseId = getPurchaseIdFromUrl();
  if (!purchaseId) {
    showState("empty");
    return;
  }

  showState("loading");
  await ensurePlayerSession();

  let purchase = await getPurchaseById(purchaseId);
  if (!purchase) {
    showState("empty");
    return;
  }
  currentPurchase = { ...purchase, id: purchaseId };

  const isApproved = purchase.status === PURCHASE_STATUS.APPROVED || purchase.status === "approved";
  if (!isApproved) {
    els.empty.querySelector("h2").textContent = "Tu pago todavía no fue aprobado";
    els.empty.querySelector("p").textContent =
      "En cuanto el organizador confirme tu comprobante vas a poder entrar a la sala de juego.";
    showState("empty");
    return;
  }

  const bingo = await getBingoById(purchase.bingoId);
  if (!bingo) {
    showState("empty");
    return;
  }

  currentBingo = bingo;
  renderHeaderStatus(bingo);
  renderVideo(bingo);
  renderBallState(bingo);
  renderEmptyCardState(purchase, "Estamos cargando tus cartones...");
  setupClaimButtons();
  setupAnnouncer();
  setupChatAudioButton();
  setupChatForm();
  subscribeChatForBingo(bingo);
  showState("content");

  subscribeToBingo(bingo.id, (updatedBingo) => {
    if (!updatedBingo) return;
    currentBingo = updatedBingo;
    renderHeaderStatus(updatedBingo);
    renderVideo(updatedBingo);
    renderBallState(updatedBingo);
    subscribeChatForBingo(updatedBingo);
    handleWinnerUpdate(updatedBingo);
    if (cards.length > 0) {
      renderActiveCard();
    }
    showState("content");
  });
  subscribeToAuditLog(
    bingo.id,
    handlePublicAuditUpdate,
    60,
    () => {
      if (els.publicAuditLog) {
        els.publicAuditLog.innerHTML = `<p class="public-audit-empty">El registro técnico del sorteo está protegido. Los avisos importantes aparecerán en pantalla durante la partida.</p>`;
      }
    }
  );

  try {
    purchase = (await ensurePurchaseCards(purchaseId)) || purchase;
  } catch (err) {
    console.warn("No se pudieron asegurar los cartones al entrar a la sala:", err);
    renderEmptyCardState(
      purchase,
      "No pudimos generar tus cartones. Si el problema continúa, el organizador debe aprobar nuevamente la compra o revisar las reglas de Firestore."
    );
    return;
  }

  cards = await loadCardsForPurchase(purchase, purchaseId);

  if (cards.length === 0) {
    renderEmptyCardState(
      purchase,
      "La sala ya está abierta, pero los cartones todavía no están disponibles. Pedile al organizador que vuelva a revisar esta compra."
    );
    return;
  }

  activeCardIndex = 0;
  renderActiveCard();
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    console.error(err);
    showToast("Ocurrió un error al cargar la sala.", { type: "error" });
    showState("empty");
  });
});
