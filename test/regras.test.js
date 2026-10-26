// Regras de negócio do Personow: navegador (config.js/core.js) == servidor (server/regras.js).
// Rodar: node test/regras.test.js
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as cfg from "../config.js";
import * as core from "../core.js";
const require = createRequire(import.meta.url);
const srv = require("../server/regras.js");

// 1) constantes idênticas entre navegador e servidor
for (const k of ["COMISSAO_PCT", "TAXA_FIXA_CENTAVOS", "DURACAO_MIN_MINUTOS", "DURACAO_MAX_MINUTOS", "VALOR_MINIMO_CENTAVOS", "VALOR_MAXIMO_CENTAVOS", "EXCLUSIVIDADE_MINUTOS", "MAX_AULAS_ABERTAS_ALUNO"]) {
  assert.equal(cfg[k], srv[k], `${k} diverge (config.js x server/regras.js)`);
}
assert.deepEqual(cfg.FOCOS.map((f) => f.v), srv.FOCOS, "FOCOS divergem");
assert.deepEqual(core.STATUS_QUE_OCUPAM_AGENDA, srv.STATUS_QUE_OCUPAM_AGENDA);

// 2) split: R$ 80 → personal R$ 68 (85%), plataforma R$ 12 (15%) — o que a tela do aluno já prometia
const s80 = core.calcularSplit(8000);
assert.deepEqual([s80.personal, s80.comissao, s80.total], [6800, 1200, 8000]);

// 3) para QUALQUER valor permitido: nada some, nada sobra, personal nunca perde centavo, navegador == servidor
for (let v = cfg.VALOR_MINIMO_CENTAVOS; v <= cfg.VALOR_MAXIMO_CENTAVOS; v += 1) {
  const a = core.calcularSplit(v), b = srv.calcularSplit(v);
  assert.deepEqual(a, b, `divergência em ${v} centavos`);
  assert.equal(a.personal + a.comissao, a.valor, `soma errada em ${v}`);
  assert.ok(a.personal >= Math.floor((v * (100 - cfg.COMISSAO_PCT)) / 100), `personal perdeu centavo em ${v}`);
  assert.equal(a.total, a.valor + a.taxaFixa);
  assert.equal(a.app + a.personal, a.total);
}
assert.throws(() => core.calcularSplit(0));
assert.throws(() => srv.calcularSplit(-5));

// 4) validação da aula (duração e valor), igual nos dois lados
const casos = [
  ["10:00", "11:00", 8000, ""],
  ["10:00", "10:30", 3000, ""],
  ["10:00", "13:00", 8000, ""],
  ["10:00", "10:29", 8000, /pelo menos 30/],
  ["10:00", "13:01", 8000, /no máximo 3 horas/],
  ["11:00", "10:00", 8000, /depois do início/],
  ["10:00", "", 8000, /horário/],
  ["25:00", "26:00", 8000, /horário/],
  ["10:00", "11:00", 2999, /valor mínimo/],
  ["10:00", "11:00", 100001, /valor máximo/],
  ["10:00", "11:00", 0, /valor que deseja/],
  ["10:00", "11:00", 80.5, /valor que deseja/]
];
for (const [e, s, v, esperado] of casos) {
  const a = core.validarAula(e, s, v), b = srv.validarAula(e, s, v);
  assert.equal(a, b, `validarAula diverge para ${e}-${s} ${v}`);
  if (esperado === "") assert.equal(a, "", `${e}-${s} ${v} deveria ser válida`); else assert.match(a, esperado);
}

// 5) conflito de horário na agenda do personal (encostar NÃO é conflito; cancelada não ocupa)
const nova = { data: "2026-11-02", entrada: "10:00", saida: "11:00" };
const agenda = [
  { id: "a", data: "2026-11-02", entrada: "09:00", saida: "10:00", status: "aceita", horario: "09:00–10:00" },     // encosta antes
  { id: "b", data: "2026-11-02", entrada: "11:00", saida: "12:00", status: "paga" },                               // encosta depois
  { id: "c", data: "2026-11-02", entrada: "10:15", saida: "10:45", status: "cancelada" },                          // cancelada
  { id: "d", data: "2026-11-03", entrada: "10:00", saida: "11:00", status: "aceita" }                              // outro dia
];
assert.equal(core.conflitoNaAgenda(agenda, nova), undefined);
assert.equal(srv.conflitoNaAgenda(agenda, nova), undefined);
for (const choque of [
  { id: "x", data: "2026-11-02", entrada: "10:30", saida: "11:30", status: "aceita" },
  { id: "y", data: "2026-11-02", entrada: "09:30", saida: "10:30", status: "paga" },
  { id: "z", data: "2026-11-02", entrada: "10:00", saida: "11:00", status: "concluida" },
  { id: "w", data: "2026-11-02", entrada: "09:00", saida: "12:00", status: "aceita" }
]) {
  assert.ok(core.conflitoNaAgenda([...agenda, choque], nova), `deveria conflitar com ${choque.id}`);
  assert.ok(srv.conflitoNaAgenda([...agenda, choque], nova), `(servidor) deveria conflitar com ${choque.id}`);
}
assert.equal(core.conflitoNaAgenda([{ id: "x", data: "2026-11-02", entrada: "10:30", saida: "11:30", status: "aceita" }], nova, "x"), undefined, "ignora a própria aula");

// 6) filtro anti-fuga: bloqueia contatos/Pix, NÃO bloqueia conversa normal de treino
const bloqueia = ["me chama no whatsapp", "meu zap é 19 99999-8888", "11999998888", "(19) 3333-4444", "manda no insta @fulano", "chave pix: fulano@email.com", "fala comigo em joao@gmail.com", "olha https://wa.me/5519999999999", "me liga amanhã", "meu número 1999 9998888"];
const libera = ["Posso chegar às 10h?", "Vou levar a garrafa e a toalha", "Treino de 45 min, ok?", "Aula às 18:30 na academia da Rua 15", "Tenho uma lesão no joelho direito", "Combinado, até amanhã!", "R$ 80 está ótimo", "Dia 24/10/2026 serve?", "Prefiro focar em pernas e glúteos", "Vou pagar pelo app depois da aula"];
for (const t of bloqueia) { assert.ok(core.mensagemSuspeita(t), `deveria bloquear: ${t}`); assert.ok(srv.mensagemSuspeita(t), `(servidor) deveria bloquear: ${t}`); }
for (const t of libera) { assert.ok(!core.mensagemSuspeita(t), `não deveria bloquear: ${t}`); assert.ok(!srv.mensagemSuspeita(t), `(servidor) não deveria bloquear: ${t}`); }

// 7) utilidades
assert.equal(core.cpfValido("529.982.247-25"), true);
assert.equal(core.cpfValido("111.111.111-11"), false);
assert.equal(core.cpfValido("529.982.247-24"), false);
assert.equal(core.cpfMascarado("52998224725"), "***.982.247-**");
assert.equal(core.esc(`<img src=x onerror="a">`), "&lt;img src=x onerror=&quot;a&quot;&gt;");
assert.equal(core.urlImagemSegura("javascript:alert(1)"), "");
assert.equal(core.urlImagemSegura("https://lh3.googleusercontent.com/a"), "https://lh3.googleusercontent.com/a");
assert.equal(core.reaisParaCentavos("1.234,56"), 123456);
assert.equal(core.reaisParaCentavos(80), 8000);
assert.equal(core.valorCentavos({ valor: 80 }), 8000, "aula antiga (em reais) continua legível");
assert.equal(core.valorPersonal({ valor: 80 }), 6800);
assert.equal(core.valorPersonal({ valorPersonalCentavos: 7000, valor: 80 }), 7000);

console.log("✅ regras de negócio: todos os testes passaram");
