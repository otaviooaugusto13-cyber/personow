// Firebase falso (em memória) servido no lugar do CDN do gstatic.
const APP = `export const initializeApp = () => ({});`;
const AUTH = `
export const getAuth = () => ({ get currentUser() { return window.__fake.user || null; } });
export class GoogleAuthProvider { setCustomParameters() {} }
export const connectAuthEmulator = () => {};
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(window.__fake.user || null), 20); return () => {}; };
export const signInWithPopup = async () => ({ user: window.__fake.user });
export const signInWithRedirect = async () => {};
export const getRedirectResult = async () => null;
export const signOut = async () => { window.__fake.user = null; };
`;
const FS = `
const S = () => window.__fake.store;
const mk = (path) => ({ __path: path, id: path.split("/").pop() });
export const connectFirestoreEmulator = () => {};
export const getFirestore = () => ({});
export const serverTimestamp = () => ({ __ts: true, toDate: () => new Date() });
export const deleteField = () => ({ __del: true });
export const collection = (_d, ...p) => ({ __col: p.join("/"), filtros: [] });
export const doc = (_d, ...p) => mk(p.join("/"));
export const where = (f, op, v) => ({ f, v });
export const orderBy = () => ({});
export const query = (c, ...fs) => ({ __col: c.__col, filtros: fs.filter((x) => x.f) });
const lista = (q) => Object.entries(S()).filter(([k]) => k.startsWith(q.__col + "/") && !k.slice(q.__col.length + 1).includes("/") && q.filtros.every(({ f, v }) => S()[k][f] === v));
const rev = (d) => JSON.parse(JSON.stringify(d ?? null), (k, v) => (v && typeof v === "object" && v.__ms !== undefined ? { __ms: v.__ms, toMillis: () => v.__ms } : v));
const snapDe = (q) => { const docs = lista(q).map(([k, d]) => ({ id: k.split("/").pop(), data: () => rev(d) })); return { docs, empty: !docs.length }; };
const L = () => (window.__fake.listeners = window.__fake.listeners || []);
const notify = () => L().forEach((l) => l.run());
export const getDocs = async (q) => snapDe(q);
export const getDoc = async (r) => ({ exists: () => S()[r.__path] !== undefined, id: r.id, data: () => rev(S()[r.__path]) });
export const setDoc = async (r, d, o) => { S()[r.__path] = o?.merge ? { ...(S()[r.__path] || {}), ...d } : d; window.__fake.log.push(["setDoc", r.__path]); notify(); };
export const updateDoc = async (r, d) => { S()[r.__path] = { ...(S()[r.__path] || {}), ...d }; window.__fake.log.push(["updateDoc", r.__path]); notify(); };
export const addDoc = async (c, d) => { const id = "n" + Math.random().toString(36).slice(2, 8); S()[c.__col + "/" + id] = d; window.__fake.log.push(["addDoc", c.__col]); notify(); return { id }; };
export const deleteDoc = async (r) => { delete S()[r.__path]; notify(); };
export const onSnapshot = (x, cb, err) => {
  let morto = false;
  const run = () => {
    if (morto) return;
    if (x.__path) return cb({ exists: () => S()[x.__path] !== undefined, id: x.id, data: () => rev(S()[x.__path]) });
    if (window.__fake.negar && window.__fake.negar(x)) { morto = true; err && err({ code: "permission-denied" }); return; }
    cb(snapDe(x));
  };
  const l = { run }; L().push(l); run();
  return () => { morto = true; };
};`;
const DB = `
export const getDatabase = () => ({});
export const ref = () => ({});
export const set = async () => {};
export const onDisconnect = () => ({ set() {} });
export const onValue = (r, cb) => { cb({ val: () => true }); return () => {}; };
export const serverTimestamp = () => ({});`;
module.exports = { "firebase-app.js": APP, "firebase-auth.js": AUTH, "firebase-firestore.js": FS, "firebase-database.js": DB };
