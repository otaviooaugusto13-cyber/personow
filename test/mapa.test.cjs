// Mapa de personais online (painel do aluno): presença com posição aproximada, GET /personais/online, privacidade, janela de 75 s, raio, CSP e regras. Sem rede.
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { ctx, chamar, Seg } = E.carregarServidor();
const { V, C, G, Cripto, ti } = ctx;
const SEG = 1000;
const LAT = -22.4358, LNG = -46.8216;                    // aluno em Itapira
const EXATO = { lat: -22.446812345, lng: -46.811634567 };   // personal "perto" (≈1,6 km): a posição EXATA que nunca pode vazar

const U = {
  alunoA: { uid: "alunoA", email: "a@x.com", email_verified: true }, alunoB: { uid: "alunoB", email: "b@x.com", email_verified: true }, alunoSem: { uid: "alunoSem", email: "s@x.com", email_verified: true },
  p1: { uid: "p1", email: "p1@x.com", email_verified: true }, p2: { uid: "p2", email: "p2@x.com", email_verified: true }, p3: { uid: "p3", email: "p3@x.com", email_verified: true },
  p4: { uid: "p4", email: "p4@x.com", email_verified: true }, p5: { uid: "p5", email: "p5@x.com", email_verified: true },
  adm: { uid: "adm1", email: "adm@x.com", email_verified: true }, "teste-aluno": { uid: "teste-aluno", email: "t@x.com", email_verified: true }
};
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
const ok = (r, m = "") => assert.equal(r.status, 200, `${m} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
const enc = (uid, campo, v) => Cripto.cifrar(v, `personais_privado/${campo}/${uid}`);
const ping = (token, corpo = {}) => chamar("POST", "/presenca/ping", { token, body: corpo });
const online = (token = "alunoA") => chamar("GET", "/personais/online", { token });
const ids = (r) => r.json.personais.map((p) => p.id).sort();

async function semearPersonal(uid, extra = {}) {
  await set("personais", uid, { uid, nome: "Personal " + uid, status: "ativo", cref: "012345-G/SP", email: `${uid}@privado.com`, telefone: "19999990000", cidade: "Itapira - SP", treinamentoOk: true,
    especialidade: "Musculação", ratingMedia: 4.8, ratingQtd: 12, fotoGoogle: "https://lh3.googleusercontent.com/a/foto-" + uid, ...extra });
  await set("personais_privado", uid, { uid, cpfEnc: enc(uid, "cpf", "52998224725"), cpfIdx: Cripto.indiceCego("52998224725"), telefoneEnc: enc(uid, "telefone", "19999990000") });
}
function reset() {
  E.limpar(); Object.assign(E.tokens, U);
  for (const a of ["alunoA", "alunoB", "alunoSem"]) E.claimsStore[a] = { role: "aluno" };
  for (const p of ["p1", "p2", "p3", "p4", "p5"]) E.claimsStore[p] = { role: "personal", treinado: true };
  E.claimsStore.adm1 = { role: "admin" }; E.claimsStore["teste-aluno"] = { role: "aluno", teste: true };
  E.clock.now = Date.now(); ctx.__reset?.();
}
async function cenario() {
  await set("alunos", "alunoA", { uid: "alunoA", nomeCompleto: "Mercado A", localizacao: { lat: LAT, lng: LNG, cidade: "Itapira", uf: "SP" } });
  await set("alunos", "alunoB", { uid: "alunoB", nomeCompleto: "Mercado B", localizacao: { lat: -23.5505, lng: -46.6333, cidade: "São Paulo", uf: "SP" } });   // ~125 km
  await set("alunos", "alunoSem", { uid: "alunoSem", nomeCompleto: "Sem local" });
  await semearPersonal("p1"); await semearPersonal("p2", { status: "pendente" }); await semearPersonal("p3"); await semearPersonal("p4"); await semearPersonal("p5");
}

const testes = []; const t = (nome, fn) => testes.push([nome, fn]);

t("só aparece personal APROVADO, com ping+posição recentes e DENTRO do raio (sem ping, sem posição, pendente ou longe: fora)", async () => {
  await cenario();
  ok(await ping("p1", { ...EXATO, precisao: 25 }));                                                  // online, perto
  ok(await ping("p2", { lat: LAT + 0.005, lng: LNG + 0.005, precisao: 25 }));                         // online, perto, mas PENDENTE
  ok(await ping("p3", { lat: -23.5, lng: -46.65, precisao: 25 }));                                    // aprovado, online, mas a ~120 km do aluno A
  ok(await ping("p5", {}));                                                                           // aprovado, online, sem posição (GPS negado)
  // p4: aprovado, nunca pingou
  const r = await online("alunoA"); ok(r);
  assert.deepEqual(ids(r), ["p1"]); assert.equal(r.json.total, 1); assert.equal(r.json.semLocalizacao, false); assert.equal(r.json.raioKm, C.MAPA.RAIO_KM);
  const p = r.json.personais[0];
  assert.deepEqual([p.nome, p.ratingMedia, p.ratingQtd, p.modalidades], ["Personal p1", 4.8, 12, ["Musculação"]]); assert.match(p.foto, /^https:\/\//);
  const d = G.distanciaM({ lat: LAT, lng: LNG }, p) / 1000; assert.ok(Math.abs(p.distanciaKm - d) <= 0.051, "distância é a do ponto aproximado (arredondada a 0,1 km)");
  // o aluno B (São Paulo) enxerga só quem está no raio DELE: ninguém de Itapira (e p3 está perto dele? ~7 km de SP centro → sim)
  assert.deepEqual(ids(await online("alunoB")), ["p3"]);
});

t("PRIVACIDADE: resposta traz só posição arredondada e lista branca de campos; nada de CPF, telefone, CREF, e-mail; posição exata não fica em lugar nenhum", async () => {
  await cenario(); ok(await ping("p1", { ...EXATO, precisao: 10 }));
  const r = await online(); ok(r); const p = r.json.personais[0];
  assert.deepEqual(Object.keys(p).sort(), ["distanciaKm", "foto", "id", "lat", "lng", "modalidades", "nome", "ratingMedia", "ratingQtd"]);
  const dEx = G.distanciaM(EXATO, p);
  assert.ok(dEx > 0 && dEx <= C.MAPA.GRADE_M, `aproximada (erro ${Math.round(dEx)} m)`); assert.notEqual(p.lat, EXATO.lat); assert.notEqual(p.lng, EXATO.lng);
  assert.ok(String(p.lat).replace("-", "").split(".")[1].length <= 5, "no máx. 5 casas decimais");
  const texto = JSON.stringify(r.json);
  for (const proibido of ["52998224725", "012345-G/SP", "19999990000", "privado.com", "cpf", "telefone", "cref", "email", "pix", "nascimento", "-22.446812", "-46.811634"]) assert.ok(!texto.toLowerCase().includes(proibido.toLowerCase()), `vazou: ${proibido}`);
  // a posição exata NUNCA é guardada: nem na memória do servidor, nem no que é publicado para outras instâncias
  await ti.presenca.publicar();
  const tudo = JSON.stringify([...E.store.entries()]) + JSON.stringify([...ti.presenca._pos.entries()]);
  for (const n of ["-22.446812", "-46.811634", String(EXATO.lat), String(EXATO.lng)]) assert.ok(!tudo.includes(n), `posição exata persistida: ${n}`);
  const pub = E.store.get(`presenca_instancias/${ti.presenca._instancia}`); assert.equal(pub.pos.length, 1); assert.deepEqual(pub.pos[0], { u: "p1", la: p.lat, ln: p.lng, t: pub.pos[0].t });
  // repetir a consulta não refina o ponto (determinístico)
  E.avancar(6 * SEG); const r2 = await online(); assert.deepEqual([r2.json.personais[0].lat, r2.json.personais[0].lng], [p.lat, p.lng]);
});

t("aproximar(): mesma célula → mesmo ponto; erro ≤ ~0,71·grade; funciona perto do equador e em latitudes altas", async () => {
  for (const base of [{ lat: -22.4358, lng: -46.8216 }, { lat: 0.0001, lng: 0.0001 }, { lat: 60.1, lng: 24.9 }, { lat: -33.9, lng: 151.2 }]) {
    for (let i = 0; i < 40; i++) {
      const pt = { lat: base.lat + (Math.random() - 0.5) * 0.02, lng: base.lng + (Math.random() - 0.5) * 0.02 }, a = G.aproximar(pt, 300);
      assert.ok(G.distanciaM(pt, a) <= 300 * 0.75, `erro grande em ${JSON.stringify(pt)}`);
      assert.deepEqual(G.aproximar(a, 300), a, "idempotente (o centro da célula cai na própria célula)");
    }
  }
});

t("janela de presença: some em 75 s sem ping COM posição; ping sem posição não mantém o personal no mapa", async () => {
  await cenario(); ok(await ping("p1", { ...EXATO, precisao: 10 }));
  assert.deepEqual(ids(await online()), ["p1"]);
  E.avancar(40 * SEG); ok(await ping("p1", {}));                                  // ping sem posição aos 40 s
  assert.deepEqual(ids(await online()), ["p1"], "aos 40 s ainda online");
  E.avancar(30 * SEG); assert.deepEqual(ids(await online()), ["p1"], "aos 70 s ainda online (< 75 s)");
  E.avancar(10 * SEG); assert.deepEqual(ids(await online()), [], "aos 80 s: sumiu");
  E.avancar(6 * SEG);                                                              // (consulta é cacheada por 5 s no servidor: N alunos olhando = 1 leitura)
  ok(await ping("p1", { ...EXATO, precisao: 10 })); E.avancar(6 * SEG); assert.deepEqual(ids(await online()), ["p1"], "voltou ao mandar posição");
  E.avancar(76 * SEG); assert.deepEqual(ids(await online()), [], "fechou o app: some");
});

t("personal que perde a aprovação (status ≠ ativo) sai do mapa mesmo com ping recente; posição imprecisa/ inválida é ignorada", async () => {
  await cenario(); ok(await ping("p1", { ...EXATO, precisao: 10 })); assert.deepEqual(ids(await online()), ["p1"]);
  await set("personais", "p1", { ...(await get("personais", "p1")), status: "suspenso" }); E.avancar(1); ti.presenca.limparCache();
  assert.deepEqual(ids(await online()), []);
  await set("personais", "p1", { ...(await get("personais", "p1")), status: "ativo" });
  ti.presenca._pos.clear(); ti.presenca.limparCache();                                // parte do zero: só posições RUINS daqui em diante
  for (const ruim of [{ lat: "x", lng: 1 }, { lat: 120, lng: 10 }, { lat: 0, lng: 0 }, { lat: LAT, lng: LNG, precisao: 5000 }, { lat: null, lng: null }]) { const r = await ping("p1", ruim); ok(r); assert.equal(r.json.posicao, false); }
  assert.deepEqual(ids(await online()), [], "nenhuma posição ruim entrou");
  assert.equal((await ping("alunoA", { ...EXATO })).json.posicao, false, "aluno não registra posição no mapa");
  assert.equal(ti.presenca._pos.has("alunoA"), false);
});

t("acesso: só ALUNO logado consulta; personal, admin e anônimo são barrados; aluno sem localização recebe lista vazia e o aviso", async () => {
  await cenario(); ok(await ping("p1", { ...EXATO, precisao: 10 }));
  falha(await chamar("GET", "/personais/online", {}), 401, "nao-autenticado");
  for (const tk of ["p1", "adm"]) falha(await online(tk), 403, "sem-permissao");
  const r = await online("alunoSem"); ok(r); assert.deepEqual([r.json.semLocalizacao, r.json.total, r.json.personais], [true, 0, []]);
  // o ponto de referência é o salvo no perfil do aluno: query string não desloca a consulta (não dá para "triangular" mandando coordenadas)
  const q = await chamar("GET", "/personais/online?lat=-23.55&lng=-46.63", { token: "alunoA" }); assert.deepEqual(ids(q), ["p1"]);
});

t("várias instâncias: une posições publicadas por outras instâncias, ignora vencidas e malformadas", async () => {
  await cenario(); ok(await ping("p1", { ...EXATO, precisao: 10 }));
  const agora = Date.now(), perto = G.aproximar({ lat: LAT + 0.01, lng: LNG - 0.01 }, 300);
  await set("presenca_instancias", "outra", { instancia: "outra", emMs: agora, ids: [], pos: [{ u: "p3", la: perto.lat, ln: perto.lng, t: agora - 10 * SEG }, { u: "p4", la: perto.lat, ln: perto.lng, t: agora - 80 * SEG }, { u: "p5", la: "x", ln: 1, t: agora }] });
  ti.presenca.limparCache(); assert.deepEqual(ids(await online()), ["p1", "p3"]);
});

t("o servidor limita as consultas por aluno (12/min) e a lista a MAX_PONTOS", async () => {
  await cenario(); for (let i = 0; i < 12; i++) ok(await online()); falha(await online(), 429);
  reset(); await cenario();
  for (let i = 0; i < C.MAPA.MAX_PONTOS + 5; i++) { const uid = "x" + i; await semearPersonal(uid); ti.presenca.pingPosicao(uid, { lat: LAT + 0.001 * i, lng: LNG }); }
  const r = await online(); ok(r); assert.equal(r.json.personais.length, C.MAPA.MAX_PONTOS); assert.ok(r.json.personais.every((p, i, a) => i === 0 || a[i - 1].distanciaKm <= p.distanciaKm), "mais perto primeiro");
});

t("FLUXO: \"Chamar este personal\" = aula direta com personalPreferido (exclusividade 5 min); pagamento só criado, nada cobrado antes da aula", async () => {
  await cenario(); await set("cartoes", "alunoA", { uid: "alunoA", status: "ativo", ultimos4: "1234" });
  ok(await ping("p1", { ...EXATO, precisao: 10 }));
  const p = (await online()).json.personais[0];
  const r = await chamar("POST", "/criarAula", { token: "alunoA", body: { aluno: "Mercado A — Rua 1", data: V.hojeSP(), entrada: "23:00", saida: "23:59", foco: "Musculação", personalPreferido: p.id } }); ok(r);
  const aula = await get("aulas", r.json.id);
  assert.equal(aula.status, "aberta"); assert.equal(aula.personalPreferido, "p1"); assert.equal(aula.personalPreferidoNome, "Personal p1"); assert.ok(aula.exclusivoAte.toMillis() > Date.now());
  assert.equal((await get("pagamentos_internos", r.json.id)).status, "criado", "pagamento só depois da aula");
  assert.equal(await get("carteiras", "p1"), undefined, "nada creditado ao personal antes da aula");
});

t("sandbox (MODO_TESTE): /teste/personais-online põe 3 personais fictícios no mapa só para a conta de teste", async () => {
  await set("alunos", "teste-aluno", { uid: "teste-aluno", teste: true, localizacao: { lat: LAT, lng: LNG, cidade: "Itapira", uf: "SP" } });
  falha(await chamar("POST", "/teste/personais-online", { token: "alunoA" }), 403);
  ok(await chamar("POST", "/teste/personais-online", { token: "teste-aluno" }));
  const r = await online("teste-aluno"); ok(r); assert.equal(r.json.total, 3); E.avancar(10 * 60 * SEG); assert.equal((await online("teste-aluno")).json.total, 3, "fictícios não expiram");
});

t("firestore.rules: posição do personal só pelo servidor; deny-by-default explícito; cliente não grava campo de posição no perfil", async () => {
  const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
  for (const col of ["presenca_instancias", "alertas_personal", "personais_privado"]) assert.ok(new RegExp("match \\/" + col + "\\/\\{\\w+\\}\\s*\\{ allow read(, write)?: if false;").test(rules), col);
  assert.ok(/match \/\{document=\*\*\}\s*\{ allow read, write: if false; \}/.test(rules), "catch-all negando tudo");
  const bloco = rules.slice(rules.indexOf("match /personais/{uid}"), rules.indexOf("match /personais_privado"));
  assert.ok(/soMuda\(\['bio', 'cidade', 'especialidade', 'disponibilidade', 'valorMin', 'nome'\]\)/.test(bloco), "lista fechada de campos graváveis");
  assert.ok(!/lat|lng|posicao|localizacao/i.test(bloco), "perfil do personal não tem campo de posição");
  assert.ok(/allow read: if dono\(uid\) \|\| ehAdmin\(\) \|\| \(ehAluno\(\) && resource\.data\.status == 'ativo'\)/.test(bloco));
});

t("CSP: Leaflet (cdnjs) e tiles do OSM liberados em script/style/img/connect; sem unsafe-inline em script, sem unsafe-eval, sem curinga", async () => {
  let csp = ""; Seg.cabecalhos()({}, { setHeader: (k, v) => { if (k === "Content-Security-Policy") csp = v; }, removeHeader() {} }, () => {});
  const dir = (n) => (csp.split("; ").find((d) => d.startsWith(n + " ")) || "").split(" ");
  assert.ok(dir("script-src").includes("https://cdnjs.cloudflare.com")); assert.ok(dir("style-src").includes("https://cdnjs.cloudflare.com"));
  assert.ok(dir("img-src").includes("https://tile.openstreetmap.org")); assert.ok(dir("connect-src").includes("https://tile.openstreetmap.org"));
  assert.ok(!dir("script-src").includes("'unsafe-inline'") && !csp.includes("'unsafe-eval'")); assert.ok(!/(^| )\*( |;|$)/.test(csp), "sem curinga *");
});

t("paridade navegador×servidor: raio do mapa = RAIO_KM_AULAS; sw.js não cacheia /personais/ e a versão subiu", async () => {
  const cfg = fs.readFileSync(path.join(__dirname, "../config.js"), "utf8"); assert.equal(Number(/RAIO_KM_AULAS\s*=\s*(\d+)/.exec(cfg)[1]), C.MAPA.RAIO_KM);
  const sw = fs.readFileSync(path.join(__dirname, "../sw.js"), "utf8"); assert.ok(sw.includes("personais\\/")); assert.ok(Number(/personow-v(\d+)/.exec(sw)[1]) >= 14); assert.ok(sw.includes("mapa-aluno.js"));
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    reset(); const log = console.warn, err = console.error; console.warn = () => {}; console.error = () => {};
    try { await fn(); process.stdout.write(`  ✓ ${nome}\n`); }
    catch (e) { falhas++; process.stdout.write(`  ✗ ${nome}\n      ${String(e.stack || e).split("\n").slice(0, 6).join("\n      ")}\n`); }
    finally { console.warn = log; console.error = err; }
  }
  E.restaurarRelogio(); process.stdout.write(`\n${testes.length - falhas}/${testes.length} testes do mapa de personais online passaram\n`); process.exit(falhas ? 1 : 0);
})();
