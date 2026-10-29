// Scripts de operação: migração para dados cifrados e concessão de admin (partes puras, sem Firebase).
const crypto = require("node:crypto");
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const { converter } = require("../scripts/migrar-cripto.cjs");
const { novasClaims } = require("../scripts/definir-admin.cjs");
const Cripto = require("../server/lib/cripto");

const vistos = new Map();
const a = converter("u1", { cpf: "529.982.247-25", telefone: "(19) 99999-0000", nascimento: "1990-04-10", pix: { tipo: "CPF", chave: "52998224725" }, banco: { agencia: "1", conta: "2" }, email: "a@x.com" }, vistos);
assert.deepEqual(a.remover.sort(), ["banco", "cpf", "nascimento", "pix", "telefone"]); assert.equal(a.avisos.length, 0);
assert.equal(Cripto.decifrar(a.grava.cpfEnc, "personais_privado/cpf/u1"), "52998224725");
assert.equal(Cripto.decifrar(a.grava.pixEnc, "personais_privado/pix/u1").chave, "52998224725"); assert.equal(a.grava.pixTipo, "CPF");
assert.equal(JSON.stringify(a.grava).includes("52998224725"), false, "nenhum dado em claro no que será gravado");
const dup = converter("u2", { cpf: "52998224725" }, vistos);
assert.equal(dup.remover.length, 0); assert.match(dup.avisos[0], /CPF repetido/); assert.equal(dup.grava.cpfEnc, undefined, "CPF repetido não é migrado");
const ja = converter("u1", { cpf: "52998224725", cpfEnc: "v1.x.y.z" }, new Map()); assert.deepEqual(ja.remover, ["cpf"]); assert.deepEqual(ja.grava, {}, "já cifrado: só apaga o texto puro");
assert.deepEqual(converter("u3", { email: "x@x.com" }).remover, []);
assert.deepEqual(novasClaims({ foo: 1 }, true), { foo: 1, role: "admin" }); assert.deepEqual(novasClaims({ role: "admin", foo: 1, admin: true }, false), { foo: 1 });
console.log("✅ migração para dados cifrados e definir-admin: todos os testes passaram");
