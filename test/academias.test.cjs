// Academias parceiras: lib pura + rotas (admin cadastra/vincula; academia lê só agregados). Sem rede.
// Rodar: node test/academias.test.cjs
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_CLIENT_ID = "cid"; process.env.MP_CLIENT_SECRET = "csecret"; process.env.MP_WEBHOOK_SECRET = "whsecret";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env-academias.cjs");
const { ctx, chamar } = E.carregarServidor();
const Acad = require("../server/lib/academias");

const U = {
  adm: { uid: "adm1", email: "adm@x.com", email_verified: true }, ac: { uid: "ac1", email: "dono@smart.com", email_verified: true },
  ana: { uid: "ana", email: "ana@x.com", email_verified: true }, leo: { uid: "leo", email: "leo@x.com", email_verified: true }, novo: { uid: "nv1", email: "novo@smart.com", email_verified: true }
};
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
const reset = () => { E.limpar(); Object.assign(E.tokens, U); E.claimsStore.adm1 = { role: "admin" }; E.clock.now = Date.now(); };
let n = 0; const ip = () => `10.1.0.${++n % 250}`;
const ok = (r, m = "") => assert.equal(r.status, 200, `${m} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, s, c) => { assert.equal(r.status, s, `esperado ${s}, veio ${r.status} ${JSON.stringify(r.json)}`); if (c) assert.equal(r.json.codigo, c); };
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const aula = (id, o) => set("aulas", id, { status: "concluida", data: hoje(), entrada: "07:00", saida: "08:00", foco: "Musculação", local: "Smart Fit Centro", personalUid: "p1", alunoUid: "ana", alunoNome: "Ana", personalNome: "Leo Silva", ...o });

const testes = []; const t = (nome, f) => testes.push([nome, f]);

t("lib: casa por apelido sem acento/caixa; apelido curto não casa; academiaId manda", () => {
  const ac = { id: "a1", nome: "Smart Fit Centro", aliases: ["SF", "Academia Músculo"] };
  assert.ok(Acad.aulaDaAcademia({ local: "smart fit CENTRO - Itapira" }, ac));
  assert.ok(Acad.aulaDaAcademia({ local: "Academia musculo da praça" }, ac));
  assert.ok(!Acad.aulaDaAcademia({ local: "Rua SF 123" }, ac), "apelido de 2 letras é ignorado");
  assert.ok(!Acad.aulaDaAcademia({ local: "Bluefit" }, ac));
  assert.ok(Acad.aulaDaAcademia({ local: "qualquer", academiaId: "a1" }, ac)); assert.ok(!Acad.aulaDaAcademia({ local: "Smart Fit Centro", academiaId: "outra" }, ac));
});
t("lib: agregação (aulas, personais distintos, picos) e nenhum dado pessoal na saída", () => {
  const d = "2026-11-02"; // segunda
  const aulas = [
    { status: "concluida", data: d, entrada: "07:00", foco: "Musculação", personalUid: "p1", local: "Smart Fit", alunoNome: "Ana Souza", alunoUid: "ana" },
    { status: "concluida", data: d, entrada: "07:30", foco: "Corrida", personalUid: "p2", local: "Smart Fit" },
    { status: "concluida", data: d, entrada: "18:00", foco: "Musculação", personalUid: "p1", local: "Smart Fit" },
    { status: "paga", data: d, entrada: "19:00", personalUid: "p3", local: "Smart Fit" }, { status: "cancelada", data: d, entrada: "07:00", local: "Smart Fit" },
    { status: "concluida", data: d, entrada: "07:00", personalUid: "p9", local: "Outra Academia" }
  ];
  const r = Acad.agregar(aulas, { id: "a1", nome: "Smart Fit", aliases: [] });
  assert.deepEqual(r.kpis, { aulasRealizadas: 3, aulasPagasAgendadas: 1, personaisAtivos: 2 });
  assert.equal(r.picos[0].faixa, "07h–08h"); assert.equal(r.picos[0].aulas, 2); assert.equal(r.diaPico, "Segunda");
  const txt = JSON.stringify(r); for (const proibido of ["Ana", "ana", "p1", "p2", "p3"]) assert.ok(!txt.includes(`"${proibido}"`) && !txt.includes(proibido + " "), proibido);
});
t("admin: cadastra academia, valida apelidos e só admin acessa", async () => {
  reset();
  falha(await chamar("POST", "/admin/academias", { token: "ana", body: { nome: "Smart Fit Centro" }, ip: ip() }), 403, "sem-permissao");
  falha(await chamar("POST", "/admin/academias", { token: "adm", body: { nome: "ab" }, ip: ip() }), 400);
  falha(await chamar("POST", "/admin/academias", { token: "adm", body: { nome: "Smart Fit Centro", aliases: ["sf"] }, ip: ip() }), 400);
  const r = await chamar("POST", "/admin/academias", { token: "adm", body: { nome: "Smart Fit Centro", cidade: "Itapira", aliases: ["Smart Fit"], ativo: false, uids: ["x"] }, ip: ip() }); ok(r);
  const a = await get("academias", r.json.id); assert.equal(a.ativo, true); assert.deepEqual(a.uids, [], "mass-assignment ignorado");
  const l = await chamar("GET", "/admin/academias", { token: "adm", ip: ip() }); ok(l); assert.equal(l.json.length, 1);
  ok(await chamar("PUT", `/admin/academias/${r.json.id}`, { token: "adm", body: { cidade: "Mogi Guaçu" }, ip: ip() })); assert.equal((await get("academias", r.json.id)).cidade, "Mogi Guaçu");
  const aud = (await chamar("GET", "/admin/auditoria", { token: "adm", ip: ip() })).json.map((x) => x.acao); assert.ok(aud.includes("admin.academia.criar") && aud.includes("admin.academia.editar"));
});
t("vínculo por e-mail: claim academia:true preserva as outras; exige login recente; remover retira só a claim", async () => {
  reset(); E.claimsStore.ac1 = { role: "personal", perfis: ["personal"], treinado: true };
  const id = (await chamar("POST", "/admin/academias", { token: "adm", body: { nome: "Smart Fit Centro", aliases: ["Smart Fit"] }, ip: ip() })).json.id;
  E.tokens.adm.auth_time = Math.floor(Date.now() / 1000) - 3600;
  falha(await chamar("POST", `/admin/academias/${id}/acesso`, { token: "adm", body: { email: "dono@smart.com" }, ip: ip() }), 401, "reautenticar");
  delete E.tokens.adm.auth_time;
  falha(await chamar("POST", `/admin/academias/${id}/acesso`, { token: "adm", body: { email: "nao-e-email" }, ip: ip() }), 400);
  const r = await chamar("POST", `/admin/academias/${id}/acesso`, { token: "adm", body: { email: "Dono@Smart.com" }, ip: ip() }); ok(r); assert.equal(r.json.acessos, 1);
  assert.deepEqual(E.claimsStore.ac1, { role: "personal", perfis: ["personal"], treinado: true, academia: true });
  assert.deepEqual((await get("academias", id)).uids, ["ac1"]);
  ok(await chamar("POST", `/admin/academias/${id}/acesso`, { token: "adm", body: { email: "dono@smart.com", remover: true }, ip: ip() }));
  assert.deepEqual(E.claimsStore.ac1, { role: "personal", perfis: ["personal"], treinado: true }); assert.deepEqual((await get("academias", id)).uids, []);
  falha(await chamar("GET", "/academia/painel", { token: "ac", ip: ip() }), 403, "sem-permissao");
});
t("painel: só quem tem a claim E está vinculado; devolve agregados do local certo, sem dados pessoais", async () => {
  reset();
  const id = (await chamar("POST", "/admin/academias", { token: "adm", body: { nome: "Smart Fit Centro", aliases: ["Smart Fit"] }, ip: ip() })).json.id;
  ok(await chamar("POST", `/admin/academias/${id}/acesso`, { token: "adm", body: { email: "dono@smart.com" }, ip: ip() }));
  await aula("a1", {}); await aula("a2", { entrada: "07:30", personalUid: "p2", alunoNome: "Bruno Lima" }); await aula("a3", { entrada: "18:00" });
  await aula("a4", { status: "paga", personalUid: "p3" }); await aula("a5", { status: "cancelada" }); await aula("a6", { local: "Outra Academia" });
  await aula("a7", { data: "2020-01-01" });
  falha(await chamar("GET", "/academia/painel", { ip: ip() }), 401);
  falha(await chamar("GET", "/academia/painel", { token: "ana", ip: ip() }), 403, "sem-permissao");
  E.claimsStore.leo = { academia: true }; falha(await chamar("GET", "/academia/painel", { token: "leo", ip: ip() }), 403, "sem-academia"); delete E.claimsStore.leo;
  const r = await chamar("GET", "/academia/painel?dias=30", { token: "ac", ip: ip() }); ok(r);
  assert.equal(r.json.academia.nome, "Smart Fit Centro"); assert.deepEqual(r.json.kpis, { aulasRealizadas: 3, aulasPagasAgendadas: 1, personaisAtivos: 2 });
  assert.equal(r.json.picos[0].faixa, "07h–08h");
  const txt = JSON.stringify(r.json); for (const p of ["Bruno", "Ana", "Leo Silva", "ana@x.com", "alunoUid", "personalUid"]) assert.ok(!txt.includes(p), "vazou " + p);
  falha(await chamar("GET", "/academia/painel?dias=999", { token: "ac", ip: ip() }), 400);
  falha(await chamar("GET", "/academia/painel?id=outra", { token: "ac", ip: ip() }), 404);
  assert.equal(r.h["Cache-Control"], "no-store");
});
t("somente leitura: academia não escreve em /admin nem em nada", async () => {
  reset(); E.claimsStore.ac1 = { academia: true };
  for (const [m, p] of [["POST", "/admin/academias"], ["GET", "/admin/academias"], ["PUT", "/admin/academias/x"], ["POST", "/admin/academias/x/acesso"]]) falha(await chamar(m, p, { token: "ac", body: { nome: "Hack Academia" }, ip: ip() }), 403, "sem-permissao");
});
t("convite: e-mail sem conta vira convite e é ativado no primeiro acesso (e-mail verificado)", async () => {
  reset(); delete E.tokens.novo;
  const id = (await chamar("POST", "/admin/academias", { token: "adm", body: { nome: "Bluefit Norte", aliases: ["Bluefit"] }, ip: ip() })).json.id;
  const r = await chamar("POST", `/admin/academias/${id}/acesso`, { token: "adm", body: { email: "novo@smart.com" }, ip: ip() }); ok(r); assert.equal(r.json.pendente, true);
  Object.assign(E.tokens, { novo: U.novo });
  falha(await chamar("POST", "/academia/reivindicar", { token: "ana", ip: ip() }), 404, "sem-convite");
  const q = await chamar("POST", "/academia/reivindicar", { token: "novo", ip: ip() }); ok(q); assert.equal(q.json.atualizarToken, true);
  assert.equal(E.claimsStore.nv1.academia, true); const a = await get("academias", id); assert.deepEqual(a.uids, ["nv1"]); assert.deepEqual(a.convites, []);
  ok(await chamar("GET", "/academia/painel", { token: "novo", ip: ip() }));
  falha(await chamar("POST", "/academia/reivindicar", { token: "novo", ip: ip() }), 404, "sem-convite");
});
t("academia desativada deixa de enxergar o painel", async () => {
  reset();
  const id = (await chamar("POST", "/admin/academias", { token: "adm", body: { nome: "Smart Fit Centro" }, ip: ip() })).json.id;
  ok(await chamar("POST", `/admin/academias/${id}/acesso`, { token: "adm", body: { email: "dono@smart.com" }, ip: ip() }));
  ok(await chamar("GET", "/academia/painel", { token: "ac", ip: ip() }));
  ok(await chamar("PUT", `/admin/academias/${id}`, { token: "adm", body: { ativo: false }, ip: ip() }));
  falha(await chamar("GET", "/academia/painel", { token: "ac", ip: ip() }), 403, "sem-academia");
});

(async () => {
  let f = 0;
  for (const [nome, fn] of testes) { try { await fn(); console.log("  ✓", nome); } catch (e) { f++; console.log("  ✗", nome, "\n   ", e.message); } }
  if (f) { console.log(`\n❌ ${f} falha(s)`); process.exit(1); }
  console.log(`\n✅ academias: ${testes.length} testes passaram`);
})();
