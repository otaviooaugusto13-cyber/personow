// Funções puras (sem DOM, sem Firebase): dinheiro, validação, formatação.
// Testadas em node: `npm test`. As regras de dinheiro espelham server/regras.js.
import { COMISSAO_PCT, TAXA_FIXA_CENTAVOS, DURACAO_MIN_MINUTOS, DURACAO_MAX_MINUTOS, VALOR_MINIMO_CENTAVOS, VALOR_MAXIMO_CENTAVOS } from "./config.js";

// ---------- Dinheiro (sempre em CENTAVOS inteiros) ----------
export const reaisParaCentavos = (v) => {
    if (typeof v === "string") v = v.replace(/\./g, "").replace(",", ".");
    const n = Math.round(Number(v) * 100);
    return Number.isFinite(n) ? n : 0;
};
export const brl = (centavos) => ((Number(centavos) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const hhmmValido = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ""));
export const minutosEntre = (entrada, saida) => {
    if (!hhmmValido(entrada) || !hhmmValido(saida)) return 0;
    const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
    return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
};

/** Divide o valor da aula. O personal fica com o resto: arredondamento nunca o prejudica. */
export function calcularSplit(valorCentavos, pct = COMISSAO_PCT, taxaFixa = TAXA_FIXA_CENTAVOS) {
    const valor = Math.round(valorCentavos);
    if (!Number.isInteger(valor) || valor <= 0) throw new Error("valor inválido");
    const comissao = Math.round((valor * pct) / 100);
    const personal = valor - comissao;
    return { valor, personal, comissao, taxaFixa, app: comissao + taxaFixa, total: valor + taxaFixa, pct };
}

/** "" se a aula é válida; senão a mensagem de erro. */
export function validarAula(entrada, saida, valorCentavos) {
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

// ---------- Agenda do personal ----------
export const STATUS_QUE_OCUPAM_AGENDA = ["aceita", "paga", "concluida"];
export function aulasConflitam(a, b) {
    if (!a || !b || a.data !== b.data) return false;
    const ini = (x) => minutosEntre("00:00", x.entrada), fim = (x) => minutosEntre("00:00", x.saida);
    return ini(a) < fim(b) && ini(b) < fim(a);
}
export const conflitoNaAgenda = (historico, nova, ignorarId = "") =>
    historico.find((x) => x.id !== ignorarId && STATUS_QUE_OCUPAM_AGENDA.includes(x.status) && aulasConflitam(x, nova));

// ---------- Chat: tentativa de levar a negociação para fora do app ----------
// O servidor repete esta checagem (é ele quem vale); aqui serve só para avisar antes de enviar.
const FRASES_FUGA = ["whatsapp", "whats app", "wpp", "zap", "instagram", "insta", "telegram", "chave pix", "meu pix", "pix:", "me chama no pv", "chama no pv", "me liga", "meu numero", "meu número", "meu telefone", "meu celular", "meu email", "meu e-mail"];
const REGEX_TELEFONE = /(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/;
const REGEX_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const REGEX_LINK = /(https?:\/\/|www\.|wa\.me\/|t\.me\/)/i;
export function mensagemSuspeita(texto) {
    const t = String(texto || "").toLowerCase().normalize("NFC");
    const semEspacos = t.replace(/[\s.\-()]/g, "");
    return FRASES_FUGA.some((f) => t.includes(f)) || REGEX_TELEFONE.test(t) || /\d{10,}/.test(semEspacos) || REGEX_EMAIL.test(t) || REGEX_LINK.test(t);
}

// ---------- Formatação ----------
export const fmtData = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
export const fmtDataHora = (ts) => {
    const d = ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : ts ? new Date(ts) : null;
    return d && !isNaN(d) ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
};
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const soDigitos = (s) => String(s ?? "").replace(/\D/g, "");
export const ymdLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const hojeLocal = () => ymdLocal(new Date());
/** URL de imagem só se for https (evita javascript:/data: vindo de documento do banco). */
export const urlImagemSegura = (u) => (/^https:\/\//.test(u || "") ? u : "");

// ---------- Máscaras / documentos ----------
export const mascaraCPF = (v) => soDigitos(v).slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
export const mascaraTelefone = (v) => {
    const d = soDigitos(v).slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : "";
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
export function cpfValido(cpf) {
    cpf = soDigitos(cpf);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let t = 9; t < 11; t++) {
        let soma = 0;
        for (let i = 0; i < t; i++) soma += parseInt(cpf[i]) * (t + 1 - i);
        if (((soma * 10) % 11) % 10 !== parseInt(cpf[t])) return false;
    }
    return true;
}
/** 529.982.247-25 → ***.982.247-** (o aluno vê o recibo, mas não o CPF completo do personal). */
export const cpfMascarado = (cpf) => { const d = soDigitos(cpf); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : ""; };

// ---------- Aula (pedido) ----------
export const ROTULO_STATUS = { aberta: "Aguardando personal", aceita: "Aceita · pagar após a aula", paga: "Paga", concluida: "Concluída", cancelada: "Cancelada" };
export const estaPaga = (a) => a.status === "paga" || a.status === "concluida";
/** Valor da aula em centavos (aulas antigas guardavam reais em `valor`). */
export const valorCentavos = (a) => (Number.isInteger(a.valorCentavos) ? a.valorCentavos : reaisParaCentavos(a.valor));
/** O que o personal recebe (aulas antigas caem no cálculo). */
export const valorPersonal = (a) => {
    if (Number.isInteger(a.valorPersonalCentavos)) return a.valorPersonalCentavos;
    try { return calcularSplit(valorCentavos(a)).personal; } catch (e) { return 0; }
};
export const iconeFoco = (t) => {
    t = (t || "").toLowerCase();
    if (t.includes("hiper")) return "🔥"; if (t.includes("muscul")) return "💪"; if (t.includes("emag")) return "⚡";
    if (t.includes("func")) return "🤸"; if (t.includes("aval")) return "📋"; if (t.includes("corr")) return "🏃";
    return "🏋️";
};

// ---------- Textos legais ----------
export function textoTermos(perfil) {
    const comum = `<strong>Remuneração e taxas.</strong> A plataforma retém ${COMISSAO_PCT}% do valor de cada aula pela intermediação e pelo repasse automático via Mercado Pago${TAXA_FIXA_CENTAVOS ? `, além de uma taxa fixa de ${brl(TAXA_FIXA_CENTAVOS)} por aula paga pelo aluno` : ""}. A divisão é feita no momento do pagamento.<br><br>
  <strong>Limites.</strong> Cada aula tem de ${DURACAO_MIN_MINUTOS} minutos a ${DURACAO_MAX_MINUTOS / 60} horas, com valor entre ${brl(VALOR_MINIMO_CENTAVOS)} e ${brl(VALOR_MAXIMO_CENTAVOS)}.`;
    if (perfil === "personal") return `<strong>1. Autonomia.</strong> Você é profissional independente e escolhe as aulas que aceita. Não há vínculo empregatício com a plataforma ou com os alunos.<br><br>
  <strong>2.</strong> ${comum}<br><br>
  <strong>3. Aprovação.</strong> Seu cadastro (incluindo CPF e CREF) passa por análise antes de liberar os pedidos.<br><br>
  <strong>4. Compromisso.</strong> Aceitou, compareça. Se não puder, use “Desistir” com antecedência para a aula voltar à fila.<br><br>
  <strong>5. Negociação dentro do app.</strong> Compartilhar contatos ou chaves Pix para fechar aulas fora da plataforma viola estes termos e pode levar ao bloqueio da conta.<br><br>
  <strong>6. Obrigações fiscais.</strong> Seus ganhos podem ter obrigações tributárias (MEI/autônomo). O recibo emitido pela plataforma é um comprovante e não substitui NFS-e.`;
    return `<strong>1. O serviço.</strong> A plataforma conecta você a personal trainers autônomos. Eles não têm vínculo empregatício com a plataforma.<br><br>
  <strong>2.</strong> ${comum}<br><br>
  <strong>3. Pagamento.</strong> Você paga depois da aula, por Pix ou cartão, pelo Mercado Pago.<br><br>
  <strong>4. Cancelamento.</strong> Pode cancelar sem custo enquanto a aula não foi paga.<br><br>
  <strong>5. Recibo.</strong> A cada pagamento a plataforma emite um recibo da aula. Ele é um comprovante e não substitui NFS-e.<br><br>
  <strong>6. Saúde.</strong> Informe ao personal qualquer condição de saúde ou lesão antes do treino.`;
}
