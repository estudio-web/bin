// =============================================================
// CREAR BINGO PAGE (Organizador) — Capa UI
// =============================================================

import { onAuthChanged, logoutOrganizer } from "../../services/auth.service.js";
import { createBingo } from "../../services/bingo.service.js";
import { showToast } from "../../ui/toast.ui.js";

const els = {
  userName: document.getElementById("user-name"),
  userInitial: document.getElementById("user-initial"),
  btnLogout: document.getElementById("btn-logout"),
  form: document.getElementById("create-form"),
  btnSubmit: document.getElementById("btn-submit"),
  name: document.getElementById("f-name"),
  description: document.getElementById("f-description"),
  prizes: document.getElementById("f-prizes"),
  prizeTerna: document.getElementById("f-prize-terna"),
  prizeLinea: document.getElementById("f-prize-linea"),
  prizeBingo: document.getElementById("f-prize-bingo"),
  limitTerna: document.getElementById("f-limit-terna"),
  limitLinea: document.getElementById("f-limit-linea"),
  limitBingo: document.getElementById("f-limit-bingo"),
  date: document.getElementById("f-date"),
  youtube: document.getElementById("f-youtube"),
  price: document.getElementById("f-price"),
  total: document.getElementById("f-total"),
  logo: document.getElementById("f-logo"),
  organizerName: document.getElementById("f-organizer-name"),
  alias: document.getElementById("f-alias"),
  cbu: document.getElementById("f-cbu"),
  errName: document.getElementById("err-name"),
  errPrizes: document.getElementById("err-prizes"),
  errDate: document.getElementById("err-date"),
  errPrice: document.getElementById("err-price"),
  errTotal: document.getElementById("err-total"),
  errOrganizerName: document.getElementById("err-organizer-name"),
  errAlias: document.getElementById("err-alias"),
  errCbu: document.getElementById("err-cbu")
};

let currentUser = null;

function clearErrors() {
  [els.errName, els.errPrizes, els.errDate, els.errPrice, els.errTotal, els.errOrganizerName, els.errAlias, els.errCbu].forEach(
    (el) => (el.textContent = "")
  );
}

function validate() {
  clearErrors();
  let valid = true;

  if (els.name.value.trim().length < 3) {
    els.errName.textContent = "Ingresá un nombre para el bingo.";
    valid = false;
  }
  if (els.prizes.value.trim().length < 3) {
    els.errPrizes.textContent = "Agregá al menos un premio.";
    valid = false;
  }
  if (!els.date.value) {
    els.errDate.textContent = "Elegí la fecha y hora del sorteo.";
    valid = false;
  }
  if (!els.price.value || Number(els.price.value) <= 0) {
    els.errPrice.textContent = "Ingresá un precio válido.";
    valid = false;
  }
  if (!els.total.value || Number(els.total.value) <= 0) {
    els.errTotal.textContent = "Ingresá una cantidad válida.";
    valid = false;
  }
  if (els.organizerName.value.trim().length < 3) {
    els.errOrganizerName.textContent = "Ingresá el nombre del titular de la cuenta.";
    valid = false;
  }
  if (els.alias.value.trim().length < 3) {
    els.errAlias.textContent = "Ingresá el alias de la cuenta.";
    valid = false;
  }
  if (els.cbu.value.trim().replace(/\D/g, "").length < 20) {
    els.errCbu.textContent = "El CBU debe tener 22 dígitos.";
    valid = false;
  }

  return valid;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validate() || !currentUser) return;

  els.btnSubmit.disabled = true;
  els.btnSubmit.textContent = "Creando bingo...";

  try {
    const id = await createBingo({
      organizerId: currentUser.uid,
      organizerName: els.organizerName.value.trim(),
      name: els.name.value.trim(),
      description: els.description.value.trim(),
      prizes: els.prizes.value.trim(),
      prizeByType: {
        terna: els.prizeTerna.value.trim(),
        linea: els.prizeLinea.value.trim(),
        bingo: els.prizeBingo.value.trim()
      },
      winnerLimits: {
        terna: Number(els.limitTerna.value) || 0,
        linea: Number(els.limitLinea.value) || 0,
        bingo: Number(els.limitBingo.value) || 0
      },
      eventDate: new Date(els.date.value).toISOString(),
      cardPrice: Number(els.price.value),
      totalCards: Number(els.total.value),
      cbu: els.cbu.value.trim(),
      alias: els.alias.value.trim(),
      youtubeUrl: els.youtube.value.trim(),
      logoUrl: els.logo.value.trim()
    });

    showToast("¡Bingo creado con éxito!");
    window.location.href = `bingo.html?id=${encodeURIComponent(id)}`;
  } catch (err) {
    console.error(err);
    showToast("No pudimos crear el bingo. Probá de nuevo.", { type: "error" });
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = "Crear bingo";
  }
}

function init() {
  els.btnLogout.addEventListener("click", async () => {
    await logoutOrganizer();
    window.location.href = "login.html";
  });

  onAuthChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    currentUser = user;
    els.userName.textContent = user.displayName || user.email;
    els.userInitial.textContent = (user.displayName || user.email || "?").charAt(0).toUpperCase();
  });

  els.form.addEventListener("submit", handleSubmit);
}

document.addEventListener("DOMContentLoaded", init);
