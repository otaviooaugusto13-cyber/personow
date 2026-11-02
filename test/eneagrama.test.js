// Testes do Eneagrama automático (puros, sem rede): node test/eneagrama.test.js
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import * as P from "../perfil-inteligente.js";
import { parseCsv, parseJson, lerTabela } from "../scripts/_tabela.js";

process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`;
process.env.DATA_ENCRYPTION_KEY_ID = "1";
const require = createRequire(import.meta.url);
const E = require("../server/lib/eneagrama.js");
const Cripto = require("../server/lib/cripto.js");

let n = 0; const t = async (nome, fn) => { await fn(); n++; console.log("  ✓ " + nome); };

// ---- Firestore falso (get/set/merge/delete/transação); Date vira algo com toMillis(), como o Timestamp real ----
class Parceiro {}
const FieldValue = { serverTimestamp: () => new Parceiro() };
const leitura = (o) => JSON.parse(JSON.stringify(o), (k, v) => v), ts = (o) => { const c = { ...o }; for (const [k, v] of Object.entries(c)) if (v instanceof Date) c[k] = { toMillis: () => v.getTime() }; return c; };
const mesclar = (a, b) => { const r = { ...a }; for (const [k, v] of Object.entries(b)) r[k] = v && typeof v === "object" && !(v instanceof Date) && !(v instanceof Parceiro) && !Array.isArray(v) && r[k] && typeof r[k] === "object" ? mesclar(r[k], v) : v; return r; };
function novoDb() {
  const dados = new Map();
  const ref = (c, id) => ({ k: `${c}/${id}`, async get() { const d = dados.get(this.k); return { exists: d !== undefined, data: () => (d === undefined ? undefined : ts(d)) }; }, async set(v, o) { dados.set(this.k, o && o.merge ? mesclar(dados.get(this.k) || {}, v) : v); }, async delete() { dados.delete(this.k); } });
  return { dados, collection: (c) => ({ doc: (id) => ref(c, id) }), runTransaction: (fn) => fn({ get: (r) => r.get(), set: (r, v, o) => r.set(v, o) }) };
}
const EMAIL = "ana.souza@gmail.com", UID = "uid-ana";
const ctx = (db, extra = {}) => ({ db, FieldValue, Cripto, uid: UID, email: EMAIL, emailVerificado: true, ...extra });

console.log("Leitura do resultado");
await t("paridade com o navegador (lerCodigoEneagrama) em entradas variadas", () => {
  for (const s of ["PW-3w2-SO", "3w2 SO", "3-2-SO", "tipo 3 asa 2", "PW-9w1", "pm-1w9-sx", "7", "4w6", "PW-5w4-SP", "xyz", "", null, "10", "PW-2w3-SX"])
    assert.deepEqual(E.lerCodigo(s), P.lerCodigoEneagrama(s), `divergiu em ${JSON.stringify(s)}`);
});
await t("código, colunas tipo/asa/subtipo e objeto aninhado dão o mesmo resultado", () => {
  const ref = { tipo: 3, asa: 2, instinto: "SO" };
  assert.deepEqual(E.extrairResultado({ Código: "PW-3w2-SO" }).valor, ref);
  assert.deepEqual(E.extrairResultado({ TIPO: "3", Asa: "2", Subtipo: "Social" }).valor, ref);
  assert.deepEqual(E.extrairResultado({ tipo: 3, wing: "w2", instinto: "so" }).valor, ref);
  assert.deepEqual(E.extrairResultado({ eneagrama: { tipo: 3, asa: 2, instinto: "SO" } }).valor, ref);
  assert.deepEqual(E.extrairResultado({ tipo: "3w2", subtipo: "social" }).valor, ref);
});
await t("subtipos por extenso e com acento (autopreservação, sexual, social)", () => {
  assert.equal(E.extrairResultado({ tipo: 6, subtipo: "Autopreservação" }).valor.instinto, "SP");
  assert.equal(E.extrairResultado({ tipo: 6, subtipo: "Self-Preservation" }).valor.instinto, "SP");
  assert.equal(E.extrairResultado({ tipo: 6, subtipo: "Sexual" }).valor.instinto, "SX");
});
await t("rejeita lixo e conflito; descarta asa que não é vizinha com aviso", () => {
  assert.ok(E.extrairResultado({ tipo: 10 }).erro);
  assert.ok(E.extrairResultado({ tipo: 11 }).erro);
  assert.ok(E.extrairResultado({}).erro);
  assert.ok(E.extrairResultado({ codigo: "banana" }).erro);
  assert.ok(E.extrairResultado({ tipo: 3, subtipo: "xx" }).erro);
  assert.ok(E.extrairResultado({ codigo: "PW-3w2", tipo: 4 }).erro, "código e coluna divergentes");
  const r = E.extrairResultado({ tipo: 3, asa: 7 });
  assert.deepEqual(r.valor, { tipo: 3, asa: 0, instinto: "" }); assert.equal(r.avisos.length, 1);
});
await t("e-mail normalizado e chave HMAC estável, sem expor o e-mail", () => {
  assert.equal(E.normalizarEmail("  Ana.Souza@GMAIL.com "), EMAIL); assert.equal(E.normalizarEmail("sem-arroba"), "");
  const k = E.chaveEmail(Cripto, " ANA.souza@gmail.com"); assert.equal(k, E.chaveEmail(Cripto, EMAIL)); assert.match(k, /^[0-9a-f]{64}$/); assert.ok(!k.includes("ana"));
});

console.log("Arquivos");
await t("CSV com ; BOM e aspas, vírgula e tab; JSON em lista ou embrulhado", () => {
  const a = parseCsv('\uFEFFemail;codigo;tipo\r\nana@x.com;"PW-3w2-SO";\r\n"b@x.com";;"6"\r\n\r\n');
  assert.equal(a.length, 2); assert.equal(a[0].codigo, "PW-3w2-SO"); assert.equal(a[1].tipo, "6"); assert.equal(a[1].__linha, 3);
  assert.equal(parseCsv("email,tipo\nc@x.com,4").length, 1); assert.equal(parseCsv("email\ttipo\nc@x.com\t4")[0].tipo, "4");
  assert.equal(parseJson('[{"email":"a@x.com","tipo":3}]').length, 1); assert.equal(parseJson('{"resultados":[{"email":"a@x.com"}]}').length, 1);
  assert.throws(() => lerTabela("x", "dados.xlsx"), /CSV/);
});

console.log("Link assinado");
await t("autêntico serve; adulterado, expirado e e-mail diferente não servem", () => {
  const r = { tipo: 3, asa: 2, instinto: "SO" }, agora = Date.now();
  const tk = E.assinarToken(Cripto, { resultado: r, email: EMAIL, agora });
  assert.deepEqual(E.verificarToken(Cripto, tk, EMAIL, agora), r);
  assert.equal(E.verificarToken(Cripto, tk, "outra@pessoa.com", agora), null, "amarrado ao e-mail");
  assert.equal(E.verificarToken(Cripto, tk, EMAIL, agora + 31 * 86400000), null, "expira em 30 dias");
  const [corpo, ass] = tk.split("."), falso = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, "base64url")), c: "PW-8" })).toString("base64url");
  assert.equal(E.verificarToken(Cripto, `${falso}.${ass}`, EMAIL, agora), null, "adulterado");
  assert.equal(E.verificarToken(Cripto, "lixo", EMAIL, agora), null); assert.equal(E.verificarToken(Cripto, "a".repeat(700), EMAIL, agora), null);
});

console.log("Atribuição automática");
await t("resultado importado antes do cadastro é vinculado e consumido (uso único)", async () => {
  const db = novoDb(), auds = [];
  await E.registrarPendente({ db, FieldValue, Cripto, email: EMAIL, resultado: { tipo: 3, asa: 2, instinto: "SO" }, loteId: "L1" });
  assert.ok(![...db.dados.keys()].some((k) => k.includes("ana")), "e-mail não aparece nas chaves");
  const r = await E.vincularNoCadastro(ctx(db, { auditar: async (...a) => auds.push(a) }));
  assert.equal(r.codigo, "PW-3w2-SO"); assert.equal(r.origem, "importacao");
  const p = db.dados.get(`personais_perfil/${UID}`);
  assert.deepEqual(p.eneagrama, { tipo: 3, asa: 2, instinto: "SO" }); assert.equal(p.eneagramaMeta.travado, true); assert.equal(p.eneagramaMeta.loteId, "L1");
  assert.equal([...db.dados.keys()].filter((k) => k.startsWith("eneagrama_resultados/")).length, 0, "pendente consumido");
  assert.equal(auds[0][0], "eneagrama.vincular");
  assert.equal(await E.vincularNoCadastro(ctx(db)), null, "segunda chamada não acha mais nada");
});
await t("e-mail NÃO verificado não vincula e preserva o pendente", async () => {
  const db = novoDb();
  await E.registrarPendente({ db, FieldValue, Cripto, email: EMAIL, resultado: { tipo: 5, asa: 0, instinto: "" } });
  assert.equal(await E.vincularNoCadastro(ctx(db, { emailVerificado: false })), null);
  assert.equal(await E.vincularNoCadastro(ctx(db, { emailVerificado: undefined })), null);
  assert.equal(db.dados.has(`personais_perfil/${UID}`), false);
  assert.equal([...db.dados.keys()].filter((k) => k.startsWith("eneagrama_resultados/")).length, 1);
});
await t("pendente expirado é descartado, não vincula", async () => {
  const db = novoDb(), agora = Date.now();
  await E.registrarPendente({ db, FieldValue, Cripto, email: EMAIL, resultado: { tipo: 5, asa: 0, instinto: "" }, ttlDias: 1, agora });
  assert.equal(await E.vincularNoCadastro(ctx(db, { agora: agora + 2 * 86400000 })), null);
  assert.equal([...db.dados.keys()].filter((k) => k.startsWith("eneagrama_resultados/")).length, 0);
});
await t("link assinado vincula sem importação; link de outro e-mail é ignorado", async () => {
  const db = novoDb(), tk = E.assinarToken(Cripto, { resultado: { tipo: 8, asa: 7, instinto: "SX" }, email: EMAIL });
  assert.equal(await E.vincularNoCadastro(ctx(db, { email: "intruso@x.com", token: tk })), null);
  const r = await E.vincularNoCadastro(ctx(db, { token: tk }));
  assert.equal(r.origem, "link"); assert.equal(db.dados.get(`personais_perfil/${UID}`).eneagrama.tipo, 8);
});
await t("link vale mais que o importado quando os dois existem", async () => {
  const db = novoDb();
  await E.registrarPendente({ db, FieldValue, Cripto, email: EMAIL, resultado: { tipo: 2, asa: 0, instinto: "" } });
  const r = await E.vincularNoCadastro(ctx(db, { token: E.assinarToken(Cripto, { resultado: { tipo: 9, asa: 0, instinto: "SO" }, email: EMAIL }) }));
  assert.equal(r.eneagrama.tipo, 9); assert.equal([...db.dados.keys()].filter((k) => k.startsWith("eneagrama_resultados/")).length, 0);
});
await t("aplicar: trava, é idempotente, guarda o valor manual anterior e respeita manterManual", async () => {
  const db = novoDb(), base = { db, FieldValue, uid: UID, origem: "importacao" };
  await db.collection("personais_perfil").doc(UID).set({ uid: UID, experiencias: [{ area: "Musculação / Hipertrofia" }], eneagrama: { tipo: 1, asa: 0, instinto: "" } });
  assert.deepEqual(await E.aplicar({ ...base, resultado: { tipo: 4, asa: 5, instinto: "SP" }, manterManual: true }), { aplicado: false, motivo: "mantido-manual" });
  const r = await E.aplicar({ ...base, resultado: { tipo: 4, asa: 5, instinto: "SP" } });
  assert.equal(r.sobrescreveu, true);
  const p = db.dados.get(`personais_perfil/${UID}`);
  assert.equal(p.eneagramaMeta.anterior, "PW-1"); assert.equal(p.experiencias.length, 1, "não apaga o resto do perfil");
  assert.deepEqual(await E.aplicar({ ...base, resultado: { tipo: 4, asa: 5, instinto: "SP" } }), { aplicado: false, motivo: "ja-vinculado" });
  await assert.rejects(E.aplicar({ ...base, resultado: { tipo: 12 } }));
});

console.log(`\n${n} testes passaram.`);
