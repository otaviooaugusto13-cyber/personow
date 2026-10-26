// Teste do servidor SEM rede: express, firebase-admin e fetch (Mercado Pago) são substituídos por fakes em memória.
// Valida de ponta a ponta: criar → aceitar (conflito, exclusividade) → chat moderado → pagar (webhook, valor ao centavo)
// → recibo (sem CPF completo) → avaliar. Rodar: node test/server.fake.test.cjs
process.env.APP_URL = "https://exemplo.onrender.com";
process.env.MP_CLIENT_ID = "cid"; process.env.MP_CLIENT_SECRET = "csecret"; process.env.MP_WEBHOOK_SECRET = "whsecret";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");

// ---------- Firestore falso ----------
const store = new Map();            // "col/id" -> dado (JSON)
let seq = 0;
const TS = { __ts: true };
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const reviver = (k, v) => (v && typeof v === "object" && v.__ms !== undefined ? { __ms: v.__ms, toMillis: () => v.__ms } : v);
const snapDoc = (col, id) => { const k = `${col}/${id}`; const d = store.get(k); return { id, exists: d !== undefined, data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d), reviver)), ref: docRef(col, id) }; };
const docRef = (col, id) => ({
  id, col, __doc: true,
  get: async () => snapDoc(col, id),
  set: async (data, opt) => { const k = `${col}/${id}`; store.set(k, opt?.merge ? { ...(store.get(k) || {}), ...clone(data) } : clone(data)); },
  update: async (data) => { const k = `${col}/${id}`; if (!store.has(k)) throw new Error("not found"); store.set(k, { ...store.get(k), ...clone(data) }); },
  delete: async () => { store.delete(`${col}/${id}`); },
  collection: (sub) => colecao(`${col}/${id}/${sub}`)
});
const query = (col, filtros = []) => ({
  where: (f, op, v) => query(col, [...filtros, [f, v]]),
  get: async () => {
    const docs = [...store.keys()].filter((k) => k.startsWith(col + "/") && !k.slice(col.length + 1).includes("/"))
      .map((k) => snapDoc(col, k.slice(col.length + 1))).filter((s) => filtros.every(([f, v]) => s.data()[f] === v));
    return { docs, empty: docs.length === 0 };
  },
  __query: true
});
const colecao = (col) => ({ doc: (id) => docRef(col, id || `auto${++seq}`), where: (...a) => query(col).where(...a), get: () => query(col).get() });
const fsDb = {
  collection: colecao,
  batch: () => { const ops = []; return { set: (r, d) => ops.push(() => r.set(d)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const o of ops) await o(); } }; },
  runTransaction: async (fn) => {
    const ops = [];
    const r = await fn({ get: async (x) => x.get(), set: (ref, d) => ops.push(() => ref.set(d)), update: (ref, d) => ops.push(() => ref.update(d)) });
    for (const o of ops) await o();
    return r;
  }
};
const tokens = {
  "t-ana": { uid: "ana", name: "Ana Souza", email: "ana@x.com" },
  "t-bia": { uid: "bia", name: "Bia Lima" },
  "t-leo": { uid: "leo", name: "Leo Personal" },
  "t-rui": { uid: "rui", name: "Rui Personal" },
  "t-pen": { uid: "pen", name: "Pendente Personal" },
  "t-semmp": { uid: "semmp", name: "Sem MP" }
};
const adminFake = {
  apps: [1], credential: { cert: () => ({}) }, initializeApp: () => {},
  firestore: Object.assign(() => fsDb, { FieldValue: { serverTimestamp: () => TS }, Timestamp: { fromMillis: (m) => ({ __ms: m }) } }),
  auth: () => ({ verifyIdToken: async (t) => { if (!tokens[t]) throw new Error("x"); return tokens[t]; } })
};
const rotas = {};
const expressFake = () => ({ set() {}, use() {}, get: (p, h) => (rotas["GET " + p] = h), post: (p, h) => (rotas["POST " + p] = h), all: (p, h) => (rotas["ALL " + p] = h), listen() {} });
expressFake.json = () => {}; expressFake.static = () => {};
const orig = Module._load;
Module._load = function (req, ...r) { if (req === "express") return expressFake; if (req === "cors") return () => {}; if (req === "firebase-admin") return adminFake; return orig.call(this, req, ...r); };
const servidor = require(path.join(__dirname, "../server/server.js"));
Module._load = orig;

async function chamar(rota, token, body = {}, extra = {}) {
  const h = rotas["POST " + rota] || rotas["ALL " + rota] || rotas["GET " + rota];
  assert.ok(h, `rota ${rota} não existe`);
  const saida = { status: 200, json: null };
  const res = { status(s) { saida.status = s; return this; }, json(j) { saida.json = j; return this; }, sendStatus(s) { saida.status = s; return this; }, redirect(u) { saida.status = 302; saida.json = { redirect: u }; return this; } };
  const headers = { ...(token ? { authorization: "Bearer " + token } : {}), ...(extra.headers || {}) };
  await h({ get: (n) => headers[n.toLowerCase()] || "", body, query: extra.query || {}, protocol: "https" }, res);
  return saida;
}
// mesma base de datas do servidor (America/Sao_Paulo): em UTC o "hoje" diverge à noite
const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const dia = (n) => { const [a, m, d] = hojeSP().split("-").map(Number); return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10); };
const base = { local: "Smart Fit — Av. Brasil, 100", foco: "Hipertrofia", entrada: "10:00", saida: "11:00", valorCentavos: 8000 };

// ---------- Mercado Pago falso ----------
let pagamentoMP = null;   // o que a API "devolve" em GET /v1/payments/:id
global.fetch = async (url) => {
  if (String(url).includes("/v1/payments/")) return { ok: true, status: 200, json: async () => pagamentoMP };
  if (String(url).includes("/checkout/preferences")) return { ok: true, status: 200, json: async () => ({ id: "PREF1", init_point: "https://mp.test/checkout/PREF1" }) };
  return { ok: false, status: 404, json: async () => ({ message: "x" }) };
};

(async () => {
  const futuro = Date.now() + 10 * 3600_000;
  for (const [uid, nome, status, mpConectado] of [["leo", "Leo Personal", "ativo", true], ["rui", "Rui Personal", "ativo", true], ["pen", "Pendente", "pendente", true], ["semmp", "Sem MP", "ativo", false]]) {
    store.set(`personais/${uid}`, { uid, nome, status, mpConectado, cref: "123456-G/SP" });
  }
  store.set("mp_tokens/leo", { accessToken: "AT-LEO", refreshToken: "RT", expiraEm: { __ms: futuro } });
  store.set("personais_privado/leo", { cpf: "52998224725", telefone: "(19) 99999-0000" });
  store.set("alunos/ana", { nome: "Ana Souza", email: "ana@x.com" });

  // ===== 1) criarAula: validações =====
  let r = await chamar("/criarAula", "", { ...base, data: dia(3) });
  assert.equal(r.status, 401, "sem login");
  r = await chamar("/criarAula", "t-ana", { ...base, data: dia(-1) });
  assert.equal(r.status, 400, "data passada"); 
  r = await chamar("/criarAula", "t-ana", { ...base, data: hojeSP(), entrada: "00:00", saida: "01:00" });
  assert.equal(r.status, 400, "horário de hoje que já passou");
  r = await chamar("/criarAula", "t-ana", { ...base, data: dia(3), saida: "14:00" });
  assert.equal(r.status, 400); assert.match(r.json.erro, /no máximo 3 horas/);
  r = await chamar("/criarAula", "t-ana", { ...base, data: dia(3), valorCentavos: 1000 });
  assert.equal(r.status, 400); assert.match(r.json.erro, /valor mínimo/);
  r = await chamar("/criarAula", "t-ana", { ...base, data: dia(3), foco: "Reposição de gôndola" });
  assert.equal(r.status, 400, "foco fora do universo fitness é recusado");
  r = await chamar("/criarAula", "t-ana", { ...base, data: dia(3), local: "x" });
  assert.equal(r.status, 400, "local curto");
  r = await chamar("/criarAula", "t-ana", { ...base, data: dia(3), personalPreferidoUid: "pen" });
  assert.equal(r.status, 400); assert.equal(r.json.codigo, "personal-indisponivel", "personal pendente não pode ser chamado");

  // ===== 2) criarAula: sucesso grava split só no servidor =====
  r = await chamar("/criarAula", "t-ana", { ...base, data: dia(3) });
  assert.equal(r.status, 200); const aulaId = r.json.id;
  assert.equal(r.json.valorCentavos, 8000); assert.equal(r.json.valorPersonalCentavos, 6800);
  const aula = store.get(`aulas/${aulaId}`);
  assert.equal(aula.status, "aberta"); assert.equal(aula.alunoUid, "ana"); assert.equal(aula.alunoNome, "Ana");
  assert.equal(aula.minutos, 60); assert.equal(aula.horario, "10:00–11:00");
  assert.equal(aula.comissaoCentavos, undefined, "comissão não vai no documento visível ao personal");
  assert.equal(store.get(`pagamentos_internos/${aulaId}`).split.comissao, 1200);

  // limite de pedidos em aberto
  for (let i = 0; i < 4; i++) assert.equal((await chamar("/criarAula", "t-ana", { ...base, data: dia(10 + i) })).status, 200);
  r = await chamar("/criarAula", "t-ana", { ...base, data: dia(20) });
  assert.equal(r.status, 429); assert.equal(r.json.codigo, "muitos-pedidos");

  // ===== 3) aceitarAula =====
  r = await chamar("/aceitarAula", "t-pen", { aulaId });
  assert.equal(r.status, 403); assert.equal(r.json.codigo, "personal-inativo");
  r = await chamar("/aceitarAula", "t-semmp", { aulaId });
  assert.equal(r.status, 403); assert.equal(r.json.codigo, "personal-sem-mp");
  r = await chamar("/aceitarAula", "t-ana", { aulaId });
  assert.equal(r.status, 403, "aluno que nem é personal");
  r = await chamar("/aceitarAula", "t-leo", { aulaId });
  assert.equal(r.status, 200);
  assert.equal(store.get(`aulas/${aulaId}`).status, "aceita"); assert.equal(store.get(`aulas/${aulaId}`).personalUid, "leo");
  r = await chamar("/aceitarAula", "t-rui", { aulaId });
  assert.equal(r.status, 409); assert.equal(r.json.codigo, "aula-indisponivel", "segunda pessoa não pega a mesma aula");

  // conflito de horário do Leo (mesmo dia 10:30–11:30) x aula que encosta (11:00–12:00)
  r = await chamar("/criarAula", "t-bia", { ...base, data: dia(3), entrada: "10:30", saida: "11:30" });
  const choqueId = r.json.id;
  r = await chamar("/aceitarAula", "t-leo", { aulaId: choqueId });
  assert.equal(r.status, 409); assert.equal(r.json.codigo, "conflito-horario");
  r = await chamar("/criarAula", "t-bia", { ...base, data: dia(3), entrada: "11:00", saida: "12:00" });
  const encostaId = r.json.id;
  assert.equal((await chamar("/aceitarAula", "t-leo", { aulaId: encostaId })).status, 200, "aulas coladas não são conflito");
  assert.equal((await chamar("/aceitarAula", "t-rui", { aulaId: choqueId })).status, 200, "outro personal pode pegar o horário");

  // exclusividade "Chamar agora"
  r = await chamar("/criarAula", "t-bia", { ...base, data: dia(5), personalPreferidoUid: "leo" });
  const exclId = r.json.id;
  assert.ok(store.get(`aulas/${exclId}`).exclusivoAte.__ms > Date.now());
  r = await chamar("/aceitarAula", "t-rui", { aulaId: exclId });
  assert.equal(r.status, 403); assert.equal(r.json.codigo, "exclusivo");
  assert.equal((await chamar("/aceitarAula", "t-leo", { aulaId: exclId })).status, 200);

  // valor mínimo das preferências do personal
  store.set("personais/rui", { ...store.get("personais/rui"), valorMin: 100 });
  r = await chamar("/criarAula", "t-bia", { ...base, data: dia(6) });
  r = await chamar("/aceitarAula", "t-rui", { aulaId: r.json.id });
  assert.equal(r.status, 409); assert.equal(r.json.codigo, "abaixo-do-minimo");

  // ===== 4) chat =====
  r = await chamar("/enviarMensagem", "t-ana", { aulaId: choqueId, texto: "oi" });
  assert.equal(r.status, 403, "quem não faz parte da aula não escreve");
  r = await chamar("/enviarMensagem", "t-ana", { aulaId, texto: "Posso chegar às 10h?" });
  assert.equal(r.status, 200);
  r = await chamar("/enviarMensagem", "t-leo", { aulaId, texto: "Pode sim! Traz a toalha." });
  assert.equal(r.status, 200);
  const msgs = [...store.keys()].filter((k) => k.startsWith(`aulas/${aulaId}/mensagens/`));
  assert.equal(msgs.length, 2);
  r = await chamar("/enviarMensagem", "t-leo", { aulaId, texto: "me chama no zap 19 99999-1111" });
  assert.equal(r.status, 422); assert.equal(r.json.codigo, "contato-externo"); assert.equal(r.json.detalhe.infracoes, 1);
  assert.equal([...store.keys()].filter((k) => k.startsWith(`aulas/${aulaId}/mensagens/`)).length, 2, "mensagem bloqueada não é gravada");
  await chamar("/enviarMensagem", "t-leo", { aulaId, texto: "minha chave pix: leo@x.com" });
  assert.equal(store.get("infracoes/leo").total, 2); assert.equal(store.get("infracoes/leo").revisaoManual, true, "reincidência vai para revisão humana");
  r = await chamar("/enviarMensagem", "t-bia", { aulaId: exclId, texto: "x".repeat(501) });
  assert.equal(r.status, 400);
  const aberta = (await chamar("/criarAula", "t-bia", { ...base, data: dia(8) })).json.id;
  r = await chamar("/enviarMensagem", "t-bia", { aulaId: aberta, texto: "alguém aí?" });
  assert.equal(r.status, 409); assert.equal(r.json.codigo, "chat-fechado");

  // ===== 5) cobrança =====
  r = await chamar("/criarCobranca", "t-bia", { aulaId });
  assert.equal(r.status, 403, "aula de outro aluno");
  r = await chamar("/criarCobranca", "t-ana", { aulaId: aberta });
  assert.equal(r.status, 403, "aula de outro aluno (aberta da Bia)");
  r = await chamar("/criarCobranca", "t-bia", { aulaId: aberta });
  assert.equal(r.status, 400); assert.equal(r.json.codigo, "nao-aceita");
  r = await chamar("/criarCobranca", "t-ana", { aulaId });
  assert.equal(r.status, 200); assert.equal(r.json.init_point, "https://mp.test/checkout/PREF1");
  assert.equal(r.json.totalCentavos, 8000);
  assert.equal(store.get(`pagamentos_internos/${aulaId}`).split.app, 1200, "marketplace_fee = comissão");

  // ===== 6) webhook / confirmação =====
  const assinar = (id, reqId = "req1", ts = "1700000000") => `ts=${ts},v1=${crypto.createHmac("sha256", "whsecret").update(`id:${String(id).toLowerCase()};request-id:${reqId};ts:${ts};`).digest("hex")}`;
  r = await chamar("/webhookMP", "", { type: "payment", data: { id: "999" } }, { query: { sid: aulaId }, headers: { "x-signature": "ts=1,v1=abc", "x-request-id": "req1" } });
  assert.equal(r.status, 401, "assinatura inválida é recusada");
  pagamentoMP = { external_reference: aulaId, status: "approved", transaction_amount: 79.99, payment_type_id: "pix", fee_details: [{ type: "mercadopago_fee", amount: 0.5 }] };
  r = await chamar("/webhookMP", "", { type: "payment", data: { id: "999" } }, { query: { sid: aulaId }, headers: { "x-signature": assinar("999"), "x-request-id": "req1" } });
  assert.equal(r.status, 200);
  assert.equal(store.get(`aulas/${aulaId}`).status, "aceita", "valor diferente por 1 centavo NÃO paga a aula");
  pagamentoMP = { ...pagamentoMP, external_reference: "outra-aula", transaction_amount: 80 };
  await chamar("/webhookMP", "", { type: "payment", data: { id: "999" } }, { query: { sid: aulaId }, headers: { "x-signature": assinar("999"), "x-request-id": "req1" } });
  assert.equal(store.get(`aulas/${aulaId}`).status, "aceita", "pagamento de outra aula é ignorado");
  pagamentoMP = { external_reference: aulaId, status: "pending", transaction_amount: 80, payment_type_id: "pix" };
  r = await chamar("/confirmarPagamento", "t-ana", { aulaId, paymentId: "999" });
  assert.equal(r.json.aprovado, false); assert.equal(r.json.status, "pending");
  r = await chamar("/confirmarPagamento", "t-bia", { aulaId, paymentId: "999" });
  assert.equal(r.status, 403, "só o aluno da aula confirma");

  pagamentoMP = { external_reference: aulaId, status: "approved", transaction_amount: 80, payment_type_id: "pix", fee_details: [{ type: "mercadopago_fee", amount: 0.5 }] };
  r = await chamar("/webhookMP", "", { type: "payment", data: { id: "999" } }, { query: { sid: aulaId }, headers: { "x-signature": assinar("999"), "x-request-id": "req1" } });
  assert.equal(r.status, 200);
  const paga = store.get(`aulas/${aulaId}`);
  assert.equal(paga.status, "paga"); assert.ok(paga.reciboId); assert.equal(paga.reciboNumero, 1);
  const rec = store.get(`recibos/${paga.reciboId}`);
  assert.equal(rec.tipo, "recibo_aula_plataforma"); assert.equal(rec.alunoUid, "ana"); assert.equal(rec.numeroFmt, "000001");
  assert.equal(rec.personal.documentoMascarado, "***.982.247-**", "recibo não expõe o CPF completo do personal");
  assert.equal(JSON.stringify(rec).includes("52998224725"), false);
  assert.equal(rec.valores.total, 8000); assert.equal(rec.valores.comissao, undefined, "recibo do aluno não mostra comissão");
  assert.equal(JSON.stringify(rec).includes("1200"), false);
  const pi = store.get(`pagamentos_internos/${aulaId}`);
  assert.equal(pi.status, "aprovado"); assert.equal(pi.taxaMpCentavos, 50);

  // idempotência: o MP repete o webhook e o aluno volta da página — nada duplica
  await chamar("/webhookMP", "", { type: "payment", data: { id: "999" } }, { query: { sid: aulaId }, headers: { "x-signature": assinar("999"), "x-request-id": "req1" } });
  r = await chamar("/confirmarPagamento", "t-ana", { aulaId, paymentId: "999" });
  assert.equal(r.json.jaPaga, true);
  assert.equal([...store.keys()].filter((k) => k.startsWith("recibos/")).length, 1);
  assert.equal(store.get("contadores/recibos").ultimo, 1);
  r = await chamar("/criarCobranca", "t-ana", { aulaId });
  assert.equal(r.status, 400); assert.equal(r.json.codigo, "ja-paga");

  // ===== 7) avaliação =====
  r = await chamar("/avaliarAula", "t-ana", { aulaId: exclId, estrelas: 5 });
  assert.equal(r.status, 403, "não avalia aula de outro aluno");
  r = await chamar("/avaliarAula", "t-ana", { aulaId, estrelas: 9 });
  assert.equal(r.status, 400);
  r = await chamar("/avaliarAula", "t-ana", { aulaId, estrelas: 5, comentario: "Ótimo treino!" });
  assert.equal(r.status, 200);
  assert.deepEqual([store.get("personais/leo").ratingQtd, store.get("personais/leo").ratingMedia], [1, 5]);
  r = await chamar("/avaliarAula", "t-ana", { aulaId, estrelas: 1 });
  assert.equal(r.status, 409); assert.equal(r.json.codigo, "ja-avaliada", "só uma avaliação por aula");
  assert.equal(store.get("personais/leo").ratingMedia, 5);
  r = await chamar("/avaliarAula", "t-bia", { aulaId: exclId, estrelas: 4 });   // ainda não paga
  assert.equal(r.status, 409); assert.equal(r.json.codigo, "nao-paga");

  // ===== 8) OAuth do personal =====
  r = await chamar("/mpConectarUrl", "t-leo");
  assert.equal(r.status, 200); assert.match(r.json.url, /auth\.mercadopago\.com\.br\/authorization.*platform_id=mp/);
  const state = decodeURIComponent(/state=([^&]+)/.exec(r.json.url)[1]);
  r = await chamar("/mpCallback", "", {}, { query: { code: "c", state: "leo.assinaturafalsa" } });
  assert.match(r.json.redirect, /mp=erro/, "state adulterado é recusado");
  r = await chamar("/mpCallback", "", {}, { query: { code: "c", state: "x" } });
  assert.match(r.json.redirect, /mp=erro/);
  assert.ok(state.startsWith("leo."));

  // ===== 9) diagnóstico =====
  r = await chamar("/saude"); assert.equal(r.json.ok, true);

  console.log("✅ servidor (fake): todos os testes passaram");
})().catch((e) => { console.error(e); process.exit(1); });
