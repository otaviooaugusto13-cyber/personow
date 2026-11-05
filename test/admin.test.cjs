// Rotas novas do painel admin: dashboard, busca de alunos, detalhe e cancelamento de aula. Sem rede.
process.env.AMBIENTE = "teste"; process.env.APP_URL = "https://app.exemplo.com"; process.env.MP_CLIENT_ID = "c"; process.env.MP_CLIENT_SECRET = "s"; process.env.MP_WEBHOOK_SECRET = "w";
const crypto = require("node:crypto");
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict"); const E = require("./fake-env.cjs");
const { ctx, chamar } = E.carregarServidor();
const set = (c, id, d) => ctx.db.collection(c).doc(id).set(d), get = async (c, id) => (await ctx.db.collection(c).doc(id).get()).data();
let n = 0; const ip = () => `10.2.0.${++n % 250}`;
const U = (u) => ({ uid: u, email: `${u}@x.com`, email_verified: true, name: u });
(async () => {
  E.limpar(); Object.assign(E.tokens, { adm: U("adm"), ana: U("ana") }); E.claimsStore.adm = { role: "admin", admin: true }; E.claimsStore.ana = { role: "aluno" };
  await set("alunos", "ana", { uid: "ana", nome: "Ana Souza", email: "ana@x.com" });
  await set("aulas", "p1", { alunoUid: "ana", status: "paga", valorCentavos: 10000, valorPersonalCentavos: 8500, data: "2026-10-01" });
  await set("aulas", "o1", { alunoUid: "ana", status: "aberta", valorCentavos: 5000, valorPersonalCentavos: 4250, data: "2026-12-01" });
  await set("aulas", "g1", { alunoUid: "ana", status: "paga", valorCentavos: 5000, valorPersonalCentavos: 4250, data: "2026-10-02" });
  let r = await chamar("GET", "/admin/dashboard", { token: "adm", ip: ip() }); assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.gmvCentavos, 15000); assert.equal(r.json.comissaoCentavos, 2250); assert.equal(r.json.aulasPorStatus.paga, 2); assert.equal(r.json.aulasPorStatus.aberta, 1);
  assert.equal((await chamar("GET", "/admin/dashboard", { token: "ana", ip: ip() })).status, 403);
  r = await chamar("GET", "/admin/alunos?q=souza", { token: "adm", ip: ip() }); assert.equal(r.status, 200); assert.equal(r.json.length, 1);
  r = await chamar("GET", "/admin/aulas/p1", { token: "adm", ip: ip() }); assert.equal(r.json.comissaoCentavos, 1500);
  assert.equal((await chamar("POST", "/admin/aulas/o1/cancelar", { token: "adm", body: { motivo: "x" }, ip: ip() })).status, 400);
  assert.equal((await chamar("POST", "/admin/aulas/p1/cancelar", { token: "adm", body: { motivo: "pedido do aluno" }, ip: ip() })).status, 409);
  r = await chamar("POST", "/admin/aulas/o1/cancelar", { token: "adm", body: { motivo: "duplicada pelo aluno" }, ip: ip() }); assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await get("aulas", "o1")).status, "cancelada");
  assert.equal((await chamar("GET", "/admin/aulas/inexistente", { token: "adm", ip: ip() })).status, 404);
  console.log("✅ admin (dashboard, busca, aula, cancelamento): todos os testes passaram"); E.restaurarRelogio?.(); process.exit(0);
})().catch((e) => { console.error("❌", e.stack || e); process.exit(1); });
