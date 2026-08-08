// =============================================================
// DRAW SERVICE — Capa Services (Motor del bingo)
// -------------------------------------------------------------
// Controla el sorteo de bolillas sobre el propio documento del
// bingo (calledBalls, currentBall). Firestore onSnapshot se
// encarga de propagar cada bolilla en tiempo real tanto al
// panel del organizador como a la sala del jugador.
// =============================================================

import { db } from "../config/firebase-config.js";
import { COLLECTIONS, BINGO_STATUS, TOTAL_BALLS } from "../config/constants.js";
import { logAuditEvent } from "./audit.service.js";
import { generateId } from "../utils/format.utils.js";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Devuelve el prefijo de bolilla. En el formato 90 bolillas no hay letras.
 */
export function getBallLetter() {
  return "";
}

/**
 * Pone el bingo en vivo (habilita la sala del jugador y el sorteo).
 */
export async function startBingo(bingoId) {
  const ref = doc(db, COLLECTIONS.BINGOS, bingoId);
  const snap = await getDoc(ref);
  const bingo = snap.exists() ? snap.data() : {};
  const sessionId = bingo.status === BINGO_STATUS.FINISHED || !bingo.currentSessionId
    ? generateId("session")
    : bingo.currentSessionId;
  await updateDoc(ref, {
    status: BINGO_STATUS.LIVE,
    currentSessionId: sessionId,
    calledBalls: [],
    currentBall: null,
    winners: { terna: [], linea: [], bingo: [] },
    sessionStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await logAuditEvent({ bingoId, sessionId, type: "bingo_started", detail: "El organizador inició una nueva partida." });
}

/**
 * Sortea la siguiente bolilla sin repetir números ya cantados.
 * @param {Object} bingo  documento actual del bingo (con calledBalls)
 * @returns {Promise<number|null>} la bolilla sorteada, o null si ya se cantaron todas
 */
export async function drawNextBall(bingo) {
  const called = new Set(bingo.calledBalls || []);
  if (called.size >= TOTAL_BALLS) return null;

  let ball;
  do {
    ball = Math.floor(Math.random() * TOTAL_BALLS) + 1;
  } while (called.has(ball));

  const ref = doc(db, COLLECTIONS.BINGOS, bingo.id);
  await updateDoc(ref, {
    calledBalls: arrayUnion(ball),
    currentBall: ball,
    updatedAt: serverTimestamp()
  });

  await logAuditEvent({
    bingoId: bingo.id,
    sessionId: bingo.currentSessionId || null,
    type: "ball_drawn",
    detail: `Se cantó la bolilla ${getBallLetter(ball)}-${ball}`,
    meta: { ball }
  });

  return ball;
}

export async function addManualBall(bingo, ball) {
  const value = Number(ball);
  if (!Number.isInteger(value) || value < 1 || value > TOTAL_BALLS) {
    throw new Error(`La bolilla debe estar entre 1 y ${TOTAL_BALLS}.`);
  }

  const called = new Set(bingo.calledBalls || []);
  if (called.has(value)) {
    throw new Error(`La bolilla ${value} ya fue cantada.`);
  }

  const ref = doc(db, COLLECTIONS.BINGOS, bingo.id);
  await updateDoc(ref, {
    calledBalls: arrayUnion(value),
    currentBall: value,
    updatedAt: serverTimestamp()
  });

  await logAuditEvent({
    bingoId: bingo.id,
    sessionId: bingo.currentSessionId || null,
    type: "ball_drawn",
    detail: `Se cargó manualmente la bolilla ${getBallLetter(value)}${value}`,
    meta: { ball: value, source: "manual" }
  });

  return value;
}

export async function removeLastBall(bingo, reason = "") {
  const calledBalls = Array.isArray(bingo?.calledBalls) ? bingo.calledBalls : [];
  if (calledBalls.length === 0) return null;

  const removedBall = calledBalls[calledBalls.length - 1];
  const nextCurrentBall = calledBalls.length > 1 ? calledBalls[calledBalls.length - 2] : null;
  const ref = doc(db, COLLECTIONS.BINGOS, bingo.id);

  await updateDoc(ref, {
    calledBalls: arrayRemove(removedBall),
    currentBall: nextCurrentBall,
    updatedAt: serverTimestamp()
  });

  const liveText = bingo.status === BINGO_STATUS.LIVE
    ? " durante el sorteo en vivo"
    : " antes del inicio visible del sorteo";

  await logAuditEvent({
    bingoId: bingo.id,
    sessionId: bingo.currentSessionId || null,
    type: "ball_removed",
    detail: `Se anuló la bolilla ${removedBall}${liveText}${reason ? `: ${reason}` : ""}`,
    meta: { ball: removedBall, reason, bingoStatus: bingo.status }
  });

  return removedBall;
}

export async function resetVisibleDrawState(bingo, reason = "Limpieza manual de bolillas anteriores") {
  if (!bingo?.id) throw new Error("El bingo no existe.");

  const ref = doc(db, COLLECTIONS.BINGOS, bingo.id);
  const previousSessionId = bingo.currentSessionId || null;
  const nextSessionId = generateId("session");

  await updateDoc(ref, {
    status: BINGO_STATUS.PUBLISHED,
    currentSessionId: nextSessionId,
    calledBalls: [],
    currentBall: null,
    winners: { terna: [], linea: [], bingo: [] },
    sessionStartedAt: null,
    updatedAt: serverTimestamp()
  });

  await logAuditEvent({
    bingoId: bingo.id,
    sessionId: previousSessionId,
    type: "session_reset",
    detail: `${reason}. Se ocultaron las bolillas y ganadores de la partida anterior para iniciar una nueva sesión.`,
    meta: {
      previousSessionId,
      nextSessionId,
      masterOnly: true
    }
  });

  return nextSessionId;
}

/**
 * Registra un ganador declarado por el organizador (terna, línea o bingo).
 */
export async function declareWinner(bingoId, winType, winnerInfo) {
  const ref = doc(db, COLLECTIONS.BINGOS, bingoId);
  await updateDoc(ref, {
    [`winners.${winType}`]: arrayUnion(winnerInfo),
    updatedAt: serverTimestamp()
  });
  await logAuditEvent({
    bingoId,
    sessionId: winnerInfo.sessionId || null,
    type: "winner_declared",
    detail: `${winnerInfo.ownerName} ganó ${winType.toUpperCase()}${winnerInfo.cardVisibleId || winnerInfo.cardId ? ` con el cartón ${winnerInfo.cardVisibleId || winnerInfo.cardId}` : ""}${winnerInfo.prize ? ` — Premio: ${winnerInfo.prize}` : ""}`,
    meta: { ...winnerInfo, winType }
  });
}

/**
 * Finaliza el bingo: no se pueden cantar más bolillas ni comprar cartones.
 */
export async function finishBingo(bingoOrId) {
  const bingoId = typeof bingoOrId === "string" ? bingoOrId : bingoOrId.id;
  const sessionId = typeof bingoOrId === "string" ? null : bingoOrId.currentSessionId || null;
  const ref = doc(db, COLLECTIONS.BINGOS, bingoId);
  await updateDoc(ref, { status: BINGO_STATUS.FINISHED, updatedAt: serverTimestamp() });
  await logAuditEvent({ bingoId, sessionId, type: "bingo_finished", detail: "El organizador finalizó la partida." });
}
