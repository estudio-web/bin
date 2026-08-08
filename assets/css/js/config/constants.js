// =============================================================
// CONSTANTES DE DOMINIO
// -------------------------------------------------------------
// Nombres de colecciones y enums compartidos por todos los
// Services. Cambiar un nombre de colección se hace UNA sola vez
// acá y se propaga a todo el sistema.
// =============================================================

export const COLLECTIONS = Object.freeze({
  BINGOS: "bingos",
  CARDS: "cards",
  PURCHASES: "purchases",
  CHAT: "chat_messages",
  DRAWS: "draws",
  ORGANIZERS: "organizers",
  AUDIT: "audit_log",
  SALES: "sales",
  COMMISSION_MOVEMENTS: "commission_movements",
  PLATFORM_SETTINGS: "platform_settings"
});

export const USER_ROLE = Object.freeze({
  SUPER_ADMIN: "super_admin",
  ORGANIZER: "organizer",
  PLAYER: "player"
});

export const BINGO_STATUS = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
  LIVE: "live",
  FINISHED: "finished",
  CANCELLED: "cancelled"
});

export const PURCHASE_STATUS = Object.freeze({
  PENDING: "pending", // esperando comprobante
  REVIEW: "review", // comprobante subido, esperando aprobación
  APPROVED: "approved",
  REJECTED: "rejected"
});

export const WIN_TYPE = Object.freeze({
  TERNA: "terna",
  LINEA: "linea",
  BINGO: "bingo"
});

// Bingo familiar de 90 bolillas: cartón de 3 filas x 9 columnas.
export const CARD_RANGES = Object.freeze([
  [1, 9],
  [10, 19],
  [20, 29],
  [30, 39],
  [40, 49],
  [50, 59],
  [60, 69],
  [70, 79],
  [80, 90]
]);

export const TOTAL_BALLS = 90;
