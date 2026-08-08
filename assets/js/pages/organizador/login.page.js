// =============================================================
// LOGIN PAGE (Organizador) — Capa UI
// =============================================================

import { registerOrganizer, loginOrganizer, onAuthChanged, translateAuthError } from "../../services/auth.service.js";
import { showToast } from "../../ui/toast.ui.js";

const els = {
  tabLogin: document.getElementById("tab-login"),
  tabRegister: document.getElementById("tab-register"),
  fieldName: document.getElementById("field-name"),
  regName: document.getElementById("reg-name"),
  nameError: document.getElementById("name-error"),
  email: document.getElementById("auth-email"),
  emailError: document.getElementById("email-error"),
  password: document.getElementById("auth-password"),
  passwordError: document.getElementById("password-error"),
  form: document.getElementById("auth-form"),
  btnSubmit: document.getElementById("btn-submit"),
  title: document.getElementById("auth-title"),
  hint: document.getElementById("auth-hint")
};

let mode = "login"; // login | register

function setMode(newMode) {
  mode = newMode;
  const isRegister = mode === "register";

  els.tabLogin.classList.toggle("is-active", !isRegister);
  els.tabRegister.classList.toggle("is-active", isRegister);
  els.fieldName.hidden = !isRegister;
  els.btnSubmit.textContent = isRegister ? "Crear cuenta" : "Iniciar sesión";
  els.title.textContent = isRegister ? "Creá tu cuenta de organizador" : "Ingresá a tu panel";
  els.hint.textContent = isRegister
    ? "Vas a poder crear bingos, aprobar pagos y sortear en vivo."
    : "Gestioná tus bingos, aprobá pagos y controlá el sorteo en vivo.";
  clearErrors();
}

function clearErrors() {
  els.nameError.textContent = "";
  els.emailError.textContent = "";
  els.passwordError.textContent = "";
}

function validate() {
  let valid = true;
  clearErrors();

  if (mode === "register" && els.regName.value.trim().length < 3) {
    els.nameError.textContent = "Ingresá el nombre del organizador.";
    valid = false;
  }

  if (!els.email.value.includes("@")) {
    els.emailError.textContent = "Ingresá un email válido.";
    valid = false;
  }

  if (els.password.value.length < 6) {
    els.passwordError.textContent = "La contraseña debe tener al menos 6 caracteres.";
    valid = false;
  }

  return valid;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validate()) return;

  els.btnSubmit.disabled = true;
  els.btnSubmit.textContent = "Procesando...";

  try {
    if (mode === "register") {
      await registerOrganizer({
        name: els.regName.value.trim(),
        email: els.email.value.trim(),
        password: els.password.value
      });
    } else {
      await loginOrganizer({
        email: els.email.value.trim(),
        password: els.password.value
      });
    }
    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    showToast(translateAuthError(err), { type: "error" });
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = mode === "register" ? "Crear cuenta" : "Iniciar sesión";
  }
}

function init() {
  els.tabLogin.addEventListener("click", () => setMode("login"));
  els.tabRegister.addEventListener("click", () => setMode("register"));
  els.form.addEventListener("submit", handleSubmit);

  // Si ya hay sesión activa, va directo al dashboard.
  onAuthChanged((user) => {
    if (user) window.location.href = "dashboard.html";
  });
}

document.addEventListener("DOMContentLoaded", init);
