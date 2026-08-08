import { db } from "../config/firebase-config.js";
import { COLLECTIONS } from "../config/constants.js";
import {
  addDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MAX_MESSAGE_LENGTH = 240;

function normalizeMessage(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function timestampToMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  if (value) {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
}

export function subscribeToBingoChat(bingoId, sessionId, callback) {
  const messagesRef = collection(db, COLLECTIONS.CHAT);
  const constraints = [where("bingoId", "==", bingoId)];
  if (sessionId) constraints.push(where("sessionId", "==", sessionId));
  const q = query(messagesRef, ...constraints);

  return onSnapshot(q, (snap) => {
    const messages = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => timestampToMillis(a.createdAt) - timestampToMillis(b.createdAt))
      .slice(-80);
    callback(messages);
  });
}

export async function sendChatMessage({ bingoId, sessionId, senderRole, senderName, text, kind = "message" }) {
  const message = normalizeMessage(text);
  if (!bingoId || !message) return;

  await addDoc(collection(db, COLLECTIONS.CHAT), {
    bingoId,
    sessionId: sessionId || null,
    senderRole: senderRole === "organizer" ? "organizer" : "player",
    senderName: normalizeMessage(senderName || (senderRole === "organizer" ? "Organizador" : "Jugador")).slice(0, 60),
    kind: kind === "announcement" ? "announcement" : "message",
    text: message,
    createdAt: serverTimestamp()
  });
}

export async function clearBingoChat(bingoId, sessionId) {
  if (!bingoId) return 0;

  const messagesRef = collection(db, COLLECTIONS.CHAT);
  const constraints = [where("bingoId", "==", bingoId)];
  if (sessionId) constraints.push(where("sessionId", "==", sessionId));
  const snap = await getDocs(query(messagesRef, ...constraints));

  await Promise.all(snap.docs.map((docSnap) => deleteDoc(docSnap.ref)));
  return snap.size;
}
