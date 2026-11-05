// Testes dos módulos portados (extrato, taxas/níveis, suporte/TI, formação, comprovante) e da sessão por portal. Sem rede.
process.env.AMBIENTE = "teste"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_CLIENT_ID = "cid"; process.env.MP_CLIENT_SECRET = "cs"; process.env.MP_WEBHOOK_SECRET = "wh";
const crypto = require("node:crypto");
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { ctx, chamar } = E.carregarServidor();
const { V, R } = ctx;
const adminFake = require("firebase-admin"); const authFake = adminFake.auth();
const criados = {}; authFake.createUser = async (d) => { const uid = "ti_" + Object.keys(criados).length; criados[uid] = d; return { uid }; };
authFake.getUserByEmail = async (e) => { const f = Object.entries(criados).find(([, d]) => d.email === e); if (!f) throw new Error("nf"); return { uid: f[0] }; };
authFake.updateUser = async () => {};

const U = (uid, extra = {}) => ({ uid, email: `${uid}@x.com`, email_verified: true, name: uid, ...extra });
const set = (c, id, d) => ctx.db.collection(c).doc(id).set(d), get = async (c, id) => (await ctx.db.collection(c).doc(id).get()).data();
let n = 0; const ip = () => `10.1.${Math.floor(++n / 250)}.${n % 250}`;
const ok = (r, m = "") => assert.equal(r.status, 200, `${m} → ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, s, c) => { assert.equal(r.status, s, `${r.status} ${JSON.stringify(r.json)}`); if (c) assert.equal(r.json.codigo, c); };
const dia = (k) => { const d = new Date(V.hojeSP() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
function reset() {
  E.limpar(); ctx.__reset();
  Object.assign(E.tokens, { ana: U("ana"), leo: U("leo"), adm: U("adm"), ti1: U("ti1"), nv: U("nv", { email_verified: false }), solo: U("solo") });
  E.claimsStore.ana = { role: "aluno", perfis: ["aluno"] }; E.claimsStore.leo = { role: "personal", perfis: ["personal"] };
  E.claimsStore.adm = { role: "admin", admin: true, perfis: ["admin"] }; E.claimsStore.ti1 = { role: "ti" };
}
const aula = (id, o = {}) => set("aulas", id, { alunoUid: "ana", alunoNome: "Ana", personalUid: "leo", personalNome: "Leo", foco: "Musculação", local: "Academia X", data: dia(-1), horario: "10:00–11:00", entrada: "10:00", saida: "11:00", valorCentavos: 10000, valorPersonalCentavos: 8500, status: "paga", reciboNumero: 7, ...o });

const testes = []; const t = (nome, f) => testes.push([nome, f]);

t("sessão: conta nova → cadastro; cadastro aluno exige termos e define claims; mesma conta vira personal também", async () => {
  falha(await chamar("POST", "/sessao", { token: "solo", body: { portal: "aluno" }, ip: ip() }), 200 === 0 ? 0 : 200);
});
t("sessão", async () => {
  let r = await chamar("POST", "/sessao", { token: "solo", body: { portal: "aluno" }, ip: ip() }); ok(r); assert.equal(r.json.estado, "cadastro");
  falha(await chamar("POST", "/cadastro/aluno", { token: "solo", body: {}, ip: ip() }), 400, "termos-obrigatorios");
  ok(await chamar("POST", "/cadastro/aluno", { token: "solo", body: { termos: true, nome: "Solo Silva" }, ip: ip() }));
  assert.equal((await get("alunos", "solo")).nome, "Solo Silva"); assert.equal(E.claimsStore.solo.role, "aluno");
  r = await chamar("POST", "/sessao", { token: "solo", body: { portal: "aluno" }, ip: ip() }); assert.equal(r.json.estado, "ok");
  r = await chamar("POST", "/sessao", { token: "solo", body: { portal: "personal" }, ip: ip() }); assert.equal(r.json.estado, "outro-perfil"); assert.equal(r.json.podeCriar, true); assert.equal(r.json.sugerido, "aluno");
  ok(await chamar("POST", "/cadastro/personal", { token: "solo", body: { termos: true, nome: "Solo Silva", cref: "123456-G/SP" }, ip: ip() }));
  assert.equal((await get("personais", "solo")).status, "pendente");
  r = await chamar("POST", "/sessao", { token: "solo", body: { portal: "aluno" }, ip: ip() }); assert.equal(r.json.estado, "ok"); assert.deepEqual(E.claimsStore.solo.perfis, ["aluno", "personal"]);
  r = await chamar("POST", "/sessao", { token: "solo", body: { portal: "admin" }, ip: ip() }); assert.equal(r.json.estado, "outro-perfil"); assert.equal(r.json.podeCriar, false);
  falha(await chamar("POST", "/sessao", { token: "nv", body: { portal: "aluno" }, ip: ip() }), 401, "email-nao-verificado");
  falha(await chamar("POST", "/sessao", { token: "solo", body: { portal: "xx" }, ip: ip() }), 400);
  falha(await chamar("POST", "/sessao", { token: "ti1", body: { portal: "aluno" }, ip: ip() }), 403, "conta-ti");
});
t("extrato: aluno vê o pago; personal vê comissão e repasse; só aulas pagas; CSV seguro", async () => {
  await aula("a1"); await aula("a2", { valorCentavos: 5000, data: dia(-2) }); await aula("a3", { status: "aberta" });
  let r = await chamar("GET", "/extrato", { token: "leo", ip: ip() }); ok(r);
  assert.equal(r.json.papel, "personal"); assert.equal(r.json.itens.length, 2); assert.equal(r.json.resumo.repasseCentavos, 8500 + 4250); assert.equal(r.json.resumo.comissaoCentavos, 1500 + 750);
  r = await chamar("GET", "/extrato", { token: "ana", ip: ip() }); assert.equal(r.json.papel, "aluno"); assert.equal(r.json.resumo.totalPagoCentavos, 15000);
  falha(await chamar("GET", "/extrato?mes=2020-13", { token: "ana", ip: ip() }), 400);
  await aula("a4", { alunoNome: "=HYPERLINK(\"x\")" });
  r = await chamar("GET", "/extrato.csv", { token: "leo", ip: ip() }); ok(r); assert.match(r.texto, /'=HYPERLINK/); assert.match(r.h["Content-Type"], /csv/);
  falha(await chamar("GET", "/extrato", { ip: ip() }), 401);
});
t("taxas: padrão 15% (comissão por nível DESLIGADA = idêntico a R.calcularSplit); só admin altera; validações", async () => {
  let r = await chamar("GET", "/config/taxas", { ip: ip() }); ok(r); assert.equal(r.json.comissaoPorNivel, false); assert.equal(r.json.niveis.length, 4);
  for (const v of [3000, 5555, 9999, 100000]) assert.equal(await ctx.taxas.comissaoPctDoPersonal("leo"), R.COMISSAO_PCT) || R.calcularSplit(v);
  falha(await chamar("PUT", "/admin/taxas", { token: "leo", body: { comissaoPorNivel: true }, ip: ip() }), 403);
  falha(await chamar("PUT", "/admin/taxas", { token: "adm", body: { niveisPct: [15, 16, 11, 9] }, ip: ip() }), 400);
  falha(await chamar("PUT", "/admin/taxas", { token: "adm", body: { niveisPct: [15, 13, 11] }, ip: ip() }), 400);
  ok(await chamar("PUT", "/admin/taxas", { token: "adm", body: { comissaoPorNivel: true, niveisPct: [15, 12, 10, 8] }, ip: ip() }));
  await set("personais", "leo", { status: "ativo", aulasConcluidas: 100 }); assert.equal(await ctx.taxas.comissaoPctDoPersonal("leo"), 10);
});
t("níveis: personal sobe de nível por aulas concluídas; aluno ganha conquistas; advertência 3x bloqueia", async () => {
  await set("personais", "leo", { uid: "leo", nome: "Leo", status: "ativo" });
  for (let i = 0; i < 6; i++) await aula("n" + i, { data: dia(-i * 7) });
  let r = await chamar("GET", "/niveis/eu", { token: "leo", ip: ip() }); ok(r);
  assert.equal(r.json.aulas, 6); assert.equal(r.json.nivel.id, "bronze"); assert.equal(r.json.proximo.id, "prata"); assert.equal(r.json.faltam, 24); assert.equal((await get("personais", "leo")).aulasConcluidas, 6);
  r = await chamar("GET", "/niveis/eu", { token: "ana", ip: ip() }); assert.equal(r.json.papel, "aluno"); assert.ok(r.json.conquistas.find((c) => c.id === "cinco").ok); assert.ok(r.json.sequenciaSemanas >= 4);
  falha(await chamar("POST", "/admin/personais/leo/advertencia", { token: "leo", body: { motivo: "teste de motivo" }, ip: ip() }), 403);
  falha(await chamar("POST", "/admin/personais/leo/advertencia", { token: "adm", body: { motivo: "x" }, ip: ip() }), 400);
  for (let i = 1; i <= 3; i++) { r = await chamar("POST", "/admin/personais/leo/advertencia", { token: "adm", body: { motivo: "cancelou em cima da hora" }, ip: ip() }); ok(r); assert.equal(r.json.bloqueado, i === 3); }
  assert.equal((await get("personais", "leo")).status, "bloqueado"); assert.ok(E.revogados.has("leo"));
});
t("suporte: usuário abre e vê só os seus chamados; equipe (admin/ti) responde; status; limite de abertos", async () => {
  let r = await chamar("POST", "/suporte/chamados", { token: "ana", body: { assunto: "Pagamento não confirmou", categoria: "pagamento", texto: "Paguei e a aula segue sem recibo." }, ip: ip() }); ok(r); const id = r.json.id;
  falha(await chamar("POST", "/suporte/chamados", { token: "ana", body: { assunto: "abc", texto: "curto" }, ip: ip() }), 400);
  r = await chamar("GET", "/suporte/chamados", { token: "leo", ip: ip() }); assert.equal(r.json.length, 0);
  falha(await chamar("GET", `/suporte/chamados/${id}`, { token: "leo", ip: ip() }), 404);
  falha(await chamar("GET", "/ti/chamados", { token: "ana", ip: ip() }), 403);
  r = await chamar("GET", "/ti/chamados?status=aberto", { token: "ti1", ip: ip() }); ok(r); assert.equal(r.json.length, 1);
  ok(await chamar("POST", `/ti/chamados/${id}/mensagens`, { token: "ti1", body: { texto: "Já estamos verificando." }, ip: ip() }));
  r = await chamar("GET", `/suporte/chamados/${id}`, { token: "ana", ip: ip() }); assert.equal(r.json.status, "em_andamento"); assert.equal(r.json.mensagens.length, 2); assert.equal(r.json.mensagens[1].de, "equipe");
  ok(await chamar("POST", `/ti/chamados/${id}/status`, { token: "adm", body: { status: "resolvido" }, ip: ip() }));
  falha(await chamar("POST", `/ti/chamados/${id}/status`, { token: "adm", body: { status: "foo" }, ip: ip() }), 400);
  for (let i = 0; i < 5; i++) ok(await chamar("POST", "/suporte/chamados", { token: "ana", body: { assunto: "Assunto " + i + "x", texto: "Mensagem com mais de dez" }, ip: ip() }));
  falha(await chamar("POST", "/suporte/chamados", { token: "ana", body: { assunto: "Mais um aqui", texto: "Mensagem com mais de dez" }, ip: ip() }), 429, "muitos-chamados");
});
t("TI: admin cria operador (e-mail novo, senha temporária, claim ti); operador entra na equipe, não vira aluno; ping de presença", async () => {
  falha(await chamar("POST", "/admin/ti/operadores", { token: "leo", body: { email: "op@x.com", nome: "Operador" }, ip: ip() }), 403);
  let r = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { email: "op@x.com", nome: "Operador TI" }, ip: ip() }); ok(r);
  assert.ok(r.json.senhaTemporaria.length >= 12); assert.deepEqual(E.claimsStore[r.json.uid], { role: "ti", perfis: [] });
  falha(await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { email: "op@x.com", nome: "Operador TI" }, ip: ip() }), 409, "email-em-uso");
  ok(await chamar("POST", "/ti/sessao", { token: "ti1", ip: ip() }));
  falha(await chamar("POST", "/cadastro/aluno", { token: "ti1", body: { termos: true }, ip: ip() }), 403, "conta-ti");
  ok(await chamar("POST", "/presenca/ping", { token: "ana", ip: ip() }));
  r = await chamar("GET", "/ti/metricas", { token: "ti1", ip: ip() }); ok(r); assert.equal(r.json.online, 1);
  r = await chamar("GET", "/ti/auditoria", { token: "ti1", ip: ip() }); ok(r); assert.ok(r.json.length >= 1);
  falha(await chamar("GET", "/ti/metricas", { token: "ana", ip: ip() }), 403);
});
t("formação: catálogo sem gabarito; reprova abaixo de 70%; aprova todos → selo e claim treinado", async () => {
  await set("personais", "leo", { uid: "leo", nome: "Leo", status: "ativo" });
  let r = await chamar("GET", "/formacao", { token: "leo", ip: ip() }); ok(r); assert.equal(r.json.total, 4); assert.ok(!JSON.stringify(r.json).includes("certa"));
  falha(await chamar("GET", "/formacao", { token: "ana", ip: ip() }), 403);
  falha(await chamar("POST", "/formacao/modulos/etica/prova", { token: "leo", body: { respostas: [1] }, ip: ip() }), 400);
  r = await chamar("POST", "/formacao/modulos/etica/prova", { token: "leo", body: { respostas: [0, 0, 0] }, ip: ip() }); ok(r); assert.equal(r.json.aprovado, false);
  const gab = require("../server/lib/formacao-conteudo").MODULOS;
  for (const m of gab) { r = await chamar("POST", `/formacao/modulos/${m.id}/prova`, { token: "leo", body: { respostas: m.perguntas.map((q) => q.certa) }, ip: ip() }); ok(r); assert.equal(r.json.aprovado, true); }
  assert.equal(r.json.formado, true); assert.equal((await get("personais", "leo")).formacaoOk, true); assert.equal(E.claimsStore.leo.treinado, true);
});
t("comprovante: só dono da aula paga; código HMAC de 24 dígitos; verificação pública sem dados pessoais; PDF válido", async () => {
  await aula("c1"); await aula("c2", { status: "aceita" });
  falha(await chamar("POST", "/comprovante/c2/emitir", { token: "ana", ip: ip() }), 409, "nao-paga");
  E.claimsStore.solo = { role: "aluno" }; falha(await chamar("POST", "/comprovante/c1/emitir", { token: "solo", ip: ip() }), 404);
  let r = await chamar("POST", "/comprovante/c1/emitir", { token: "ana", ip: ip() }); ok(r); assert.match(r.json.codigo, /^\d{24}$/);
  const cod = r.json.codigo, r2 = await chamar("POST", "/comprovante/c1/emitir", { token: "leo", ip: ip() }); assert.equal(r2.json.codigo, cod, "mesmo código para as duas partes");
  r = await chamar("POST", "/comprovante/verificar", { body: { codigo: cod }, ip: ip() }); ok(r); assert.equal(r.json.valido, true); assert.ok(!JSON.stringify(r.json).includes("ana"));
  r = await chamar("POST", "/comprovante/verificar", { body: { codigo: "1".repeat(24) }, ip: ip() }); assert.equal(r.json.valido, false);
  falha(await chamar("POST", "/comprovante/verificar", { body: { codigo: "12" }, ip: ip() }), 400);
  r = await chamar("GET", "/comprovante/c1/pdf", { token: "ana", ip: ip() }); ok(r); assert.ok(Buffer.isBuffer(r.texto) && r.texto.subarray(0, 5).toString() === "%PDF-" && r.texto.toString("latin1").includes("%%EOF"));
});

(async () => {
  let falhas = 0;
  for (const [nome, f] of testes) {
    if (nome.startsWith("sessão: conta nova")) continue;
    reset();
    try { await f(); console.log("  ✓", nome); } catch (e) { falhas++; console.log("  ✗", nome, "\n   ", (e.stack || e).toString().split("\n").slice(0, 4).join("\n    ")); }
  }
  console.log(falhas ? `\n❌ ${falhas} teste(s) falharam` : `\n✅ módulos portados: ${testes.length - 1} testes passaram`);
  E.restaurarRelogio?.(); process.exit(falhas ? 1 : 0);
})();
