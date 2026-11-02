// ============================================================
// REGRAS FINANCEIRAS DO SERVIDOR — é ela que vale de verdade.
// Deve ser idêntica a config.js/core.js (test/split.test.js confere).
//
// Modelo "aula" (por aula, valores em CENTAVOS inteiros):
//   Aluno paga                 = R$ 100,00  (VALOR_AULA_CENTAVOS)
//   Comissão da plataforma     = R$  25,00  (retida automaticamente; nível Bronze)
//   Repasse ao personal        = R$  75,00  (cai na carteira digital)
//
// Os VALORES em reais são a fonte da verdade; a porcentagem é apenas derivada (PCT_REPASSE = 75%).
// O padrão é uma SUPOSIÇÃO DE NEGÓCIO: ajuste no painel admin (Configurações → Taxas) sem mexer no código.
//
// DINÂMICO: os valores abaixo são apenas o PADRÃO (semente inicial e referência dos testes).
// Em produção quem manda é o documento `configuracoes/taxas` no Firestore, editado pelo admin
// (PUT /admin/taxas) e lido via lib/taxas.js. Todas as funções recebem `cfg` e, sem ele, usam o PADRÃO.
// ============================================================
const PADRAO = Object.freeze({
  precoCentavos: 10000,       // aluno paga
  comissaoCentavos: 2500,     // retida pela plataforma
  repasseCentavos: 7500,      // vai para a carteira do personal
  taxaFixaCentavos: 0,        // não há taxa adicional para o aluno neste modelo
  horasMin: 0.5,              // duração mínima da aula
  horasMax: 3,                // duração máxima da aula
  maxSemana: 5,               // máx. de aulas do mesmo personal com o mesmo aluno por semana
  versao: 0
});
const VALOR_AULA_CENTAVOS = PADRAO.precoCentavos;
const COMISSAO_PLATAFORMA_CENTAVOS = PADRAO.comissaoCentavos;
const REPASSE_PERSONAL_CENTAVOS = PADRAO.repasseCentavos;
const TAXA_FIXA_CENTAVOS = PADRAO.taxaFixaCentavos;
const HORAS_MIN_AULA = PADRAO.horasMin;
const HORAS_MAX_AULA = PADRAO.horasMax;
const MAX_VEZES_SEMANA_ALUNO = PADRAO.maxSemana;
const STATUS_QUE_CONTAM = ["aceita", "paga", "concluida"];

if (PADRAO.comissaoCentavos + PADRAO.repasseCentavos !== PADRAO.precoCentavos) {
  throw new Error("Configuração financeira inconsistente: comissão + repasse deve ser igual à aula.");
}
const PCT_REPASSE = (REPASSE_PERSONAL_CENTAVOS * 100) / VALOR_AULA_CENTAVOS; // 75
const PCT_COMISSAO = 100 - PCT_REPASSE;                                             // 25

// ---------- validação das taxas editadas pelo admin ----------
const LIMITES = Object.freeze({
  precoCentavos: [1000, 500000],   // R$ 10,00 a R$ 5.000,00
  taxaFixaCentavos: [0, 50000],     // R$ 0,00 a R$ 500,00
  horas: [0.5, 12],
  maxSemana: [1, 7]
});
const brlTxt = (c) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const inteiro = (v) => typeof v === "number" && Number.isSafeInteger(v);
const meiaHora = (v) => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v * 2);

/**
 * Valida e normaliza as taxas. Retorna { erro: "", cfg } ou { erro: "mensagem" }.
 * Só aceita NÚMEROS (nada de string), centavos inteiros, e exige comissão + repasse === aula.
 * Campos desconhecidos são ignorados (o cliente não injeta nada no documento).
 */
function validarTaxas(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { erro: "Corpo inválido." };
  const { precoCentavos: d, comissaoCentavos: c, repasseCentavos: r, taxaFixaCentavos: t, horasMin: hmin, horasMax: hmax, maxSemana: ms } = b;
  for (const [nome, v] of [["aula", d], ["comissão", c], ["repasse", r], ["taxa fixa", t]]) if (!inteiro(v) || v < 0) return { erro: `Valor inválido em "${nome}" (use centavos inteiros, sem negativos).` };
  const [dMin, dMax] = LIMITES.precoCentavos, [tMin, tMax] = LIMITES.taxaFixaCentavos;
  if (d < dMin || d > dMax) return { erro: `A aula deve ficar entre ${brlTxt(dMin)} e ${brlTxt(dMax)}.` };
  if (t < tMin || t > tMax) return { erro: `A taxa fixa deve ficar entre ${brlTxt(tMin)} e ${brlTxt(tMax)}.` };
  if (r <= 0) return { erro: "O repasse ao personal precisa ser maior que zero." };
  if (c + r !== d) return { erro: `Comissão (${brlTxt(c)}) + repasse (${brlTxt(r)}) precisa ser igual à aula (${brlTxt(d)}); ${c + r > d ? "sobram" : "faltam"} ${brlTxt(Math.abs(d - c - r))}.` };
  const [hLo, hHi] = LIMITES.horas;
  if (!meiaHora(hmin) || !meiaHora(hmax)) return { erro: "A duração da aula deve ser em horas inteiras ou meias horas (ex.: 1 ou 1,5)." };
  if (hmin < hLo || hmax > hHi) return { erro: `A duração da aula deve ficar entre ${hLo} h e ${hHi} h.` };
  if (hmin > hmax) return { erro: "A duração mínima da aula não pode ser maior que a máxima." };
  const [sLo, sHi] = LIMITES.maxSemana;
  if (!inteiro(ms) || ms < sLo || ms > sHi) return { erro: `O máximo de aulas por semana por aluno deve ser um inteiro de ${sLo} a ${sHi}.` };
  return { erro: "", cfg: { precoCentavos: d, comissaoCentavos: c, repasseCentavos: r, taxaFixaCentavos: t, horasMin: hmin, horasMax: hmax, maxSemana: ms } };
}

const minutosEntre = (entrada, saida) => {
  const ok = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ""));
  if (!ok(entrada) || !ok(saida)) return 0;
  const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
  return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
};

// ---------- Níveis de confiabilidade (gamificação) ----------
// Regra pedida: Bronze (início) 25% · Prata (30 chamados) 20% · Ouro (+60) 15% · Platina (+100) 10%.
// Interpretação adotada: os números são ACRESCENTADOS a cada degrau (30 → 90 → 190 acumulados).
// Se o negócio quiser limiares absolutos (30/60/100), basta trocar CHAMADOS_PARA_SUBIR por [30, 30, 40].
const CHAMADOS_PARA_SUBIR = [30, 60, 100];
const NIVEIS_BASE = [
  { id: "bronze", nome: "Bronze", comissaoPct: 25 },
  { id: "prata", nome: "Prata", comissaoPct: 20 },
  { id: "ouro", nome: "Ouro", comissaoPct: 15 },
  { id: "platina", nome: "Platina", comissaoPct: 10 }
];
const NIVEIS = NIVEIS_BASE.map((n, i) => ({ ...n, minConcluidos: CHAMADOS_PARA_SUBIR.slice(0, i).reduce((a, b) => a + b, 0) }));
const nivelPorId = (id) => NIVEIS.find((n) => n.id === id) || NIVEIS[0];
const indiceNivel = (id) => Math.max(0, NIVEIS.findIndex((n) => n.id === id));
/** Maior nível cujo mínimo de chamados concluídos já foi atingido. */
const nivelPorConcluidos = (n) => { const c = Math.max(0, Math.floor(Number(n) || 0)); return [...NIVEIS].reverse().find((x) => c >= x.minConcluidos); };
/**
 * Comissão da plataforma, em centavos, para um nível. O Bronze é a comissão vigente das taxas (editável pelo admin);
 * os demais níveis escalam proporcionalmente (Prata = 20/25 da comissão do Bronze etc.). Com o padrão (R$ 100 / R$ 25),
 * dá exatamente R$ 50 · 40 · 30 · 20.
 */
const comissaoDoNivel = (id, cfg = PADRAO) => Math.round((cfg.comissaoCentavos * nivelPorId(id).comissaoPct) / NIVEIS[0].comissaoPct);
if (comissaoDoNivel("bronze") !== COMISSAO_PLATAFORMA_CENTAVOS) throw new Error("Configuração inconsistente: a comissão do Bronze deve ser igual à comissão padrão.");

/**
 * Divisão da aula. Sempre inteiros; comissão + repasse === aula (nada some, nada sobra).
 * `cfg` = taxas vigentes (padrão se omitido). `nivel`: define a comissão da plataforma. `bonusCentavos`: bônus de urgência
 * (chamado relâmpago) pago pelo aluno e repassado INTEGRALMENTE ao personal (a comissão incide só sobre a aula).
 */
function calcularPreco(cfg = PADRAO, nivel = "bronze", bonusCentavos = 0) {
  const { precoCentavos: valor, comissaoCentavos: comissaoBase, repasseCentavos: repasseBase, taxaFixaCentavos: taxaFixa } = cfg;
  if (comissaoBase + repasseBase !== valor) throw new Error("Configuração financeira inconsistente: comissão + repasse deve ser igual à aula.");
  const bonus = Number.isInteger(bonusCentavos) && bonusCentavos > 0 ? bonusCentavos : 0;
  const n = nivelPorId(nivel), comissao = comissaoDoNivel(n.id, cfg);
  return {
    valor,
    personal: valor - comissao + bonus,
    comissao,
    royalty: comissao,                 // alias de compatibilidade
    taxaFixa,
    app: comissao + taxaFixa,
    total: valor + taxaFixa + bonus,
    pct: (comissao * 100) / valor,
    bonus,
    nivel: n.id,
    comissaoBase,                      // comissão do Bronze nas taxas vigentes (permite reconstruir as taxas congeladas a partir do split)
    modelo: "aula-v1",
    versaoTaxas: cfg.versao || 0       // qual versão das taxas gerou este split (rastreabilidade)
  };
}

/**
 * Reconstrói as taxas (cfg) que geraram um split já gravado — a aula guarda o split "congelado" e, no aceite, a comissão
 * passa a depender do nível; este atalho devolve a base (Bronze) para recalcular sem reler as taxas vigentes. null se o split for inválido.
 */
function cfgDoSplit(sp) {
  if (!sp || ![sp.valor, sp.taxaFixa].every(Number.isInteger)) return null;
  const base = Number.isInteger(sp.comissaoBase) ? sp.comissaoBase : Math.round((sp.comissao * NIVEIS[0].comissaoPct) / nivelPorId(sp.nivel).comissaoPct);
  if (!Number.isInteger(base) || base < 0 || base >= sp.valor) return null;
  return { precoCentavos: sp.valor, comissaoCentavos: base, repasseCentavos: sp.valor - base, taxaFixaCentavos: sp.taxaFixa, versao: sp.versaoTaxas || 0 };
}

/** O preço é fixo por aula, independente da duração. */
function calcularAula(minutos, cfg = PADRAO) {
  const m = Math.round(minutos);
  if (!Number.isInteger(m) || m <= 0) throw new Error("duração inválida");
  return { ...calcularPreco(cfg), minutos: m, horas: m / 60, liquidoPersonal: cfg.repasseCentavos };
}

/** "" se o horário é válido; senão a mensagem de erro. */
function validarAula(entrada, saida, cfg = PADRAO) {
  const m = minutosEntre(entrada, saida);
  if (m <= 0) return "A saída precisa ser depois da entrada.";
  if (m < cfg.horasMin * 60) return `A aula precisa ter no mínimo ${cfg.horasMin} horas.`;
  if (m > cfg.horasMax * 60) return `A aula pode ter no máximo ${cfg.horasMax} horas.`;
  return "";
}

// ---------- semana (segunda a domingo) ----------
const paraUTC = (iso) => { const [a, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const deUTC = (dt) => dt.toISOString().slice(0, 10);
function limitesSemana(iso) {
  const dt = paraUTC(iso), dow = (dt.getUTCDay() + 6) % 7; // 0 = segunda
  const ini = new Date(dt); ini.setUTCDate(dt.getUTCDate() - dow);
  const fim = new Date(ini); fim.setUTCDate(ini.getUTCDate() + 6);
  return { inicio: deUTC(ini), fim: deUTC(fim) };
}
/** Quantas aulas desse personal já existem com o mesmo aluno, na semana da data informada. */
function vezesNaSemana(historico, alunoUid, dataIso, ignorarId = "") {
  const { inicio, fim } = limitesSemana(dataIso);
  return historico.filter((t) => t.id !== ignorarId && t.uid === alunoUid && STATUS_QUE_CONTAM.includes(t.status) && t.data >= inicio && t.data <= fim).length;
}

module.exports = {
  PADRAO, LIMITES, validarTaxas,
  CHAMADOS_PARA_SUBIR, NIVEIS, nivelPorId, indiceNivel, nivelPorConcluidos, comissaoDoNivel, cfgDoSplit,
  VALOR_AULA_CENTAVOS, COMISSAO_PLATAFORMA_CENTAVOS, REPASSE_PERSONAL_CENTAVOS, TAXA_FIXA_CENTAVOS,
  HORAS_MIN_AULA, HORAS_MAX_AULA, MAX_VEZES_SEMANA_ALUNO, STATUS_QUE_CONTAM, PCT_REPASSE, PCT_COMISSAO,
  minutosEntre, calcularPreco, calcularAula, validarAula, limitesSemana, vezesNaSemana
};
