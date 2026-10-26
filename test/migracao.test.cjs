const assert = require("node:assert/strict");
const { mapearProfissional, mapearSolicitacao } = require("../scripts/migrar-dados.cjs");

// personal com uid do Google: separa público x privado (CPF/telefone/Pix nunca no documento público)
const m = mapearProfissional("abc", { uid: "u1".padEnd(28, "x"), nome: "Leo", cpf: "52998224725", telefone: "(19) 99999-0000", pix: { chave: "x" }, email: "l@x.com", status: "ativo", cref: "123-G/SP", especialidade: "Hipertrofia", valorMin: 80 });
assert.equal(m.publico.nome, "Leo"); assert.equal(m.publico.cpf, undefined); assert.equal(m.publico.email, undefined); assert.equal(m.publico.pix, undefined);
assert.equal(m.privado.cpf, "52998224725"); assert.equal(m.privado.email, "l@x.com");
// documento antigo com CPF como id e sem uid: não dá para migrar
assert.equal(mapearProfissional("52998224725", { nome: "Fulano", cpf: "52998224725" }), null);

// pedido antigo (reais, loja, promotor*) → aula nova (centavos, local, personal*, split 85/15)
const uidP = "P".repeat(28);
const { aula, interno } = mapearSolicitacao("s1", { uid: "alunoX", loja: "Smart Fit", data: "2026-11-02", entrada: "10:00", saida: "11:00", valor: 80, foco: "Funcional", status: "aceita", promotorChave: uidP, promotorNome: "Leo", promotorPreferido: "Leo" }, new Set([uidP]));
assert.equal(aula.local, "Smart Fit"); assert.equal(aula.loja, undefined);
assert.equal(aula.valorCentavos, 8000); assert.equal(aula.valorPersonalCentavos, 6800); assert.equal(aula.minutos, 60);
assert.equal(aula.personalUid, uidP); assert.equal(aula.personalNome, "Leo"); assert.equal(aula.promotorNome, undefined);
assert.equal(interno.split.comissao, 1200);

// aceita por quem não foi migrado (CPF como chave): marca para voltar à fila
const x = mapearSolicitacao("s2", { uid: "a", loja: "Academia", data: "2026-11-02", entrada: "10:00", saida: "11:00", valor: 100, status: "aceita", promotorChave: "52998224725" }, new Set());
assert.equal(x.aula._semPersonal, true); assert.equal(x.aula.personalUid, undefined);
console.log("✅ migração: todos os testes passaram");
