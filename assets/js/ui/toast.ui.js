// =============================================================
// TOAST UI — feedback no bloqueante, reutilizable en toda la app
// =============================================================

let hideTimeout = null;

export function showToast(message, { type = "info", duration = 3200 } = {}) {
  const toastEl = document.getElementById("toast");
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.classList.remove("is-error");
  if (type === "error") toastEl.classList.add("is-error");

  toastEl.classList.add("is-visible");

  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    toastEl.classList.remove("is-visible");
  }, duration);
}
