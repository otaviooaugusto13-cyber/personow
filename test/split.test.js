// Paridade navegador (config.js/core.js) × servidor (server/split.js, server/lib/config.js) e regras de negócio puras.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as cfg from "../config.js";
import * as core from "../core.js";
const require = createRequire(import.meta.url);
const srv = require("../server/split.js"), SC = require("../server/lib/config.js");

assert.deepEqual(cfg.EMPRESA, SC.EMPRESA, "EMPRESA diverge entre config.js e server/lib/config.js (emitente do comprovante)");

// 1) constantes idênticas entre navegador e servidor
for (const k of ["VALOR_AULA_CENTAVOS", "COMISSAO_PLATAFORMA_CENTAVOS", "REPASSE_PERSONAL_CENTAVOS", "TAXA_FIXA_CENTAVOS", "HORAS_MIN_AULA", "HORAS_MAX_AULA", "MAX_VEZES_SEMANA_ALUNO"])
  assert.equal(cfg[k], srv[k], `${k} diverge (config.js x server/split.js)`);
assert.equal(cfg.IDADE_MINIMA, SC.IDADE_MINIMA); assert.equal(cfg.CREF_REGEX.source, SC.CREF_REGEX.source); assert.deepEqual(cfg.UFS, SC.UFS);
assert.deepEqual(core.MODALIDADES.map((s) => s.v), SC.MODALIDADES, "MODALIDADES diverge entre core.js e server/lib/config.js");
assert.deepEqual(core.CATEGORIAS, SC.CATEGORIAS, "CATEGORIAS diverge entre core.js e server/lib/config.js");
assert.deepEqual(core.MODALIDADE_CATEGORIA, SC.MODALIDADE_CATEGORIA, "MODALIDADE_CATEGORIA diverge entre core.js e server/lib/config.js");
for (const s of SC.MODALIDADES) assert.ok(SC.CATEGORIAS[SC.MODALIDADE_CATEGORIA[s]], `modalidade sem categoria de habilitação: ${s}`);

// 2) aula R$ 100 → R$ 25 plataforma + R$ 75 personal
assert.deepEqual([cfg.VALOR_AULA_CENTAVOS, cfg.COMISSAO_PLATAFORMA_CENTAVOS, cfg.REPASSE_PERSONAL_CENTAVOS], [10000, 2500, 7500]);
const d = core.calcularPreco(); assert.deepEqual(d, srv.calcularPreco());
assert.equal(d.personal + d.app, d.total);
assert.equal(d.pct, 25); assert.equal(srv.PCT_REPASSE, 75);

// 3) qualquer duração permitida dá o mesmo preço, igual no navegador e no servidor
for (let m = 1; m <= 600; m++) { assert.deepEqual(core.calcularAula(m), srv.calcularAula(m)); assert.equal(core.validarAula("08:00", `${String(8 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`.replace(/^(2[4-9]|[3-9]\d)/, "23")), srv.validarAula("08:00", `${String(8 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`.replace(/^(2[4-9]|[3-9]\d)/, "23"))); }
assert.equal(core.calcularAula(60).total, 10000);

// 4) limites de aula (0,5–3 h)
assert.equal(core.validarAula("08:00", "08:30"), ""); assert.equal(core.validarAula("08:00", "11:00"), "");
assert.match(core.validarAula("08:00", "08:29"), /mínimo/); assert.match(core.validarAula("08:00", "11:01"), /máximo/); assert.match(core.validarAula("12:00", "08:00"), /depois da entrada/);
assert.equal(core.minutosEntre("08:00", "24:00"), 0); assert.equal(srv.minutosEntre("08:00", "x"), 0);

// 5) semana segunda–domingo e máximo de aulas por semana/aluno
assert.deepEqual(core.limitesSemana("2026-10-21"), { inicio: "2026-10-19", fim: "2026-10-25" });
assert.deepEqual(srv.limitesSemana("2026-01-01"), core.limitesSemana("2026-01-01"));
const hist = [{ id: "a", uid: "L", data: "2026-10-19", status: "paga" }, { id: "b", uid: "L", data: "2026-10-21", status: "aceita" }, { id: "c", uid: "L", data: "2026-10-25", status: "concluida" }, { id: "d", uid: "L", data: "2026-10-22", status: "cancelada" }, { id: "e", uid: "M", data: "2026-10-22", status: "aceita" }];
assert.equal(core.vezesNaSemana(hist, "L", "2026-10-23"), 3); assert.equal(srv.vezesNaSemana(hist, "L", "2026-10-23"), 3);

// 6) idade: 18 é o mínimo (CREF); datas impossíveis rejeitadas
const f = (anos, dd = 0) => { const [a, m, dia] = core.hojeLocal().split("-").map(Number); return new Date(Date.UTC(a - anos, m - 1, dia - dd)).toISOString().slice(0, 10); };
assert.match(core.validarNascimento(f(17)).erro, /18 anos/); assert.match(core.validarNascimento(f(18, -1)).erro, /18 anos/);
assert.equal(core.validarNascimento(f(18)).erro, ""); assert.equal(core.validarNascimento(f(40)).erro, "");
assert.ok(core.validarNascimento("2010-02-31").erro); assert.ok(core.validarNascimento("").erro); assert.ok(core.validarNascimento("2999-01-01").erro);
assert.equal(core.limitesNascimento().max, f(18));
// CREF: navegador e servidor aceitam/recusam igual
const V = require("../server/lib/validacao.js");
for (const c of ["012345-G/SP", " 12345-p/rj ", "1234-G/MG"]) { assert.equal(core.crefValido(c), ""); assert.equal(V.cref(c), core.normalizarCref(c)); }
for (const c of ["123", "012345-X/SP", "012345-G/XX", "012345G/SP", ""]) { assert.ok(core.crefValido(c)); assert.throws(() => V.cref(c)); }

// 7) privacidade: o que cada lado enxerga
assert.deepEqual(Object.keys(core.visaoAluno(d)).sort(), ["taxaFixa", "total", "valor"]); assert.deepEqual(Object.keys(core.visaoPersonal(d)), ["liquido"]);
assert.equal(core.valorPersonal({}), 7500); assert.equal(core.valorPersonal({ valorPersonalCentavos: 7500 }), 7500);

// 8) Termos: informam aula, comissão, repasse, idade e treinamento — e só eles discriminam isso
for (const perfil of ["aluno", "personal"]) { const t = core.textoTermos(perfil); assert.ok(t.includes("R$") && /100,00/.test(t) && /25,00/.test(t) && /75,00/.test(t), perfil); }
assert.match(core.textoTermos("personal"), /Personow/); assert.match(core.textoTermos("personal"), /18 anos/); assert.match(core.textoTermos("personal"), /CREF/);
assert.equal(core.esc("<img onerror=alert(1)>"), "&lt;img onerror=alert(1)&gt;");

// 9) taxas DINÂMICAS: com os mesmos valores, navegador (core.js) e servidor (split.js) calculam exatamente igual
{
  const nova = { precoCentavos: 31000, comissaoCentavos: 6200, repasseCentavos: 24800, taxaFixaCentavos: 350, horasMin: 1, horasMax: 2.5, maxSemana: 4, versao: 4 };
  const { erro, cfg: ok } = srv.validarTaxas(nova); assert.equal(erro, "");
  assert.equal(core.aplicarTaxas({ ...ok, versao: 4 }), true);
  assert.deepEqual(core.calcularPreco(), srv.calcularPreco({ ...ok, versao: 4 }));
  for (const m of [60, 90, 120, 150, 151]) assert.deepEqual(core.calcularAula(m), srv.calcularAula(m, { ...ok, versao: 4 }));
  // taxas dinâmicas + níveis: a comissão do Bronze é a vigente e os demais níveis escalam (navegador e servidor idênticos); o split congelado se reconstrói
  for (const n of ["bronze", "prata", "ouro", "platina"]) for (const b of [0, 3000]) { const sv = srv.calcularPreco({ ...ok, versao: 4 }, n, b); assert.deepEqual(core.calcularPreco(n, b), sv, `dinâmico ${n}/${b}`); assert.deepEqual(srv.calcularPreco(srv.cfgDoSplit(sv), n, b), sv, `congelado ${n}/${b}`); assert.equal(sv.personal + sv.app, sv.total); }
  assert.equal(srv.calcularPreco({ ...ok, versao: 4 }, "bronze").comissao, 6200); assert.equal(srv.calcularPreco({ ...ok, versao: 4 }, "platina").comissao, 2480);
  for (const [e, sd] of [["08:00", "08:59"], ["08:00", "09:00"], ["08:00", "10:30"], ["08:00", "10:31"]]) assert.equal(core.validarAula(e, sd), srv.validarAula(e, sd, ok), `${e}-${sd}`);
  assert.equal(core.valorPersonal({}), 24800); assert.match(core.textoTermos("aluno"), /310,00/); assert.match(core.textoTermos("aluno"), /62,00/); assert.match(core.textoTermos("aluno"), /248,00/);
  assert.equal(core.calcularPreco().total, 31350); assert.equal(core.calcularPreco().personal + core.calcularPreco().app, 31350);
  // lixo vindo da rede nunca contamina a tela: mantém o último valor bom
  assert.equal(core.aplicarTaxas({ ...nova, repasseCentavos: 1 }), false); assert.equal(core.aplicarTaxas(null), false); assert.equal(core.aplicarTaxas({ ...nova, precoCentavos: NaN }), false);
  assert.equal(core.TAXAS.repasseCentavos, 24800);
  // volta ao padrão para não afetar nada depois
  core.aplicarTaxas({ precoCentavos: 10000, comissaoCentavos: 2500, repasseCentavos: 7500, taxaFixaCentavos: 0, horasMin: 0.5, horasMax: 3, maxSemana: 5, versao: 0 });
  assert.deepEqual(core.calcularPreco(), srv.calcularPreco());
  // o servidor jamais aceita split inconsistente
  assert.throws(() => srv.calcularPreco({ ...ok, repasseCentavos: 1 }), /inconsistente/);
}
console.log("✓ paridade navegador×servidor, aula 100/25/75, idade 18+, CREF e termos");

// 9) Camada de níveis/jogo: servidor e navegador idênticos
assert.deepEqual(cfg.NIVEIS.map((n) => [n.id, n.comissaoPct, n.minConcluidos]), srv.NIVEIS.map((n) => [n.id, n.comissaoPct, n.minConcluidos]), "NIVEIS diverge");
assert.deepEqual(cfg.CHAMADOS_PARA_SUBIR, srv.CHAMADOS_PARA_SUBIR);
for (const [n, id] of [[0, "bronze"], [29, "bronze"], [30, "prata"], [89, "prata"], [90, "ouro"], [189, "ouro"], [190, "platina"]]) { assert.equal(srv.nivelPorConcluidos(n).id, id); assert.equal(core.nivelPorConcluidos(n).id, id); }
for (const n of ["bronze", "prata", "ouro", "platina"]) for (const b of [0, 3000]) assert.deepEqual(core.calcularPreco(n, b), srv.calcularPreco(srv.PADRAO, n, b), `calcularPreco ${n}/${b}`);
assert.equal(cfg.GEO_RAIO_METROS, SC.GEO.RAIO_METROS); assert.equal(cfg.VIDAS_MAX, SC.VIDAS_MAX); assert.equal(cfg.CANCELAMENTO_TARDIO_HORAS, SC.CANCELAMENTO_TARDIO_HORAS);
assert.deepEqual(cfg.BONUS_RELAMPAGO_CENTAVOS, SC.RELAMPAGO.BONUS_OPCOES_CENTAVOS);
for (const perfil of ["aluno", "personal"]) { const t = core.textoTermos(perfil); assert.match(t, /Platina 10%/); assert.match(t, /advertência/); assert.match(t, /100 m|foto/); }
