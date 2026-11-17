// Modulo Firebase per Turni GPG. Richiede firebase-config.js compilato.
const { firebaseConfig, ADMIN_EMAIL } = window.TURNI_FIREBASE_CONFIG || {};
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendEmailVerification, sendPasswordResetEmail, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const configured = firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("INSERISCI_")
  && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("INSERISCI_")
  && firebaseConfig.appId && !firebaseConfig.appId.startsWith("INSERISCI_");
if (!configured) throw new Error("Configurazione Firebase mancante: completa firebase-config.js.");

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const adminEmail = String(ADMIN_EMAIL || "").toLowerCase();

export async function register(email, password, name, role = "") {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await sendEmailVerification(credential.user);
  await setDoc(doc(db, "accessRequests", credential.user.uid), {
    uid: credential.user.uid, email: credential.user.email,
    name: String(name || "").trim().slice(0, 60),
    role: String(role || "").trim().slice(0, 60),
    status: "pending", createdAt: serverTimestamp()
  });
  return credential.user;
}
export async function login(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  await credential.user.reload();
  if (!credential.user.emailVerified) {
    await signOut(auth);
    throw new Error("Verifica prima il tuo indirizzo email: controlla la posta.");
  }
  return credential.user;
}
export const logout = () => signOut(auth);
export const resetPassword = email => sendPasswordResetEmail(auth, email.trim());
export const watchAuth = callback => onAuthStateChanged(auth, callback);

export async function getAccess(uid) {
  const snap = await getDoc(doc(db, "members", uid));
  return snap.exists() ? snap.data() : null;
}
export async function submitAccessRequest(user, name, role = "", note = "") {
  await setDoc(doc(db, "accessRequests", user.uid), {
    uid: user.uid, email: user.email,
    name: String(name || "").trim().slice(0, 60),
    role: String(role || "").trim().slice(0, 60),
    note: String(note || "").trim().slice(0, 300),
    status: "pending", createdAt: serverTimestamp()
  });
}
export async function loadPrivateData(uid) {
  const snap = await getDoc(doc(db, "privateData", uid));
  return snap.exists() ? snap.data() : null;
}
export async function savePrivateData(uid, data) {
  // Un documento per utente: mai condiviso tra collaboratori.
  await setDoc(doc(db, "privateData", uid), {
    params: data.params || {}, shifts: Array.isArray(data.shifts) ? data.shifts : [],
    updatedAt: serverTimestamp()
  });
}
export function watchMyNotifications(uid, callback) {
  return onSnapshot(query(collection(db, "notifications", uid, "items"), orderBy("createdAt", "desc")),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function markNotificationRead(uid, notificationId) {
  await updateDoc(doc(db, "notifications", uid, "items", notificationId), { read: true });
}
export function watchAdminRequests(callback) {
  return onSnapshot(query(collection(db, "accessRequests"), orderBy("createdAt", "asc")),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function approveMember(uid, member, message = "La tua richiesta è stata approvata.") {
  await setDoc(doc(db, "members", uid), {
    active: true, name: String(member.name || "").slice(0, 60),
    start: member.start || "", end: member.end || "",
    email: String(member.email || ""), updatedAt: serverTimestamp()
  });
  await updateDoc(doc(db, "accessRequests", uid), { status: "approved", reviewedAt: serverTimestamp() });
  await addDoc(collection(db, "notifications", uid, "items"), {
    title: "Accesso approvato", message, read: false, createdAt: serverTimestamp()
  });
}
export async function suspendMember(uid) {
  await updateDoc(doc(db, "members", uid), { active: false, updatedAt: serverTimestamp() });
  await addDoc(collection(db, "notifications", uid, "items"), {
    title: "Accesso sospeso", message: "L'amministratore ha sospeso temporaneamente il tuo accesso.",
    read: false, createdAt: serverTimestamp()
  });
}
