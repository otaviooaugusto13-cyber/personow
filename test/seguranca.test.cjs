// Bateria dos módulos de segurança/admin/perfil adaptados do Abastece Já. Sem rede (Firestore/Auth/Express falsos).
// Rodar: node test/seguranca.test.cjs
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_CLIENT_ID = "cid"; process.env.MP_CLIENT_SECRET = "csecret"; process.env.MP_WEBHOOK_SECRET = "whsecret";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { ctx, chamar, Seg, finalizarPagamento } = E.carregarServidor();
const { V, R, Cripto } = ctx;

const U = {
  ana: { uid: "ana", email: "ana@x.com", email_verified: true, name: "Ana Souza" }, bia: { uid: "bia", email: "bia@x.com", email_verified: true },
  leo: { uid: "leo", email: "leo@x.com", email_verified: true }, rui: { uid: "rui", email: "rui@x.com", email_verified: true },
  adm: { uid: "adm1", email: "adm@x.com", email_verified: true }, nv: { uid: "nv", email: "nv@x.com", email_verified: false }
};
const CPF1 = "52998224725", CPF2 = "11144477735";
const hoje = () => V.hojeSP();
const dia = (n) => { const d = new Date(hoje() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
function reset() {
  E.limpar(); Object.assign(E.tokens, U); E.claimsStore.adm1 = { role: "admin" }; E.clock.now = Date.now();
}
const ok = (r, m = "") => assert.equal(r.status, 200, `${m} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
let ipSeq = 0; const ip = () => `10.0.0.${++ipSeq % 250}`;   // cada chamada com IP novo: o limitador por IP não interfere nos outros testes

const testes = []; const t = (n, f) => testes.push([n, f]);

t("cabeçalhos: CSP restritiva (com Maps), HSTS, nosniff, frame-ancestors, sem x-powered-by", () => {
  const h = {}; Seg.cabecalhos()({}, { setHeader: (k, v) => (h[k] = v), removeHeader() {} }, () => {});
  const csp = h["Content-Security-Policy"];
  assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /object-src 'none'/);
  assert.match(csp, /maps\.googleapis\.com/, "Google Maps liberado (radar do aluno e mapa do personal)");
  assert.match(csp, /firebaseio\.com/); assert.match(csp, /mercadopago/);
  assert.match(h["Strict-Transport-Security"], /max-age=\d+/); assert.equal(h["X-Content-Type-Options"], "nosniff"); assert.equal(h["X-Frame-Options"], "DENY");
  assert.match(h["Permissions-Policy"], /geolocation=\(self\)/);
});
t("CSRF: origem de fora é recusada; JSON obrigatório; webhook isento; GET livre", () => {
  const mw = Seg.protecaoCsrf(new Set(["https://app.exemplo.com"]), { isentas: ["/webhookMP"] });
  const run = (req) => { let r; mw({ method: "POST", path: "/criarAula", get: () => "", ...req, get: (n) => (req.h || {})[n.toLowerCase()] }, {}, (e) => (r = e || "ok")); return r; };
  assert.equal(run({ h: { origin: "https://evil.com", "content-type": "application/json" } }).codigo, "origem-invalida");
  assert.equal(run({ h: { origin: "https://app.exemplo.com", "content-type": "application/json" } }), "ok");
  assert.equal(run({ h: { "content-type": "text/plain", "content-length": "5" } }).codigo, "tipo-invalido");
  assert.equal(run({ path: "/webhookMP", h: { origin: "https://mp.com", "content-type": "text/plain", "content-length": "5" } }), "ok");
  let g; mw({ method: "GET", path: "/x", get: () => "https://evil.com" }, {}, (e) => (g = e || "ok")); assert.equal(g, "ok");
});
t("rate limit: estoura e devolve 429 com Retry-After", async () => {
  const { limitar } = Seg.criarLimitador(); const mw = limitar({ max: 3, nome: "x" }); const h = {}; let ultimo;
  for (let i = 0; i < 4; i++) mw({ ip: "1.1.1.1" }, { setHeader: (k, v) => (h[k] = v) }, (e) => (ultimo = e || "ok"));
  assert.equal(ultimo.status, 429); assert.ok(h["Retry-After"]);
});
t("autenticação: sem token, token revogado e e-mail não verificado são recusados", async () => {
  falha(await chamar("GET", "/perfil/personal/privado", { ip: ip() }), 401);
  falha(await chamar("GET", "/perfil/personal/privado", { token: "nv", ip: ip() }), 401, "sessao-invalida");
  await set("personais", "leo", { uid: "leo", nome: "Leo", status: "pendente" });
  ok(await chamar("GET", "/perfil/personal/privado", { token: "leo", ip: ip() }));
  E.revogados.add("leo"); falha(await chamar("GET", "/perfil/personal/privado", { token: "leo", ip: ip() }), 401, "sessao-invalida"); E.revogados.delete("leo");
});
t("dados privados: cifrados em repouso, CPF duplicado barrado, validações", async () => {
  await set("personais", "leo", { uid: "leo", nome: "Leo", status: "pendente" }); await set("personais", "rui", { uid: "rui", nome: "Rui", status: "pendente" });
  const body = { cpf: "529.982.247-25", telefone: "(19) 99999-0000", nascimento: "1990-04-10", pix: { tipo: "Celular", chave: "(19) 99999-0000" }, banco: { banco: "Nubank", tipo: "Corrente", agencia: "0001", conta: "12345", digito: "6" }, hack: "x" };
  ok(await chamar("PUT", "/perfil/personal/privado", { token: "leo", body, ip: ip() }), "salvar");
  const bruto = await get("personais_privado", "leo");
  assert.ok(bruto.cpfEnc && bruto.telefoneEnc && bruto.nascimentoEnc && bruto.pixEnc && bruto.bancoEnc, "tudo cifrado");
  assert.equal(JSON.stringify(bruto).includes(CPF1), false, "CPF em claro não pode existir no documento");
  assert.equal(JSON.stringify(bruto).includes("99999"), false, "telefone em claro não pode existir");
  assert.equal(bruto.hack, undefined, "campo desconhecido ignorado (mass assignment)");
  const r = await chamar("GET", "/perfil/personal/privado", { token: "leo", ip: ip() }); ok(r);
  assert.equal(r.json.cpf, CPF1); assert.equal(r.json.nascimento, "1990-04-10"); assert.equal(r.json.pix.chave, "19999990000"); assert.equal(r.json.banco.agencia, "0001");
  falha(await chamar("PUT", "/perfil/personal/privado", { token: "rui", body: { cpf: CPF1 }, ip: ip() }), 409, "cpf-duplicado");
  ok(await chamar("PUT", "/perfil/personal/privado", { token: "leo", body: { cpf: CPF1 }, ip: ip() }), "o próprio dono pode reenviar o mesmo CPF");
  falha(await chamar("PUT", "/perfil/personal/privado", { token: "rui", body: { cpf: "11111111111" }, ip: ip() }), 400, "cpf-invalido");
  falha(await chamar("PUT", "/perfil/personal/privado", { token: "rui", body: { nascimento: dia(-365 * 15) }, ip: ip() }), 403, "idade-minima");
  falha(await chamar("PUT", "/perfil/personal/privado", { token: "rui", body: { pix: { tipo: "CPF", chave: "123" } }, ip: ip() }), 400);
  falha(await chamar("PUT", "/perfil/personal/privado", { token: "ana", body: { cpf: CPF2 }, ip: ip() }), 403, "sem-cadastro");   // aluno sem cadastro de personal
  assert.deepEqual((await get("personais_privado", "rui")) || {}, {}, "nada foi gravado nas tentativas inválidas");
});
t("dados privados: AAD impede copiar valor cifrado de outro usuário; formato antigo (texto puro) ainda é lido", async () => {
  await set("personais", "leo", { uid: "leo", nome: "Leo", status: "ativo" }); await set("personais", "rui", { uid: "rui", nome: "Rui", status: "ativo" });
  ok(await chamar("PUT", "/perfil/personal/privado", { token: "leo", body: { cpf: CPF1 }, ip: ip() }));
  const enc = (await get("personais_privado", "leo")).cpfEnc;
  await set("personais_privado", "rui", { uid: "rui", cpfEnc: enc });                    // atacante copia o cifrado do Leo para o Rui
  assert.equal((await chamar("GET", "/perfil/personal/privado", { token: "rui", ip: ip() })).json.cpf, "", "não decifra em outro contexto");
  await set("personais_privado", "rui", { uid: "rui", cpf: CPF2, telefone: "(19) 98888-7777" });   // legado
  const r = await chamar("GET", "/perfil/personal/privado", { token: "rui", ip: ip() }); assert.equal(r.json.cpf, CPF2); assert.equal(r.json.telefone, "(19) 98888-7777");
  ok(await chamar("PUT", "/perfil/personal/privado", { token: "rui", body: { cpf: CPF2 }, ip: ip() }));
  const novo = await get("personais_privado", "rui"); assert.ok(novo.cpfEnc); assert.equal(novo.cpf, undefined, "ao salvar, o texto puro antigo é apagado");
});
t("perfil inteligente: só focos oficiais, sem repetição, limites, sem personal alheio", async () => {
  await set("personais", "leo", { uid: "leo", nome: "Leo", status: "ativo" });
  const bio = "Personal com 5 anos em musculação e hipertrofia.";
  let r = await chamar("PUT", "/perfil/personal/inteligente", { token: "leo", body: { experiencias: [{ foco: "Hipertrofia", anos: 5 }, { foco: "Hipertrofia", anos: 9 }, { foco: "Corrida", anos: 2 }], bio, palavrasChave: ["hipertrofia", "corrida"] }, ip: ip() });
  ok(r); const p = await get("personais", "leo"); assert.deepEqual(p.experiencias, [{ foco: "Hipertrofia", anos: 5 }, { foco: "Corrida", anos: 2 }]); assert.equal(p.bio, bio); assert.equal(p.status, "ativo", "status intacto");
  falha(await chamar("PUT", "/perfil/personal/inteligente", { token: "leo", body: { experiencias: [{ foco: "Reposição de gôndola", anos: 1 }] }, ip: ip() }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/perfil/personal/inteligente", { token: "leo", body: { experiencias: [{ foco: "Corrida", anos: 99 }] }, ip: ip() }), 400);
  falha(await chamar("PUT", "/perfil/personal/inteligente", { token: "leo", body: { experiencias: "x" }, ip: ip() }), 400);
  falha(await chamar("PUT", "/perfil/personal/inteligente", { token: "leo", body: { experiencias: [], bio: "a".repeat(301) }, ip: ip() }), 400);
  falha(await chamar("PUT", "/perfil/personal/inteligente", { token: "ana", body: { experiencias: [] }, ip: ip() }), 403, "sem-cadastro");
});
t("recado do suporte: admin envia, dono apaga com 'Entendi', outro usuário não mexe", async () => {
  await set("personais", "leo", { uid: "leo", nome: "Leo", status: "pendente" }); await set("alunos", "ana", { nome: "Ana" });
  ok(await chamar("POST", "/admin/recado/personal/leo", { token: "adm", body: { texto: "Confira seu CREF, por favor." }, ip: ip() }));
  assert.equal((await get("personais", "leo")).recado.texto, "Confira seu CREF, por favor.");
  falha(await chamar("POST", "/admin/recado/personal/leo", { token: "leo", body: { texto: "me aprovem" }, ip: ip() }), 403, "sem-permissao");
  ok(await chamar("POST", "/perfil/recado/lido", { token: "leo", body: { tipo: "personal" }, ip: ip() }));
  assert.equal((await get("personais", "leo")).recado, undefined);
  ok(await chamar("POST", "/admin/recado/aluno/ana", { token: "adm", body: { texto: "Seu pagamento foi conferido." }, ip: ip() }));
});
t("admin: RBAC — só admin entra; aluno e personal levam 403", async () => {
  for (const tk of ["ana", "leo"]) falha(await chamar("GET", "/admin/personais", { token: tk, ip: ip() }), 403, "sem-permissao");
  falha(await chamar("GET", "/admin/personais", { ip: ip() }), 401);
  ok(await chamar("GET", "/admin/eu", { token: "adm", ip: ip() }));
  E.claimsStore.ana = { admin: true }; ok(await chamar("GET", "/admin/eu", { token: "ana", ip: ip() }), "claim admin:true também vale"); delete E.claimsStore.ana;
});
t("admin: aprovar exige CREF e CPF; ficha não vaza CPF inteiro; ações ficam na auditoria", async () => {
  await set("personais", "leo", { uid: "leo", nome: "Leo", status: "pendente", cref: "", criadoEm: new E.Timestamp(Date.now()) });
  falha(await chamar("POST", "/admin/personais/leo/status", { token: "adm", body: { status: "ativo" }, ip: ip() }), 409, "cadastro-incompleto");
  await ctx.db.collection("personais").doc("leo").set({ cref: "123456-G/SP" }, { merge: true });
  falha(await chamar("POST", "/admin/personais/leo/status", { token: "adm", body: { status: "ativo" }, ip: ip() }), 409, "cadastro-incompleto");   // ainda sem CPF
  ok(await chamar("PUT", "/perfil/personal/privado", { token: "leo", body: { cpf: CPF1, telefone: "(19) 99999-0000", nascimento: "1990-04-10" }, ip: ip() }));
  const ficha = await chamar("GET", "/admin/personais/leo", { token: "adm", ip: ip() }); ok(ficha);
  assert.equal(ficha.json.cpfMascarado, "***.982.247-**"); assert.equal(JSON.stringify(ficha.json).includes(CPF1), false); assert.ok(ficha.json.idade >= 30);
  const lista = await chamar("GET", "/admin/personais?status=pendente", { token: "adm", ip: ip() }); ok(lista); assert.equal(lista.json.length, 1);
  ok(await chamar("POST", "/admin/personais/leo/status", { token: "adm", body: { status: "ativo" }, ip: ip() }));
  assert.equal((await get("personais", "leo")).status, "ativo");
  falha(await chamar("POST", "/admin/personais/leo/status", { token: "adm", body: { status: "deus" }, ip: ip() }), 400);
  const aud = await chamar("GET", "/admin/auditoria", { token: "adm", ip: ip() }); ok(aud);
  const acoes = aud.json.map((a) => a.acao); assert.ok(acoes.includes("admin.personal.ver_ficha") && acoes.includes("admin.personal.ativo"), acoes.join(","));
});
t("admin: bloquear exige motivo, grava recado e derruba a sessão; devolver para análise preserva o motivo", async () => {
  await set("personais", "leo", { uid: "leo", nome: "Leo", status: "ativo", cref: "1" });
  falha(await chamar("POST", "/admin/personais/leo/status", { token: "adm", body: { status: "bloqueado" }, ip: ip() }), 400, "motivo-obrigatorio");
  ok(await chamar("POST", "/admin/personais/leo/status", { token: "adm", body: { status: "bloqueado", motivo: "CREF não confere." }, ip: ip() }));
  const p = await get("personais", "leo"); assert.equal(p.status, "bloqueado"); assert.equal(p.recado.texto, "CREF não confere."); assert.ok(E.revogados.has("leo"), "sessões revogadas");
  falha(await chamar("GET", "/perfil/personal/privado", { token: "leo", ip: ip() }), 401, "sessao-invalida");
  ok(await chamar("POST", "/admin/personais/leo/status", { token: "adm", body: { status: "pendente", motivo: "Envie o CREF legível." }, ip: ip() }));
  assert.equal((await get("personais", "leo")).recado.tipo, "pendente");
  ok(await chamar("POST", "/admin/usuarios/ana/revogar-sessoes", { token: "adm", ip: ip() })); assert.ok(E.revogados.has("ana"));
});
t("admin: financeiro (comissão 15% ao centavo), aulas e CSV com proteção contra fórmula", async () => {
  await set("personais", "leo", { uid: "leo", nome: "=cmd|' /C calc'!A0", status: "ativo", cref: "1" });
  await set("aulas", "a1", { status: "paga", valorCentavos: 8000, valorPersonalCentavos: 6800, data: dia(-1), horario: "10:00–11:00", foco: "Hipertrofia", local: "Smart Fit", alunoNome: "Ana", personalNome: "Leo", reciboNumero: 1 });
  await set("aulas", "a2", { status: "concluida", valorCentavos: 3333, data: dia(-2), horario: "08:00–09:00", foco: "Corrida", local: "Praça", alunoNome: "Bia", personalNome: "Rui" });
  await set("aulas", "a3", { status: "aberta", valorCentavos: 5000, data: dia(1) });
  const r = await chamar("GET", "/admin/financeiro/resumo", { token: "adm", ip: ip() }); ok(r);
  const sp = R.calcularSplit(3333);
  assert.equal(r.json.aulasPagas, 2); assert.equal(r.json.volumeCentavos, 11333); assert.equal(r.json.repasseCentavos, 6800 + sp.personal); assert.equal(r.json.comissaoCentavos, 1200 + sp.comissao);
  assert.equal(r.json.repasseCentavos + r.json.comissaoCentavos, r.json.volumeCentavos, "repasse + comissão = volume (nunca perde centavo)"); assert.equal(r.json.aulasAbertas, 1);
  assert.equal((await chamar("GET", "/admin/aulas?status=paga", { token: "adm", ip: ip() })).json.length, 1);
  const csv = await chamar("GET", "/admin/exportar/personais", { token: "adm", ip: ip() }); ok(csv);
  assert.ok(csv.texto.startsWith("﻿")); assert.match(csv.texto, /'=cmd/, "fórmula neutralizada"); assert.equal(csv.h["Content-Type"].includes("text/csv"), true);
  const csvA = await chamar("GET", "/admin/exportar/aulas", { token: "adm", ip: ip() }); ok(csvA); assert.match(csvA.texto, /80,00/); falha(await chamar("GET", "/admin/exportar/senhas", { token: "adm", ip: ip() }), 400);
  falha(await chamar("GET", "/admin/exportar/aulas", { token: "ana", ip: ip() }), 403);
});
t("admin: moderação lista ocorrências e reincidentes; aviso global liga/desliga e é público", async () => {
  await set("moderacao", "m1", { uid: "ana", aulaId: "a1", trecho: "chama no zap", criadoEm: new E.Timestamp(Date.now()) });
  await set("infracoes", "ana", { uid: "ana", total: 2, revisaoManual: true, ultimaEm: new E.Timestamp(Date.now()) });
  const r = await chamar("GET", "/admin/moderacao", { token: "adm", ip: ip() }); ok(r); assert.equal(r.json.ocorrencias.length, 1); assert.deepEqual(r.json.reincidentes.map((x) => x.uid), ["ana"]);
  assert.equal((await chamar("GET", "/aviso", { ip: ip() })).json.ativo, false);
  falha(await chamar("PUT", "/admin/aviso", { token: "adm", body: { ativo: true, texto: "" }, ip: ip() }), 400);
  ok(await chamar("PUT", "/admin/aviso", { token: "adm", body: { ativo: true, nivel: "alerta", texto: "Manutenção hoje às 23h." }, ip: ip() }));
  assert.deepEqual((await chamar("GET", "/aviso", { ip: ip() })).json, { ativo: true, nivel: "alerta", texto: "Manutenção hoje às 23h." });
});
t("criarAula: guarda a coordenada (arredondada); coordenada absurda é ignorada sem derrubar o pedido", async () => {
  const base = { local: "Smart Fit — Av. Brasil, 100", foco: "Hipertrofia", entrada: "10:00", saida: "11:00", valorCentavos: 8000, data: dia(3) };
  let r = await chamar("POST", "/criarAula", { token: "ana", body: { ...base, lat: -22.43581, lng: -46.82312 }, ip: ip() }); ok(r);
  let a = await get("aulas", r.json.id); assert.equal(a.lat, -22.436); assert.equal(a.lng, -46.823);
  r = await chamar("POST", "/criarAula", { token: "ana", body: { ...base, lat: 51.5, lng: -0.12 }, ip: ip() }); ok(r);   // Londres
  a = await get("aulas", r.json.id); assert.equal(a.lat, undefined); assert.equal(a.lng, undefined);
  r = await chamar("POST", "/criarAula", { token: "ana", body: { ...base, lat: "x", lng: {} }, ip: ip() }); ok(r);
  assert.equal((await get("aulas", r.json.id)).lat, undefined);
});
t("recibo: CPF do personal cifrado é decifrado só para mascarar (***.982.247-**)", async () => {
  await set("alunos", "ana", { nome: "Ana", email: "ana@x.com" }); await set("personais", "leo", { uid: "leo", nome: "Leo", status: "ativo", cref: "123456-G/SP", mpConectado: true });
  await set("personais_privado", "leo", { uid: "leo", cpfEnc: Cripto.cifrar(CPF1, "personais_privado/cpf/leo") });
  await set("aulas", "a9", { alunoUid: "ana", alunoNome: "Ana", personalUid: "leo", personalNome: "Leo", status: "aceita", foco: "Corrida", local: "Praça", data: dia(1), horario: "10:00–11:00", entrada: "10:00", saida: "11:00", valorCentavos: 8000 });
  await finalizarPagamento("a9", { paymentId: "99", metodo: "pix" });
  const rec = (await ctx.db.collection("recibos").where("aulaId", "==", "a9").get()).docs[0].data();
  assert.equal(rec.personal.documentoMascarado, "***.982.247-**"); assert.equal(JSON.stringify(rec).includes(CPF1), false);
  const aud = (await ctx.db.collection("auditoria").where("acao", "==", "pagamento.aprovado").get()).docs; assert.equal(aud.length, 1);
});
t("cripto: rotação de chave (v1→v2) continua decifrando", () => {
  const c1 = Cripto.cifrar("segredo", "ctx"); assert.match(c1, /^v1\./); assert.equal(Cripto.decifrar(c1, "ctx"), "segredo"); assert.throws(() => Cripto.decifrar(c1, "outro"));
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    reset();
    try { await fn(); console.log("  ✓", nome); } catch (e) { falhas++; console.error("  ✗", nome, "\n   ", e.stack.split("\n").slice(0,4).join("\n    ")); }
  }
  E.restaurarRelogio();
  if (falhas) { console.error(`\n❌ ${falhas} teste(s) falharam`); process.exit(1); }
  console.log(`\n✅ segurança/admin/perfil: ${testes.length} testes passaram`); process.exit(0);
})();
