// =============================================================
// LANDING PAGE — Capa UI
// -------------------------------------------------------------
// Esta página NUNCA importa Firestore. Toda la data llega a
// través de bingo.service.js.
// =============================================================

import { subscribeToBingo, getBingosByOrganizer, getAvailableCards } from "../services/bingo.service.js";
import { formatCurrency, formatDate, formatTime, getCountdownParts, pad2 } from "../utils/format.utils.js";
import { showToast } from "../ui/toast.ui.js";
import { BINGO_STATUS } from "../config/constants.js";

const els = {
  loading: document.getElementById("loading-state"),
  empty: document.getElementById("empty-state"),
  content: document.getElementById("bingo-content"),
  organizerContent: document.getElementById("organizer-bingos-content"),
  organizerTitle: document.getElementById("organizer-bingos-title"),
  organizerCopy: document.getElementById("organizer-bingos-copy"),
  organizerGrid: document.getElementById("organizer-bingos-grid"),
  heroLogo: document.getElementById("hero-logo"),
  statusBadge: document.getElementById("status-badge"),
  name: document.getElementById("bingo-name"),
  desc: document.getElementById("bingo-desc"),
  fullDesc: document.getElementById("full-desc"),
  fullPrizes: document.getElementById("full-prizes"),
  metaDate: document.getElementById("meta-date"),
  metaTime: document.getElementById("meta-time"),
  metaPrice: document.getElementById("meta-price"),
  metaStock: document.getElementById("meta-stock"),
  buyPrice: document.getElementById("buy-price"),
  buyStock: document.getElementById("buy-stock"),
  buyTotal: document.getElementById("buy-total"),
  stockFill: document.getElementById("stock-fill"),
  ballCountdown: document.getElementById("ball-countdown"),
  cdDays: document.getElementById("cd-days"),
  cdHours: document.getElementById("cd-hours"),
  cdMin: document.getElementById("cd-min"),
  cdSec: document.getElementById("cd-sec"),
  ticker: document.getElementById("prize-ticker-track"),
  btnComprar: document.getElementById("btn-comprar")
};

let currentBingo = null;
let countdownInterval = null;
let tickerBuilt = false;

function getBingoIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("bingo");
}

function getOrganizerIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("organizer");
}

function getSourceBingoIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("from");
}

function showState(state) {
  els.loading.hidden = state !== "loading";
  els.empty.hidden = state !== "empty";
  els.content.hidden = state !== "content";
  els.organizerContent.hidden = state !== "organizer";
}

function renderStatusBadge(bingo) {
  const parts = getCountdownParts(bingo.eventDate);
  if (bingo.status === BINGO_STATUS.LIVE) {
    els.statusBadge.className = "badge badge-live";
    els.statusBadge.textContent = "En vivo";
  } else if (bingo.status === BINGO_STATUS.FINISHED) {
    els.statusBadge.className = "badge badge-closed";
    els.statusBadge.textContent = "Finalizado";
  } else if (parts && parts.expired) {
    els.statusBadge.className = "badge badge-closed";
    els.statusBadge.textContent = "Cerrado";
  } else {
    els.statusBadge.className = "badge badge-soon";
    els.statusBadge.textContent = "Próximamente";
  }
}

function renderPrizeTicker(prizesText) {
  if (tickerBuilt || !prizesText) return;
  const lines = prizesText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return;

  const buildChips = () =>
    lines
      .map(
        (line, idx) => `
        <span class="prize-chip">
          <span class="prize-chip__num">${pad2(idx + 1)}</span>
          ${escapeHtml(line)}
        </span>`
      )
      .join("");

  // Se duplica el contenido para lograr un loop continuo del ticker.
  els.ticker.innerHTML = buildChips() + buildChips();
  tickerBuilt = true;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderBingo(bingo) {
  currentBingo = bingo;

  document.title = `${bingo.name} — BingoLive`;

  if (bingo.logoUrl) {
    els.heroLogo.src = bingo.logoUrl;
    els.heroLogo.hidden = false;
  }

  els.name.textContent = bingo.name;
  els.desc.textContent = bingo.description || "Un bingo online con sorteo en vivo.";
  els.fullDesc.textContent = bingo.description || "Este organizador todavía no agregó una descripción.";
  els.fullPrizes.textContent = bingo.prizes || "El organizador anunciará los premios próximamente.";

  els.metaDate.textContent = formatDate(bingo.eventDate);
  els.metaTime.textContent = formatTime(bingo.eventDate);
  els.metaPrice.textContent = formatCurrency(bingo.cardPrice);

  const available = getAvailableCards(bingo);
  const total = Number(bingo.totalCards) || 0;
  const pct = total > 0 ? Math.round((available / total) * 100) : 0;

  els.metaStock.textContent = available;
  els.buyPrice.textContent = formatCurrency(bingo.cardPrice);
  els.buyStock.textContent = available;
  els.buyTotal.textContent = total;
  els.stockFill.style.width = `${pct}%`;

  const soldOut = available <= 0;
  const notSellable = bingo.status === BINGO_STATUS.FINISHED || bingo.status === BINGO_STATUS.CANCELLED;
  els.btnComprar.disabled = soldOut || notSellable;
  els.btnComprar.textContent = soldOut
    ? "Cartones agotados"
    : notSellable
    ? "Venta cerrada"
    : "Comprar cartones";

  renderStatusBadge(bingo);
  renderPrizeTicker(bingo.prizes);
  startCountdown(bingo.eventDate);

  showState("content");
}

function startCountdown(eventDate) {
  clearInterval(countdownInterval);

  const tick = () => {
    const parts = getCountdownParts(eventDate);
    if (!parts || parts.expired) {
      els.ballCountdown.textContent = "¡Ya!";
      els.cdDays.textContent = els.cdHours.textContent = els.cdMin.textContent = els.cdSec.textContent = "00";
      clearInterval(countdownInterval);
      return;
    }
    els.ballCountdown.textContent = parts.days > 0 ? `${parts.days}d` : `${pad2(parts.hours)}:${pad2(parts.minutes)}`;
    els.cdDays.textContent = pad2(parts.days);
    els.cdHours.textContent = pad2(parts.hours);
    els.cdMin.textContent = pad2(parts.minutes);
    els.cdSec.textContent = pad2(parts.seconds);
  };

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function goToPurchase() {
  if (!currentBingo) return;
  window.location.href = `pages/compra.html?bingo=${encodeURIComponent(currentBingo.id)}`;
}

function isBingoSellable(bingo) {
  return bingo.status !== BINGO_STATUS.FINISHED
    && bingo.status !== BINGO_STATUS.CANCELLED
    && getAvailableCards(bingo) > 0;
}

function sortByEventDate(items) {
  return [...items].sort((a, b) => {
    const aTime = a.eventDate ? new Date(a.eventDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.eventDate ? new Date(b.eventDate).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function renderOrganizerBingos(bingos) {
  const sourceBingoId = getSourceBingoIdFromUrl();
  const visibleBingos = sortByEventDate(
    bingos.filter((bingo) => {
      return bingo.id !== sourceBingoId
        && [BINGO_STATUS.PUBLISHED, BINGO_STATUS.LIVE].includes(bingo.status);
    })
  );
  const organizerName = visibleBingos[0]?.organizerName || bingos[0]?.organizerName || "este organizador";

  document.title = `Bingos de ${organizerName} — BingoLive`;
  els.organizerTitle.textContent = `Bingos de ${organizerName}`;
  els.organizerCopy.textContent = visibleBingos.length
    ? "Elegí un bingo disponible para ver detalles y comprar cartones."
    : "Este organizador todavía no tiene otros bingos disponibles.";

  els.organizerGrid.innerHTML = visibleBingos.length
    ? visibleBingos
        .map((bingo) => {
          const available = getAvailableCards(bingo);
          const sellable = isBingoSellable(bingo);
          const statusText = bingo.status === BINGO_STATUS.LIVE
            ? "En vivo"
            : bingo.status === BINGO_STATUS.FINISHED
            ? "Finalizado"
            : "Próximamente";
          const statusClass = bingo.status === BINGO_STATUS.LIVE
            ? "badge-live"
            : bingo.status === BINGO_STATUS.FINISHED
            ? "badge-closed"
            : "badge-soon";

          return `
            <article class="paper-card organizer-bingo-card">
              <div class="organizer-bingo-card__top">
                <span class="badge ${statusClass}">${statusText}</span>
                <span class="organizer-bingo-card__stock">${available} disponibles</span>
              </div>
              <h2>${escapeHtml(bingo.name || "Bingo sin nombre")}</h2>
              <p>${escapeHtml(bingo.description || "El organizador anunciará los detalles próximamente.")}</p>
              <div class="organizer-bingo-card__meta">
                <span>${formatDate(bingo.eventDate)}</span>
                <span>${formatTime(bingo.eventDate)}</span>
                <span>${formatCurrency(bingo.cardPrice)}</span>
              </div>
              <a class="btn ${sellable ? "btn-primary" : "btn-ghost"} btn-block" href="index.html?bingo=${encodeURIComponent(bingo.id)}">
                ${sellable ? "Ver y comprar" : "Ver detalle"}
              </a>
            </article>`;
        })
        .join("")
    : `
      <article class="paper-card organizer-bingo-card organizer-bingo-card--empty">
        <h2>No hay otros bingos</h2>
        <p>Cuando el organizador publique un nuevo bingo, va a aparecer en esta pantalla.</p>
      </article>`;

  showState("organizer");
}

async function init() {
  const bingoId = getBingoIdFromUrl();
  const organizerId = getOrganizerIdFromUrl();

  if (!bingoId) {
    if (organizerId) {
      showState("loading");
      const bingos = await getBingosByOrganizer(organizerId);
      renderOrganizerBingos(bingos);
      return;
    }
    showState("empty");
    return;
  }

  showState("loading");

  subscribeToBingo(bingoId, (bingo) => {
    if (!bingo) {
      showState("empty");
      return;
    }
    renderBingo(bingo);
  });

  els.btnComprar.addEventListener("click", goToPurchase);
}

window.addEventListener("beforeunload", () => clearInterval(countdownInterval));

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    console.error(err);
    showToast("Ocurrió un error al cargar el bingo", { type: "error" });
    showState("empty");
  });
});
