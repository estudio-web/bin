// =============================================================
// PLATFORM SERVICE - Lecturas de super admin
// =============================================================

import { db } from "../config/firebase-config.js";
import { COLLECTIONS } from "../config/constants.js";
import {
  collection,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function isCurrentUserSuperAdmin(user) {
  if (!user) return false;
  if (user.email === "tompsonfulner@gmail.com") return true;

  try {
    const ref = doc(db, COLLECTIONS.PLATFORM_SETTINGS, "super_admins", "users", user.uid);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch {
    return false;
  }
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => {
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0;
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0;
    return bTime - aTime;
  });
}

export async function getAllBingos() {
  const snap = await getDocs(collection(db, COLLECTIONS.BINGOS));
  return sortByCreatedAtDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

export async function getAllOrganizers() {
  const snap = await getDocs(collection(db, COLLECTIONS.ORGANIZERS));
  return sortByCreatedAtDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}
