// =============================================================
// STORAGE SERVICE — Capa Services
// -------------------------------------------------------------
// Sube comprobantes de pago a ImgBB (más simple y económico que
// Firebase Storage para el volumen de un MVP). Firebase Storage
// queda disponible vía firebase-config.js para usos futuros
// (logos de bingo, adjuntos del organizador, etc.).
// =============================================================

import { IMGBB_API_KEY, IMGBB_ENDPOINT } from "../config/firebase-config.js";

const MAX_FILE_SIZE_MB = 8;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/**
 * Valida el archivo del comprobante antes de subirlo.
 * @param {File} file
 * @returns {string|null} mensaje de error, o null si es válido
 */
export function validateReceiptFile(file) {
  if (!file) return "Seleccioná una imagen del comprobante.";
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Formato no soportado. Subí una imagen JPG, PNG o WEBP.";
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return `La imagen supera los ${MAX_FILE_SIZE_MB}MB permitidos.`;
  }
  return null;
}

/**
 * Sube la imagen del comprobante a ImgBB y devuelve la URL pública.
 * @param {File} file
 * @returns {Promise<string>} URL de la imagen subida
 */
export async function uploadReceiptImage(file) {
  const error = validateReceiptFile(file);
  if (error) throw new Error(error);

  const base64 = await fileToBase64(file);
  const formData = new FormData();
  formData.append("key", IMGBB_API_KEY);
  formData.append("image", base64);

  const response = await fetch(IMGBB_ENDPOINT, {
    method: "POST",
    body: formData
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.success) {
    throw new Error("No pudimos subir el comprobante. Probá nuevamente.");
  }

  return result.data.url;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // ImgBB espera el string base64 sin el prefijo "data:image/...;base64,"
      const base64String = reader.result.split(",")[1];
      resolve(base64String);
    };
    reader.onerror = () => reject(new Error("No pudimos leer la imagen seleccionada."));
    reader.readAsDataURL(file);
  });
}
