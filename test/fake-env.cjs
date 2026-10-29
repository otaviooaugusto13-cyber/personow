// Ambiente de teste SEM rede: Firestore, Auth e Express falsos em memória. Roda a cadeia de middlewares de cada rota
// (limitador, autenticação, RBAC) — usado por test/seguranca.test.cjs (módulos adaptados do Abastece Já).
const Module = require("node:module");
const crypto = require("node:crypto");
const path = require("node:path");

const clock = { now: Date.now() };
const realNow = Date.now; Date.now = () => clock.now;
class Timestamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } toDate() { return new Date(this.ms); } static now() { return new Timestamp(clock.now); } static fromMillis(m) { return new Timestamp(m); } }
const SERVER_TS = { __s: "ts" }, DEL = { __s: "del" };
const FieldValue = { serverTimestamp: () => SERVER_TS, delete: () => DEL, increment: (n) => ({ __s: "inc", n }) };
const plano = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Timestamp) && !v.__s;
const clone = (v) => (v instanceof Timestamp ? v : Array.isArray(v) ? v.map(clone) : plano(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
function aplicar(prev, dados, merge) {
  const out = merge ? clone(prev || {}) : {};
  for (const [k, v] of Object.entries(dados)) {
    if (v === SERVER_TS) out[k] = Timestamp.now(); else if (v === DEL) delete out[k];
    else if (v && v.__s === "inc") out[k] = (out[k] || 0) + v.n;
    else if (plano(v) && merge && plano(out[k])) out[k] = aplicar(out[k], v, true); else out[k] = clone(v);
  }
  return out;
}
const store = new Map(); let seq = 0;
const valor = (d, f) => f.split(".").reduce((a, k) => (a == null ? undefined : a[k]), d);
const num = (v) => (v instanceof Timestamp ? v.ms : v);
const snap = (col, id) => { const d = store.get(`${col}/${id}`); return { id, exists: d !== undefined, data: () => (d === undefined ? undefined : clone(d)), ref: ref(col, id) }; };
const ref = (col, id) => ({
  id, col, get: async () => snap(col, id),
  set: async (data, opt) => { const k = `${col}/${id}`; store.set(k, aplicar(store.get(k), data, !!opt?.merge)); },
  update: async (data) => { const k = `${col}/${id}`; if (!store.has(k)) throw new Error("not found: " + k); store.set(k, aplicar(store.get(k), data, true)); },
  delete: async () => { store.delete(`${col}/${id}`); }
});
const query = (col, f = [], ord = null, lim = null, apos = null) => ({
  __q: true,
  where: (c, op, v) => query(col, [...f, [c, op, v]], ord, lim, apos),
  orderBy: (c, dir = "asc") => query(col, f, [c, dir], lim, apos),
  limit: (n) => query(col, f, ord, n, apos), startAfter: (s) => query(col, f, ord, lim, s),
  get: async () => {
    let docs = [...store.keys()].filter((k) => k.startsWith(col + "/") && !k.slice(col.length + 1).includes("/")).map((k) => snap(col, k.slice(col.length + 1)));
    docs = docs.filter((s) => f.every(([c, op, v]) => { const x = num(valor(s.data(), c)), y = num(v);
      return op === "==" ? x === y : op === "in" ? v.includes(x) : op === "<=" ? x !== undefined && x <= y : op === ">=" ? x !== undefined && x >= y : false; }));
    if (ord) { const [c, dir] = ord; docs.sort((a, b) => { const x = c === "__name__" ? a.id : num(valor(a.data(), c)), y = c === "__name__" ? b.id : num(valor(b.data(), c)); return (x > y ? 1 : x < y ? -1 : 0) * (dir === "desc" ? -1 : 1); }); }
    if (apos) docs = docs.filter((s) => s.id > apos.id);
    if (lim) docs = docs.slice(0, lim);
    return { docs, empty: docs.length === 0, size: docs.length };
  }
});
const db = {
  collection: (col) => ({ doc: (id) => ref(col, id || `auto${++seq}`), ...query(col) }),
  batch: () => { const ops = []; return { set: (r, d, o) => ops.push(() => r.set(d, o)), update: (r, d) => ops.push(() => r.update(d)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const o of ops) await o(); } }; },
  runTransaction: async (fn) => { const ops = []; const r = await fn({
    get: (x) => x.get(), set: (rf, d, o) => ops.push(() => rf.set(d, o)), update: (rf, d) => ops.push(() => rf.update(d)), delete: (rf) => ops.push(() => rf.delete()) });
    for (const o of ops) await o(); return r; }
};
const claimsStore = {}, revogados = new Set(), tokens = {};
const authFake = {
  verifyIdToken: async (t, checarRev) => { const n = String(t).split(".")[0], base = tokens[n]; if (!base) throw new Error("bad"); if (checarRev && revogados.has(base.uid)) throw new Error("revoked");
    return { ...base, auth_time: base.auth_time ?? Math.floor(clock.now / 1000), ...(claimsStore[base.uid] || {}) }; },
  getUser: async (uid) => ({ uid, customClaims: claimsStore[uid] || {} }),
  setCustomUserClaims: async (uid, c) => { claimsStore[uid] = c; }, revokeRefreshTokens: async (uid) => { revogados.add(uid); },
  createCustomToken: async (uid, c) => `custom:${uid}`
};
const adminFake = { apps: [1], credential: { cert: () => ({}) }, initializeApp() {}, auth: () => authFake, firestore: Object.assign(() => db, { FieldValue, Timestamp }) };

// ---------- Express falso: roteia com :params e executa a cadeia de middlewares de cada rota ----------
const rotas = [], globais = [];
const compilar = (p) => { const nomes = []; const re = new RegExp("^" + p.replace(/:([A-Za-z]+)/g, (_, n) => (nomes.push(n), "([^/]+)")) + "$"); return { re, nomes }; };
const reg = (metodo) => (p, ...hs) => rotas.push({ metodo, ...compilar(p), hs: hs.flat() });
const expressFake = () => ({ set() {}, disable() {}, use: (...a) => globais.push(a), get: reg("GET"), all: reg("*"), post: reg("POST"), put: reg("PUT"), delete: reg("DELETE"), listen() {} });
expressFake.json = () => () => {}; expressFake.static = () => () => {};
const orig = Module._load;
Module._load = function (req, ...r) { if (req === "express") return expressFake; if (req === "cors") return () => () => {}; if (req === "firebase-admin") return adminFake; return orig.call(this, req, ...r); };

function carregarServidor() {
  const srv = require(path.join(__dirname, "../server/server.js"));
  const Seg = require(path.join(__dirname, "../server/lib/seguranca.js"));
  async function chamar(metodo, caminho, { token, body = {}, query = {}, headers = {}, ip = "9.9.9.9" } = {}) {
    const [pathOnly, qs] = caminho.split("?"); const q = { ...Object.fromEntries(new URLSearchParams(qs || "")), ...query };
    const r = rotas.find((x) => (x.metodo === metodo || x.metodo === "*") && x.re.test(pathOnly));
    if (!r) return { status: 404, json: { erro: "sem rota" } };
    const vals = r.re.exec(pathOnly).slice(1), params = Object.fromEntries(r.nomes.map((n, i) => [n, vals[i]]));
    const h = { ...(token ? { authorization: `Bearer ${token}.x.y` } : {}), ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
    const saida = { status: 200, json: null, texto: null, h: {} };
    const req = { method: metodo, path: pathOnly, body, query: q, params, ip, get: (n) => h[n.toLowerCase()] };
    const res = { status(s) { saida.status = s; return this; }, json(j) { saida.json = j; return this; }, send(t) { saida.texto = t; return this; }, setHeader(k, v) { saida.h[k] = v; }, removeHeader() {}, sendStatus(c) { saida.status = c; return this; }, redirect(u) { saida.status = 302; saida.json = { redirect: u }; return this; } };
    let i = 0; const pend = [];
    const next = (err) => { const p = (async () => {
      if (err) return Seg.tratadorErros(err, req, res);
      const fn = r.hs[i++]; if (!fn) return;
      try { await fn(req, res, next); } catch (e) { Seg.tratadorErros(e, req, res); }
    })(); pend.push(p); return p; };
    next(); while (pend.length) await pend.shift(); return saida;
  }
  return { ...srv, chamar, Seg };
}
const avancar = (ms) => { clock.now += ms; };
const limpar = () => { store.clear(); for (const k of Object.keys(claimsStore)) delete claimsStore[k]; revogados.clear(); };
module.exports = { carregarServidor, store, clock, avancar, limpar, tokens, claimsStore, revogados, Timestamp, restaurarRelogio: () => { Date.now = realNow; } };
