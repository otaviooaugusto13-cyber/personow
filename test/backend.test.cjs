// Bateria do backend: regras financeiras, idade 18+ e CREF, treinamento obrigatório, RBAC, IDOR, ledger, estornos, saques, conciliação.
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { app, ctx, chamar, Seg } = E.carregarServidor();
const { V, S, C } = ctx;
const DIA = 86_400_000;
const dia = (n) => { const d = new Date(V.hojeSP() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nasc = (anos, extraDias = 0) => dia(-(anos * 365 + Math.floor(anos / 4)) - extraDias);
const CPFS = ["52998224725", "11144477735", "39053344705", "86288366757", "01234567890"].filter(ctx.V.cpfValido);
const cpf = (i) => CPFS[i];

// usuários
const U = {
  alunoA: { uid: "alunoA", email: "a@x.com", email_verified: true }, alunoB: { uid: "alunoB", email: "b@x.com", email_verified: true },
  novo: { uid: "novo1", email: "n@x.com", email_verified: true, name: "Fulano de Tal" }, novo2: { uid: "novo2", email: "n2@x.com", email_verified: true, name: "Ciclano" },
  prom1: { uid: "prom1", email: "p@x.com", email_verified: true }, prom2: { uid: "prom2", email: "p2@x.com", email_verified: true },
  adm: { uid: "adm1", email: "adm@x.com", email_verified: true }, nv: { uid: "nv", email: "nv@x.com", email_verified: false }
};
function reset() {
  E.limpar(); Object.assign(E.tokens, U);
  E.claimsStore.alunoA = { role: "aluno" }; E.claimsStore.alunoB = { role: "aluno" }; E.claimsStore.prom1 = { role: "personal", treinado: false };
  E.claimsStore.prom2 = { role: "personal", treinado: false }; E.claimsStore.adm1 = { role: "admin" }; E.claimsStore.nv = { role: "aluno" };
  E.clock.now = Date.now(); ctx.__reset?.(); ctx.taxas.invalidar();
}
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
const ok = (r, msg = "") => assert.equal(r.status, 200, `${msg} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
const Cripto = ctx.Cripto;
const enc = (uid, campo, v) => Cripto.cifrar(v, `personais_privado/${campo}/${uid}`);

async function semear({ uid = "prom1", nascimento = "1995-05-20", status = "ativo", cpfn = 0, treinado = false, habilitado = true } = {}) {
  await set("personais", uid, { uid, nome: "Personal " + uid, status, cref: `${12345 + cpfn}-G/SP`, treinamentoOk: false, ...(habilitado ? { habilitacoes: { musculacao: { em: new E.Timestamp(Date.now()), tentativas: 1, elite: true } } } : {}) });
  await set("personais_privado", uid, { uid, cpfEnc: enc(uid, "cpf", cpf(cpfn)), cpfIdx: Cripto.indiceCego(cpf(cpfn)), nascimentoEnc: enc(uid, "nascimento", nascimento), pixEnc: enc(uid, "pix", { tipo: "CPF", chave: cpf(cpfn) }), pixTipo: "CPF" });
  if (treinado) await concluirTreino(uid);
}
async function modulo(id = "m1", ordem = 1, dur = 100) { await set("treinamento_modulos", id, { ordem, titulo: "Módulo " + id, provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: dur, ativo: true }); }
async function concluirTreino(uid) { await modulo(); await set("treinamento_progresso", `${uid}_m1`, { uid, moduloId: "m1", validoSeg: 100, concluido: true }); }
const ALUNO_LAT = -22.4358, ALUNO_LNG = -46.8216;
async function alunoComCartao(uid = "alunoA") { await set("alunos", uid, { uid, nomeCompleto: "Aluno " + uid, localizacao: { lat: ALUNO_LAT, lng: ALUNO_LNG, cidade: "Itapira", uf: "SP" } }); await set("cartoes", uid, { uid, status: "ativo", ultimos4: "1234" }); }
async function aula(over = {}) {
  await alunoComCartao();
  const r = await chamar("POST", "/criarAula", { token: "alunoA", body: { aluno: "Aluno A — Rua 1", data: dia(2), entrada: "08:00", saida: "09:00", foco: "Musculação", ...over } });
  ok(r, "criarAula"); return r.json.id;
}
/** parceiro o serviço como executado (check-in/out) sem passar pela API: usado nos testes financeiros, que não são sobre geofence */
async function executar(sid) { await ctx.db.collection("aulas").doc(sid).update({ fase: "executada", checkin: { em: new E.Timestamp(Date.now()), noRaio: true }, checkout: { em: new E.Timestamp(Date.now()), conclusao: "completa" } }); }
const mpMock = (map) => { global.fetch = async (url, init = {}) => { const k = `${init.method || "GET"} ${String(url).replace("https://api.mercadopago.com", "")}`; const h = map[k] ?? Object.entries(map).find(([p]) => k.startsWith(p))?.[1]; if (!h) return { ok: false, status: 404, json: async () => ({}) }; const v = typeof h === "function" ? h(init) : h; return { ok: true, status: 200, json: async () => v }; }; };
const pgMP = (sid, over = {}) => ({ id: 777, status: "approved", external_reference: sid, currency_id: "BRL", transaction_amount: 100, payment_type_id: "credit_card", fee_details: [{ type: "mercadopago_fee", amount: 7.9 }], ...over });
async function pagar(sid, over = {}) { await executar(sid); mpMock({ "GET /v1/payments/777": pgMP(sid, over) }); return chamar("POST", "/confirmarPagamento", { token: "alunoA", body: { aulaId: sid, paymentId: "777" } }); }
/** aula aceita e pago: personal aprovado, treinado, adulto */
async function cenarioPago() {
  await semear({ treinado: true }); const sid = await aula();
  ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } })); ok(await pagar(sid)); return sid;
}

const testes = [];
const t = (nome, fn) => testes.push([nome, fn]);

// =================== 1. MODELO FINANCEIRO ===================
t("aula: R$100 = R$75 personal + R$25 plataforma; nada some nem sobra", async () => {
  const d = S.calcularPreco();
  assert.deepEqual([d.total, d.personal, d.comissao, d.app], [10000, 7500, 2500, 2500]); assert.equal(d.personal + d.app, d.total);
  assert.equal(S.PCT_REPASSE, 75, "75/100 é 75% (nível Bronze, comissão de 25%)");
  for (const [e, s] of [["08:00", "08:30"], ["08:00", "11:00"]]) assert.equal(S.validarAula(e, s), "");
  assert.match(S.validarAula("08:00", "08:29"), /mínimo/); assert.match(S.validarAula("08:00", "11:01"), /máximo/);
});
t("o cliente não consegue definir o preço da aula", async () => {
  await alunoComCartao();
  const r = await chamar("POST", "/criarAula", { token: "alunoA", body: { aluno: "Aluno A — Rua 1", data: dia(2), entrada: "08:00", saida: "09:00", foco: "Musculação", valor: 1, valorCentavos: 1, total: 1 } });
  ok(r); assert.equal(r.json.total, 10000); const p = await get("aulas", r.json.id); assert.equal(p.valorPersonalCentavos, 7500);
});
t("pagamento aprovado credita R$75 (carência) + R$25 plataforma, de forma idempotente", async () => {
  const sid = await cenarioPago();
  assert.deepEqual(await get("carteiras", "prom1").then((c) => [c.pendenteCentavos, c.disponivelCentavos]), [7500, 0]);
  assert.equal((await get("carteiras", "PLATAFORMA")).disponivelCentavos, 2500);
  ok(await pagar(sid)); ok(await pagar(sid));                                            // repetição (webhook + retorno)
  assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 7500, "crédito duplicado!");
  const n = await get("notas", (await get("aulas", sid)).notaId); assert.match(n.prestador.documento, /^\*\*\*\./, "CPF na nota deve estar mascarado");
});
t("valor/moeda/referência divergentes do Mercado Pago são recusados", async () => {
  await semear({ treinado: true }); const sid = await aula(); ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }));
  falha(await pagar(sid, { transaction_amount: 99.99 }), 400, "valor-divergente");
  falha(await pagar(sid, { external_reference: "outro" }), 400, "pagamento-invalido");
  assert.equal((await get("aulas", sid)).status, "aceita");
});
t("carência: saldo pendente → disponível só depois de LIBERACAO_DIAS; saque com todas as travas", async () => {
  await cenarioPago();
  let r = await chamar("GET", "/carteira", { token: "prom1" }); assert.deepEqual([r.json.pendenteCentavos, r.json.disponivelCentavos], [7500, 0]);
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 2500 } }), 409, "saldo-insuficiente");
  E.avancar((C.LIBERACAO_DIAS + 1) * DIA);
  r = await chamar("GET", "/carteira", { token: "prom1" }); assert.deepEqual([r.json.pendenteCentavos, r.json.disponivelCentavos], [0, 7500]);
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 100 } }), 400, "saque-minimo");
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 8000 } }), 409, "saldo-insuficiente");
  E.tokens.prom1.auth_time = Math.floor(E.clock.now / 1000) - 3600;                      // login antigo
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 2500 } }), 401, "reautenticar");
  E.tokens.prom1.auth_time = undefined;
  const s = await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 2500 } }); ok(s);
  assert.equal((await get("carteiras", "prom1")).disponivelCentavos, 5000);
  // admin paga um, rejeita outro (devolve)
  ok(await chamar("POST", `/admin/saques/${s.json.id}/rejeitar`, { token: "adm", body: { motivo: "teste" } }));
  assert.equal((await get("carteiras", "prom1")).disponivelCentavos, 7500);
  falha(await chamar("POST", `/admin/saques/${s.json.id}/pagar`, { token: "adm", body: { comprovante: "E2E123" } }), 409, "saque-resolvido");
  const s2 = await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 7500 } }); ok(s2);
  ok(await chamar("POST", `/admin/saques/${s2.json.id}/pagar`, { token: "adm", body: { comprovante: "E2E456" } }));
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true, JSON.stringify(c.json.divergencias));
});
t("Pix recém-alterado trava saques por 24h", async () => {
  await cenarioPago(); E.avancar(3 * DIA);
  ok(await chamar("PUT", "/perfil/personal/pix", { token: "prom1", body: { tipo: "E-mail", chave: "novo@pix.com" } }));
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 2500 } }), 403, "pix-recente");
  const p = await get("personais_privado", "prom1"); assert.ok(!JSON.stringify(p).includes("novo@pix.com"), "Pix em texto puro!");
});
t("estorno antes da liberação desfaz R$75 e R$25 e a conciliação fecha", async () => {
  const sid = await cenarioPago();
  mpMock({ "POST /v1/payments/777/refunds": { id: 5 }, "GET /v1/payments/777": pgMP(sid) });
  falha(await chamar("POST", `/admin/aulas/${sid}/estornar`, { token: "prom1", body: { motivo: "x ok ok" } }), 403, "sem-permissao");
  ok(await chamar("POST", `/admin/aulas/${sid}/estornar`, { token: "adm", body: { motivo: "Serviço não prestado" } }));
  assert.deepEqual(await get("carteiras", "prom1").then((c) => [c.pendenteCentavos, c.disponivelCentavos]), [0, 0]);
  assert.equal((await get("carteiras", "PLATAFORMA")).disponivelCentavos, 0);
  assert.equal((await get("aulas", sid)).status, "estornada"); assert.equal((await get("notas", (await get("aulas", sid)).notaId)).status, "cancelada");
  const r2 = await chamar("POST", `/admin/aulas/${sid}/estornar`, { token: "adm", body: { motivo: "repetido ok" } }); assert.equal(r2.json.jaEstornado, true);
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true, JSON.stringify(c.json.divergencias)); assert.equal(c.json.totais.diferencaCentavos, 0);
});
t("estorno depois do saque deixa a carteira negativa (sinalizada) e continua conciliado", async () => {
  const sid = await cenarioPago(); E.avancar(3 * DIA);
  ok(await chamar("GET", "/carteira", { token: "prom1" })); ok(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 7500 } }));
  mpMock({ "POST /v1/payments/777/refunds": { id: 5 } });
  const r = await chamar("POST", `/admin/aulas/${sid}/estornar`, { token: "adm", body: { motivo: "Chargeback antecipado" } }); ok(r); assert.equal(r.json.saldoNegativo, true);
  assert.equal((await get("carteiras", "prom1")).disponivelCentavos, -7500);
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true); assert.ok(c.json.divergencias.some((d) => d.tipo === "saldo_negativo" && d.informativo));
});
t("webhook: assinatura inválida 401; válida processa; reembolso estorna", async () => {
  await semear({ treinado: true }); const sid = await aula(); ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } })); await executar(sid);
  mpMock({ "GET /v1/payments/777": pgMP(sid), "POST /v1/payments/777/refunds": { id: 9 } });
  const assinar = (id, reqId, ts) => `ts=${ts},v1=${crypto.createHmac("sha256", "segredo-webhook").update(`id:${id};request-id:${reqId};ts:${ts};`).digest("hex")}`;
  const hook = (h) => chamar("POST", "/webhookMP?data.id=777&type=payment", { headers: h, body: {} });
  falha(await hook({ "x-request-id": "r1", "x-signature": "ts=1,v1=00" }), 401, "assinatura-invalida");
  falha(await hook({}), 401, "assinatura-invalida");
  ok(await hook({ "x-request-id": "r1", "x-signature": assinar("777", "r1", "123") })); ok(await hook({ "x-request-id": "r1", "x-signature": assinar("777", "r1", "123") }));
  assert.equal((await get("aulas", sid)).status, "paga"); assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 7500);
  mpMock({ "GET /v1/payments/777": pgMP(sid, { status: "refunded" }) });
  ok(await hook({ "x-request-id": "r2", "x-signature": assinar("777", "r2", "124") }));
  assert.equal((await get("pagamentos_internos", sid)).status, "estornado"); assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 0);
});
t("conciliação detecta saldo adulterado", async () => {
  await cenarioPago(); await ctx.db.collection("carteiras").doc("prom1").set({ pendenteCentavos: 99999 }, { merge: true });
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, false); assert.ok(c.json.divergencias.some((d) => d.tipo === "saldo_carteira" && d.ref === "prom1"));
});
t("CSV: injeção de fórmula neutralizada, valores negativos preservados, escopo por papel", async () => {
  await cenarioPago(); await set("aulas", "x", { uid: "alunoA", status: "paga", aluno: "=HYPERLINK(\"http://x\")", data: dia(1), foco: "Musculação", personalNome: "@evil" });
  const r = await chamar("GET", "/aluno/exportar.csv", { token: "alunoA" }); ok(r); assert.ok(r.texto.includes("'=HYPERLINK") && r.texto.includes("'@evil")); assert.equal(r.h["Content-Type"], "text/csv; charset=utf-8");
  falha(await chamar("GET", "/aluno/exportar.csv", { token: "prom1" }), 403, "sem-permissao");
  const a = await chamar("GET", "/admin/exportar/lancamentos.csv", { token: "adm" }); ok(a); assert.ok(a.texto.includes("75,00") && a.texto.includes("25,00"));
  falha(await chamar("GET", "/admin/exportar/lancamentos.csv", { token: "alunoA" }), 403, "sem-permissao");
});

// =================== 2. IDADE 18+ E CREF ===================
t("cadastro: 17 anos recusado; 18 exatos aceitos; CREF obrigatório, válido e único; fronteiras", async () => {
  const body = (n, extra = {}) => ({ termos: true, nascimento: n, cpf: cpf(0), cref: "012345-G/SP", ...extra });
  const hoje = V.hojeSP(), [a, m, d] = hoje.split("-").map(Number), ant = (anos, dd = 0) => { const x = new Date(Date.UTC(a - anos, m - 1, d - dd)); return x.toISOString().slice(0, 10); };
  falha(await chamar("POST", "/cadastro/personal", { token: "novo", body: body(ant(17, 0)) }), 403, "idade-minima");
  falha(await chamar("POST", "/cadastro/personal", { token: "novo", body: body(ant(18, -1)) }), 403, "idade-minima");   // faz 18 amanhã
  falha(await chamar("POST", "/cadastro/personal", { token: "novo", body: body(dia(1)) }), 400, "nascimento-invalido");
  falha(await chamar("POST", "/cadastro/personal", { token: "novo", body: body("2010-02-31") }), 400, "nascimento-invalido");
  falha(await chamar("POST", "/cadastro/personal", { token: "novo", body: body("1850-01-01") }), 400, "nascimento-invalido");
  falha(await chamar("POST", "/cadastro/personal", { token: "novo", body: body("2000-01-01", { nascimento: { $gt: "" } }) }), 400, "nascimento-invalido");  // objeto no lugar de string
  const semCref = body(ant(18, 0)); delete semCref.cref;
  assert.ok([400].includes((await chamar("POST", "/cadastro/personal", { token: "novo", body: semCref })).status), "sem CREF não cadastra");
  assert.equal((await chamar("POST", "/cadastro/personal", { token: "novo", body: body(ant(18, 0), { cref: "123" }) })).status, 400, "CREF inválido");
  assert.equal((await chamar("POST", "/cadastro/personal", { token: "novo", body: body(ant(18, 0), { cref: "012345-G/XX" }) })).status, 400, "UF inválida");
  const r = await chamar("POST", "/cadastro/personal", { token: "novo", body: body(ant(18, 0), { cref: "012345-g/sp", telefone: "19988887777" }) });
  ok(r); assert.deepEqual([r.json.idade, r.json.status], [18, "pendente"]);
  assert.equal(E.claimsStore.novo1.role, "personal");
  assert.equal((await get("personais", "novo1")).cref, "012345-G/SP", "CREF normalizado");
  const raw = JSON.stringify(await get("personais_privado", "novo1")); for (const seg of [cpf(0), "19988887777", ant(18, 0)]) assert.ok(!raw.includes(seg), `dado sensível em texto puro: ${seg}`);
  assert.ok(!JSON.stringify(await get("personais", "novo1")).includes("n@x.com"), "e-mail não deve ficar no perfil público");
  falha(await chamar("POST", "/cadastro/personal", { token: "novo2", body: body("1990-03-04", { cpf: cpf(2) }) }), 409, "cref-duplicado");
});
t("cadastro: CPF inválido/duplicado; papéis exclusivos", async () => {
  const cref = "054321-G/SP";
  falha(await chamar("POST", "/cadastro/personal", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: "111.111.111-11", cref } }), 400, "cpf-invalido");
  falha(await chamar("POST", "/cadastro/personal", { token: "novo", body: { nascimento: "1990-03-04", cpf: cpf(0), cref } }), 400, "termos-obrigatorios");
  const r = await chamar("POST", "/cadastro/personal", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0), cref } }); ok(r);
  falha(await chamar("POST", "/cadastro/personal", { token: "novo2", body: { termos: true, nascimento: "1991-03-04", cpf: cpf(0), cref: "065432-G/SP" } }), 409, "cpf-duplicado");
  falha(await chamar("POST", "/cadastro/personal", { token: "alunoA", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(2), cref: "076543-G/SP" } }), 409, "papel-conflito");
  falha(await chamar("POST", "/cadastro/aluno", { token: "prom1", body: { termos: true } }), 409, "papel-conflito");
  ok(await chamar("POST", "/cadastro/aluno", { token: "novo2", body: { termos: true } })); assert.equal(E.claimsStore.novo2.role, "aluno");
});
t("data de nascimento e CPF ficam travados (não dá para 'rejuvenescer' a conta)", async () => {
  await semear({ nascimento: "1995-05-20" });
  falha(await chamar("PUT", "/perfil/personal/privado", { token: "prom1", body: { nascimento: "1980-01-01" } }), 409, "dado-travado");
  falha(await chamar("PUT", "/perfil/personal/privado", { token: "prom1", body: { cpf: cpf(3) } }), 409, "dado-travado");
  ok(await chamar("PUT", "/perfil/personal/privado", { token: "prom1", body: { telefone: "(19) 91234-5678", status: "ativo", treinamentoOk: true } }));
  assert.equal((await get("personais", "prom1")).treinamentoOk, false);
  const p = await chamar("GET", "/perfil/privado", { token: "prom1" }); assert.match(p.json.cpfMascarado, /^\*\*\*\./); assert.equal(p.json.idade >= 30, true); assert.equal(p.json.cref, "12345-G/SP");
});
t("conta antiga sem nascimento é bloqueada até informar; sem CREF não aceita aula", async () => {
  await set("personais", "prom1", { uid: "prom1", nome: "Antigo", status: "ativo" }); await set("personais_privado", "prom1", { uid: "prom1" }); await concluirTreino("prom1");
  const sid = await aula(); falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }), 403, "idade-nao-verificada");
  const sit = await chamar("GET", "/habilitacao", { token: "prom1" }); assert.ok(sit.json.pendencias.includes("nascimento")); assert.ok(sit.json.pendencias.includes("cref")); assert.equal(sit.json.habilitado, false);
  await semear({ nascimento: "1990-01-01", treinado: true }); await ctx.db.collection("personais").doc("prom1").update({ cref: "" });
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }), 403, "cref-pendente");
  await ctx.db.collection("personais").doc("prom1").update({ cref: "012345-G/SP" });
  ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }));
});
t("menor de 18 já cadastrado nunca aceita aula, mesmo com tudo o mais em dia; ao fazer 18 libera", async () => {
  const hoje = V.hojeSP(), [a, m, d] = hoje.split("-").map(Number), ant = (anos) => new Date(Date.UTC(a - anos, m - 1, d - 1)).toISOString().slice(0, 10);
  await semear({ nascimento: ant(17), treinado: true });
  const sid = await aula(); falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }), 403, "idade-minima");
  await semear({ uid: "prom2", nascimento: ant(18), treinado: true, cpfn: 2 });
  ok(await chamar("POST", "/aceitarAula", { token: "prom2", body: { aulaId: await aula({ entrada: "06:00", saida: "07:00" }) } }));
});
// =================== 3. CAPACITAÇÃO PERSONOW ===================
t("sem treinamento concluído não aceita aula (inclusive com catálogo vazio: falha fechada)", async () => {
  await semear(); const sid = await aula();
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }), 403, "treinamento-pendente");   // nenhum módulo cadastrado
  await modulo();
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }), 403, "treinamento-pendente");
  assert.equal((await get("aulas", sid)).status, "aberta");
});
t("progresso é validado no servidor: pular, acelerar e declarar conclusão não funcionam", async () => {
  await semear(); await modulo("m1", 1, 100); await modulo("m2", 2, 60);
  const ping = (b) => chamar("POST", "/treinamento/ping", { token: "prom1", body: b });
  falha(await ping({ moduloId: "m2", posicaoSeg: 0, tocando: true }), 403, "modulo-bloqueado");                      // ordem obrigatória
  ok(await ping({ moduloId: "m1", posicaoSeg: 0, tocando: true }));
  E.avancar(10_000); let r = await ping({ moduloId: "m1", posicaoSeg: 95, tocando: true }); ok(r); assert.equal(r.json.validoSeg, 0, "pulo para o fim não pode creditar");
  E.avancar(1000); falha(await ping({ moduloId: "m1", posicaoSeg: 0, tocando: true }), 429, "ping-rapido");
  E.avancar(10_000); r = await ping({ moduloId: "m1", posicaoSeg: 1, tocando: true }); assert.equal(r.json.validoSeg, 1);   // reinício correto só credita contíguo
  for (let i = 0; i < 8; i++) { E.avancar(10_000); r = await ping({ moduloId: "m1", posicaoSeg: Math.min(99, r.json.validoSeg + 10), tocando: true }); ok(r); }
  assert.equal(r.json.concluido, false, "80 s de reprodução não bastam para 90% de 100 s (limiar 90)");
  E.avancar(10_000); r = await ping({ moduloId: "m1", posicaoSeg: r.json.validoSeg + 10, tocando: true }); assert.equal(r.json.concluido, true); assert.equal(r.json.treinamentoCompleto, false);
  assert.equal((await get("personais", "prom1")).treinamentoOk, false, "m2 ainda pendente");
  ok(await ping({ moduloId: "m2", posicaoSeg: 0, tocando: true }));
  let pos = 0; for (let i = 0; i < 7; i++) { E.avancar(10_000); pos += 10; r = await ping({ moduloId: "m2", posicaoSeg: pos, tocando: true }); }
  assert.equal(r.json.concluido, true); assert.equal(r.json.treinamentoCompleto, true);
  assert.equal((await get("personais", "prom1")).treinamentoOk, true); assert.equal(E.claimsStore.prom1.treinado, true);
});
t("pausado não credita; completar libera o aceite; novo módulo obrigatório re-bloqueia", async () => {
  await semear(); await modulo("m1", 1, 30);
  const ping = (b) => chamar("POST", "/treinamento/ping", { token: "prom1", body: b });
  ok(await ping({ moduloId: "m1", posicaoSeg: 0, tocando: true })); E.avancar(10_000); let r = await ping({ moduloId: "m1", posicaoSeg: 10, tocando: false }); assert.equal(r.json.validoSeg, 0);
  let pos = 0; E.avancar(5000); await ping({ moduloId: "m1", posicaoSeg: 0, tocando: true }); for (let i = 0; i < 3; i++) { E.avancar(10_000); pos += 10; r = await ping({ moduloId: "m1", posicaoSeg: pos, tocando: true }); }
  assert.equal(r.json.treinamentoCompleto, true);
  const sid = await aula(); ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }));
  await modulo("m3", 3, 60);
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: await aula({ data: dia(5) }) } }), 403, "treinamento-pendente");
  const st = await chamar("GET", "/treinamento", { token: "prom1" }); assert.equal(st.json.completo, false); assert.equal(E.claimsStore.prom1.treinado, false);
});
t("admin cadastra módulos com validação; personal não", async () => {
  const b = { ordem: 1, titulo: "Boas-vindas Personow", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 300 };
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "prom1", body: b }), 403, "sem-permissao");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, videoRef: "http://x" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, provedor: "mp4", videoRef: "http://inseguro/v.mp4" } }), 400, "dados-invalidos");
  ok(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: b }));
});
t("aprovar cadastro exige dados legais completos; bloquear derruba sessões", async () => {
  await set("personais", "prom1", { uid: "prom1", nome: "A", status: "pendente" }); await set("personais_privado", "prom1", { uid: "prom1" });
  falha(await chamar("POST", "/admin/personais/prom1/status", { token: "adm", body: { status: "ativo" } }), 409, "cadastro-incompleto");
  await semear({ status: "pendente" }); ok(await chamar("POST", "/admin/personais/prom1/status", { token: "adm", body: { status: "ativo" } }));
  ok(await chamar("POST", "/admin/personais/prom1/status", { token: "adm", body: { status: "bloqueado", motivo: "fraude" } }));
  falha(await chamar("GET", "/habilitacao", { token: "prom1" }), 401, "sessao-invalida");
});

// =================== 4. SEGURANÇA ===================
t("RBAC: cada papel só alcança suas rotas; sem token/e-mail não verificado → 401", async () => {
  falha(await chamar("POST", "/criarAula", { body: {} }), 401, "nao-autenticado");
  falha(await chamar("POST", "/criarAula", { token: "prom1", body: {} }), 403, "sem-permissao");
  falha(await chamar("POST", "/aceitarAula", { token: "alunoA", body: {} }), 403, "sem-permissao");
  falha(await chamar("GET", "/admin/personais", { token: "alunoA" }), 403, "sem-permissao"); falha(await chamar("GET", "/admin/conciliacao", { token: "prom1" }), 403, "sem-permissao");
  falha(await chamar("GET", "/carteira", { token: "alunoA" }), 403, "sem-permissao");
  falha(await chamar("GET", "/aluno/exportar.csv", { token: "nv" }), 401, "sessao-invalida");
  assert.equal((await chamar("POST", "/criarAula", { headers: { authorization: "Bearer lixo" }, body: {} })).status, 401);
  ok(await chamar("GET", "/admin/personais", { token: "adm" }));
});
t("MFA de administrador quando ADMIN_EXIGE_MFA=1", async () => {
  C.ADMIN_EXIGE_MFA = true; try { falha(await chamar("GET", "/admin/personais", { token: "adm" }), 403, "mfa-obrigatorio"); E.tokens.adm1 = undefined; E.tokens.adm = { ...U.adm, firebase: { sign_in_second_factor: "totp" } }; ok(await chamar("GET", "/admin/personais", { token: "adm" })); } finally { C.ADMIN_EXIGE_MFA = false; E.tokens.adm = U.adm; }
});
t("IDOR: aluno B e personal B não tocam em aulas alheios (resposta 404, sem confirmar existência)", async () => {
  await semear({ treinado: true }); const sid = await aula(); ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }));
  await alunoComCartao("alunoB");
  for (const [rota, tk] of [["/cancelarAula", "alunoB"], ["/criarCobranca", "alunoB"], ["/avaliarServico", "alunoB"], ["/desistirAula", "prom2"]]) {
    const r = await chamar("POST", rota, { token: tk, body: { aulaId: sid, estrelas: 5 } }); falha(r, 404, "nao-encontrado"); }
  falha(await chamar("POST", "/confirmarPagamento", { token: "alunoB", body: { aulaId: sid, paymentId: "777" } }), 404, "nao-encontrado");
  assert.equal((await get("aulas", sid)).status, "aceita");
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: { $ne: null } } }), 400, "dados-invalidos");       // injeção NoSQL
});
t("validação de entrada: tipos, datas, modalidade, mass assignment", async () => {
  await alunoComCartao();
  const base = { aluno: "Aluno A — Rua 1", data: dia(2), entrada: "08:00", saida: "09:00", foco: "Musculação" };
  for (const ruim of [{ foco: "Drop table" }, { data: "2020-01-01" }, { data: dia(200) }, { aluno: { $gt: "" } }, { aluno: "x" }, { entrada: "25:00" }, { saida: "13:00:00" }, { personalPreferido: "../x" }])
    assert.ok([400].includes((await chamar("POST", "/criarAula", { token: "alunoA", body: { ...base, ...ruim } })).status), JSON.stringify(ruim));
  const r = await chamar("POST", "/criarAula", { token: "alunoA", body: { ...base, status: "paga", uid: "outro", personalUid: "x" } }); ok(r);
  const p = await get("aulas", r.json.id); assert.deepEqual([p.status, p.uid, p.personalUid], ["aberta", "alunoA", undefined]);
});
t("regras de aceite: aprovação, limite semanal, conflito de horário, janela de exclusividade", async () => {
  await semear({ status: "pendente", treinado: true }); const s1 = await aula();
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: s1 } }), 403, "personal-inativo");
  await semear({ treinado: true });
  ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: s1 } }));
  falha(await chamar("POST", "/aceitarAula", { token: "prom2", body: { aulaId: s1 } }), 403, "personal-inativo");
  const s2 = await aula({ entrada: "08:30", saida: "09:30" }); falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: s2 } }), 409, "conflito-horario");
  for (const [e, f] of [["10:00", "11:00"], ["12:00", "13:00"], ["14:00", "15:00"], ["16:00", "17:00"]]) ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: await aula({ entrada: e, saida: f }) } }));   // 5 aulas na semana
  const s5 = await aula({ entrada: "18:00", saida: "19:00" }); falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: s5 } }), 409, "limite-semanal");
  await semear({ uid: "prom2", cpfn: 2, treinado: true }); await alunoComCartao();
  const ex = await chamar("POST", "/criarAula", { token: "alunoA", body: { aluno: "Aluno A — Rua 1", data: dia(9), entrada: "08:00", saida: "09:00", foco: "Musculação", personalPreferido: "prom1" } }); ok(ex);
  falha(await chamar("POST", "/aceitarAula", { token: "prom2", body: { aulaId: ex.json.id } }), 403, "exclusivo");
  E.avancar(6 * 60_000); ok(await chamar("POST", "/aceitarAula", { token: "prom2", body: { aulaId: ex.json.id } }));
});
t("avaliação: uma vez por serviço pago, só pelo aluno dona, média do personal atualizada", async () => {
  const sid = await cenarioPago();
  falha(await chamar("POST", "/avaliarServico", { token: "alunoA", body: { aulaId: sid, estrelas: 6 } }), 400, "dados-invalidos");
  ok(await chamar("POST", "/avaliarServico", { token: "alunoA", body: { aulaId: sid, estrelas: 4, comentario: "ok" } }));
  falha(await chamar("POST", "/avaliarServico", { token: "alunoA", body: { aulaId: sid, estrelas: 5 } }), 409, "ja-avaliado");
  assert.equal((await get("personais", "prom1")).ratingMedia, 4);
});
t("cron de liberação exige segredo; rate limit devolve 429", async () => {
  falha(await chamar("POST", "/interno/liberar", { headers: { "x-cron-secret": "errado" } }), 401);
  ok(await chamar("POST", "/interno/liberar", { headers: { "x-cron-secret": "cron-secreto" } }));
  let ultimo; for (let i = 0; i < 14; i++) ultimo = await chamar("POST", "/cadastro/aluno", { token: "novo2", body: {}, ip: "7.7.7.7" }); falha(ultimo, 429, "limite-requisicoes");
});
t("middlewares: CSRF/Origin, Content-Type, CORS fechado e cabeçalhos (CSP sem unsafe-inline em scripts)", async () => {
  const origens = Seg.origensPermitidas("https://app.exemplo.com"), csrf = Seg.protecaoCsrf(origens, { isentas: ["/webhookMP"] });
  const rodar = (req) => new Promise((r) => csrf({ method: "POST", path: "/criarAula", ...req, get: (n) => (req.h || {})[n.toLowerCase()] }, {}, (e) => r(e?.codigo || "ok")));
  assert.equal(await rodar({ h: { origin: "https://evil.com", "content-type": "application/json", "content-length": "2", host: "api" } }), "origem-invalida");
  assert.equal(await rodar({ h: { origin: "https://app.exemplo.com", "content-type": "text/plain", "content-length": "5" } }), "tipo-invalido");
  assert.equal(await rodar({ h: { origin: "https://app.exemplo.com", "content-type": "application/json", "content-length": "5" } }), "ok");
  const c = Seg.opcoesCors(origens); await new Promise((r) => c.origin("https://evil.com", (_, v) => (assert.equal(v, false), r())));
  const hs = {}; Seg.cabecalhos()({}, { setHeader: (k, v) => (hs[k] = v), removeHeader() {} }, () => {});
  const script = hs["Content-Security-Policy"].split(";").find((s) => s.trim().startsWith("script-src")); assert.ok(!script.includes("unsafe-inline") && !script.includes("unsafe-eval"));
  assert.ok(hs["Strict-Transport-Security"] && hs["X-Frame-Options"] === "DENY" && hs["X-Content-Type-Options"] === "nosniff");
});
t("sandbox: contas de teste não existem fora de MODO_TESTE e não acessam rotas de outro papel", async () => {
  const r = await chamar("POST", "/teste/login", { body: { perfil: "personal" } }); ok(r); assert.equal((await get("personais", "teste-personal")).status, "ativo");
  falha(await chamar("POST", "/teste/pagar", { token: "alunoA", body: { aulaId: "x" } }), 403, "so-teste");
});
t("regras do Firestore: deny-by-default, sem escrita aberta, campos sensíveis protegidos", async () => {
  const fs = require("node:fs"), rules = fs.readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  assert.match(rules, /match \/\{documento=\*\*\} \{ allow read, write: if false; \}/); assert.ok(!/allow [^;]*if true/.test(rules));
  for (const col of ["personais_privado", "pagamentos_internos", "carteiras", "lancamentos", "saques", "treinamento_progresso", "habilitacao_categorias", "habilitacao_sessoes", "auditoria"]) assert.ok(new RegExp("match \\/" + col + "\\/\\{\\w+\\}\\s*\\{ allow read, write: if false;").test(rules), col);
  const upd = /match \/personais\/\{uid\}[\s\S]*?allow update:[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1];
  for (const proibido of ["status", "treinamentoOk", "habilitacoes", "role", "ratingMedia", "refCode"]) assert.ok(!upd.includes(`'${proibido}'`), `cliente não pode alterar ${proibido}`);
  assert.match(rules, /treinado\(\) && !banido\(\) && resource\.data\.status == 'aberta'/);
  assert.match(rules, /match \/aulas\/\{id\} \{[\s\S]*?allow write: if false;/);
});

// =================== 8. CURSOS, PERFIL INTELIGENTE E GEOLOCALIZAÇÃO ===================
t("cursos opcionais não bloqueiam nem entram na habilitação; obrigatórios seguem em ordem", async () => {
  await semear();
  await set("treinamento_modulos", "o1", { ordem: 1, titulo: "Obrigatório 1", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 100, ativo: true });
  await set("treinamento_modulos", "c1", { ordem: 2, titulo: "Curso opcional", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 100, ativo: true, obrigatorio: false, categoria: "saude" });
  await set("treinamento_modulos", "o2", { ordem: 3, titulo: "Obrigatório 2", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 100, ativo: true });
  const r = await chamar("GET", "/treinamento", { token: "prom1" }); ok(r);
  const m = Object.fromEntries(r.json.modulos.map((x) => [x.id, x]));
  assert.equal(m.c1.bloqueado, false, "opcional sempre aberto"); assert.equal(m.c1.categoria, "saude"); assert.equal(m.c1.obrigatorio, false);
  assert.equal(m.o2.bloqueado, true, "o2 espera o1"); assert.equal(m.o1.categoria, "habilitacao");
  assert.equal(r.json.total, 2, "só obrigatórios contam"); assert.deepEqual(r.json.opcionais, { concluidos: 0, total: 1 });
  await set("treinamento_progresso", "prom1_o1", { uid: "prom1", moduloId: "o1", validoSeg: 100, concluido: true });
  await set("treinamento_progresso", "prom1_o2", { uid: "prom1", moduloId: "o2", validoSeg: 100, concluido: true });
  const f = await chamar("GET", "/treinamento", { token: "prom1" }); assert.equal(f.json.completo, true, "habilitado sem fazer o curso opcional");
});
t("admin cadastra curso opcional por categoria; obrigatório sempre cai em 'habilitacao'; categoria inválida é recusada", async () => {
  const b = { ordem: 5, titulo: "Prevenção de perdas na prática", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 300 };
  const r = await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, obrigatorio: false, categoria: "saude" } }); ok(r);
  assert.deepEqual([(await get("treinamento_modulos", r.json.id)).obrigatorio, (await get("treinamento_modulos", r.json.id)).categoria], [false, "saude"]);
  const r2 = await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, categoria: "tecnica" } }); ok(r2);
  assert.equal((await get("treinamento_modulos", r2.json.id)).categoria, "habilitacao");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, obrigatorio: false, categoria: "inventada" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "prom1", body: b }), 403, "sem-permissao");
});
t("perfil inteligente: personal salva experiência+Eneagrama; bio/palavras vão ao perfil público, Eneagrama NÃO", async () => {
  await semear();
  const corpo = { experiencias: [{ area: "Musculação / Hipertrofia", anos: 3 }, { area: "Pilates", anos: 2, detalhe: "postura e core" }], eneagrama: { tipo: 1, asa: 2, instinto: "SP" }, palavrasChave: ["musculação", "pilates", "3+ anos de experiência"], bio: "Personal trainer com 3 anos em musculação.", bioAuto: true };
  ok(await chamar("PUT", "/perfil/personal/inteligente", { token: "prom1", body: corpo }));
  const pub = await get("personais", "prom1");
  assert.equal(pub.bio, corpo.bio); assert.deepEqual(pub.palavrasChave, corpo.palavrasChave); assert.deepEqual(pub.areasExperiencia, ["Musculação / Hipertrofia", "Pilates"]);
  assert.equal(pub.eneagrama, undefined, "Eneagrama não é público"); assert.equal(pub.status, "ativo");
  const lido = await chamar("GET", "/perfil/personal/inteligente", { token: "prom1" }); ok(lido); assert.deepEqual(lido.json.eneagrama, { tipo: 1, asa: 2, instinto: "SP" }); assert.equal(lido.json.experiencias.length, 2);
});
t("perfil inteligente: validação rígida (área, asa não vizinha, tipo, palavras, tamanho) e campos extras ignorados", async () => {
  await semear(); const put = (b) => chamar("PUT", "/perfil/personal/inteligente", { token: "prom1", body: b });
  falha(await put({ experiencias: [{ area: "Hacker", anos: 1 }] }), 400, "dados-invalidos");
  falha(await put({ experiencias: [{ area: "Bebidas", anos: 1 }, { area: "Bebidas", anos: 2 }] }), 400, "dados-invalidos");
  falha(await put({ experiencias: [{ area: "Bebidas", anos: 99 }] }), 400, "dados-invalidos");
  falha(await put({ eneagrama: { tipo: 10 } }), 400, "dados-invalidos"); falha(await put({ eneagrama: { tipo: 1, asa: 5 } }), 400, "dados-invalidos"); falha(await put({ eneagrama: { tipo: 1, instinto: "XX" } }), 400, "dados-invalidos");
  falha(await put({ palavrasChave: ["<script>alert(1)</script>"] }), 400, "dados-invalidos"); falha(await put({ palavrasChave: Array(13).fill("ok x") }), 400, "dados-invalidos");
  falha(await put({ bio: "x".repeat(301) }), 400, "dados-invalidos");
  ok(await put({ experiencias: [], eneagrama: null, bio: "ok", status: "ativo", treinamentoOk: true, ratingMedia: 5 }));
  const p = await get("personais", "prom1"); assert.equal(p.treinamentoOk, false); assert.equal(p.ratingMedia, undefined);
  falha(await chamar("PUT", "/perfil/personal/inteligente", { token: "alunoA", body: {} }), 403, "sem-permissao");
});
t("aula herda a localização do aluno (servidor): local/regiao; campos soltos do cliente são ignorados", async () => {
  await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "Aluno A", localizacao: { lat: -22.4358, lng: -46.8231, cidade: "Itapira", uf: "SP" } }); await set("cartoes", "alunoA", { uid: "alunoA", status: "ativo", ultimos4: "1234" });
  const r = await chamar("POST", "/criarAula", { token: "alunoA", body: { aluno: "Aluno A — Rua 1", data: dia(2), entrada: "08:00", saida: "09:00", foco: "Musculação", lat: 0, lng: 0, cidade: "Outra" } }); ok(r);
  const v = await get("aulas", r.json.id); assert.deepEqual([v.local.lat, v.local.lng, v.regiao.cidade, v.regiao.uf], [-22.4358, -46.8231, "Itapira", "SP"]);
  assert.equal(v.lat, undefined, "coordenadas soltas do cliente não entram na aula"); assert.equal(v.cidade, undefined);
});
t("aluno sem localização cadastrada não consegue pedir (o check-in precisa do ponto exato do aluno)", async () => {
  await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "Aluno A" }); await set("cartoes", "alunoA", { uid: "alunoA", status: "ativo", ultimos4: "1234" });
  falha(await chamar("POST", "/criarAula", { token: "alunoA", body: { aluno: "Aluno A — Rua 1", data: dia(2), entrada: "08:00", saida: "09:00", foco: "Musculação" } }), 409, "localizacao-obrigatoria");
});
t("regras do Firestore: aluno e personal NÃO gravam localização nem perfil inteligente direto (só o servidor valida)", async () => {
  const fs = require("node:fs"), rules = fs.readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  const alunoUpd = /match \/alunos\/\{uid\}[\s\S]*?allow update:[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1];
  for (const c of ["cidade", "uf", "lat", "lng", "localizacao"]) assert.ok(!alunoUpd.includes(`'${c}'`), `aluno não grava ${c} direto`);
  const promUpd = /match \/personais\/\{uid\}[\s\S]*?allow update:[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1];
  for (const c of ["eneagrama", "experiencias", "palavrasChave", "areasExperiencia", "nivel", "vidas"]) assert.ok(!promUpd.includes(`'${c}'`), c);
});
t("conta de parceiro (B2B) não vira aluno/personal por engano e /sessao a orienta ao painel do parceiro", async () => {
  await semear(); E.tokens.parceiro1 = { uid: "parceiro1", email: "mk1@x.com", email_verified: true }; E.claimsStore.parceiro1 = { role: "parceiro" };
  const parceiro = await chamar("POST", "/sessao", { token: "parceiro1", body: {} });
  ok(parceiro); assert.equal(parceiro.json.estado, "outro-perfil"); assert.equal(parceiro.json.destino, "/parceiro.html");
  falha(await chamar("POST", "/cadastro/aluno", { token: "parceiro1", body: { termos: true } }), 409, "papel-conflito");
  falha(await chamar("POST", "/cadastro/personal", { token: "parceiro1", body: { termos: true, nascimento: "1990-01-01", cpf: "52998224725", cref: "011111-G/SP" } }), 409, "papel-conflito");
  assert.equal((await get("alunos", "parceiro1")), undefined, "nenhum cadastro foi criado");
});
t("cabeçalhos: geolocalização e câmera liberadas só para a própria origem; microfone segue bloqueado", async () => {
  const Seg = ctx.Seg || require("../server/lib/seguranca.js"), hs = {}; Seg.cabecalhos()({}, { setHeader: (k, v) => (hs[k] = v), removeHeader() {} }, () => {});
  const pp = hs["Permissions-Policy"]; assert.match(pp, /geolocation=\(self\)/); assert.match(pp, /camera=\(self\)/); assert.match(pp, /microphone=\(\)/);
});

// =================== 5. MULTI-PERFIL / TROCA DE PORTAL (/sessao) ===================
t("sessão: conta com dois perfis NÃO trava; o portal aberto decide o perfil ativo e nenhum perfil se perde", async () => {
  await set("alunos", "dual", { uid: "dual", nomeCompleto: "Aluno Dual" }); await set("personais", "dual", { uid: "dual", nome: "Dual", status: "ativo", treinamentoOk: true });
  E.tokens.dual = { uid: "dual", email: "d@x.com", email_verified: true };                       // sem claim algum (conta antiga)
  let r = await chamar("POST", "/sessao", { token: "dual", body: {} }); ok(r);                    // cliente antigo, sem portal → escolher (antes: 409 "Conta com dois perfis")
  assert.equal(r.json.estado, "escolher"); assert.deepEqual(r.json.perfis, ["aluno", "personal"]); assert.equal(E.claimsStore.dual, undefined);
  r = await chamar("POST", "/sessao", { token: "dual", body: { portal: "personal" } }); ok(r);
  assert.deepEqual([r.json.estado, r.json.role, r.json.atualizarToken], ["ok", "personal", true]);
  assert.deepEqual([E.claimsStore.dual.role, E.claimsStore.dual.treinado, E.claimsStore.dual.perfis], ["personal", true, ["aluno", "personal"]]);
  ok(await chamar("GET", "/habilitacao", { token: "dual" }));                                      // rota de personal liberada
  r = await chamar("POST", "/sessao", { token: "dual", body: { portal: "aluno" } }); ok(r);
  assert.deepEqual([r.json.estado, r.json.role, E.claimsStore.dual.role], ["ok", "aluno", "aluno"]); assert.deepEqual(E.claimsStore.dual.perfis, ["aluno", "personal"]);
  falha(await chamar("GET", "/habilitacao", { token: "dual" }), 403, "sem-permissao");           // com o aluno ativa, rota de personal continua protegida
  r = await chamar("POST", "/sessao", { token: "dual", body: { portal: "aluno" } }); assert.equal(r.json.atualizarToken, false);   // idempotente: sem novo token à toa
  r = await chamar("POST", "/sessao", { token: "dual", body: {} }); assert.deepEqual([r.json.estado, r.json.role], ["ok", "aluno"]);  // cliente antigo com papel ativo válido
});
t("sessão: perfil errado vira aviso amigável (200 + estado), nunca erro, e não altera o papel", async () => {
  await set("alunos", "alunoA", { uid: "alunoA" });
  let r = await chamar("POST", "/sessao", { token: "alunoA", body: { portal: "personal" } }); ok(r);
  assert.deepEqual([r.json.estado, r.json.sugerido, r.json.role, r.json.atualizarToken], ["outro-perfil", "aluno", null, false]); assert.equal(E.claimsStore.alunoA.role, "aluno");
  await semear({ uid: "prom1" });
  r = await chamar("POST", "/sessao", { token: "prom1", body: { portal: "aluno" } }); ok(r); assert.deepEqual([r.json.estado, r.json.sugerido], ["outro-perfil", "personal"]);
  r = await chamar("POST", "/sessao", { token: "novo", body: { portal: "personal" } }); ok(r); assert.deepEqual([r.json.estado, r.json.perfis], ["cadastro", []]);
  falha(await chamar("POST", "/sessao", { token: "alunoA", body: { portal: "dono" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/sessao", { body: { portal: "aluno" } }), 401, "nao-autenticado");
});
t("sessão: ninguém se promove a admin pelo portal; admin entra nos portais sem perder o admin", async () => {
  let r = await chamar("POST", "/sessao", { token: "alunoA", body: { portal: "admin" } }); ok(r); assert.equal(r.json.estado, "outro-perfil"); assert.equal(E.claimsStore.alunoA.role, "aluno"); assert.ok(!E.claimsStore.alunoA.perfis?.includes("admin"));
  falha(await chamar("GET", "/admin/personais", { token: "alunoA" }), 403, "sem-permissao");
  E.claimsStore.adm1 = { role: "admin", admin: true };
  r = await chamar("POST", "/sessao", { token: "adm", body: { portal: "personal" } }); ok(r); assert.deepEqual([r.json.estado, r.json.perfis], ["cadastro", ["admin"]]);   // admin pode criar o próprio perfil
  ok(await chamar("POST", "/cadastro/personal", { token: "adm", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0), cref: "012345-G/SP" } }));                                       // antes: 409 "outro perfil"
  assert.deepEqual([E.claimsStore.adm1.role, E.claimsStore.adm1.perfis], ["personal", ["personal", "admin"].sort((a, b) => ["aluno", "personal", "admin"].indexOf(a) - ["aluno", "personal", "admin"].indexOf(b))]);
  falha(await chamar("GET", "/admin/personais", { token: "adm" }), 403, "sem-permissao");         // enquanto o portal do personal está ativo
  r = await chamar("POST", "/sessao", { token: "adm", body: { portal: "admin" } }); ok(r); assert.deepEqual([r.json.estado, r.json.role], ["ok", "admin"]);
  ok(await chamar("GET", "/admin/personais", { token: "adm" }));                                  // painel admin de volta
});
t("cadastro: conflito de perfil devolve 409 amigável com a sugestão de painel", async () => {
  await set("alunos", "alunoA", { uid: "alunoA" });
  const r = await chamar("POST", "/cadastro/personal", { token: "alunoA", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(2), cref: "022222-G/SP" } });
  falha(r, 409, "papel-conflito"); assert.deepEqual([r.json.detalhe.tem, r.json.detalhe.sugerido], ["aluno", "aluno"]); assert.match(r.json.erro, /outra conta Google/);
  assert.equal((await get("personais", "alunoA")), undefined);
});

// =================== 6. RECADO DO SUPORTE (admin → personal/aluno) ===================
t("recado: admin envia a personal e aluno; motivo de 'voltar p/ análise' vira recado; aprovar limpa; 'entendi' só limpa o próprio", async () => {
  await semear({ status: "ativo" }); await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "Aluno A" });
  ok(await chamar("POST", "/admin/recado/personal/prom1", { token: "adm", body: { texto: "Olá! Confira seu CPF e fale com o suporte." } }));
  assert.deepEqual([(await get("personais", "prom1")).recado.texto, (await get("personais", "prom1")).recado.tipo], ["Olá! Confira seu CPF e fale com o suporte.", "info"]);
  ok(await chamar("POST", "/admin/recado/aluno/alunoA", { token: "adm", body: { texto: "Bom dia! Complete os dados fiscais." } })); assert.equal((await get("alunos", "alunoA")).recado.texto, "Bom dia! Complete os dados fiscais.");
  ok(await chamar("POST", "/admin/personais/prom1/status", { token: "adm", body: { status: "pendente", motivo: "CPF não confere" } }));
  const p = await get("personais", "prom1"); assert.deepEqual([p.status, p.recado.texto, p.recado.tipo], ["pendente", "CPF não confere", "pendente"]);
  ok(await chamar("POST", "/perfil/recado/lido", { token: "alunoA" })); assert.equal((await get("alunos", "alunoA")).recado, undefined); assert.equal((await get("personais", "prom1")).recado.texto, "CPF não confere");
  ok(await chamar("POST", "/admin/personais/prom1/status", { token: "adm", body: { status: "ativo" } })); assert.equal((await get("personais", "prom1")).recado, undefined);
});
t("recado: só admin envia; validação de tipo/tamanho; cadastro inexistente → 404; o cliente não escreve recado (regras)", async () => {
  await semear({ status: "ativo" });
  for (const tk of ["alunoA", "prom1"]) falha(await chamar("POST", "/admin/recado/personal/prom1", { token: tk, body: { texto: "oi, tudo bem?" } }), 403, "sem-permissao");
  falha(await chamar("POST", "/admin/recado/admin/prom1", { token: "adm", body: { texto: "oi, tudo bem?" } }), 400);
  falha(await chamar("POST", "/admin/recado/personal/prom1", { token: "adm", body: { texto: "x" } }), 400);
  falha(await chamar("POST", "/admin/recado/personal/prom1", { token: "adm", body: { texto: "a".repeat(301) } }), 400);
  falha(await chamar("POST", "/admin/recado/personal/fantasma", { token: "adm", body: { texto: "oi, tudo bem?" } }), 404, "nao-encontrado");
  falha(await chamar("POST", "/perfil/recado/lido", {}), 401, "nao-autenticado");
  const regras = require("node:fs").readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8"); assert.ok(!/'recado'/.test(regras), "recado não pode estar na lista de campos graváveis pelo cliente");
});

// =================== 6. ONBOARDING / ADMIN: CPF duplicado, desbloqueio, edição, exclusão, rotas dos painéis ===================
t("desbloqueio: bloqueado SEM data de nascimento é liberado, mas continua sem aceitar aula; data < 16 conhecida não libera", async () => {
  await set("personais", "prom1", { uid: "prom1", nome: "A", status: "bloqueado" }); await set("personais_privado", "prom1", { uid: "prom1" });
  ok(await chamar("POST", "/admin/personais/prom1/status", { token: "adm", body: { status: "ativo" } }));
  assert.equal((await get("personais", "prom1")).status, "ativo");
  const h = await chamar("GET", "/habilitacao", { token: "prom1" }); ok(h); assert.equal(h.json.habilitado, false); assert.ok(h.json.pendencias.includes("nascimento"));
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: "qualquer" } }), 404);          // nem chega a aceitar: aula inexistente (a trava legal roda no aceite real, ver teste de idade)
  await set("personais", "prom1", { uid: "prom1", nome: "A", status: "bloqueado" });
  await set("personais_privado", "prom1", { uid: "prom1", nascimentoEnc: enc("prom1", "nascimento", nasc(15)) });
  falha(await chamar("POST", "/admin/personais/prom1/status", { token: "adm", body: { status: "ativo" } }), 409, "idade-minima");
  await set("personais", "prom2", { uid: "prom2", nome: "B", status: "pendente" }); await set("personais_privado", "prom2", { uid: "prom2" });
  falha(await chamar("POST", "/admin/personais/prom2/status", { token: "adm", body: { status: "ativo" } }), 409, "cadastro-incompleto");   // 1ª aprovação continua exigindo o cadastro completo
});
t("CPF duplicado: 409 com dica do e-mail (mascarado); registro órfão (sem perfil) não trava o cadastro", async () => {
  await semear({ status: "ativo" }); await set("usuarios", "prom1", { uid: "prom1", role: "personal", email: "joao.silva@gmail.com" });
  const r = await chamar("POST", "/cadastro/personal", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0), cref: "012345-G/SP" } });
  falha(r, 409, "cpf-duplicado"); assert.match(r.json.detalhe.emailMascarado, /^j\*+@gmail\.com$/); assert.ok(!JSON.stringify(r.json).includes("joao"));
  await ctx.db.collection("personais").doc("prom1").delete();                                                  // perfil removido, privado esquecido = órfão
  ok(await chamar("POST", "/cadastro/personal", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0), cref: "012345-G/SP" } }));
});
t("/sessao devolve o destino do painel certo (aluno → /painel-aluno, personal → /painel-personal, conta de personal abrindo o aluno → painel do personal)", async () => {
  let r = await chamar("POST", "/sessao", { token: "alunoA", body: { portal: "aluno" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["ok", "/painel-aluno"]);
  r = await chamar("POST", "/sessao", { token: "prom1", body: { portal: "personal" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["ok", "/painel-personal"]);
  r = await chamar("POST", "/sessao", { token: "prom1", body: { portal: "aluno" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["outro-perfil", "/painel-personal"]);
  r = await chamar("POST", "/sessao", { token: "alunoA", body: { portal: "personal" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["outro-perfil", "/painel-aluno"]);
  r = await chamar("POST", "/sessao", { token: "novo", body: { portal: "aluno" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["cadastro", null]);
});
t("rotas limpas: /painel-aluno e /painel-personal entregam a página certa; barra final redireciona preservando a query", async () => {
  let r = await chamar("GET", "/painel-aluno"); ok(r); assert.ok(r.texto.endsWith("index.html"));
  r = await chamar("GET", "/painel-personal"); ok(r); assert.ok(r.texto.endsWith("personal.html"));
  r = await chamar("GET", "/painel-aluno/?x=1"); assert.equal(r.status, 302); assert.equal(r.h.location, "/painel-aluno?x=1");
});
t("admin edita personal (dados cifrados, CPF único, ≥ 16 anos) e aluno (CNPJ válido); só admin; log sem dados pessoais", async () => {
  await semear({ status: "ativo" }); await semear({ uid: "prom2", cpfn: 1 }); await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "Aluno A" });
  falha(await chamar("PUT", "/admin/personais/prom1", { token: "alunoA", body: { nome: "X Y" } }), 403, "sem-permissao");
  ok(await chamar("PUT", "/admin/personais/prom1", { token: "adm", body: { nome: "Novo Nome", cidade: "Itapira", telefone: "(19) 99999-1234", nascimento: "1990-01-02", valorMin: 5000, disponibilidade: { inicio: "07:00", fim: "19:00" } } }));
  const pub = await get("personais", "prom1"); assert.deepEqual([pub.nome, pub.cidade, pub.valorMin, pub.editadoPor], ["Novo Nome", "Itapira", 5000, "adm1"]);
  const raw = JSON.stringify(await get("personais_privado", "prom1")); for (const seg of ["99999-1234", "19999991234", "1990-01-02"]) assert.ok(!raw.includes(seg), `dado em texto puro: ${seg}`);
  const f = await chamar("GET", "/admin/personais/prom1", { token: "adm" }); ok(f); assert.deepEqual([f.json.telefone, f.json.nascimento, f.json.nome], ["19999991234", "1990-01-02", "Novo Nome"]);
  falha(await chamar("PUT", "/admin/personais/prom1", { token: "adm", body: { cpf: cpf(1) } }), 409, "cpf-duplicado");
  ok(await chamar("PUT", "/admin/personais/prom1", { token: "adm", body: { cpf: cpf(2) } })); assert.equal((await get("personais_privado", "prom1")).cpfIdx, Cripto.indiceCego(cpf(2)));
  falha(await chamar("PUT", "/admin/personais/prom1", { token: "adm", body: { nascimento: nasc(15) } }), 403, "idade-minima");
  falha(await chamar("PUT", "/admin/personais/prom1", { token: "adm", body: { status: "ativo", treinamentoOk: true } }), 400, "dados-invalidos");   // mass assignment: campos fora da lista são ignorados
  falha(await chamar("PUT", "/admin/personais/fantasma", { token: "adm", body: { nome: "Zé Ninguém" } }), 404, "nao-encontrado");
  ok(await chamar("PUT", "/admin/alunos/alunoA", { token: "adm", body: { nomeCompleto: "Aluno X", documento: "11.222.333/0001-81", telefone: "(19) 3333-4444", email: "x@aluno.com" } }));
  const l = await get("alunos", "alunoA"); assert.deepEqual([l.nomeCompleto, l.documento, l.telefone], ["Aluno X", "11222333000181", "1933334444"]);
  falha(await chamar("PUT", "/admin/alunos/alunoA", { token: "adm", body: { documento: "11.222.333/0001-82" } }), 400, "documento-invalido");
  const logs = [...E.store.entries()].filter(([k]) => k.startsWith("auditoria/")).map(([, v]) => v), ed = logs.find((a) => a.acao === "admin.personal.editar");
  assert.ok(ed && ed.detalhes.campos.includes("telefone")); assert.ok(!JSON.stringify(logs).includes("99999-1234") && !JSON.stringify(logs).includes("19999991234"));
});
t("admin exclui personal: apaga dados e credenciais, mantém o ledger, libera o CPF; trava por saldo/aula/saque; protege admin e a si mesmo", async () => {
  await semear({ status: "ativo" }); await set("usuarios", "prom1", { uid: "prom1", role: "personal", email: "p@x.com" });
  await set("treinamento_progresso", "prom1_m1", { uid: "prom1", moduloId: "m1", concluido: true }); await set("lancamentos", "pg_s1_prof", { carteiraUid: "prom1", tipo: "credito_aula", dPendente: 7500, dDisponivel: 0 });
  const corpo = { motivo: "Aula do titular (LGPD)", confirmar: "EXCLUIR" };
  falha(await chamar("POST", "/admin/personais/prom1/excluir", { token: "prom1", body: corpo }), 403, "sem-permissao");
  falha(await chamar("POST", "/admin/personais/prom1/excluir", { token: "adm", body: { motivo: "Aula do titular" } }), 400, "confirmacao-obrigatoria");
  falha(await chamar("POST", "/admin/personais/prom1/excluir", { token: "adm", body: { confirmar: "EXCLUIR" } }), 400, "dados-invalidos");
  E.tokens.velho = { ...U.adm, auth_time: Math.floor(Date.now() / 1000) - 3600 }; falha(await chamar("POST", "/admin/personais/prom1/excluir", { token: "velho", body: corpo }), 401, "reautenticar");
  await set("carteiras", "prom1", { uid: "prom1", pendenteCentavos: 7500, disponivelCentavos: 0 });
  falha(await chamar("POST", "/admin/personais/prom1/excluir", { token: "adm", body: corpo }), 409, "exclusao-bloqueada");
  await set("carteiras", "prom1", { uid: "prom1", pendenteCentavos: 0, disponivelCentavos: 0 });
  await set("aulas", "s1", { uid: "alunoA", personalUid: "prom1", status: "aceita" });
  falha(await chamar("POST", "/admin/personais/prom1/excluir", { token: "adm", body: corpo }), 409, "exclusao-bloqueada");
  await set("aulas", "s1", { uid: "alunoA", personalUid: "prom1", status: "paga" });
  await set("saques", "q1", { uid: "prom1", status: "solicitado", valorCentavos: 2500 });
  falha(await chamar("POST", "/admin/personais/prom1/excluir", { token: "adm", body: corpo }), 409, "exclusao-bloqueada");
  await set("saques", "q1", { uid: "prom1", status: "pago", valorCentavos: 2500 });
  falha(await chamar("POST", "/admin/alunos/prom1/excluir", { token: "adm", body: corpo }), 404, "nao-encontrado");          // tipo errado
  const r = await chamar("POST", "/admin/personais/prom1/excluir", { token: "adm", body: corpo }); ok(r);
  for (const [c, id] of [["personais", "prom1"], ["personais_privado", "prom1"], ["usuarios", "prom1"], ["treinamento_progresso", "prom1_m1"]]) assert.equal(await get(c, id), undefined, `${c} deveria ter sido apagado`);
  assert.ok(E.excluidos.has("prom1") && E.revogados.has("prom1"));
  for (const [c, id] of [["aulas", "s1"], ["lancamentos", "pg_s1_prof"], ["carteiras", "prom1"], ["saques", "q1"]]) assert.ok(await get(c, id), `${c} (histórico financeiro) deve ser mantido`);
  assert.ok([...E.store.values()].some((v) => v?.acao === "admin.personal.excluir"));
  ok(await chamar("POST", "/cadastro/personal", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0), cref: "012345-G/SP" } }));    // o CPF ficou livre
  falha(await chamar("POST", "/admin/personais/adm1/excluir", { token: "adm", body: corpo }), 409, "exclusao-proibida");
  E.claimsStore.adm2 = { role: "admin" }; E.tokens.adm2 = undefined; await set("personais", "adm2", { uid: "adm2", nome: "Outro Admin", status: "ativo" });
  falha(await chamar("POST", "/admin/personais/adm2/excluir", { token: "adm", body: corpo }), 409, "exclusao-proibida");
});
t("admin exclui aluno: cancela aulas não pagos, remove cartão e credenciais, mantém notas e pagamentos", async () => {
  await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "Aluno A" }); await set("usuarios", "alunoA", { uid: "alunoA", role: "aluno" });
  await set("cartoes", "alunoA", { status: "ativo", ultimos4: "4242" }); await set("cartoes_privado", "alunoA", { uid: "alunoA", mpCardId: "1" });
  await set("aulas", "sA", { uid: "alunoA", status: "aberta" }); await set("aulas", "sB", { uid: "alunoA", status: "paga" }); await set("notas", "n1", { alunoUid: "alunoA" }); await set("pagamentos_internos", "sB", { uid: "alunoA", status: "aprovado" });
  const corpo = { motivo: "Aluno encerrou as atividades", confirmar: "EXCLUIR" };
  const r = await chamar("POST", "/admin/alunos/alunoA/excluir", { token: "adm", body: corpo }); ok(r); assert.equal(r.json.aulasCancelados, 1);
  assert.equal((await get("aulas", "sA")).status, "cancelada"); assert.equal((await get("aulas", "sB")).status, "paga");
  for (const [c, id] of [["alunos", "alunoA"], ["cartoes", "alunoA"], ["cartoes_privado", "alunoA"], ["usuarios", "alunoA"]]) assert.equal(await get(c, id), undefined, `${c} deveria ter sido apagado`);
  for (const [c, id] of [["notas", "n1"], ["pagamentos_internos", "sB"]]) assert.ok(await get(c, id), `${c} deve ser mantido`);
  assert.ok(E.excluidos.has("alunoA"));
});

// =================== TAXAS DINÂMICAS (configuracoes/taxas) ===================
const NOVAS = { precoCentavos: 25000, comissaoCentavos: 5000, repasseCentavos: 20000, taxaFixaCentavos: 500, horasMin: 1, horasMax: 8, maxSemana: 3 };
const salvarTaxas = (corpo = NOVAS, token = "adm") => chamar("PUT", "/admin/taxas", { token, body: corpo });

t("taxas: sem nada configurado o app recebe o padrão 100/25/75 sem precisar de login", async () => {
  const r = await chamar("GET", "/config/taxas"); ok(r);
  assert.deepEqual(r.json, { precoCentavos: 10000, comissaoCentavos: 2500, repasseCentavos: 7500, taxaFixaCentavos: 0, horasMin: 0.5, horasMax: 3, maxSemana: 5, versao: 0 });
});
t("taxas: só o admin lê os metadados e só o admin altera (sem login 401, aluno/personal 403)", async () => {
  falha(await chamar("GET", "/admin/taxas"), 401, "nao-autenticado");
  for (const token of ["alunoA", "prom1"]) { falha(await salvarTaxas(NOVAS, token), 403, "sem-permissao"); falha(await chamar("GET", "/admin/taxas", { token }), 403, "sem-permissao"); }
  falha(await salvarTaxas(NOVAS, null), 401, "nao-autenticado");
  assert.equal((await get("configuracoes", "taxas")), undefined, "nada foi gravado");
  const r = await chamar("GET", "/admin/taxas", { token: "adm" }); ok(r); assert.equal(r.json.origem, "padrao"); assert.ok(r.json.limites && r.json.padrao);
});
t("taxas: admin salva → grava no banco, versão sobe, rota pública reflete na hora e a auditoria guarda antes/depois", async () => {
  const r = await salvarTaxas(); ok(r, "salvar"); assert.equal(r.json.versao, 1); assert.equal(r.json.origem, "banco"); assert.equal(r.json.atualizadoPor, "adm1");
  const doc = await get("configuracoes", "taxas"); assert.equal(doc.precoCentavos, 25000); assert.equal(doc.versao, 1); assert.equal(doc.atualizadoPor, "adm1");
  const pub = await chamar("GET", "/config/taxas"); ok(pub); assert.deepEqual(pub.json, { ...NOVAS, versao: 1 });
  assert.ok(!("atualizadoPor" in pub.json), "a rota pública não expõe quem alterou");
  const aud = (await ctx.db.collection("auditoria").get()).docs.map((d) => d.data()).find((a) => a.acao === "admin.taxas.salvar");
  assert.ok(aud); assert.equal(aud.detalhes.antes.precoCentavos, 10000); assert.equal(aud.detalhes.depois.precoCentavos, 25000);
  assert.equal((await salvarTaxas({ ...NOVAS, maxSemana: 2 })).json.versao, 2);
});
t("taxas: validação rígida (soma, tipos, limites, horas, semana) e campos extras nunca chegam ao banco", async () => {
  const ruins = [
    { ...NOVAS, repasseCentavos: 19000 },                       // comissão + repasse ≠ aula
    { ...NOVAS, precoCentavos: "25000" },                      // string
    { ...NOVAS, precoCentavos: 25000.5 }, { ...NOVAS, taxaFixaCentavos: -1 }, { ...NOVAS, comissaoCentavos: -5000, repasseCentavos: 30000 },
    { ...NOVAS, precoCentavos: 500, comissaoCentavos: 100, repasseCentavos: 400 },                 // aula abaixo do piso
    { ...NOVAS, precoCentavos: 600000, comissaoCentavos: 100000, repasseCentavos: 500000 },       // acima do teto
    { ...NOVAS, comissaoCentavos: 25000, repasseCentavos: 0 },                                      // repasse zero
    { ...NOVAS, taxaFixaCentavos: 60000 },
    { ...NOVAS, horasMin: 7, horasMax: 6 }, { ...NOVAS, horasMin: 4.3 }, { ...NOVAS, horasMax: 13 }, { ...NOVAS, horasMin: 0 },
    { ...NOVAS, maxSemana: 0 }, { ...NOVAS, maxSemana: 8 }, { ...NOVAS, maxSemana: 2.5 }, { ...NOVAS, maxSemana: undefined },
    { ...NOVAS, horasMax: null }, [], null
  ];
  for (const corpo of ruins) { const r = await salvarTaxas(corpo); assert.equal(r.status, 400, JSON.stringify(corpo)); }
  assert.equal(await get("configuracoes", "taxas"), undefined, "nenhuma proposta inválida foi gravada");
  ok(await salvarTaxas({ ...NOVAS, horasMin: 4.5, horasMax: 5.5, evil: "<script>", atualizadoPor: "hacker" }), "meia hora é aceita");
  const doc = await get("configuracoes", "taxas"); assert.ok(!("evil" in doc)); assert.equal(doc.versao, 1); assert.equal(doc.atualizadoPor, "adm1", "autoria vem do token, não do corpo");
});
t("taxas: mexe em dinheiro, então exige login recente (como estorno e saque)", async () => {
  E.tokens.adm.auth_time = Math.floor(E.clock.now / 1000) - 3600;
  falha(await salvarTaxas(), 401, "reautenticar"); E.tokens.adm.auth_time = undefined;
  assert.equal(await get("configuracoes", "taxas"), undefined);
});
t("taxas: dois admins editando — quem salva com versão velha leva 409 e nada é sobrescrito", async () => {
  ok(await salvarTaxas({ ...NOVAS, versao: 0 }));                                   // admin A salva sobre a v0 → v1
  const r = await salvarTaxas({ ...NOVAS, maxSemana: 5, versao: 0 });               // admin B ainda via a v0
  falha(r, 409, "taxas-desatualizadas"); assert.equal(r.json.detalhe.versaoAtual, 1);
  assert.equal((await get("configuracoes", "taxas")).maxSemana, 3);
  ok(await salvarTaxas({ ...NOVAS, maxSemana: 5, versao: 1 }));
});
t("taxas: criarAula usa a aula, a taxa fixa e a duração NOVAS (a aula não depende de nenhuma constante)", async () => {
  await alunoComCartao();
  const body = { aluno: "Aluno A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Musculação" };
  falha(await chamar("POST", "/criarAula", { token: "alunoA", body }), 400, "aula-invalido");     // padrão: máximo 3 h
  ok(await salvarTaxas());
  const r = await chamar("POST", "/criarAula", { token: "alunoA", body }); ok(r, "4 h agora é válido");
  assert.deepEqual(r.json, { id: r.json.id, valor: 25000, taxaFixa: 500, total: 25500 });
  const sp = (await get("pagamentos_internos", r.json.id)).split;
  assert.deepEqual([sp.total, sp.personal, sp.app, sp.versaoTaxas], [25500, 20000, 5500, 1]); assert.equal(sp.personal + sp.app, sp.total);
  assert.equal((await get("aulas", r.json.id)).valorPersonalCentavos, 20000, "o personal vê o repasse novo");
  const longo = await chamar("POST", "/criarAula", { token: "alunoA", body: { ...body, saida: "17:00" } }); falha(longo, 400, "aula-invalido"); assert.match(longo.json.erro, /máximo 8 horas/);
});
t("taxas: preço congelado na aula — o que já foi criado paga/repassa o valor antigo; o novo, o novo", async () => {
  await semear({ treinado: true });
  const antigo = await aula(); ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: antigo } }));
  ok(await salvarTaxas({ ...NOVAS, taxaFixaCentavos: 0, horasMin: 0.5, horasMax: 3 }));                     // 250/50/200 depois do aceite
  ok(await pagar(antigo)); const a = (await get("pagamentos_internos", antigo)).split;                    // MP cobra R$ 100 (valor visto pelo aluno)
  assert.deepEqual([a.total, a.personal, a.app], [10000, 7500, 2500]);
  const novo = await aula({ data: dia(3) }); ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: novo } }));
  falha(await pagar(novo), 400, "valor-divergente");                                                      // R$ 100 não paga uma aula de R$ 250
  ok(await pagar(novo, { transaction_amount: 250, id: 777 })); const n = (await get("pagamentos_internos", novo)).split;
  assert.deepEqual([n.total, n.personal, n.app], [25000, 20000, 5000]);
  assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 7500 + 20000, "cada crédito segue o split congelado do sua aula");
});
t("taxas: o limite semanal por aluno vem do banco (5 → 1 muda o aceite na hora)", async () => {
  await semear({ treinado: true });
  const p1 = await aula({ entrada: "08:00", saida: "09:00", data: dia(2) }), p2 = await aula({ entrada: "13:00", saida: "14:00", data: dia(2) });
  ok(await salvarTaxas({ ...NOVAS, maxSemana: 1 }));
  ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: p1 } }));
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: p2 } }), 409, "limite-semanal");
  ok(await salvarTaxas({ ...NOVAS, maxSemana: 2 }));
  ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: p2 } }));
});
t("taxas: se o banco cair, usa a última versão boa; sem cache ou com documento corrompido, 503 (nunca chuta valores)", async () => {
  ok(await salvarTaxas()); await alunoComCartao();
  const orig = ctx.db.collection;
  const quebrar = () => { ctx.db.collection = (c) => (c === "configuracoes" ? { doc: () => ({ get: async () => { throw new Error("firestore fora"); } }) } : orig(c)); };
  try {
    E.avancar(31_000); quebrar();
    const r = await chamar("GET", "/config/taxas"); ok(r); assert.equal(r.json.precoCentavos, 25000, "serviu a última versão boa");
    ctx.db.collection = orig; ctx.taxas.invalidar(); quebrar();
    falha(await chamar("GET", "/config/taxas"), 503, "taxas-indisponiveis");
    falha(await chamar("POST", "/criarAula", { token: "alunoA", body: { aluno: "Aluno A — Rua 1", data: dia(2), entrada: "08:00", saida: "09:00", foco: "Musculação" } }), 503, "taxas-indisponiveis");   // sem preço confiável, não nasce aula
  } finally { ctx.db.collection = orig; }
  await set("configuracoes", "taxas", { precoCentavos: 1, comissaoCentavos: 1, repasseCentavos: 1, versao: 7 }); ctx.taxas.invalidar();
  falha(await chamar("GET", "/config/taxas"), 503, "taxas-indisponiveis");
});
t("taxas: o cliente não lê nem escreve configuracoes direto (regras negam por padrão); só a API expõe", async () => {
  const rules = require("node:fs").readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  assert.ok(!/match \/configuracoes/.test(rules), "nenhuma regra libera configuracoes: cai no deny-by-default");
});
// =================== 7. CHAT DE SUPORTE + PUSH ===================
const TK = (n) => `token-${n}-`.padEnd(40, "x");
const msgsDe = async (uid) => [...E.store.entries()].filter(([k, v]) => k.startsWith("suporte_mensagens/") && v.uid === uid).sort(([a], [b]) => (a > b ? 1 : -1)).map(([, v]) => v);
t("suporte: conversa completa usuário ↔ equipe, não lidas dos dois lados e histórico em ordem", async () => {
  await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "Aluno A" });
  ok(await chamar("POST", "/suporte/mensagem", { token: "alunoA", body: { texto: "Oi, preciso de ajuda com o cadastro." } }));
  let c = await get("suporte_conversas", "alunoA"); assert.deepEqual([c.tipo, c.nome, c.naoLidasSuporte, c.naoLidasUsuario, c.ultimaDe], ["aluno", "Aluno A", 1, 0, "usuario"]);
  ok(await chamar("POST", "/admin/suporte/alunoA/mensagem", { token: "adm", body: { texto: "Bom dia! Já vamos ver." } }));
  ok(await chamar("POST", "/admin/suporte/alunoA/mensagem", { token: "adm", body: { texto: "Pode enviar o CNPJ?" } }));
  c = await get("suporte_conversas", "alunoA"); assert.deepEqual([c.naoLidasUsuario, c.naoLidasSuporte, c.ultimaDe, c.ultimaMsg], [2, 1, "suporte", "Pode enviar o CNPJ?"]);
  assert.deepEqual((await msgsDe("alunoA")).map((m) => [m.de, m.texto]), [["usuario", "Oi, preciso de ajuda com o cadastro."], ["suporte", "Bom dia! Já vamos ver."], ["suporte", "Pode enviar o CNPJ?"]]);
  ok(await chamar("POST", "/suporte/lido", { token: "alunoA" })); assert.equal((await get("suporte_conversas", "alunoA")).naoLidasUsuario, 0);
  ok(await chamar("POST", "/admin/suporte/alunoA/lido", { token: "adm" })); assert.equal((await get("suporte_conversas", "alunoA")).naoLidasSuporte, 0);
});
t("suporte: permissões, validação e limites (sem IDOR: o usuário só fala na própria conversa)", async () => {
  await semear({ status: "ativo" }); await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "A" });
  falha(await chamar("POST", "/suporte/mensagem", { body: { texto: "oi" } }), 401, "nao-autenticado");
  falha(await chamar("POST", "/suporte/mensagem", { token: "adm", body: { texto: "oi" } }), 403, "sem-permissao");                      // admin responde por /admin/suporte
  for (const tk of ["alunoA", "prom1"]) { falha(await chamar("POST", "/admin/suporte/prom1/mensagem", { token: tk, body: { texto: "oi" } }), 403, "sem-permissao"); falha(await chamar("POST", "/admin/suporte/prom1/lido", { token: tk }), 403, "sem-permissao"); }
  for (const texto of ["", "   ", "a".repeat(1001), { $gt: "" }, 5]) falha(await chamar("POST", "/suporte/mensagem", { token: "alunoA", body: { texto } }), 400);
  falha(await chamar("POST", "/admin/suporte/fantasma/mensagem", { token: "adm", body: { texto: "oi" } }), 404, "nao-encontrado");
  falha(await chamar("POST", "/admin/suporte/a.b/mensagem", { token: "adm", body: { texto: "oi" } }), 400, "dados-invalidos");          // id inválido
  ok(await chamar("POST", "/suporte/mensagem", { token: "alunoA", body: { texto: "<img src=x onerror=alert(1)>" } }));                   // guardado como texto (o front escapa)
  assert.equal((await msgsDe("alunoA")).length, 1); assert.equal((await msgsDe("prom1")).length, 0);
  let ultimo; for (let i = 0; i < 22; i++) ultimo = await chamar("POST", "/suporte/mensagem", { token: "alunoA", body: { texto: "spam " + i } }); falha(ultimo, 429, "limite-requisicoes");
});
t("push: aparelho do usuário recebe resposta da equipe; admins recebem mensagem do usuário; tokens mortos são limpos; sem vazamento entre contas", async () => {
  await semear({ status: "ativo" }); await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "A" });
  ok(await chamar("POST", "/push/registrar", { token: "alunoA", body: { token: TK("aluno") } })); ok(await chamar("POST", "/push/registrar", { token: "prom1", body: { token: TK("prom") } })); ok(await chamar("POST", "/push/registrar", { token: "adm", body: { token: TK("adm") } }));
  falha(await chamar("POST", "/push/registrar", { token: "alunoA", body: { token: "curto" } }), 400, "dados-invalidos"); falha(await chamar("POST", "/push/registrar", { body: { token: TK("x") } }), 401, "nao-autenticado");
  ok(await chamar("POST", "/admin/suporte/alunoA/mensagem", { token: "adm", body: { texto: "Olá, tudo bem?" } }));
  assert.equal(E.pushes.length, 1); assert.deepEqual(E.pushes[0].tokens, [TK("aluno")]); assert.deepEqual([E.pushes[0].data.titulo, E.pushes[0].data.corpo, E.pushes[0].data.url], ["Suporte Personow", "Olá, tudo bem?", "index.html?suporte=1"]);
  ok(await chamar("POST", "/suporte/mensagem", { token: "prom1", body: { texto: "Meu CPF está errado" } }));
  assert.deepEqual(E.pushes[1].tokens, [TK("adm")]); assert.equal(E.pushes[1].data.url, "admin.html#suporte");
  E.mortos.add(TK("aluno")); ok(await chamar("POST", "/admin/suporte/alunoA/mensagem", { token: "adm", body: { texto: "de novo" } }));
  assert.equal([...E.store.keys()].filter((k) => k.startsWith("push_tokens/")).length, 2);                                               // o token morto foi apagado
  ok(await chamar("POST", "/push/registrar", { token: "alunoA", body: { token: TK("troca") } })); ok(await chamar("POST", "/push/registrar", { token: "prom1", body: { token: TK("troca") } }));   // mesmo aparelho, outra conta
  E.pushes.length = 0; ok(await chamar("POST", "/admin/suporte/alunoA/mensagem", { token: "adm", body: { texto: "só para o aluno" } })); assert.ok(!E.pushes.some((p) => p.tokens.includes(TK("troca"))), "token migrou para a outra conta");
  ok(await chamar("POST", "/push/remover", { token: "alunoA", body: { token: TK("troca") } }));                                          // não é dela mais: não remove
  assert.equal([...E.store.values()].filter((v) => v.token === TK("troca")).length, 1);
  ok(await chamar("POST", "/push/remover", { token: "prom1", body: { token: TK("troca") } })); assert.equal([...E.store.values()].filter((v) => v.token === TK("troca")).length, 0);
});
t("suporte: recado e motivo de status do admin entram no histórico do chat e disparam push", async () => {
  await semear({ status: "ativo" }); ok(await chamar("POST", "/push/registrar", { token: "prom1", body: { token: TK("prom") } }));
  ok(await chamar("POST", "/admin/recado/personal/prom1", { token: "adm", body: { texto: "Confira seu CPF, por favor." } }));
  ok(await chamar("POST", "/admin/personais/prom1/status", { token: "adm", body: { status: "pendente", motivo: "CPF não confere" } }));
  assert.deepEqual((await msgsDe("prom1")).map((m) => [m.de, m.texto]), [["suporte", "Confira seu CPF, por favor."], ["suporte", "CPF não confere"]]);
  assert.equal((await get("suporte_conversas", "prom1")).naoLidasUsuario, 2); assert.equal(E.pushes.length, 2); assert.equal(E.pushes[0].data.url, "personal.html?suporte=1");
});
t("suporte: regras do Firestore — leitura só do dono/admin, nenhuma escrita pelo cliente", async () => {
  const r = require("node:fs").readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  assert.match(r, /match \/suporte_conversas\/\{uid\} \{ allow read: if dono\(uid\) \|\| ehAdmin\(\); allow write: if false; \}/);
  assert.match(r, /match \/suporte_mensagens\/\{id\}\s+\{ allow read: if logado\(\) && \(resource\.data\.uid == request\.auth\.uid \|\| ehAdmin\(\)\); allow write: if false; \}/);
  assert.ok(!/push_tokens/.test(r.replace(/\/\/.*$/gm, "")), "push_tokens fica negado por padrão");
});

// ============================================================
// HABILITAÇÃO POR CATEGORIA (vídeo + timer + questionário 100%)
// ============================================================
const PERGUNTAS = [
  { texto: "Qual é o cuidado antes de iniciar um treino com aluno novo?", opcoes: ["Começar com carga máxima", "Fazer anamnese e avaliar limitações", "Tanto faz"], correta: 1 },
  { texto: "Produto com embalagem violada: o que fazer?", opcoes: ["Vender", "Retirar e avisar o responsável", "Esconder", "Devolver à prateleira"], correta: 1 },
  { texto: "Antes de repor, o que conferir?", opcoes: ["Etiqueta de preço correta", "A cor da caixa"], correta: 0 },
  { texto: "Como empilhar delicados?", opcoes: ["Em camadas baixas", "O mais alto possível", "Sob caixas pesadas"], correta: 0 }
];
const conteudo = (over = {}) => ({ descricao: "Treinamento de Funcional", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 60, ativo: true, perguntas: PERGUNTAS.slice(0, 3), ...over });
const publicar = async (cat = "funcional", over = {}) => ok(await chamar("PUT", `/admin/habilitacoes/categorias/${cat}`, { token: "adm", body: conteudo(over) }), "admin salva categoria");
const HAB = (caminho, body, token = "prom1") => chamar("POST", `/habilitacoes/${caminho}`, { token, body });
/** assiste ao vídeo de verdade: pings de 10 em 10 s com posição contígua, tocando */
async function assistir(cat = "funcional", dur = 60) {
  let r; for (let pos = 0; pos <= dur; pos += 10) { r = await HAB("ping", { categoria: cat, posicaoSeg: pos, tocando: true }); ok(r, "ping"); E.avancar(10_000); }
  r = await HAB("ping", { categoria: cat, posicaoSeg: dur, tocando: true }); ok(r); return r.json;
}
/** descobre as respostas certas lendo o gabarito DIRETO do banco (o personal nunca o vê) e mapeando para a ordem embaralhada */
async function respostasCertas(perguntas, cat = "funcional") {
  const c = await get("habilitacao_categorias", cat);
  return perguntas.map((q) => { const orig = c.perguntas.find((p) => p.id === q.id); return q.opcoes.indexOf(orig.opcoes[orig.correta]); });
}
const iniciarEAssistir = async (cat = "funcional", dur = 60) => { ok(await HAB("iniciar", { categoria: cat })); return assistir(cat, dur); };

t("admin cadastra conteúdo da categoria com validação; personal não", async () => {
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/funcional", { token: "prom1", body: conteudo() }), 403, "sem-permissao");
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/inexistente", { token: "adm", body: conteudo() }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/funcional", { token: "adm", body: conteudo({ perguntas: PERGUNTAS.slice(0, 2) }) }), 400, "dados-invalidos");          // mínimo 3
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/funcional", { token: "adm", body: conteudo({ perguntas: [...PERGUNTAS, PERGUNTAS[0]] }) }), 400, "dados-invalidos");   // máximo 4
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/funcional", { token: "adm", body: conteudo({ perguntas: [{ ...PERGUNTAS[0], correta: 9 }, PERGUNTAS[1], PERGUNTAS[2]] }) }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/funcional", { token: "adm", body: conteudo({ videoRef: "http://inseguro/v.mp4", provedor: "mp4" }) }), 400, "dados-invalidos");
  await publicar("funcional"); const c = await get("habilitacao_categorias", "funcional"); assert.equal(c.perguntas.length, 3); assert.equal(c.perguntas[0].id, "q1");
  const lista = await chamar("GET", "/admin/habilitacoes/categorias", { token: "adm" }); ok(lista); assert.equal(lista.json.length, 6); assert.equal(lista.json.find((x) => x.id === "funcional").pronta, true);
});

t("categoria sem vídeo/perguntas publicados: ninguém inicia (falha fechada) e o gabarito nunca aparece para o personal", async () => {
  await semear();
  falha(await HAB("iniciar", { categoria: "endurance" }), 409, "categoria-indisponivel");
  await publicar("funcional"); await publicar("endurance", { ativo: false }); falha(await HAB("iniciar", { categoria: "endurance" }), 409, "categoria-indisponivel");
  const l = await chamar("GET", "/habilitacoes", { token: "prom1" }); ok(l); assert.equal(l.json.categorias.length, 6);
  assert.equal(l.json.categorias.find((c) => c.id === "funcional").disponivel, true); assert.equal(l.json.categorias.find((c) => c.id === "endurance").disponivel, false);
  assert.ok(!JSON.stringify(l.json).includes("\"correta\"") && !JSON.stringify(l.json).includes("videoRef") && !JSON.stringify(l.json).includes("perguntas"), "lista não pode vazar gabarito, perguntas nem vídeo");
  falha(await HAB("iniciar", { categoria: "padaria; drop" }), 400, "dados-invalidos");
});

t("fluxo completo: timer = duração + 3 s, vídeo até o fim, questionário sem gabarito, 100% habilita e libera o aceite da modalidade", async () => {
  await semear({ treinado: true }); await publicar("funcional");
  const sid = await aula({ foco: "Treino funcional" });
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }), 403, "categoria-pendente");
  const ini = await HAB("iniciar", { categoria: "funcional" }); ok(ini);
  assert.equal(ini.json.restanteMs, 63_000, "timer = 60 s de vídeo + 3 s de margem"); assert.equal(ini.json.margemSeg, 3);
  falha(await HAB("questionario", { categoria: "funcional" }), 409, "timer-pendente");               // portão fechado: nada de questionário no começo
  let r = await assistir("funcional", 60);                                                           // ~70 s de relógio correm durante a reprodução real
  assert.equal(r.videoOk, true); assert.equal(r.restanteMs, 0); assert.equal(r.liberado, true);
  const q = await HAB("questionario", { categoria: "funcional" }); ok(q); assert.equal(q.json.perguntas.length, 3);
  assert.ok(q.json.perguntas.every((p) => Object.keys(p).sort().join() === "id,opcoes,texto"), "gabarito não sai do servidor (só id, texto e alternativas)");
  const resp = await HAB("responder", { categoria: "funcional", respostas: await respostasCertas(q.json.perguntas) }); ok(resp);
  assert.equal(resp.json.aprovado, true); assert.equal(resp.json.acertos, 3); assert.equal(resp.json.selo.elite, true); assert.equal(resp.json.selo.titulo, "Funcional");
  const p = await get("personais", "prom1"); assert.ok(p.habilitacoes.funcional, "habilitação gravada no perfil"); assert.equal(p.habilitacoes.funcional.elite, true); assert.equal(p.habilitacoes.funcional.tentativas, 1);
  ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }));  // agora aceita a aula de Funcional
  const lista = await chamar("GET", "/habilitacoes", { token: "prom1" }); assert.equal(lista.json.selos.some((s) => s.categoria === "funcional" && s.elite), true);
  falha(await HAB("responder", { categoria: "funcional", respostas: [0, 0, 0] }), 409, "sem-avaliacao");   // tentativa única: não reenvia depois de aprovado
  falha(await HAB("iniciar", { categoria: "funcional" }), 409, "ja-habilitado");
});

t("anti-bypass: pular, pausar, adiantar relógio e declarar 'fim' não liberam o questionário", async () => {
  await semear(); await publicar("funcional"); ok(await HAB("iniciar", { categoria: "funcional" }));
  let r = await HAB("ping", { categoria: "funcional", posicaoSeg: 0, tocando: true }); ok(r);
  E.avancar(10_000); r = await HAB("ping", { categoria: "funcional", posicaoSeg: 58, tocando: true }); assert.equal(r.json.validoSeg, 0, "pular para o fim não credita");
  E.avancar(10_000); r = await HAB("ping", { categoria: "funcional", posicaoSeg: 10, tocando: false }); assert.equal(r.json.validoSeg, 0, "pausado não credita");
  E.avancar(10_000); r = await HAB("ping", { categoria: "funcional", posicaoSeg: 20, tocando: false }); assert.equal(r.json.validoSeg, 0, "pausado → pausado não credita");
  E.avancar(120_000);                                                                           // o timer do SERVIDOR já venceu (relógio, não o do navegador)...
  falha(await HAB("questionario", { categoria: "funcional" }), 409, "video-incompleto");              // ...mas o vídeo não foi assistido
  r = await HAB("ping", { categoria: "funcional", posicaoSeg: 60, tocando: true }); assert.ok(r.json.validoSeg < 5, "ping tardio só credita o tempo real decorrido (máx. 30 s por ping), nunca o vídeo todo");
  falha(await HAB("questionario", { categoria: "funcional" }), 409, "video-incompleto");
  falha(await HAB("responder", { categoria: "funcional", respostas: [0, 0, 0] }), 409, "sem-avaliacao");   // não dá para responder sem o questionário liberado
  E.avancar(5000); falha(await HAB("ping", { categoria: "endurance", posicaoSeg: 0, tocando: true }), 409, "sessao-inexistente");
});

t("pausa e retomada: ping de play ancora a posição e o crédito segue o tempo real (sem perder nem ganhar)", async () => {
  await semear(); await publicar("funcional"); ok(await HAB("iniciar", { categoria: "funcional" }));
  const ping = (pos, tocando, evento = false) => HAB("ping", { categoria: "funcional", posicaoSeg: pos, tocando, evento });
  E.avancar(7000); ok(await ping(0, true, true));                                                       // apertou play (âncora em 0)
  E.avancar(5000); let r = await ping(5, true); assert.equal(r.json.validoSeg, 5);
  E.avancar(2000); r = await ping(7, false, true); assert.equal(r.json.validoSeg, 7, "pausa credita o trecho já tocado");
  E.avancar(30_000); r = await ping(7, true, true); assert.equal(r.json.validoSeg, 7, "retomar só ancora; os 30 s de pausa não contam");
  E.avancar(5000); r = await ping(12, true); assert.equal(r.json.validoSeg, 12);
  E.avancar(5000); r = await ping(30, true); assert.equal(r.json.validoSeg, 12, "salto de 18 s em 5 s: sem crédito");
  E.avancar(500); r = await ping(30, true, true); assert.equal(r.json.validoSeg, 12, "ping de evento colado (<1 s) é ignorado");
});

t("reprovou (<100%): feedback, sessão encerrada, e é obrigatório assistir de novo com o timer do zero; depois de refazer, não é 'elite'", async () => {
  await semear(); await publicar("funcional"); await iniciarEAssistir("funcional");
  let q = await HAB("questionario", { categoria: "funcional" }); ok(q);
  const certas = await respostasCertas(q.json.perguntas), erradas = certas.map((c, i) => (i === 0 ? (c + 1) % q.json.perguntas[0].opcoes.length : c));   // erra só UMA
  const r1 = await HAB("responder", { categoria: "funcional", respostas: erradas }); ok(r1);
  assert.equal(r1.json.aprovado, false); assert.equal(r1.json.acertos, 2); assert.equal(r1.json.total, 3); assert.equal(r1.json.refazer, true);
  assert.equal((await get("personais", "prom1")).habilitacoes?.funcional, undefined, "98% não habilita");
  falha(await HAB("responder", { categoria: "funcional", respostas: certas }), 409, "sem-avaliacao");   // não reaproveita a mesma tentativa
  falha(await HAB("questionario", { categoria: "funcional" }), 409, "sessao-encerrada");                // não revê o teste sem rever o vídeo
  const nova = await HAB("iniciar", { categoria: "funcional" }); ok(nova);
  assert.equal(nova.json.validoSeg, 0, "vídeo do zero"); assert.equal(nova.json.restanteMs, 63_000, "timer inteiro do zero"); assert.equal(nova.json.reprovacoes, 1);
  falha(await HAB("questionario", { categoria: "funcional" }), 409, "timer-pendente");
  await assistir("funcional"); q = await HAB("questionario", { categoria: "funcional" }); ok(q);
  const r2 = await HAB("responder", { categoria: "funcional", respostas: await respostasCertas(q.json.perguntas) }); ok(r2);
  assert.equal(r2.json.aprovado, true); assert.equal(r2.json.selo.elite, false, "aprovado só na 2ª tentativa: habilitado, sem selo de elite");
  assert.equal((await get("personais", "prom1")).habilitacoes.funcional.tentativas, 2);
});

t("respostas inválidas não gastam a tentativa nem aprovam; questionário vence em 20 min", async () => {
  await semear(); await publicar("funcional"); await iniciarEAssistir("funcional");
  const q = await HAB("questionario", { categoria: "funcional" }); ok(q);
  falha(await HAB("responder", { categoria: "funcional", respostas: [0, 0] }), 400, "dados-invalidos");          // faltou responder
  falha(await HAB("responder", { categoria: "funcional", respostas: [0, 0, 99] }), 400, "dados-invalidos");
  falha(await HAB("responder", { categoria: "funcional", respostas: "tudo certo" }), 400, "dados-invalidos");
  falha(await HAB("responder", { categoria: "funcional", respostas: [0, 0, { $ne: 1 }] }), 400, "dados-invalidos");
  const q2 = await HAB("questionario", { categoria: "funcional" }); ok(q2); assert.deepEqual(q2.json.perguntas, q.json.perguntas, "reabrir o app devolve o MESMO questionário");
  E.avancar(21 * 60_000); falha(await HAB("responder", { categoria: "funcional", respostas: await respostasCertas(q.json.perguntas) }), 409, "quiz-expirado");
  const nova = await HAB("iniciar", { categoria: "funcional" }); ok(nova); assert.equal(nova.json.validoSeg, 0);
});

t("conteúdo editado pelo admin invalida sessões em andamento; personal não forja habilitação pelo perfil", async () => {
  await semear(); await publicar("funcional"); await iniciarEAssistir("funcional");
  const q = await HAB("questionario", { categoria: "funcional" }); ok(q);
  await publicar("funcional", { perguntas: PERGUNTAS.slice(1, 4) });                                         // admin troca as perguntas
  falha(await HAB("responder", { categoria: "funcional", respostas: [0, 0, 0] }), 409, "conteudo-alterado");
  ok(await chamar("PUT", "/perfil/personal/privado", { token: "prom1", body: { telefone: "(19) 91234-5678", habilitacoes: { funcional: { elite: true } } } }));
  assert.equal((await get("personais", "prom1")).habilitacoes?.funcional, undefined, "mass assignment: habilitacoes só o servidor escreve");
  falha(await chamar("POST", "/habilitacoes/iniciar", { token: "alunoA", body: { categoria: "funcional" } }), 403, "sem-permissao");
  falha(await chamar("GET", "/habilitacoes", {}), 401);
});

t("aceite filtrado por categoria: só as modalidades em que está habilitado; Dança e Emagrecimento seguem Funcional", async () => {
  await semear({ treinado: true });                                                                       // habilitado só em Musculação
  const musc = await aula(), lutas = await aula({ foco: "Lutas e artes marciais", data: dia(3) }), pilates = await aula({ foco: "Pilates", data: dia(4) }), emag = await aula({ foco: "Emagrecimento", data: dia(5) });
  for (const [sid, cat] of [[lutas, "lutas"], [pilates, "mentecorpo"]]) { const r = await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: sid } }); falha(r, 403, "categoria-pendente"); assert.equal(r.json.detalhe.categoria, cat); assert.equal((await get("aulas", sid)).status, "aberta"); }
  ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: musc } }));
  falha(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: emag } }), 403, "categoria-pendente");   // "Emagrecimento" exige a categoria Funcional
  await ctx.db.collection("personais").doc("prom1").set({ habilitacoes: { funcional: { em: new E.Timestamp(Date.now()), tentativas: 1, elite: true } } }, { merge: true });
  ok(await chamar("POST", "/aceitarAula", { token: "prom1", body: { aulaId: emag } }));
  const sit = await chamar("GET", "/habilitacao", { token: "prom1" }); assert.deepEqual(sit.json.categorias.sort(), ["funcional", "musculacao"]);
});

// ---------- Prova por módulo (perguntas/alternativas; correção só no servidor) ----------
const PERGS = [{ enunciado: "Qual o primeiro passo com um aluno novo?", alternativas: ["Avaliar histórico e limitações", "Começar com carga máxima", "Tanto faz"], correta: 0 }, { enunciado: "Ao notar equipamento danificado você deve?", alternativas: ["Ignorar", "Avisar o responsável do local", "Usar mesmo assim"], correta: 1 }];
async function moduloComProva(extra = {}) { await modulo(); await ctx.db.collection("treinamento_modulos").doc("m1").set({ perguntas: PERGS, notaMinima: 100, ...extra }, { merge: true }); }
t("prova: só depois de assistir; gabarito nunca vai ao personal; reprova sem revelar; aprova e habilita", async () => {
  await semear({ uid: "prom1" }); await moduloComProva();
  falha(await chamar("GET", "/treinamento/modulos/m1/prova", { token: "prom1" }), 403, "assista-primeiro");
  await set("treinamento_progresso", "prom1_m1", { uid: "prom1", moduloId: "m1", validoSeg: 95, videoOk: true });
  const q = await chamar("GET", "/treinamento/modulos/m1/prova", { token: "prom1" }); ok(q);
  assert.equal(q.json.perguntas.length, 2); assert.ok(!JSON.stringify(q.json).includes("correta"), "o gabarito não pode vazar");
  const tr = await chamar("GET", "/treinamento", { token: "prom1" }); ok(tr); assert.ok(!JSON.stringify(tr.json).includes("correta"));
  assert.equal(tr.json.completo, false, "vídeo visto mas prova pendente: ainda não habilita");
  const ruim = await chamar("POST", "/treinamento/modulos/m1/prova", { token: "prom1", body: { respostas: [1, 1] } }); ok(ruim);
  assert.equal(ruim.json.aprovado, false); assert.equal(ruim.json.erradas, undefined, "não revela quais erraram");
  assert.notEqual(E.claimsStore.prom1.treinado, true);
  falha(await chamar("POST", "/treinamento/modulos/m1/prova", { token: "prom1", body: { respostas: [0] } }), 400, "dados-invalidos");
  const bom = await chamar("POST", "/treinamento/modulos/m1/prova", { token: "prom1", body: { respostas: [0, 1] } }); ok(bom);
  assert.equal(bom.json.aprovado, true); assert.equal(bom.json.treinamentoCompleto, true); assert.equal(E.claimsStore.prom1.treinado, true);
  assert.equal((await chamar("POST", "/treinamento/modulos/m1/prova", { token: "prom1", body: { respostas: [0, 1] } })).json.jaAprovado, true);
});
t("prova: módulo antigo (sem perguntas) segue valendo só com o vídeo; curso opcional não trava a habilitação", async () => {
  await semear({ uid: "prom1" }); await concluirTreino("prom1");
  await set("treinamento_modulos", "c1", { ordem: 2, titulo: "Curso", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 100, ativo: true, obrigatorio: false, categoria: "saude", perguntas: PERGS });
  const tr = await chamar("GET", "/treinamento", { token: "prom1" }); ok(tr); assert.equal(tr.json.completo, true);
  assert.equal(tr.json.modulos.find((m) => m.id === "c1").temProva, true); assert.equal(tr.json.modulos.find((m) => m.id === "m1").temProva, false);
});
t("prova: o admin cadastra módulo com perguntas e a validação barra dados ruins", async () => {
  const base = { ordem: 3, titulo: "Módulo com prova", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 120, obrigatorio: false, categoria: "atendimento" };
  ok(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...base, perguntas: PERGS } }), "admin salva com prova");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...base, perguntas: [{ enunciado: "Pergunta sem alternativas", alternativas: ["só uma"], correta: 0 }] } }), 400);
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...base, perguntas: [{ enunciado: "Correta fora do intervalo", alternativas: ["a", "b"], correta: 5 }] } }), 400);
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "prom1", body: { ...base } }), 403);
  const l = await chamar("GET", "/admin/treinamento/modulos", { token: "adm" }); ok(l); assert.ok(l.json.some((m) => m.perguntas?.length === 2 && m.categoria === "atendimento"));
});

// ---------- Check-in / check-out ----------
const spMin = () => { const [h, m] = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour12: false, hour: "2-digit", minute: "2-digit" }).split(":").map(Number); return (h % 24) * 60 + m; };
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
async function aulaHoje(id, extra = {}) { const ini = Math.max(0, spMin() - 5); await set("aulas", id, { uid: "alunoA", aluno: "Aluno X", personalUid: "prom1", status: "aceita", data: V.hojeSP(), entrada: hhmm(ini), saida: hhmm(Math.min(1439, ini + 240)), minutos: 240, ...extra }); }
// (o check-in/out por /aulas foi substituído pelo check-in com geofence e foto de test/jogo.test.cjs)
// ---------- Painel admin: resumo financeiro e auditoria de exportações ----------
t("admin: resumo financeiro (saques parados, sem dados de Pix) e registro de exportação na auditoria", async () => {
  await set("saques", "q1", { uid: "prom1", status: "solicitado", valorCentavos: 2500, criadoEm: new E.Timestamp(Date.now() - 3 * 3600_000), pixEnc: "x" });
  await set("saques", "q2", { uid: "prom2", status: "pago", valorCentavos: 9999, criadoEm: new E.Timestamp(Date.now()) });
  const r = await chamar("GET", "/admin/financeiro/resumo", { token: "adm" }); ok(r);
  assert.equal(r.json.saquesAbertos.qtd, 1); assert.equal(r.json.saquesAbertos.valorCentavos, 2500); assert.ok(r.json.saquesAbertos.maisAntigoEm);
  assert.ok(!JSON.stringify(r.json).includes("pix"), "sem dados de Pix");
  falha(await chamar("GET", "/admin/financeiro/resumo", { token: "prom1" }), 403); falha(await chamar("GET", "/admin/financeiro/resumo", { token: "alunoA" }), 403);
  ok(await chamar("POST", "/admin/auditar-exportacao", { token: "adm", body: { tipo: "missoes", linhas: 42 } }));
  falha(await chamar("POST", "/admin/auditar-exportacao", { token: "adm", body: { tipo: "../../etc/passwd" } }), 400);
  falha(await chamar("POST", "/admin/auditar-exportacao", { token: "prom1", body: { tipo: "missoes" } }), 403);
  const aud = await chamar("GET", "/admin/auditoria?limite=50", { token: "adm" }); ok(aud);
  assert.ok(aud.json.some((a) => a.acao === "admin.exportar" && a.alvo === "missoes"), "a exportação ficou no log");
});

// ---------- Suporte: perfil 360 do atendente ----------
t("suporte: perfil 360 do aluno e do personal (só admin), CPF mascarado, histórico, pré-carga leve sem auditoria", async () => {
  await semear({ uid: "prom1", status: "ativo", treinado: true });
  await set("usuarios", "prom1", { email: "p@x.com" });
  await set("personais", "prom1", { uid: "prom1", nome: "Personal prom1", status: "ativo", cidade: "Itapira", ratingMedia: 4.8 });
  await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "Aluno A", documento: "12345678000190", objetivo: "Emagrecimento", endereco: "Rua 1", criadoEm: new E.Timestamp(Date.now()) });
  await set("cartoes", "alunoA", { uid: "alunoA", status: "ativo", ultimos4: "1234" });
  await set("aulas", "s1", { uid: "alunoA", personalUid: "prom1", personalNome: "Personal prom1", aluno: "Aluno A", status: "concluida", data: dia(-1), foco: "Musculação", criadoEm: new E.Timestamp(Date.now() - 1000) });
  await set("aulas", "s2", { uid: "alunoA", status: "aberta", data: dia(3), foco: "Bebidas", criadoEm: new E.Timestamp(Date.now()) });
  ok(await chamar("POST", "/suporte/mensagem", { token: "alunoA", body: { texto: "Preciso de ajuda." } }));
  ok(await chamar("POST", "/suporte/mensagem", { token: "prom1", body: { texto: "Não consigo aceitar aula." } }));

  // RBAC: só admin
  falha(await chamar("GET", "/admin/suporte/alunoA/perfil", { token: "alunoA" }), 403); falha(await chamar("GET", "/admin/suporte/prom1/perfil", { token: "prom1" }), 403);
  falha(await chamar("GET", "/admin/suporte/naoexiste/perfil", { token: "adm" }), 404);

  const l = await chamar("GET", "/admin/suporte/alunoA/perfil", { token: "adm" }); ok(l);
  assert.equal(l.json.tipo, "aluno"); assert.equal(l.json.cadastro.nome, "Aluno A"); assert.equal(l.json.cadastro.cartao, "ativo");
  assert.equal(l.json.historico.total, 2); assert.equal(l.json.historico.porStatus.concluida, 1); assert.equal(l.json.historico.ultimos[0].status, "aberta", "mais recente primeiro");
  assert.ok(!JSON.stringify(l.json).includes("ultimos4"), "não expõe dados do cartão além do status");

  const p = await chamar("GET", "/admin/suporte/prom1/perfil", { token: "adm" }); ok(p);
  assert.equal(p.json.tipo, "personal"); assert.equal(p.json.email, "p@x.com"); assert.equal(p.json.cadastro.cidade, "Itapira"); assert.equal(p.json.historico.total, 1);
  assert.ok(p.json.cadastro.cpfMascarado && !p.json.cadastro.cpfMascarado.includes(cpf(0)), "CPF vem mascarado"); assert.equal(p.json.parcial, false);
  assert.equal(p.json.conversa.mensagens, 1);

  const antes = [...E.store.keys()].filter((k) => k.startsWith("auditoria/")).length;
  const leve = await chamar("GET", "/admin/suporte/prom1/perfil?leve=1", { token: "adm" }); ok(leve);
  assert.equal(leve.json.parcial, true); assert.equal(leve.json.cadastro.cpfMascarado, ""); assert.equal(leve.json.cadastro.telefone, "", "pré-carga não decifra dados pessoais");
  assert.equal([...E.store.keys()].filter((k) => k.startsWith("auditoria/")).length, antes, "pré-carga não gera auditoria");
  const aud = [...E.store.values()].filter((v) => v.acao === "admin.suporte.ver_perfil"); assert.equal(aud.length, 2, "abrir o perfil (não a pré-carga) é auditado");
});

t("cadastro de personal: sem CPF/nascimento → 400; dados já gravados são reaproveitados; conta já cadastrada não dá erro", async () => {
  const corpo = { termos: true, nome: "Fulano", telefone: "19999990000", cref: "012345-G/SP" };
  falha(await chamar("POST", "/cadastro/personal", { token: "novo", body: corpo }), 400, "dados-invalidos");
  await set("personais_privado", "novo1", { uid: "novo1", cpfEnc: enc("novo1", "cpf", cpf(0)), cpfIdx: Cripto.indiceCego(cpf(0)), nascimentoEnc: enc("novo1", "nascimento", "1995-05-20") });   // cadastro interrompido antes
  const r = await chamar("POST", "/cadastro/personal", { token: "novo", body: corpo }); ok(r, "reaproveita dados gravados");
  assert.equal((await get("personais", "novo1")).status, "pendente");
  const r2 = await chamar("POST", "/cadastro/personal", { token: "novo", body: { termos: true } }); ok(r2); assert.equal(r2.json.jaCadastrado, true);   // sem CPF no corpo, mas já cadastrado
});

// ============================================================
// COMPROVANTE DE SERVIÇO (layout DANFE simplificado)
// ============================================================
const DANFE = require("../server/lib/danfe");
const EMITIR = (id, token = "alunoA") => chamar("POST", `/nota/${id}/emitir`, { token });
const dvChave = (base43) => { let soma = 0, peso = 2; for (let i = 42; i >= 0; i--) { soma += Number(base43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; } const r = soma % 11; return r < 2 ? 0 : 11 - r; };
const chaveValida = (base = "3526040000000000000055001000000123100000123") => base + dvChave(base);
/** decodifica as larguras de volta para texto, conferindo início, parada e dígito verificador (round-trip do código de barras) */
function decodificarBarras(modulos) {
  const sim = []; for (let i = 0; i < modulos.length - 7; i += 6) sim.push(DANFE.PADROES.indexOf(modulos.slice(i, i + 6).join("")));
  assert.equal(modulos.slice(-7).join(""), "2331112", "padrão de parada"); assert.ok(sim.every((c) => c >= 0), "todos os símbolos existem");
  const dv = sim.pop(), soma = sim.reduce((a, c, i) => a + (i === 0 ? c : c * i), 0) % 103; assert.equal(dv, soma, "dígito verificador do Code 128");
  const [ini, ...dados] = sim; return ini === 105 ? dados.map((c) => String(c).padStart(2, "0")).join("") : dados.map((c) => String.fromCharCode(c + 32)).join("");
}
async function notaPaga() { const sid = await cenarioPago(); return { sid, notaId: (await get("aulas", sid)).notaId }; }

t("comprovante: o aluno dona emite; itens fecham com o total; documento sem valor fiscal; código de barras decodifica", async () => {
  const { sid, notaId } = await notaPaga(); assert.ok(notaId);
  const r = await EMITIR(notaId); ok(r); const d = r.json;
  assert.equal(d.modo, "comprovante"); assert.equal(d.semValorFiscal, true); assert.equal(d.marcaDagua, "SEM VALOR FISCAL"); assert.equal(d.codigo.rotulo, "CÓDIGO DE VERIFICAÇÃO"); assert.equal(d.via, 1); assert.equal(d.estornado, false);
  assert.equal(d.identificacao.numeroFmt, "000001"); assert.equal(d.identificacao.serie, "A1"); assert.equal(d.emitente.cnpj, "00.000.000/0001-00");
  const nv = (await get("notas", notaId)).valores;
  assert.equal(d.itens.reduce((a, i) => a + i.totalCentavos, 0), d.calculo.totalCentavos); assert.equal(d.calculo.totalCentavos, 10000); assert.deepEqual(d.itens.map((i) => i.totalCentavos), [nv.valor, nv.taxaFixa].filter((v) => v > 0), JSON.stringify(nv));
  assert.equal(d.calculo.valorServicosCentavos + d.calculo.taxaServicoCentavos, d.calculo.totalCentavos); assert.equal(d.pagamento.status, "pago");
  assert.ok(/^\d{24}$/.test(d.codigo.valor), "24 dígitos, nunca 44 (não imita chave de acesso)"); assert.equal(decodificarBarras(d.codigo.barras.modulos), d.codigo.valor);
  assert.equal(d.codigo.barras.total, d.codigo.barras.modulos.reduce((a, b) => a + b, 0)); assert.ok(!/"[a-zA-Z]*[uU]id"/.test(JSON.stringify(d)), "sem campos de uid no documento"); assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(JSON.stringify(d)), "sem CPF completo");
  assert.match(d.adicionais.join(" "), /NÃO substitui nota fiscal/);
  assert.equal((await EMITIR(notaId)).json.via, 2, "2ª via"); assert.equal((await get("notas", notaId)).emissoes, 2);
  assert.equal((await get("notas", notaId)).valores.total, 10000, "a emissão não altera o snapshot da nota");
  assert.ok((await ctx.db.collection("auditoria").get()).docs.some((x) => x.data().acao === "nota.emitir"), "emissão auditada");
});

t("comprovante: nota alheia = 404, personal = 403, sem login = 401, admin pode, id inválido = 400", async () => {
  const { notaId } = await notaPaga();
  falha(await EMITIR(notaId, "alunoB"), 404, "nao-encontrado"); falha(await EMITIR(notaId, "prom1"), 403, "sem-permissao"); falha(await chamar("POST", `/nota/${notaId}/emitir`, {}), 401);
  falha(await EMITIR("a$b%20c", "alunoA"), 400); falha(await EMITIR("naoexisteNota123"), 404, "nao-encontrado"); assert.equal((await get("notas", notaId)).emissoes, undefined, "tentativas negadas não contam via");
  const a = await EMITIR(notaId, "adm"); if (a.status === 200) assert.equal(a.json.identificacao.numeroFmt, "000001"); else falha(a, 403, "mfa-obrigatorio");
});

t("comprovante mostra o ESTORNO em tempo real e continua válido na verificação (marcado como estornado)", async () => {
  const { sid, notaId } = await notaPaga(); const antes = (await EMITIR(notaId)).json; mpMock({ "POST /v1/payments/777/refunds": { id: 5 }, "GET /v1/payments/777": pgMP(sid) });
  ok(await chamar("POST", `/admin/aulas/${sid}/estornar`, { token: "adm", body: { motivo: "teste de estorno" } }));
  const d = (await EMITIR(notaId)).json; assert.equal(d.estornado, true, JSON.stringify(d.pagamento) + JSON.stringify(await get("pagamentos_internos", sid))); assert.equal(d.pagamento.status, "estornado"); assert.equal(d.codigo.valor, antes.codigo.valor, "o código não muda com o estorno");
  const v = await chamar("POST", "/nota/verificar", { body: { id: notaId, codigo: antes.codigo.verificacao } }); ok(v); assert.equal(v.json.valida, true); assert.equal(v.json.estornado, true);
});

t("verificação pública: só o código correto valida; adulteração e entradas estranhas não", async () => {
  const { notaId } = await notaPaga(); const d = (await EMITIR(notaId)).json, V1 = (codigo, id = notaId) => chamar("POST", "/nota/verificar", { body: { id, codigo } });
  let r = await V1(d.codigo.verificacao); ok(r); assert.equal(r.json.valida, true, JSON.stringify({ id: notaId, cod: d.codigo.verificacao })); assert.deepEqual(Object.keys(r.json).sort(), ["emitidaEm", "estornado", "numeroFmt", "serie", "valida"], JSON.stringify(r.json)); assert.equal(r.json.valida, true); assert.equal(r.json.numeroFmt, "000001");
  assert.equal((await V1(d.codigo.valor)).json.valida, true, "aceita com ou sem espaços");
  const trocado = d.codigo.valor.slice(0, 23) + ((Number(d.codigo.valor[23]) + 1) % 10); assert.equal((await V1(trocado)).json.valida, false);
  assert.equal((await V1(d.codigo.valor, "outraNota12345")).json.valida, false); assert.equal((await V1("123")).json.valida, false);
  for (const id of [{ $ne: 1 }, "../x", "", null]) { const x = await chamar("POST", "/nota/verificar", { body: { id, codigo: d.codigo.valor } }); ok(x); assert.equal(x.json.valida, false); }
  await ctx.db.collection("notas").doc(notaId).set({ valores: { valor: 7500, taxaFixa: 5000, total: 25000 } }, { merge: true });          // adulteração no banco
  assert.equal((await V1(d.codigo.valor)).json.valida, false, "valor alterado invalida o código");
  falha(await EMITIR(notaId), 409, "nota-inconsistente");
});

t("documento fiscal: só com chave de 44 dígitos válida + protocolo + data de autorização; senão continua sem valor fiscal", async () => {
  const { notaId } = await notaPaga(), base = (await get("notas", notaId)), chave = chaveValida(); assert.ok(DANFE.chaveAcessoValida(chave)); assert.ok(!DANFE.chaveAcessoValida(chave.slice(0, 43) + ((Number(chave[43]) + 1) % 10)));
  const fisc = (f) => ctx.db.collection("notas").doc(notaId).set({ ...base, fiscal: f ? { documento: f } : { nfse: null } });
  await fisc({ chaveAcesso: chave.slice(0, 43) + ((Number(chave[43]) + 1) % 10), protocolo: "135260000000001", autorizadaEm: new E.Timestamp(Date.now()) }); assert.equal((await EMITIR(notaId)).json.modo, "comprovante", "DV inválido não vira fiscal");
  await fisc({ chaveAcesso: chave, protocolo: "123", autorizadaEm: new E.Timestamp(Date.now()) }); assert.equal((await EMITIR(notaId)).json.modo, "comprovante", "sem protocolo não vira fiscal");
  await fisc({ chaveAcesso: chave, protocolo: "135260000000001" }); assert.equal((await EMITIR(notaId)).json.modo, "comprovante", "sem data de autorização não vira fiscal");
  await fisc({ chaveAcesso: chave, protocolo: "135260000000001", autorizadaEm: new E.Timestamp(Date.now()), ambiente: "producao" });
  let d = (await EMITIR(notaId)).json; assert.equal(d.modo, "fiscal"); assert.equal(d.semValorFiscal, false); assert.equal(d.marcaDagua, ""); assert.equal(d.codigo.rotulo, "CHAVE DE ACESSO"); assert.equal(d.codigo.valor, chave); assert.equal(decodificarBarras(d.codigo.barras.modulos), chave); assert.equal(d.codigo.protocolo, "135260000000001");
  await fisc({ chaveAcesso: chave, protocolo: "135260000000001", autorizadaEm: new E.Timestamp(Date.now()), ambiente: "homologacao" }); d = (await EMITIR(notaId)).json; assert.equal(d.semValorFiscal, true); assert.match(d.marcaDagua, /HOMOLOGAÇÃO/);
});

t("Code 128: tabela íntegra, B e C, e limites", async () => {
  assert.equal(DANFE.PADROES.length, 107); for (const p of DANFE.PADROES.slice(0, 106)) assert.equal(p.split("").reduce((a, b) => a + Number(b), 0), 11); assert.equal(DANFE.PADROES[106].split("").reduce((a, b) => a + Number(b), 0), 13);
  for (const txt of ["12", "123456789012345678901234", "Hello-World 42", "123", "A1b2~"]) assert.equal(decodificarBarras(DANFE.code128(txt).modulos), txt);
  assert.throws(() => DANFE.code128("")); assert.throws(() => DANFE.code128("ação")); assert.throws(() => DANFE.code128("1".repeat(81)));
  assert.equal(DANFE.agrupar("123456789012"), "1234 5678 9012");
});


(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    reset(); const log = console.warn; console.warn = () => {}; const err = console.error; console.error = () => {};
    try { await fn(); console.log = console.log; process.stdout.write(`  ✓ ${nome}\n`); }
    catch (e) { falhas++; process.stdout.write(`  ✗ ${nome}\n      ${String(e.stack || e).split("\n").slice(0, 4).join("\n      ")}\n`); }
    finally { console.warn = log; console.error = err; }
  }
  E.restaurarRelogio(); process.stdout.write(`\n${testes.length - falhas}/${testes.length} testes do backend passaram\n`); process.exit(falhas ? 1 : 0);
})();
