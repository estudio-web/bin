// =============================================================
// DASHBOARD PAGE (Organizador) — Capa UI
// =============================================================

import { onAuthChanged, logoutOrganizer } from "../../services/auth.service.js";
import { getBingosByOrganizer } from "../../services/bingo.service.js";
import { getPurchasesByBingo } from "../../services/purchase.service.js";
import { getAllBingos, getAllOrganizers, isCurrentUserSuperAdmin } from "../../services/platform.service.js";
import { getAllSales, computeSalesSummary, syncSalesForApprovedPurchases } from "../../services/finance.service.js";
import { computeBingoStats } from "../../utils/stats.utils.js";
import { formatCurrency, formatDate } from "../../utils/format.utils.js";
import { showToast } from "../../ui/toast.ui.js";
import { BINGO_STATUS } from "../../config/constants.js";

const els = {
  loading: document.getElementById("loading-state"),
  empty: document.getElementById("empty-state"),
  grid: document.getElementById("bingo-grid"),
  dashboardTitle: document.getElementById("dashboard-title"),
  dashboardSubtitle: document.getElementById("dashboard-subtitle"),
  userName: document.getElementById("user-name"),
  userInitial: document.getElementById("user-initial"),
  btnLogout: document.getElementById("btn-logout"),
  platformPanel: document.getElementById("platform-panel"),
  btnRefreshPlatform: document.getElementById("btn-refresh-platform"),
  btnScrollBingos: document.getElementById("btn-scroll-bingos"),
  btnScrollOrganizers: document.getElementById("btn-scroll-organizers"),
  platformSearch: document.getElementById("platform-search"),
  platformStatusFilter: document.getElementById("platform-status-filter"),
  platformResultsCount: document.getElementById("platform-results-count"),
  platformBingos: document.getElementById("platform-bingos"),
  platformOrganizers: document.getElementById("platform-organizers"),
  platformGross: document.getElementById("platform-gross"),
  platformCommissions: document.getElementById("platform-commissions"),
  platformSalesBody: document.getElementById("platform-sales-body"),
  platformBingosBody: document.getElementById("platform-bingos-body"),
  platformOrganizersBody: document.getElementById("platform-organizers-body")
};

let platformBingosCache = [];

const STATUS_LABEL = {
  [BINGO_STATUS.DRAFT]: { text: "Borrador", cls: "badge-soon" },
  [BINGO_STATUS.PUBLISHED]: { text: "Publicado", cls: "badge-soon" },
  [BINGO_STATUS.LIVE]: { text: "En vivo", cls: "badge-live" },
  [BINGO_STATUS.FINISHED]: { text: "Finalizado", cls: "badge-closed" },
  [BINGO_STATUS.CANCELLED]: { text: "Cancelado", cls: "badge-closed" }
};

function showState(state) {
  els.loading.hidden = state !== "loading";
  els.empty.hidden = state !== "empty";
  els.grid.hidden = state !== "grid";
}

function renderBingoCard(bingo, stats) {
  const status = STATUS_LABEL[bingo.status] || STATUS_LABEL[BINGO_STATUS.PUBLISHED];
  const el = document.createElement("article");
  el.className = "paper-card bingo-card";
  el.innerHTML = `
    <div class="bingo-card__top">
      <h3>${escapeHtml(bingo.name)}</h3>
      <span class="badge ${status.cls}">${status.text}</span>
    </div>
    <p class="bingo-card__meta">${formatDate(bingo.eventDate)}</p>
    <div class="bingo-card__stats">
      <div>Vendidos<strong>${stats.soldCards}/${stats.totalCards}</strong></div>
      <div>Recaudado<strong>${formatCurrency(stats.revenue)}</strong></div>
      <div>Jugadores<strong>${stats.players}</strong></div>
    </div>
    <a class="btn btn-ghost btn-block" href="bingo.html?id=${encodeURIComponent(bingo.id)}">Gestionar bingo →</a>
  `;
  return el;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadBingos(uid, { suppressEmpty = false } = {}) {
  showState("loading");
  const bingos = await getBingosByOrganizer(uid);

  if (bingos.length === 0) {
    showState(suppressEmpty ? "hidden" : "empty");
    return;
  }

  els.grid.innerHTML = "";

  const statsPromises = bingos.map(async (bingo) => {
    const purchases = await getPurchasesByBingo(bingo.id);
    await syncSalesForApprovedPurchases(purchases, bingo);
    return { bingo, stats: computeBingoStats(bingo, purchases) };
  });

  const results = await Promise.all(statsPromises);
  results.forEach(({ bingo, stats }) => {
    els.grid.appendChild(renderBingoCard(bingo, stats));
  });

  showState("grid");
}

function renderPlatformSales(sales) {
  const latest = sales.slice(0, 12);
  if (latest.length === 0) {
    els.platformSalesBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#6b664f;">Todavia no hay ventas registradas.</td></tr>`;
    return;
  }

  els.platformSalesBody.innerHTML = latest
    .map(
      (sale) => `
        <tr>
          <td>${escapeHtml(sale.bingoName || sale.bingoId || "-")}</td>
          <td>${escapeHtml(sale.buyerName || "-")}</td>
          <td>${escapeHtml(sale.organizerName || sale.organizerId || "-")}</td>
          <td>${formatCurrency(sale.grossAmount)}</td>
          <td>${formatCurrency(sale.commissionAmount)}</td>
        </tr>`
    )
    .join("");
}

function getOrganizerMap(organizers, bingos) {
  const map = new Map();

  organizers.forEach((organizer) => {
    map.set(organizer.id, {
      id: organizer.id,
      name: organizer.name || organizer.email || "Organizador",
      email: organizer.email || "",
      bingoCount: 0,
      grossAmount: 0
    });
  });

  bingos.forEach((bingo) => {
    if (!bingo.organizerId) return;
    const existing = map.get(bingo.organizerId) || {
      id: bingo.organizerId,
      name: bingo.organizerName || "Organizador detectado",
      email: "",
      bingoCount: 0,
      grossAmount: 0
    };
    existing.name = existing.name || bingo.organizerName || "Organizador detectado";
    existing.bingoCount += 1;
    map.set(bingo.organizerId, existing);
  });

  return map;
}

function getFilteredPlatformBingos() {
  const term = (els.platformSearch?.value || "").trim().toLowerCase();
  const status = els.platformStatusFilter?.value || "all";

  return platformBingosCache.filter((bingo) => {
    const matchesStatus = status === "all" || bingo.status === status;
    const haystack = [
      bingo.name,
      bingo.id,
      bingo.organizerName,
      bingo.organizerId,
      bingo.status
    ].join(" ").toLowerCase();
    return matchesStatus && (!term || haystack.includes(term));
  });
}

function renderPlatformBingos() {
  const filtered = getFilteredPlatformBingos();
  if (els.platformResultsCount) {
    const cappedText = filtered.length > 30 ? " Mostrando los primeros 30." : "";
    els.platformResultsCount.textContent =
      filtered.length === platformBingosCache.length
        ? `${filtered.length} bingo(s) en total.${cappedText}`
        : `${filtered.length} de ${platformBingosCache.length} bingo(s) encontrados.${cappedText}`;
  }

  const latest = filtered.slice(0, 30);
  if (latest.length === 0) {
    els.platformBingosBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#64736c;">No hay bingos que coincidan con la busqueda.</td></tr>`;
    return;
  }

  els.platformBingosBody.innerHTML = latest
    .map((bingo) => {
      const status = STATUS_LABEL[bingo.status] || STATUS_LABEL[BINGO_STATUS.PUBLISHED];
      const landingUrl = `../../index.html?bingo=${encodeURIComponent(bingo.id)}`;
      return `
        <tr>
          <td>
            <strong>${escapeHtml(bingo.name || bingo.id)}</strong>
            <div class="platform-muted mono">${escapeHtml(bingo.id)}</div>
          </td>
          <td>
            ${escapeHtml(bingo.organizerName || "Sin nombre")}
            <div class="platform-muted mono">${escapeHtml(bingo.organizerId || "-")}</div>
          </td>
          <td><span class="badge ${status.cls}">${status.text}</span></td>
          <td>${formatDate(bingo.eventDate)}</td>
          <td>
            <div class="table-actions">
              <a class="btn btn-ghost btn-small" href="bingo.html?id=${encodeURIComponent(bingo.id)}">Gestionar</a>
              <a class="btn btn-ghost btn-small" href="${landingUrl}" target="_blank" rel="noopener">Ver sala</a>
            </div>
          </td>
        </tr>`;
    })
    .join("");
}

function renderPlatformOrganizers(organizerMap, sales) {
  sales.forEach((sale) => {
    if (!sale.organizerId) return;
    const existing = organizerMap.get(sale.organizerId) || {
      id: sale.organizerId,
      name: sale.organizerName || "Organizador detectado",
      email: "",
      bingoCount: 0,
      grossAmount: 0
    };
    existing.grossAmount += Number(sale.grossAmount) || 0;
    organizerMap.set(sale.organizerId, existing);
  });

  const rows = [...organizerMap.values()].sort((a, b) => b.bingoCount - a.bingoCount || a.name.localeCompare(b.name));
  if (rows.length === 0) {
    els.platformOrganizersBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#64736c;">Todavia no hay organizadores detectados.</td></tr>`;
    return;
  }

  els.platformOrganizersBody.innerHTML = rows
    .map(
      (organizer) => `
        <tr>
          <td>${escapeHtml(organizer.name || "Organizador")}</td>
          <td>
            ${escapeHtml(organizer.email || "Sin perfil registrado")}
            <div class="platform-muted mono">${escapeHtml(organizer.id)}</div>
          </td>
          <td>${organizer.bingoCount}</td>
          <td>${formatCurrency(organizer.grossAmount)}</td>
        </tr>`
    )
    .join("");
}

async function loadPlatformPanel() {
  els.platformPanel.hidden = false;
  els.btnRefreshPlatform.disabled = true;
  els.btnRefreshPlatform.textContent = "Actualizando...";

  try {
    const [bingos, organizers, sales] = await Promise.all([
      getAllBingos(),
      getAllOrganizers(),
      getAllSales()
    ]);
    const summary = computeSalesSummary(sales);
    const organizerMap = getOrganizerMap(organizers, bingos);
    platformBingosCache = bingos;

    els.platformBingos.textContent = bingos.length;
    els.platformOrganizers.textContent = organizerMap.size;
    els.platformGross.textContent = formatCurrency(summary.grossAmount);
    els.platformCommissions.textContent = formatCurrency(summary.commissionAmount);
    renderPlatformSales(sales);
    renderPlatformBingos();
    renderPlatformOrganizers(organizerMap, sales);
  } catch (err) {
    console.error(err);
    showToast("No pudimos cargar el panel de plataforma.", { type: "error" });
  } finally {
    els.btnRefreshPlatform.disabled = false;
    els.btnRefreshPlatform.textContent = "Actualizar";
  }
}

function init() {
  els.btnLogout.addEventListener("click", async () => {
    await logoutOrganizer();
    window.location.href = "login.html";
  });
  els.btnRefreshPlatform?.addEventListener("click", loadPlatformPanel);
  els.platformSearch?.addEventListener("input", renderPlatformBingos);
  els.platformStatusFilter?.addEventListener("change", renderPlatformBingos);
  els.btnScrollBingos?.addEventListener("click", () => {
    document.getElementById("master-bingos-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.btnScrollOrganizers?.addEventListener("click", () => {
    document.getElementById("master-organizers-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  onAuthChanged(async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    els.userName.textContent = user.displayName || user.email;
    els.userInitial.textContent = (user.displayName || user.email || "?").charAt(0).toUpperCase();

    const superAdmin = await isCurrentUserSuperAdmin(user);
    if (superAdmin) {
      els.dashboardTitle.textContent = "Panel master";
      els.dashboardSubtitle.textContent = "Administra toda la plataforma y entra a cualquier bingo para asistir al organizador.";
      loadPlatformPanel();
    }

    loadBingos(user.uid, { suppressEmpty: superAdmin }).catch((err) => {
      console.error(err);
      showToast("No pudimos cargar tus bingos.", { type: "error" });
      showState("empty");
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
