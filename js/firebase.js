import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  limit,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/*
==================================================
CONVERSATE PRO JAPANESE — EXPERIMENTAL FIREBASE LAYER
==================================================

This intentionally uses a custom username/password system so the project
owner can learn, create multiple test users, switch accounts, and inspect
all of the data directly in Firestore.

IMPORTANT:
Passwords are stored as plain text ONLY because this is a private learning
experiment, matching the older prototype behavior. Do not use this account
system for a public production application.
==================================================
*/

const firebaseConfig = {
  apiKey: "AIzaSyDVh4UFpUIGLIDllXgB4V03PPHncg6llIA",
  authDomain: "two-todolist-project.firebaseapp.com",
  projectId: "two-todolist-project",
  storageBucket: "two-todolist-project.firebasestorage.app",
  messagingSenderId: "981585696379",
  appId: "1:981585696379:web:fcd35ed7176c86c64ef4de"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const database = getFirestore(app);

const COLLECTIONS = Object.freeze({
  accounts: "conversateJapanese_accounts",
  users: "conversateJapanese_users",
  rooms: "rooms",
  sentences: "sentences",
  paragraphs: "paragraphs"
});

const STORAGE_KEYS = Object.freeze({
  session: "conversateproJapanese.session.v1",
  activeRoomId: "conversateproJapanese.activeRoomId.v1",
  activeRoomLegacy: "conversateproJapanese.activeRoom.v1"
});

function nowISO() {
  return new Date().toISOString();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function normalizeUsername(value) {
  return cleanText(value).toLowerCase();
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeAccount(account) {
  if (!account) return null;

  return {
    userId: cleanText(account.userId || account.user_idx || account.id),
    user_idx: cleanText(account.userId || account.user_idx || account.id),
    name: cleanText(account.name),
    email: cleanText(account.email),
    username: cleanText(account.username),
    createdAt: cleanText(account.createdAt)
  };
}

function saveSession(account) {
  const safe = safeAccount(account);

  if (!safe?.userId) {
    throw new Error("Cannot save an invalid account session.");
  }

  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(safe));
  return safe;
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.session);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed?.userId ? parsed : null;
  } catch (_) {
    return null;
  }
}

function getSessionUserId() {
  return cleanText(getCurrentUser()?.userId);
}

function isLoggedIn() {
  return Boolean(getSessionUserId());
}

function clearActiveRoom() {
  localStorage.removeItem(STORAGE_KEYS.activeRoomId);
  localStorage.removeItem(STORAGE_KEYS.activeRoomLegacy);
}

function logout() {
  localStorage.removeItem(STORAGE_KEYS.session);
  clearActiveRoom();
}

function requireUserId() {
  const userId = getSessionUserId();

  if (!userId) {
    throw new Error("You must login before using this feature.");
  }

  return userId;
}

async function findAccountByUsername(username) {
  const usernameLower = normalizeUsername(username);
  if (!usernameLower) return null;

  const q = query(
    collection(database, COLLECTIONS.accounts),
    where("usernameLower", "==", usernameLower),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;

  const hit = snapshot.docs[0];
  return { id: hit.id, ...hit.data() };
}

async function findAccountByEmail(email) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) return null;

  const q = query(
    collection(database, COLLECTIONS.accounts),
    where("emailLower", "==", emailLower),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;

  const hit = snapshot.docs[0];
  return { id: hit.id, ...hit.data() };
}

async function registerUser(details = {}) {
  const name = cleanText(details.name);
  const email = cleanText(details.email);
  const username = cleanText(details.username);
  const password = String(details.password ?? "");

  if (!name || !email || !username || !password) {
    throw new Error("Complete all registration fields.");
  }

  if (username.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }

  if (password.length < 4) {
    throw new Error("For this experiment, use a password with at least 4 characters.");
  }

  const [existingUsername, existingEmail] = await Promise.all([
    findAccountByUsername(username),
    findAccountByEmail(email)
  ]);

  if (existingUsername) {
    throw new Error("That username already exists.");
  }

  if (existingEmail) {
    throw new Error("An account already uses that email.");
  }

  const userId = createId("user");
  const timestamp = nowISO();

  const account = {
    userId,
    user_idx: userId,
    name,
    email,
    emailLower: normalizeEmail(email),
    username,
    usernameLower: normalizeUsername(username),

    // EXPERIMENT ONLY — deliberately mirrors the old custom-auth prototype.
    password,

    createdAt: timestamp,
    updatedAt: timestamp
  };

  const profile = {
    userId,
    user_idx: userId,
    name,
    email,
    username,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const batch = writeBatch(database);
  batch.set(doc(database, COLLECTIONS.accounts, userId), account);
  batch.set(doc(database, COLLECTIONS.users, userId), profile);
  await batch.commit();

  return saveSession(account);
}

async function loginUser(username, password) {
  username = cleanText(username);
  password = String(password ?? "");

  if (!username || !password) {
    throw new Error("Enter your username and password.");
  }

  const account = await findAccountByUsername(username);

  if (!account) {
    throw new Error("Username was not found.");
  }

  if (String(account.password ?? "") !== password) {
    throw new Error("Password is incorrect.");
  }

  const userId = cleanText(account.userId || account.user_idx || account.id);
  account.userId = userId;
  account.user_idx = userId;

  clearActiveRoom();
  return saveSession(account);
}

async function getFreshCurrentUser() {
  const userId = getSessionUserId();
  if (!userId) return null;

  const snapshot = await getDoc(doc(database, COLLECTIONS.accounts, userId));

  if (!snapshot.exists()) {
    logout();
    return null;
  }

  const account = { id: snapshot.id, ...snapshot.data() };
  return saveSession(account);
}

function userDocRef(userId = requireUserId()) {
  return doc(database, COLLECTIONS.users, userId);
}

function roomsCollectionRef(userId = requireUserId()) {
  return collection(userDocRef(userId), COLLECTIONS.rooms);
}

function roomDocRef(roomId, userId = requireUserId()) {
  roomId = cleanText(roomId);
  if (!roomId) throw new Error("Room ID is required.");
  return doc(roomsCollectionRef(userId), roomId);
}

function sentencesCollectionRef(roomId, userId = requireUserId()) {
  return collection(roomDocRef(roomId, userId), COLLECTIONS.sentences);
}

function sentenceDocRef(roomId, sentenceId, userId = requireUserId()) {
  sentenceId = cleanText(sentenceId);
  if (!sentenceId) throw new Error("Sentence ID is required.");
  return doc(sentencesCollectionRef(roomId, userId), sentenceId);
}

function paragraphsCollectionRef(roomId, userId = requireUserId()) {
  return collection(roomDocRef(roomId, userId), COLLECTIONS.paragraphs);
}

function paragraphDocRef(roomId, paragraphId, userId = requireUserId()) {
  paragraphId = cleanText(paragraphId);
  if (!paragraphId) throw new Error("Paragraph ID is required.");
  return doc(paragraphsCollectionRef(roomId, userId), paragraphId);
}

async function createRoom(name, direction = "en-ja") {
  const userId = requireUserId();
  name = cleanText(name);

  if (!name) {
    throw new Error("Conversation name is required.");
  }

  if (!new Set(["en-ja", "ja-en"]).has(direction)) {
    throw new Error("Invalid room direction.");
  }

  const timestamp = nowISO();
  const room = {
    id: createId("room"),
    userId,
    name,
    direction,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await setDoc(roomDocRef(room.id, userId), room);
  return clone(room);
}

async function getRooms() {
  const userId = requireUserId();
  const snapshot = await getDocs(roomsCollectionRef(userId));

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

async function getRoom(roomId) {
  const snapshot = await getDoc(roomDocRef(roomId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function updateRoom(roomId, changes = {}) {
  const current = await getRoom(roomId);
  if (!current) throw new Error("Conversation room was not found.");

  const next = {
    ...current,
    ...(cleanText(changes.name) ? { name: cleanText(changes.name) } : {}),
    ...(changes.direction === "en-ja" || changes.direction === "ja-en"
      ? { direction: changes.direction }
      : {}),
    updatedAt: nowISO()
  };

  await setDoc(roomDocRef(roomId), next, { merge: true });

  const activeId = getActiveRoomId();
  if (activeId === roomId) setActiveRoom(next);

  return clone(next);
}

function setActiveRoom(roomOrId) {
  const roomId = cleanText(typeof roomOrId === "string" ? roomOrId : roomOrId?.id);
  if (!roomId) throw new Error("Room ID is required.");

  localStorage.setItem(STORAGE_KEYS.activeRoomId, roomId);

  // Keep compatibility with the current experimental app.js until it is
  // switched fully to Firestore in the next integration step.
  if (typeof roomOrId === "object" && roomOrId) {
    localStorage.setItem(STORAGE_KEYS.activeRoomLegacy, JSON.stringify(roomOrId));
  }
}

function getActiveRoomId() {
  return cleanText(localStorage.getItem(STORAGE_KEYS.activeRoomId));
}

async function getActiveRoom() {
  const roomId = getActiveRoomId();
  if (!roomId) return null;
  return getRoom(roomId);
}

async function deleteCollectionDocuments(collectionRef) {
  const snapshot = await getDocs(collectionRef);
  if (snapshot.empty) return;

  const docs = snapshot.docs;
  const chunkSize = 400;

  for (let i = 0; i < docs.length; i += chunkSize) {
    const batch = writeBatch(database);
    docs.slice(i, i + chunkSize).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

async function deleteRoom(roomId) {
  roomId = cleanText(roomId);
  if (!roomId) throw new Error("Room ID is required.");

  await deleteCollectionDocuments(sentencesCollectionRef(roomId));
  await deleteCollectionDocuments(paragraphsCollectionRef(roomId));
  await deleteDoc(roomDocRef(roomId));

  if (getActiveRoomId() === roomId) {
    clearActiveRoom();
  }
}

async function saveSentence(roomId, sentence) {
  const data = clone(sentence || {});
  const sentenceId = cleanText(data.id) || createId("sentence");
  const timestamp = nowISO();

  data.id = sentenceId;
  data.updatedAt = timestamp;
  data.createdAt = cleanText(data.createdAt) || timestamp;

  await setDoc(sentenceDocRef(roomId, sentenceId), data);
  await setDoc(roomDocRef(roomId), { updatedAt: timestamp }, { merge: true });

  return clone(data);
}

async function getSentences(roomId) {
  const snapshot = await getDocs(sentencesCollectionRef(roomId));

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
}

async function deleteSentence(roomId, sentenceId) {
  await deleteDoc(sentenceDocRef(roomId, sentenceId));
  await setDoc(roomDocRef(roomId), { updatedAt: nowISO() }, { merge: true });
}

async function saveParagraph(roomId, paragraph) {
  const data = clone(paragraph || {});
  const paragraphId = cleanText(data.id) || createId("paragraph");
  const timestamp = nowISO();

  data.id = paragraphId;
  data.updatedAt = timestamp;
  data.createdAt = cleanText(data.createdAt) || timestamp;

  await setDoc(paragraphDocRef(roomId, paragraphId), data);
  await setDoc(roomDocRef(roomId), { updatedAt: timestamp }, { merge: true });

  return clone(data);
}


async function saveSentenceAndParagraph(roomId, sentence, paragraph) {
  roomId = cleanText(roomId);
  if (!roomId) throw new Error("Room ID is required.");

  const sentenceData = clone(sentence || {});
  const paragraphData = clone(paragraph || {});

  const sentenceId = cleanText(sentenceData.id);
  const paragraphId = cleanText(paragraphData.id);

  if (!sentenceId) throw new Error("Sentence ID is required.");
  if (!paragraphId) throw new Error("Paragraph ID is required.");

  const timestamp = nowISO();

  sentenceData.id = sentenceId;
  sentenceData.updatedAt = timestamp;
  sentenceData.createdAt = cleanText(sentenceData.createdAt) || timestamp;

  paragraphData.id = paragraphId;
  paragraphData.updatedAt = timestamp;
  paragraphData.createdAt = cleanText(paragraphData.createdAt) || timestamp;

  const batch = writeBatch(database);

  batch.set(sentenceDocRef(roomId, sentenceId), sentenceData);
  batch.set(paragraphDocRef(roomId, paragraphId), paragraphData);
  batch.set(roomDocRef(roomId), { updatedAt: timestamp }, { merge: true });

  await batch.commit();

  return {
    sentence: clone(sentenceData),
    paragraph: clone(paragraphData)
  };
}

async function getParagraphs(roomId) {
  const snapshot = await getDocs(paragraphsCollectionRef(roomId));

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(a.anchorOrder ?? 0) - Number(b.anchorOrder ?? 0));
}

async function deleteParagraph(roomId, paragraphId) {
  await deleteDoc(paragraphDocRef(roomId, paragraphId));
  await setDoc(roomDocRef(roomId), { updatedAt: nowISO() }, { merge: true });
}


async function replaceParagraphGrouping(roomId, details = {}) {
  roomId = cleanText(roomId);
  if (!roomId) throw new Error("Room ID is required.");

  const paragraph = clone(details.paragraph || {});
  const paragraphId = cleanText(paragraph.id) || createId("paragraph");
  const sentenceIds = Array.from(new Set(
    (Array.isArray(paragraph.sentenceIds) ? paragraph.sentenceIds : [])
      .map(cleanText)
      .filter(Boolean)
  ));
  const deleteParagraphIds = Array.from(new Set(
    (Array.isArray(details.deleteParagraphIds) ? details.deleteParagraphIds : [])
      .map(cleanText)
      .filter((id) => id && id !== paragraphId)
  ));

  if (sentenceIds.length < 2) {
    throw new Error("A paragraph needs at least two sentences.");
  }

  if (sentenceIds.length + deleteParagraphIds.length > 450) {
    throw new Error("This paragraph is too large for one experimental Firestore batch.");
  }

  const timestamp = nowISO();
  paragraph.id = paragraphId;
  paragraph.sentenceIds = sentenceIds;
  paragraph.updatedAt = timestamp;
  paragraph.createdAt = cleanText(paragraph.createdAt) || timestamp;

  const batch = writeBatch(database);

  batch.set(paragraphDocRef(roomId, paragraphId), paragraph);

  sentenceIds.forEach((sentenceId) => {
    batch.set(
      sentenceDocRef(roomId, sentenceId),
      { paragraphId, updatedAt: timestamp },
      { merge: true }
    );
  });

  deleteParagraphIds.forEach((oldParagraphId) => {
    batch.delete(paragraphDocRef(roomId, oldParagraphId));
  });

  batch.set(roomDocRef(roomId), { updatedAt: timestamp }, { merge: true });
  await batch.commit();

  return clone(paragraph);
}

async function breakdownParagraphGrouping(roomId, paragraph) {
  roomId = cleanText(roomId);
  if (!roomId) throw new Error("Room ID is required.");

  const data = clone(paragraph || {});
  const paragraphId = cleanText(data.id);
  const sentenceIds = Array.from(new Set(
    (Array.isArray(data.sentenceIds) ? data.sentenceIds : [])
      .map(cleanText)
      .filter(Boolean)
  ));

  if (!paragraphId) {
    throw new Error("Paragraph ID is required.");
  }

  if (sentenceIds.length > 450) {
    throw new Error("This paragraph is too large for one experimental Firestore batch.");
  }

  const timestamp = nowISO();
  const batch = writeBatch(database);

  batch.delete(paragraphDocRef(roomId, paragraphId));

  sentenceIds.forEach((sentenceId) => {
    batch.set(
      sentenceDocRef(roomId, sentenceId),
      { paragraphId: null, updatedAt: timestamp },
      { merge: true }
    );
  });

  batch.set(roomDocRef(roomId), { updatedAt: timestamp }, { merge: true });
  await batch.commit();
}

async function loadRoomData(roomId) {
  const [room, sentences, paragraphs] = await Promise.all([
    getRoom(roomId),
    getSentences(roomId),
    getParagraphs(roomId)
  ]);

  if (!room) {
    throw new Error("Conversation room was not found.");
  }

  return { room, sentences, paragraphs };
}

const ConversateFirebase = Object.freeze({
  database,
  firebaseConfig: clone(firebaseConfig),
  COLLECTIONS,
  STORAGE_KEYS,

  registerUser,
  loginUser,
  logout,
  getCurrentUser,
  getFreshCurrentUser,
  getSessionUserId,
  isLoggedIn,
  findAccountByUsername,

  createRoom,
  getRooms,
  getRoom,
  updateRoom,
  deleteRoom,
  setActiveRoom,
  getActiveRoomId,
  getActiveRoom,

  saveSentence,
  getSentences,
  deleteSentence,

  saveParagraph,
  saveSentenceAndParagraph,
  getParagraphs,
  deleteParagraph,
  replaceParagraphGrouping,
  breakdownParagraphGrouping,

  loadRoomData
});

window.ConversateFirebase = ConversateFirebase;
window.dispatchEvent(new CustomEvent("conversatefirebase:ready"));

export {
  database,
  firebaseConfig,
  COLLECTIONS,
  STORAGE_KEYS,
  registerUser,
  loginUser,
  logout,
  getCurrentUser,
  getFreshCurrentUser,
  getSessionUserId,
  isLoggedIn,
  findAccountByUsername,
  createRoom,
  getRooms,
  getRoom,
  updateRoom,
  deleteRoom,
  setActiveRoom,
  getActiveRoomId,
  getActiveRoom,
  saveSentence,
  getSentences,
  deleteSentence,
  saveParagraph,
  saveSentenceAndParagraph,
  getParagraphs,
  deleteParagraph,
  replaceParagraphGrouping,
  breakdownParagraphGrouping,
  loadRoomData
};
