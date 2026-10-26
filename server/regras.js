// ============================================================
// REGRAS DE NEGÓCIO DO PERSONOW — o servidor é quem manda de verdade.
// Deve ser idêntica a config.js/core.js (test/regras.test.js confere).
//
// Modelo (por aula):
//   O aluno propõe o valor da aula (ex.: R$ 80,00).
//   Comissão da plataforma = COMISSAO_PCT % do valor da aula.
//   Personal recebe        = valor − comissão (fica com o resto: nunca perde centavo).
//   Aluno paga             = valor + taxa fixa (0 por padrão; ajustável).
// ============================================================
const COMISSAO_PCT = 15;
const TAXA_FIXA_CENTAVOS = 0;
const DURACAO_MIN_MINUTOS = 30;
const DURACAO_MAX_MINUTOS = 180;
const VALOR_MINIMO_CENTAVOS = 3000;     // R$ 30,00
const VALOR_MAXIMO_CENTAVOS = 100000;   // R$ 1.000,00
const EXCLUSIVIDADE_MINUTOS = 5;        // "Chamar agora": só o personal escolhido vê o pedido por 5 min
const MAX_AULAS_ABERTAS_ALUNO = 5;      // evita spam de pedidos em aberto
const FOCOS = ["Musculação", "Hipertrofia", "Emagrecimento", "Corrida", "Funcional", "Avaliação Física"];
const STATUS_QUE_OCUPAM_AGENDA = ["aceita", "paga", "concluida"];

const brl = (centavos) => ((Number(centavos) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hhmmValido = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ""));

const minutosEntre = (entrada, saida) => {
  if (!hhmmValido(entrada) || !hhmmValido(saida)) return 0;
  const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
  return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
};

/** Divide o valor da aula (centavos). O personal fica com o resto: arredondamento nunca o prejudica. */
function calcularSplit(valorCentavos, pct = COMISSAO_PCT, taxaFixa = TAXA_FIXA_CENTAVOS) {
  const valor = Math.round(valorCentavos);
  if (!Number.isInteger(valor) || valor <= 0) throw new Error("valor inválido");
  const comissao = Math.round((valor * pct) / 100);
  const personal = valor - comissao;
  return { valor, personal, comissao, taxaFixa, app: comissao + taxaFixa, total: valor + taxaFixa, pct };
}

/** "" se a aula é válida; senão a mensagem de erro para mostrar ao aluno. */
function validarAula(entrada, saida, valorCentavos) {
  if (!hhmmValido(entrada) || !hhmmValido(saida)) return "Informe o horário de início e de término da aula.";
  const m = minutosEntre(entrada, saida);
  if (m <= 0) return "O término precisa ser depois do início.";
  if (m < DURACAO_MIN_MINUTOS) return `A aula precisa ter pelo menos ${DURACAO_MIN_MINUTOS} minutos.`;
  if (m > DURACAO_MAX_MINUTOS) return `A aula pode ter no máximo ${DURACAO_MAX_MINUTOS / 60} horas.`;
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return "Informe o valor que deseja pagar pela aula.";
  if (valorCentavos < VALOR_MINIMO_CENTAVOS) return `O valor mínimo por aula é ${brl(VALOR_MINIMO_CENTAVOS)}.`;
  if (valorCentavos > VALOR_MAXIMO_CENTAVOS) return `O valor máximo por aula é ${brl(VALOR_MAXIMO_CENTAVOS)}.`;
  return "";
}

/** Duas aulas do mesmo dia se sobrepõem? (encostar — 10:00 fim / 10:00 início — NÃO é conflito) */
function aulasConflitam(a, b) {
  if (!a || !b || a.data !== b.data) return false;
  const ini = (x) => minutosEntre("00:00", x.entrada), fim = (x) => minutosEntre("00:00", x.saida);
  return ini(a) < fim(b) && ini(b) < fim(a);
}

/** Primeira aula do histórico do personal que conflita com a nova (ou undefined). */
function conflitoNaAgenda(historico, nova, ignorarId = "") {
  return historico.find((x) => x.id !== ignorarId && STATUS_QUE_OCUPAM_AGENDA.includes(x.status) && aulasConflitam(x, nova));
}

/** Palavras/padrões que indicam tentativa de levar a negociação para fora da plataforma. */
const FRASES_FUGA = ["whatsapp", "whats app", "wpp", "zap", "instagram", "insta", "telegram", "chave pix", "meu pix", "pix:", "me chama no pv", "chama no pv", "me liga", "meu numero", "meu número", "meu telefone", "meu celular", "meu email", "meu e-mail"];
const REGEX_TELEFONE = /(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/;
const REGEX_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const REGEX_LINK = /(https?:\/\/|www\.|wa\.me\/|t\.me\/)/i;
function mensagemSuspeita(texto) {
  const t = String(texto || "").toLowerCase().normalize("NFC");
  const semEspacos = t.replace(/[\s.\-()]/g, "");
  return FRASES_FUGA.some((f) => t.includes(f)) || REGEX_TELEFONE.test(t) || /\d{10,}/.test(semEspacos) || REGEX_EMAIL.test(t) || REGEX_LINK.test(t);
}

module.exports = {
  COMISSAO_PCT, TAXA_FIXA_CENTAVOS, DURACAO_MIN_MINUTOS, DURACAO_MAX_MINUTOS, VALOR_MINIMO_CENTAVOS, VALOR_MAXIMO_CENTAVOS,
  EXCLUSIVIDADE_MINUTOS, MAX_AULAS_ABERTAS_ALUNO, FOCOS, STATUS_QUE_OCUPAM_AGENDA,
  hhmmValido, minutosEntre, calcularSplit, validarAula, aulasConflitam, conflitoNaAgenda, mensagemSuspeita
};
