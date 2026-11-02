// Bateria do módulo de TI: RBAC, operadores (senha, exclusão lógica, último gestor), trilha de auditoria (hash encadeado),
// chamados (máquina de estados, SLA, IDOR), métricas agregadas, ranking e presença online. Sem rede (ver fake-env.cjs).
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { ctx, chamar } = E.carregarServidor();
const { ti } = ctx;
const SENHA = "Cavalo-Bateria-Grampo-42";

/** Prepara operadores semeados direto no banco (equivale ao script de bootstrap). */
const U = {
  gest: { uid: "ti-gest", email: "gestora@personow.ti", email_verified: true }, gest2: { uid: "ti-gest2", email: "gestor2@personow.ti", email_verified: true },
  tec1: { uid: "ti-tec1", email: "ana@personow.ti", email_verified: true }, tec2: { uid: "ti-tec2", email: "bruno@personow.ti", email_verified: true },
  alunoA: { uid: "alunoA", email: "a@x.com", email_verified: true }, alunoB: { uid: "alunoB", email: "b@x.com", email_verified: true }, prom1: { uid: "prom1", email: "p@x.com", email_verified: true }, adm: { uid: "adm1", email: "adm@x.com", email_verified: true },
  semPapel: { uid: "sem", email: "s@x.com", email_verified: true }
};
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
const todos = async (col) => (await ctx.db.collection(col).get()).docs.map((d) => d.data());
async function operador(chave, nivel, extra = {}) {
  const u = U[chave]; E.claimsStore[u.uid] = { role: "ti", perfis: ["ti"], tiNivel: nivel };
  await set("ti_operadores", u.uid, { uid: u.uid, nome: { gest: "Gestora Gil", gest2: "Gestor Dois", tec1: "Ana Técnica", tec2: "Bruno Técnico" }[chave], email: u.email, nivel, status: "ativo", trocarSenha: false, criadoEm: new E.Timestamp(Date.now()), ...extra });
}
function reset() {
  E.limpar(); Object.assign(E.tokens, U);
  E.claimsStore.alunoA = { role: "aluno" }; E.claimsStore.alunoB = { role: "aluno" }; E.claimsStore.prom1 = { role: "personal", treinado: false }; E.claimsStore.adm1 = { role: "admin" };
  E.clock.now = Date.now(); ctx.__reset();
}
const ok = (r, msg = "") => assert.equal(r.status, 200, `${msg} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
const novoChamado = async (token = "alunoA", over = {}) => { const r = await chamar("POST", "/chamados", { token, body: { titulo: "Pix não confirma", descricao: "Paguei e a aula continua aberto.", categoria: "pagamento", urgencia: "alta", ...over } }); ok(r, "abrir chamado"); return r.json; };
const MIN = 60_000;

const testes = []; const t = (nome, fn) => testes.push([nome, fn]);

// ======================= acesso (RBAC) =======================
t("RBAC: só operador de TI ativo entra; aluno/personal/admin/sem papel/sem login são barrados; nível limita a ação", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  for (const tk of ["alunoA", "prom1", "adm", "semPapel"]) { falha(await chamar("GET", "/ti/operadores", { token: tk }), 403, "sem-permissao"); falha(await chamar("GET", "/ti/dashboard", { token: tk }), 403, "sem-permissao"); }
  falha(await chamar("GET", "/ti/dashboard", {}), 401, "nao-autenticado");
  ok(await chamar("GET", "/ti/dashboard", { token: "gest" })); ok(await chamar("GET", "/ti/dashboard", { token: "tec1" }));
  // técnico não gerencia operadores nem vê toda a auditoria / verificação
  falha(await chamar("POST", "/ti/operadores", { token: "tec1", body: { nome: "Fulano de Tal", email: "f@personow.ti", nivel: "tecnico" } }), 403, "sem-permissao");
  falha(await chamar("GET", "/ti/auditoria/verificar", { token: "tec1" }), 403, "sem-permissao");
  falha(await chamar("GET", "/ti/auditoria/exportar", { token: "tec1" }), 403, "sem-permissao");
  const lista = await chamar("GET", "/ti/operadores", { token: "tec1" }); ok(lista);
  assert.ok(lista.json.length === 2 && lista.json.every((o) => !("email" in o)), "técnico só vê nome/nível, sem e-mail");
  // a recusa do técnico ficou registrada na trilha
  const aud = (await todos("ti_auditoria")).filter((a) => a.resultado === "negado" && a.operadorUid === "ti-tec1");
  assert.ok(aud.length >= 2, "acessos negados auditados");
});
t("operador excluído/desativado perde o acesso na hora, mesmo com token ainda válido", async () => {
  await operador("tec1", "tecnico", { status: "excluido" });
  falha(await chamar("GET", "/ti/dashboard", { token: "tec1" }), 403, "operador-inativo");
});
t("conta de TI não consegue virar aluno/personal (cadastro/sessão do app comercial)", async () => {
  await operador("gest", "gestor");
  falha(await chamar("POST", "/sessao", { token: "gest", body: { portal: "aluno" } }), 403, "conta-ti");
  falha(await chamar("POST", "/cadastro/aluno", { token: "gest", body: { termos: true } }), 403, "conta-ti");
  falha(await chamar("POST", "/cadastro/personal", { token: "gest", body: { termos: true } }), 403, "conta-ti");
  assert.equal(E.claimsStore["ti-gest"].role, "ti", "claim intacta");
});

// ======================= operadores =======================
t("operadores: cadastro valida, gera senha temporária, claim role=ti, duplicado 409, exige login recente", async () => {
  await operador("gest", "gestor");
  const base = { nome: "Carla Suporte", email: "Carla@Personow.TI", nivel: "tecnico" };
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: { ...base, senha: "curta" } }), 400, "senha-fraca");
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: { ...base, senha: "carla@personow-2026X" } }), 400, "senha-fraca");   // contém o e-mail
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: { ...base, nivel: "root" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: { ...base, email: { $ne: 1 } } }), 400, "dados-invalidos");
  E.tokens.gest = { ...U.gest, auth_time: Math.floor(Date.now() / 1000) - 3600 };
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: base }), 401, "reautenticar");
  E.tokens.gest = U.gest;
  const r = await chamar("POST", "/ti/operadores", { token: "gest", body: base }); ok(r);
  assert.equal(r.json.operador.email, "carla@personow.ti"); assert.equal(r.json.operador.trocarSenha, true); assert.ok(r.json.senhaTemporaria.length >= 12);
  const uid = r.json.operador.uid; assert.deepEqual({ role: E.claimsStore[uid].role, nivel: E.claimsStore[uid].tiNivel }, { role: "ti", nivel: "tecnico" });
  assert.equal(E.contas.get(uid).password, r.json.senhaTemporaria); assert.equal(E.contas.get(uid).emailVerified, true);
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: base }), 409, "email-em-uso");
  assert.ok(!JSON.stringify(await get("ti_operadores", uid)).includes(r.json.senhaTemporaria), "senha nunca persistida no Firestore");
});
t("senha temporária: tudo bloqueado (trocar-senha) até o operador definir a sua; troca revoga sessões e limpa a flag", async () => {
  await operador("gest", "gestor");
  const c = await chamar("POST", "/ti/operadores", { token: "gest", body: { nome: "Carla Suporte", email: "carla@personow.ti", nivel: "tecnico" } }); ok(c);
  const uid = c.json.operador.uid; E.tokens.carla = { uid, email: "carla@personow.ti", email_verified: true };
  falha(await chamar("GET", "/ti/dashboard", { token: "carla" }), 403, "trocar-senha");
  const s = await chamar("POST", "/ti/sessao", { token: "carla" }); ok(s); assert.equal(s.json.operador.trocarSenha, true);       // sessão/sair/senha continuam liberadas
  falha(await chamar("POST", "/ti/eu/senha", { token: "carla", body: { senhaNova: "fraca" } }), 400, "senha-fraca");
  falha(await chamar("POST", "/ti/eu/senha", { token: "carla", body: { senhaNova: "carla-personow-Forte9" } }), 400, "senha-fraca");  // contém parte do e-mail
  const ok1 = await chamar("POST", "/ti/eu/senha", { token: "carla", body: { senhaNova: SENHA } }); ok(ok1); assert.equal(ok1.json.relogin, true);
  assert.equal(E.contas.get(uid).password, SENHA); assert.ok(E.revogados.has(uid), "sessões revogadas");
  assert.equal((await get("ti_operadores", uid)).trocarSenha, false);
  E.revogados.delete(uid); ok(await chamar("GET", "/ti/dashboard", { token: "carla" }));
});
t("reset de senha por gestor: temporária, revoga sessões, obriga troca; não vale para si mesmo; técnico não pode", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  falha(await chamar("POST", "/ti/operadores/ti-tec1/senha", { token: "tec1" }), 403, "sem-permissao");
  falha(await chamar("POST", "/ti/operadores/ti-gest/senha", { token: "gest" }), 409, "proprio-usuario");
  E.contas.set("ti-tec1", { uid: "ti-tec1", email: "ana@personow.ti" });
  falha(await chamar("POST", "/ti/operadores/ti-tec1/senha", { token: "gest" }), 400, "dados-invalidos");   // motivo obrigatório (e não pede mais a senha atual)
  const r = await chamar("POST", "/ti/operadores/ti-tec1/senha", { token: "gest", body: { motivo: "Esqueceu a senha" } }); ok(r);
  assert.equal(E.contas.get("ti-tec1").password, r.json.senhaTemporaria); assert.ok(E.revogados.has("ti-tec1")); assert.equal((await get("ti_operadores", "ti-tec1")).trocarSenha, true);
  falha(await chamar("POST", "/ti/operadores/nao-existe/senha", { token: "gest", body: { motivo: "Esqueceu a senha" } }), 404, "nao-encontrado");
});
t("exclusão lógica: parceiro, desativa login, revoga sessões, devolve chamados à fila; mantém o registro; restaurar reativa com senha nova", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  E.contas.set("ti-tec1", { uid: "ti-tec1", email: "ana@personow.ti" });
  const c = await novoChamado(); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec1" }));
  falha(await chamar("POST", "/ti/operadores/ti-tec1/excluir", { token: "gest", body: {} }), 400, "dados-invalidos");   // motivo obrigatório
  const r = await chamar("POST", "/ti/operadores/ti-tec1/excluir", { token: "gest", body: { motivo: "Desligamento da empresa" } }); ok(r);
  assert.equal(r.json.chamadosDevolvidos, 1);
  const d = await get("ti_operadores", "ti-tec1"); assert.equal(d.status, "excluido"); assert.equal(d.motivoExclusao, "Desligamento da empresa"); assert.equal(d.excluidoPor, "ti-gest");
  assert.equal(E.contas.get("ti-tec1").disabled, true); assert.ok(E.revogados.has("ti-tec1"));
  falha(await chamar("GET", "/ti/dashboard", { token: "tec1" }), 401, "sessao-invalida");     // token revogado
  const ch = await chamar("GET", `/ti/chamados/${c.id}`, { token: "gest" }); assert.equal(ch.json.status, "aberto"); assert.equal(ch.json.atribuidoUid, "");
  assert.equal((await chamar("GET", "/ti/operadores", { token: "gest" })).json.length, 1);
  assert.equal((await chamar("GET", "/ti/operadores?status=excluido", { token: "gest" })).json.length, 1);
  falha(await chamar("POST", "/ti/operadores/ti-tec1/excluir", { token: "gest", body: { motivo: "de novo, para teste" } }), 409, "operador-excluido");
  const rest = await chamar("POST", "/ti/operadores/ti-tec1/restaurar", { token: "gest" }); ok(rest);
  assert.equal(E.contas.get("ti-tec1").disabled, false); assert.equal(E.contas.get("ti-tec1").password, rest.json.senhaTemporaria); assert.equal((await get("ti_operadores", "ti-tec1")).trocarSenha, true);
  falha(await chamar("POST", "/ti/operadores/ti-tec1/restaurar", { token: "gest" }), 409, "nao-excluido");
});
t("proteções: não exclui a si mesmo, não rebaixa a si mesmo, nunca deixa a TI sem gestor ativo (nem em aulas simultâneos)", async () => {
  await operador("gest", "gestor"); await operador("gest2", "gestor");
  for (const k of ["gest", "gest2"]) E.contas.set(U[k].uid, { uid: U[k].uid, email: U[k].email });
  falha(await chamar("POST", "/ti/operadores/ti-gest/excluir", { token: "gest", body: { motivo: "teste de proteção" } }), 409, "proprio-usuario");
  falha(await chamar("PUT", "/ti/operadores/ti-gest/nivel", { token: "gest", body: { nivel: "tecnico" } }), 409, "proprio-usuario");
  // dois gestores tentam se remover ao mesmo tempo: exatamente um consegue; sempre sobra um gestor ativo
  const [x, y] = await Promise.all([chamar("POST", "/ti/operadores/ti-gest2/excluir", { token: "gest", body: { motivo: "remoção cruzada A" } }), chamar("POST", "/ti/operadores/ti-gest/excluir", { token: "gest2", body: { motivo: "remoção cruzada B" } })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.equal((await ti.operadores.listar()).filter((o) => o.nivel === "gestor").length, 1);
  const barrado = x.status === 409 ? x : y; assert.equal(barrado.json.codigo, "ultimo-gestor");
});
t("alterar nível: atualiza claim e revoga sessões; técnico rebaixado perde permissões na hora", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  ok(await chamar("PUT", "/ti/operadores/ti-tec1/nivel", { token: "gest", body: { nivel: "gestor" } }));
  assert.equal(E.claimsStore["ti-tec1"].tiNivel, "gestor"); assert.ok(E.revogados.has("ti-tec1")); E.revogados.delete("ti-tec1");
  ok(await chamar("GET", "/ti/operadores", { token: "tec1" }));
  falha(await chamar("PUT", "/ti/operadores/ti-tec1/nivel", { token: "gest", body: { nivel: "chefe" } }), 400, "dados-invalidos");
});

// ======================= auditoria =======================
t("auditoria: toda ação fica registrada com quem/o quê/antes→depois/IP, SEM senhas; cadeia de hash íntegra", async () => {
  await operador("gest", "gestor");
  const c = await chamar("POST", "/ti/operadores", { token: "gest", body: { nome: "Carla Suporte", email: "carla@personow.ti", nivel: "tecnico", senha: SENHA }, ip: "10.1.2.3", headers: { "user-agent": "Teste/1.0" } }); ok(c);
  const uid = c.json.operador.uid; ok(await chamar("PUT", `/ti/operadores/${uid}/nivel`, { token: "gest", body: { nivel: "gestor" } }));
  const regs = (await todos("ti_auditoria")).sort((a, b) => a.seq - b.seq);
  assert.deepEqual(regs.map((r) => r.acao), ["operador.criar", "operador.nivel"]);
  const [criar, nivel] = regs;
  assert.equal(criar.operadorUid, "ti-gest"); assert.equal(criar.ip, "10.1.2.3"); assert.equal(criar.ua, "Teste/1.0"); assert.equal(criar.alvoId, uid); assert.equal(criar.resultado, "ok");
  assert.deepEqual(nivel.antes, { nivel: "tecnico" }); assert.deepEqual(nivel.depois, { nivel: "gestor" });
  assert.ok(!JSON.stringify(regs).includes(SENHA), "senha em claro nunca vai para a trilha");
  const v = await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }); ok(v); assert.equal(v.json.ok, true); assert.ok(v.json.verificados >= 2);
});
t("auditoria: adulterar, apagar ou reordenar um registro quebra a cadeia e a verificação acusa", async () => {
  await operador("gest", "gestor");
  for (let i = 0; i < 4; i++) await ti.auditoria.registrar({ uid: "ti-gest", nome: "G", nivel: "gestor", ip: "1.1.1.1" }, { acao: "teste.evento", resumo: "evento " + i });
  ok(await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }));
  const k = "ti_auditoria/0000000002", original = JSON.parse(JSON.stringify(E.store.get(k)));
  E.store.get(k).resumo = "adulterado";
  let v = await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }); assert.equal(v.json.ok, false); assert.ok(v.json.problemas.some((p) => p.seq === 2 && p.problema === "conteudo-alterado"));
  E.store.set(k, original); assert.equal((await chamar("GET", "/ti/auditoria/verificar", { token: "gest" })).json.ok, true);
  E.store.delete("ti_auditoria/0000000003");
  v = await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }); assert.equal(v.json.ok, false); assert.ok(v.json.problemas.some((p) => /buraco|encadeamento/.test(p.problema)));
});
t("auditoria: gravações simultâneas não repetem nem pulam número de sequência", async () => {
  await Promise.all(Array.from({ length: 25 }, (_, i) => ti.auditoria.registrar({ uid: "x" + (i % 3), nome: "N", nivel: "tecnico" }, { acao: "teste.paralelo", resumo: String(i) })));
  const seqs = (await todos("ti_auditoria")).map((r) => r.seq).sort((a, b) => a - b); assert.deepEqual(seqs, Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal((await ti.auditoria.verificar()).ok, true);
});
t("auditoria: filtros (operador, ação, alvo, período), paginação por cursor; técnico só enxerga o que ele próprio fez", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  const c1 = await novoChamado(), c2 = await novoChamado("alunoB");
  ok(await chamar("POST", `/ti/chamados/${c1.id}/assumir`, { token: "tec1" })); E.avancar(2 * MIN);
  ok(await chamar("POST", `/ti/chamados/${c2.id}/assumir`, { token: "gest" })); E.avancar(2 * MIN);
  ok(await chamar("POST", `/ti/chamados/${c2.id}/comentarios`, { token: "gest", body: { texto: "Verificando o gateway" } }));
  const g = await chamar("GET", "/ti/auditoria", { token: "gest" }); ok(g); assert.ok(g.json.itens.length >= 3);
  assert.ok(g.json.itens.every((a, i, v) => i === 0 || a.seq < v[i - 1].seq), "mais recentes primeiro");
  assert.equal((await chamar("GET", "/ti/auditoria?operador=ti-tec1", { token: "gest" })).json.itens.every((a) => a.operadorUid === "ti-tec1"), true);
  assert.equal((await chamar("GET", "/ti/auditoria?acao=chamado.comentar", { token: "gest" })).json.itens.length, 1);
  assert.equal((await chamar("GET", `/ti/auditoria?alvo=${c1.id}`, { token: "gest" })).json.itens.length, 1);
  const p1 = await chamar("GET", "/ti/auditoria?limite=2", { token: "gest" }); assert.equal(p1.json.itens.length, 2); assert.ok(p1.json.proximo);
  const p2 = await chamar("GET", `/ti/auditoria?limite=50&cursor=${p1.json.proximo}`, { token: "gest" }); assert.ok(p2.json.itens.every((a) => a.seq < p1.json.itens[1].seq));
  const hoje = new Date(Date.now()).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  assert.ok((await chamar("GET", `/ti/auditoria?de=${hoje}&ate=${hoje}`, { token: "gest" })).json.itens.length >= 3);
  assert.equal((await chamar("GET", "/ti/auditoria?de=2001-01-01&ate=2001-01-02", { token: "gest" })).json.itens.length, 0);
  falha(await chamar("GET", "/ti/auditoria?de=2026-02-31", { token: "gest" }), 400, "dados-invalidos");
  falha(await chamar("GET", "/ti/auditoria?cursor=abc", { token: "gest" }), 400, "dados-invalidos");
  const meu = await chamar("GET", "/ti/auditoria?operador=ti-gest", { token: "tec1" }); ok(meu);        // técnico tentando ver a gestora: o filtro é ignorado
  assert.ok(meu.json.itens.length > 0 && meu.json.itens.every((a) => a.operadorUid === "ti-tec1"));
});
t("auditoria: exportação CSV (BOM, ; e neutralização de fórmula) e a própria exportação/consulta ficam registradas", async () => {
  await operador("gest", "gestor");
  await ti.auditoria.registrar({ uid: "ti-gest", nome: "=HYPERLINK(\"http://x\")", nivel: "gestor" }, { acao: "teste.csv", resumo: "linha; com ponto-e-vírgula" });
  const r = await chamar("GET", "/ti/auditoria/exportar", { token: "gest" }); ok(r);
  assert.ok(r.texto.startsWith("﻿Seq;Data/hora;Operador")); assert.ok(r.texto.includes("'=HYPERLINK"), "fórmula neutralizada: " + JSON.stringify(r.texto).slice(0, 600)); assert.ok(r.texto.includes('"linha; com ponto-e-vírgula"'));
  assert.ok((await todos("ti_auditoria")).some((a) => a.acao === "auditoria.exportar"));
});
t("auditoria: tentativa recusada por regra (ex.: excluir o último gestor) também é registrada, com o motivo", async () => {
  await operador("gest", "gestor"); await operador("gest2", "gestor", { status: "excluido" });
  falha(await chamar("POST", "/ti/operadores/ti-gest/excluir", { token: "gest", body: { motivo: "teste de recusa" } }), 409, "proprio-usuario");
  const a = (await todos("ti_auditoria")).find((x) => x.acao === "operador.excluir"); assert.equal(a.resultado, "erro"); assert.equal(a.meta.codigo, "proprio-usuario");
});

// ======================= chamados =======================
t("chamado do usuário: protocolo sequencial, urgência crítica proibida, limite por hora, só o dono vê (IDOR → 404)", async () => {
  const c1 = await novoChamado(); assert.equal(c1.protocolo, "TI-000001"); assert.equal(c1.status, "aberto");
  falha(await chamar("POST", "/chamados", { token: "alunoA", body: { titulo: "Quero crítica", descricao: "tentando forçar prioridade", urgencia: "critica" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/chamados", { token: "alunoA", body: { titulo: "ab", descricao: "curto" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/chamados", { token: "alunoA", body: { titulo: { $gt: "" }, descricao: "descrição qualquer" } }), 400, "dados-invalidos");
  const c2 = await novoChamado("prom1", { urgencia: "baixa" }); assert.equal(c2.protocolo, "TI-000002");
  const d = await get("chamados_ti", c1.id); assert.equal(d.prioridade, "alta"); assert.equal(d.solicitanteUid, "alunoA"); assert.equal(d.slaAtendMs - d.criadoMs, 60 * MIN);
  assert.equal((await chamar("GET", "/chamados/meus", { token: "alunoA" })).json.length, 1);
  ok(await chamar("GET", `/chamados/${c1.id}`, { token: "alunoA" })); falha(await chamar("GET", `/chamados/${c1.id}`, { token: "alunoB" }), 404, "nao-encontrado");
  falha(await chamar("POST", `/chamados/${c1.id}/responder`, { token: "alunoB", body: { texto: "invasor" } }), 404, "nao-encontrado");
  falha(await chamar("GET", "/chamados/meus", { token: "semPapel" }), 403); falha(await chamar("GET", "/chamados/meus", {}), 401);
  for (let i = 0; i < 3; i++) await novoChamado("alunoB"); await novoChamado("alunoB"); await novoChamado("alunoB");
  falha(await chamar("POST", "/chamados", { token: "alunoB", body: { titulo: "Sexto chamado", descricao: "passou do limite por hora" } }), 429, "limite-requisicoes");
});
t("fila da equipe: mais urgentes primeiro; filtros; assumir (1 só vence); técnico não mexe no chamado do colega; gestor pode", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico"); await operador("tec2", "tecnico");
  const baixa = await novoChamado("alunoA", { urgencia: "baixa" }); E.avancar(MIN); const alta = await novoChamado("alunoB", { urgencia: "alta" });
  const fila = await chamar("GET", "/ti/chamados", { token: "tec1" }); ok(fila); assert.deepEqual(fila.json.itens.map((c) => c.id), [alta.id, baixa.id]);
  assert.equal((await chamar("GET", "/ti/chamados?prioridade=baixa", { token: "tec1" })).json.itens.length, 1);
  assert.equal((await chamar("GET", `/ti/chamados?q=${alta.protocolo}`, { token: "tec1" })).json.itens.length, 1);
  assert.equal((await chamar("GET", "/ti/chamados?atribuido=nenhum", { token: "tec1" })).json.itens.length, 2);
  const [a, b] = await Promise.all([chamar("POST", `/ti/chamados/${alta.id}/assumir`, { token: "tec1" }), chamar("POST", `/ti/chamados/${alta.id}/assumir`, { token: "tec2" })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], "assumir simultâneo: um vence"); assert.equal((a.status === 409 ? a : b).json.codigo, "ja-atribuido");
  const dono = a.status === 200 ? "tec1" : "tec2", outro = dono === "tec1" ? "tec2" : "tec1";
  falha(await chamar("POST", `/ti/chamados/${alta.id}/status`, { token: outro, body: { status: "resolvido", nota: "tentando roubar" } }), 403, "nao-e-seu");
  falha(await chamar("POST", `/ti/chamados/${baixa.id}/status`, { token: dono, body: { status: "resolvido", nota: "sem assumir antes" } }), 409);
  falha(await chamar("POST", `/ti/chamados/${alta.id}/atribuir`, { token: dono, body: { operadorUid: "ti-gest" } }), 403, "sem-permissao");   // só gestor encaminha
  ok(await chamar("POST", `/ti/chamados/${alta.id}/atribuir`, { token: "gest", body: { operadorUid: U[outro].uid } }));
  assert.equal((await get("chamados_ti", alta.id)).atribuidoUid, U[outro].uid);
  falha(await chamar("POST", `/ti/chamados/${alta.id}/atribuir`, { token: "gest", body: { operadorUid: "fantasma" } }), 404, "nao-encontrado");
});
t("ciclo completo + métricas: TMA/TMR corretos, tempo 'aguardando usuário' não conta, SLA, linha do tempo, notas internas ocultas ao usuário", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  const c = await novoChamado("alunoA", { urgencia: "alta" });             // SLA alta: 1 h para atender, 8 h para resolver
  E.avancar(10 * MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec1" }));                    // TMA = 10 min
  ok(await chamar("POST", `/ti/chamados/${c.id}/comentarios`, { token: "tec1", body: { texto: "Suspeita: webhook atrasado (interno)", interno: true } }));
  ok(await chamar("POST", `/ti/chamados/${c.id}/comentarios`, { token: "tec1", body: { texto: "Pode me enviar o comprovante?", interno: false } }));
  ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "aguardando_usuario", nota: "Aguardando comprovante" } }));
  E.avancar(120 * MIN);                                                                                                 // 2 h esperando o usuário
  const r = await chamar("POST", `/chamados/${c.id}/responder`, { token: "alunoA", body: { texto: "Segue o comprovante." } }); ok(r); assert.equal(r.json.status, "em_atendimento");
  E.avancar(20 * MIN);
  falha(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "resolvido" } }), 400, "dados-invalidos");     // resolver exige nota
  ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "resolvido", nota: "Webhook reprocessado; aula liberada." } }));
  const t1 = await get("chamados_ti", c.id); assert.equal(t1.status, "resolvido"); assert.equal(t1.tempoAtendSeg, 600);
  assert.equal(t1.tempoResolSeg, (10 + 120 + 20) * 60 - 120 * 60, "resolução líquida = total − tempo aguardando usuário"); assert.equal(t1.pausadoSeg, 7200);
  falha(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "aguardando_usuario" } }), 409, "transicao-invalida");
  falha(await chamar("POST", `/chamados/${c.id}/responder`, { token: "alunoA", body: { texto: "mais uma" } }), 409, "estado-invalido");
  const vis = await chamar("GET", `/chamados/${c.id}`, { token: "alunoA" }); ok(vis);
  assert.ok(!JSON.stringify(vis.json).includes("interno"), "nota interna não chega ao usuário"); assert.ok(vis.json.eventos.some((e) => e.texto === "Pode me enviar o comprovante?")); assert.equal(vis.json.resolucao, "Webhook reprocessado; aula liberada.");
  assert.ok(!("atribuidoUid" in vis.json) && !("slaAtendEm" in vis.json), "usuário não vê dados internos");
  const full = await chamar("GET", `/ti/chamados/${c.id}`, { token: "gest" }); assert.ok(full.json.eventos.some((e) => e.interno && /webhook atrasado/.test(e.texto)));
  assert.deepEqual(full.json.eventos.map((e) => e.tipo), ["criado", "assumido", "comentario", "comentario", "status", "comentario", "status"]);
  const d = await chamar("GET", "/ti/dashboard?dias=7", { token: "gest" }); ok(d);
  assert.equal(d.json.periodo.criados, 1); assert.equal(d.json.periodo.resolvidos, 1); assert.equal(d.json.periodo.tmaSeg, 600); assert.equal(d.json.periodo.tmrSeg, 1800);
  assert.equal(d.json.periodo.slaAtendimentoPct, 100); assert.equal(d.json.periodo.slaResolucaoPct, 100);
  assert.deepEqual(d.json.ranking.map((r) => [r.nome, r.resolvidos, r.assumidos, r.tmaSeg]), [["Ana Técnica", 1, 1, 600]]);
  assert.equal(d.json.fila.totalAbertos, 0);
});
t("SLA estourado aparece como fora do prazo; reabrir um resolvido reinicia a resolução e conta a reabertura", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  const c = await novoChamado("alunoA", { urgencia: "alta" });
  E.avancar(61 * MIN);
  let d = await chamar("GET", "/ti/dashboard", { token: "gest" }); assert.equal(d.json.fila.aberto, 1); assert.equal(d.json.fila.foraDoPrazo, 1, "sem atendimento além de 1 h");
  ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec1" }));
  ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "resolvido", nota: "Resolvido com atraso." } }));
  d = await chamar("GET", "/ti/dashboard", { token: "gest" }); assert.equal(d.json.periodo.slaAtendimentoPct, 0, "atendeu depois do prazo");
  ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "em_atendimento", nota: "Voltou a falhar" } }));
  const x = await get("chamados_ti", c.id); assert.equal(x.reaberturas, 1); assert.equal(x.status, "em_atendimento"); assert.equal(x.resolvidoMs, null);
  ok(await chamar("PUT", `/ti/chamados/${c.id}/prioridade`, { token: "tec1", body: { prioridade: "critica" } }));
  assert.equal((await get("chamados_ti", c.id)).prioridade, "critica"); falha(await chamar("PUT", `/ti/chamados/${c.id}/prioridade`, { token: "tec1", body: { prioridade: "critica" } }), 409, "sem-mudanca");
});
t("ranking: ordena por resolvidos (depois assumidos); período filtra; ignora dias fora da janela", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico"); await operador("tec2", "tecnico");
  const fechar = async (tok, n) => { for (let i = 0; i < n; i++) { const c = await novoChamado(i % 2 ? "alunoA" : "alunoB", { titulo: `Chamado ${tok} ${i}`.padEnd(8, "x") }); E.avancar(MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: tok })); E.avancar(MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: tok, body: { status: "resolvido", nota: "Feito e conferido." } })); } };
  ctx.__reset(); await fechar("tec2", 2); ctx.__reset(); await fechar("tec1", 3);
  ctx.__reset(); const c = await novoChamado("alunoA"); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec2" }));    // tec2: +1 assumido (não resolvido)
  const d = await chamar("GET", "/ti/dashboard?dias=7", { token: "gest" }); ok(d);
  assert.deepEqual(d.json.ranking.map((r) => [r.posicao, r.nome, r.resolvidos, r.assumidos]), [[1, "Ana Técnica", 3, 3], [2, "Bruno Técnico", 2, 3]]);
  assert.equal(d.json.periodo.serie.length, 7); assert.equal(d.json.periodo.resolvidos, 5);
  E.avancar(10 * 86_400_000); ctx.__reset();
  assert.equal((await chamar("GET", "/ti/dashboard?dias=7", { token: "gest" })).json.ranking.length, 0, "tudo ficou fora dos 7 dias");
  assert.equal((await chamar("GET", "/ti/dashboard?dias=30", { token: "gest" })).json.ranking.length, 2);
  assert.equal((await chamar("GET", "/ti/dashboard?dias=999", { token: "gest" })).json.periodo.dias, 7, "período inválido cai no padrão");
});
t("chamado aberto por operador em nome de alguém; transições inválidas e cancelamento; paginação dos resolvidos", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  const r = await chamar("POST", "/ti/chamados", { token: "tec1", body: { titulo: "Impressora do aluno X", descricao: "Cliente ligou: não imprime nota.", categoria: "infra", prioridade: "critica", solicitanteNome: "Dona Maria (telefone)" } }); ok(r);
  assert.equal(r.json.origem, "ti"); assert.equal(r.json.solicitante.tipo, "externo");
  falha(await chamar("POST", "/ti/chamados", { token: "tec1", body: { titulo: "Sem solicitante", descricao: "faltou informar quem pediu" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/ti/chamados", { token: "tec1", body: { titulo: "Usuário fantasma", descricao: "uid inexistente", solicitanteNome: "Xavier", solicitanteUid: "ninguem" } }), 404, "nao-encontrado");
  falha(await chamar("POST", `/ti/chamados/${r.json.id}/status`, { token: "tec1", body: { status: "resolvido", nota: "pulou etapas" } }), 409);
  ok(await chamar("POST", `/ti/chamados/${r.json.id}/status`, { token: "gest", body: { status: "cancelado", nota: "Duplicado do TI-000009" } }));
  falha(await chamar("POST", `/ti/chamados/${r.json.id}/assumir`, { token: "tec1" }), 409);
  falha(await chamar("GET", "/ti/chamados/a..b", { token: "tec1" }), 400, "dados-invalidos");
  falha(await chamar("GET", "/ti/chamados?visao=tudo", { token: "tec1" }), 400, "dados-invalidos");
  for (let i = 0; i < 3; i++) { const c = await novoChamado(); E.avancar(MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec1" })); E.avancar(MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "resolvido", nota: "Ok conferido" } })); }
  const p1 = await chamar("GET", "/ti/chamados?visao=resolvidos&limite=2", { token: "tec1" }); ok(p1); assert.equal(p1.json.itens.length, 2); assert.ok(p1.json.proximo);
  const p2 = await chamar("GET", `/ti/chamados?visao=resolvidos&limite=2&cursor=${p1.json.proximo}`, { token: "tec1" }); assert.equal(p2.json.itens.length, 1); assert.equal(p2.json.proximo, null);
});

// ======================= presença / tempo real =======================
t("presença: conta quem pingou nos últimos 75 s, separa por tipo, expira, ignora ping rápido e sem papel; 1 usuário = 1", async () => {
  await operador("gest", "gestor");
  for (const tk of ["alunoA", "alunoB", "prom1", "adm", "gest"]) ok(await chamar("POST", "/presenca/ping", { token: tk }));
  assert.equal((await chamar("POST", "/presenca/ping", { token: "semPapel" })).json.contado, false);
  assert.equal((await chamar("POST", "/presenca/ping", { token: "alunoA" })).json.contado, false, "ping em < 10 s é ignorado");
  falha(await chamar("POST", "/presenca/ping", {}), 401);
  let d = (await chamar("GET", "/ti/dashboard", { token: "gest" })).json.online; assert.deepEqual([d.total, d.alunos, d.personais, d.admins, d.ti], [5, 2, 1, 1, 1]);
  E.avancar(40_000); ok(await chamar("POST", "/presenca/ping", { token: "alunoA" })); ti.presenca.limparCache();
  E.avancar(40_000); ti.presenca.limparCache();                                          // 80 s desde o ping dos outros; alunoA pingou há 40 s
  d = (await chamar("GET", "/ti/dashboard", { token: "gest" })).json.online; assert.deepEqual([d.total, d.alunos], [1, 1], "só quem pingou há < 75 s");
  E.avancar(80_000); ti.presenca.limparCache(); assert.equal((await chamar("GET", "/ti/dashboard", { token: "gest" })).json.online.total, 0);
});
t("presença com várias instâncias: união dos ids publicados (sem contar duas vezes o mesmo usuário) e limpeza de instâncias antigas", async () => {
  await operador("gest", "gestor");
  ok(await chamar("POST", "/presenca/ping", { token: "alunoA" }));
  const hash = (uid) => crypto.createHash("sha256").update(uid).digest("base64url").slice(0, 10);
  await set("presenca_instancias", "outra", { instancia: "outra", emMs: Date.now(), ids: ["l" + hash("alunoA"), "l" + hash("alunoZ"), "p" + hash("promQ")] });     // alunoA repetida
  await set("presenca_instancias", "morta", { instancia: "morta", emMs: Date.now() - 11 * MIN, ids: ["lxxxxxxxxxx"] });
  ti.presenca.limparCache(); const d = (await chamar("GET", "/ti/dashboard", { token: "gest" })).json.online;
  assert.deepEqual([d.total, d.alunos, d.personais], [3, 2, 1]); assert.equal(E.store.has("presenca_instancias/morta"), false, "instância morta removida");
  await ti.presenca.publicar(); assert.ok(E.store.get(`presenca_instancias/${ti.presenca._instancia}`).ids.length >= 1);
});
t("tempo real (SSE): retrato com online+fila; limite de streams por operador; encerrarDe derruba", async () => {
  await operador("gest", "gestor"); ok(await chamar("POST", "/presenca/ping", { token: "alunoA" })); await novoChamado();
  const r = await ti.tempoReal.retrato(); assert.equal(r.online.total >= 1, true); assert.equal(r.fila.aberto, 1);
  const escritas = []; const mk = () => ({ status() { return this; }, setHeader() {}, flushHeaders() {}, write: (s) => escritas.push(s), end() { this.fechado = true; } });
  const req = { usuario: { uid: "ti-gest" }, on() {} }, resp = [mk(), mk(), mk(), mk()];
  for (let i = 0; i < 3; i++) await ti.tempoReal.assinar(req, resp[i]);
  await assert.rejects(() => ti.tempoReal.assinar(req, resp[3]), (e) => e.status === 429);
  assert.ok(escritas.some((s) => s.startsWith("event: tick") && s.includes('"aberto":1')));
  ti.tempoReal.encerrarDe("ti-gest"); assert.ok(resp.slice(0, 3).every((x) => x.fechado)); assert.equal(ti.tempoReal._assinantes.size, 0);
});
t("sessão: login é auditado uma única vez por autenticação; logout também; config para a tela", async () => {
  await operador("gest", "gestor");
  const s = await chamar("POST", "/ti/sessao", { token: "gest" }); ok(s); assert.ok(s.json.permissoes.includes("operadores.gerir")); assert.deepEqual(s.json.config.prioridades, ["baixa", "media", "alta", "critica"]);
  ok(await chamar("POST", "/ti/sessao", { token: "gest" })); ok(await chamar("POST", "/ti/sessao/sair", { token: "gest" }));
  const acoes = (await todos("ti_auditoria")).map((a) => a.acao); assert.equal(acoes.filter((a) => a === "sessao.login").length, 1); assert.equal(acoes.filter((a) => a === "sessao.logout").length, 1);
  assert.ok((await get("ti_operadores", "ti-gest")).ultimoLoginEm);
});
t("segurança: cabeçalho de token inválido, injeção NoSQL em filtros e IDs maliciosos são recusados", async () => {
  await operador("gest", "gestor");
  falha(await chamar("GET", "/ti/auditoria", { token: "gest", query: { operador: { $ne: "x" } } }), 400, "dados-invalidos");
  falha(await chamar("GET", "/ti/auditoria?acao=a%20OR%201=1", { token: "gest" }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/ti/operadores/a..b/nivel", { token: "gest", body: { nivel: "gestor" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/ti/operadores/ti-gest/excluir", { token: "ruim.ruim.ruim", body: {} }), 401);
});


// ======================= admin gerencia a equipe de TI (/admin/ti/*) =======================
const { criarBootstrapAdmin } = require("../server/lib/bootstrap-admin");
const darToken = (chave, op) => { E.tokens[chave] = { uid: op.uid, email: op.email, email_verified: true }; };

t("admin: só o papel admin gerencia a equipe de TI (aluno, personal, operador de TI e sem papel são barrados)", async () => {
  await operador("gest", "gestor");
  for (const tk of ["alunoA", "prom1", "semPapel", "gest"]) falha(await chamar("GET", "/admin/ti/operadores", { token: tk }), 403, "sem-permissao");
  falha(await chamar("GET", "/admin/ti/operadores", {}), 401, "nao-autenticado");
  ok(await chamar("GET", "/admin/ti/operadores", { token: "adm" }));
});
t("admin: cadastra operador com senha própria (troca no 1º acesso), com senha temporária e só-Google; valida, recusa duplicado e exige login recente", async () => {
  const corpo = { nome: "Carla Souza", email: "carla@personow.ti", nivel: "tecnico", acesso: "senha", senha: SENHA, exigirTroca: true };
  E.tokens.velho = { ...U.adm, auth_time: Math.floor(Date.now() / 1000) - 3600 };
  falha(await chamar("POST", "/admin/ti/operadores", { token: "velho", body: corpo }), 401, "reautenticar");
  falha(await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { ...corpo, senha: "curta" } }), 400);
  falha(await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { ...corpo, nivel: "dono" } }), 400);
  falha(await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { ...corpo, acesso: "sms" } }), 400);
  const a = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: corpo }); ok(a, "com senha");
  assert.equal(a.json.senhaTemporaria, undefined, "a senha que o admin digitou não volta na resposta");
  assert.deepEqual(E.claimsStore[a.json.operador.uid], { role: "ti", perfis: ["ti"], tiNivel: "tecnico" });
  const da = await get("ti_operadores", a.json.operador.uid); assert.equal(da.trocarSenha, true); assert.equal(da.acesso, "senha"); assert.equal(da.status, "ativo");
  falha(await chamar("POST", "/admin/ti/operadores", { token: "adm", body: corpo }), 409, "email-em-uso");
  const b = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { nome: "Davi Lima", email: "davi@personow.ti", nivel: "gestor" } }); ok(b, "temporária");
  assert.ok(b.json.senhaTemporaria && b.json.senhaTemporaria.length >= 12); assert.equal((await get("ti_operadores", b.json.operador.uid)).trocarSenha, true);
  const g = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { nome: "Elisa Ramos", email: "elisa@gmail.com", nivel: "tecnico", acesso: "google" } }); ok(g, "google");
  assert.equal(g.json.senhaTemporaria, undefined); const dg = await get("ti_operadores", g.json.operador.uid); assert.equal(dg.acesso, "google"); assert.equal(dg.trocarSenha, false);
  const lista = await chamar("GET", "/admin/ti/operadores", { token: "adm" }); ok(lista); assert.equal(lista.json.length, 3);
  // quem foi cadastrado entra no painel de TI (o login Google casa pelo e-mail → mesmo uid → mesma claim)
  darToken("elisa", g.json.operador); const ses = await chamar("POST", "/ti/sessao", { token: "elisa", body: {} }); ok(ses, "sessão do só-Google");
  assert.equal(ses.json.operador.trocarSenha, false); assert.equal(ses.json.operador.acesso, "google");
  darToken("carla", a.json.operador); falha(await chamar("GET", "/ti/dashboard", { token: "carla" }), 403, "trocar-senha");   // senha definida pelo admin: troca obrigatória
});
t("admin: altera nível, redefine senha, remove e libera de volta; removido perde o acesso na hora; o admin pode remover o último gestor", async () => {
  const c = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { nome: "Gil Gestor", email: "gil@personow.ti", nivel: "gestor", acesso: "google" } }); ok(c);
  const uid = c.json.operador.uid; darToken("gil", c.json.operador);
  ok(await chamar("GET", "/ti/dashboard", { token: "gil" }));
  ok(await chamar("PUT", `/admin/ti/operadores/${uid}/nivel`, { token: "adm", body: { nivel: "tecnico" } })); assert.equal(E.claimsStore[uid].tiNivel, "tecnico");
  falha(await chamar("PUT", `/admin/ti/operadores/${uid}/nivel`, { token: "adm", body: { nivel: "chefe" } }), 400);
  ok(await chamar("PUT", `/admin/ti/operadores/${uid}/nivel`, { token: "adm", body: { nivel: "gestor" } }));
  // senha: informada pelo admin → troca obrigatória; sem corpo → temporária devolvida uma vez; fraca → 400
  falha(await chamar("POST", `/admin/ti/operadores/${uid}/senha`, { token: "adm", body: { senha: "fraca" } }), 400);
  const r1 = await chamar("POST", `/admin/ti/operadores/${uid}/senha`, { token: "adm", body: { senha: SENHA, motivo: "Esqueceu a senha" } }); ok(r1); assert.equal(r1.json.senhaTemporaria, undefined);
  const dop = await get("ti_operadores", uid); assert.equal(dop.trocarSenha, true); assert.equal(dop.acesso, "senha");
  const r2 = await chamar("POST", `/admin/ti/operadores/${uid}/senha`, { token: "adm", body: { motivo: "Esqueceu a senha" } }); ok(r2); assert.ok(r2.json.senhaTemporaria);
  // remover exige motivo; é o ÚNICO gestor e mesmo assim o admin consegue (a trava de "último gestor" é do TI, não do admin)
  falha(await chamar("POST", `/admin/ti/operadores/${uid}/excluir`, { token: "adm", body: { motivo: "x" } }), 400);
  const ex = await chamar("POST", `/admin/ti/operadores/${uid}/excluir`, { token: "adm", body: { motivo: "Saiu da empresa" } }); ok(ex, "remover");
  assert.equal((await get("ti_operadores", uid)).status, "excluido"); assert.equal(E.contas.get(uid).disabled, true);
  falha(await chamar("GET", "/ti/dashboard", { token: "gil" }), 401);   // login desativado/sessão revogada: o token antigo não vale mais
  const lx = await chamar("GET", "/admin/ti/operadores?status=excluido", { token: "adm" }); ok(lx); assert.equal(lx.json.length, 1); assert.equal(lx.json[0].motivoExclusao, "Saiu da empresa");
  falha(await chamar("POST", `/admin/ti/operadores/${uid}/excluir`, { token: "adm", body: { motivo: "de novo, sem efeito" } }), 409, "operador-excluido");
  // liberar de volta: só-Google restaura sem senha; quem tinha senha ganha temporária
  const rs = await chamar("POST", `/admin/ti/operadores/${uid}/restaurar`, { token: "adm", body: {} }); ok(rs, "restaurar");
  assert.equal((await get("ti_operadores", uid)).status, "ativo"); assert.equal(E.contas.get(uid).disabled, false);
  falha(await chamar("POST", `/admin/ti/operadores/${uid}/restaurar`, { token: "adm", body: {} }), 409, "nao-excluido");
  falha(await chamar("POST", "/admin/ti/operadores/nao-existe/excluir", { token: "adm", body: { motivo: "teste de motivo" } }), 404);
  falha(await chamar("POST", `/admin/ti/operadores/a..b/excluir`, { token: "adm", body: { motivo: "teste de motivo" } }), 400, "dados-invalidos");
});
t("admin: tudo fica nos DOIS logs (auditoria do admin e trilha de TI, com a cadeia íntegra) e sem segredos", async () => {
  await operador("gest", "gestor");
  const c = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { nome: "Hugo Reis", email: "hugo@personow.ti", nivel: "tecnico", senha: SENHA } }); ok(c);
  ok(await chamar("POST", `/admin/ti/operadores/${c.json.operador.uid}/excluir`, { token: "adm", body: { motivo: "Fim do contrato" } }));
  const trilha = await todos("ti_auditoria"), meu = trilha.filter((a) => a.nivel === "admin");
  assert.deepEqual(meu.map((a) => a.acao).sort(), ["operador.criar", "operador.excluir"]);
  assert.ok(meu.every((a) => a.operadorUid === "adm1" && a.resumo.startsWith("[Admin]") && a.meta.origem === "painel-admin"));
  assert.ok(!JSON.stringify(trilha).includes(SENHA), "a senha nunca vai para a trilha");
  const logAdmin = await todos("auditoria"); assert.ok(logAdmin.some((a) => a.acao === "admin.ti.criar") && logAdmin.some((a) => a.acao === "admin.ti.excluir"));
  assert.ok(!JSON.stringify(logAdmin).includes(SENHA), "nem no log do admin");
  const v = await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }); ok(v); assert.deepEqual(v.json.problemas, [], JSON.stringify(v.json)); assert.ok(v.json.verificados >= 2);
});
t("bootstrap do admin: ADMIN_BOOTSTRAP_EMAIL concede o papel sem terminal; idempotente; não converte conta de TI; e-mail inexistente só avisa", async () => {
  const bs = criarBootstrapAdmin({ admin: ctx.admin, db: ctx.db, FieldValue: ctx.FieldValue, auth: ctx.auth });
  falha(await chamar("GET", "/admin/ti/operadores", { token: "semPapel" }), 403, "sem-permissao");
  assert.deepEqual(await bs.rodar({}), []);
  const [r] = await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: " S@x.com " }); assert.equal(r.feito, true);
  assert.equal(E.claimsStore.sem.admin, true); assert.equal(E.claimsStore.sem.role, "admin"); assert.ok(E.claimsStore.sem.perfis.includes("admin"));
  assert.equal((await get("usuarios", "sem")).admin, true);
  ok(await chamar("GET", "/admin/ti/operadores", { token: "semPapel" }), "depois do bootstrap");
  assert.equal((await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: "s@x.com" }))[0].motivo, "ja-e-admin");
  assert.equal((await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: "ninguem@x.com" }))[0].motivo, "conta-inexistente");
  await operador("tec1", "tecnico"); const [t1] = await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: "ana@personow.ti" }); assert.equal(t1.motivo, "conta-ti");
  assert.equal(E.claimsStore["ti-tec1"].role, "ti");
  const dois = await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: "a@x.com, b@x.com;a@x.com" }); assert.equal(dois.length, 2);   // vários e-mails, sem repetir
});

t("bootstrap: cria o 1º gestor por variáveis de ambiente, com troca de senha obrigatória, e não age de novo", async () => {
  const env = { TI_BOOTSTRAP_EMAIL: "Chefe+ti@Exemplo.com", TI_BOOTSTRAP_NOME: "Chefe", TI_BOOTSTRAP_SENHA: "Cavalo-Bateria-Grampo-42" };
  assert.equal((await ti.bootstrapGestor({})).motivo, "nao-configurado");
  const r = await ti.bootstrapGestor(env); assert.equal(r.feito, true);
  const op = await get("ti_operadores", r.uid);
  assert.equal(op.nivel, "gestor"); assert.equal(op.status, "ativo"); assert.equal(op.trocarSenha, true); assert.equal(op.email, "chefe+ti@exemplo.com");
  assert.ok((await todos("ti_auditoria")).some((a) => a.acao === "operador.criar"));
  assert.equal((await ti.bootstrapGestor(env)).motivo, "ja-existem-operadores");      // idempotente
});
t("bootstrap: senha fraca é recusada e nada é criado", async () => {
  const r = await ti.bootstrapGestor({ TI_BOOTSTRAP_EMAIL: "x@exemplo.com", TI_BOOTSTRAP_SENHA: "curta" });
  assert.equal(r.feito, false); assert.equal((await todos("ti_operadores")).length, 0);
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    reset(); const log = console.warn; console.warn = () => {}; const err = console.error; console.error = () => {};
    try { await fn(); process.stdout.write(`  ✓ ${nome}\n`); }
    catch (e) { falhas++; process.stdout.write(`  ✗ ${nome}\n      ${String(e.stack || e).split("\n").slice(0, 5).join("\n      ")}\n`); }
    finally { console.warn = log; console.error = err; }
  }
  E.restaurarRelogio(); process.stdout.write(`\n${testes.length - falhas}/${testes.length} testes do módulo de TI passaram\n`); process.exit(falhas ? 1 : 0);
})();
