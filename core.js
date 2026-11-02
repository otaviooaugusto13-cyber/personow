// Funções puras (sem DOM, sem Firebase): dinheiro, validação, formatação.
// Testadas em node: `node test/split.test.js`
import { NIVEIS, GEO_RAIO_METROS, CANCELAMENTO_TARDIO_HORAS, VALOR_AULA_CENTAVOS, COMISSAO_PLATAFORMA_CENTAVOS, REPASSE_PERSONAL_CENTAVOS, TAXA_FIXA_CENTAVOS, HORAS_MIN_AULA, HORAS_MAX_AULA, MAX_VEZES_SEMANA_ALUNO, IDADE_MINIMA, CREF_REGEX, UFS } from "./config.js";

// ---------- Taxas vigentes (DINÂMICAS) ----------
// Começam no padrão de config.js (o app abre mesmo offline) e são substituídas pelo que o servidor devolve em
// GET /config/taxas (ver taxas.js). Objeto único e mutável: todo módulo que importa TAXAS enxerga a mudança.
export const TAXAS = {
    precoCentavos: VALOR_AULA_CENTAVOS, comissaoCentavos: COMISSAO_PLATAFORMA_CENTAVOS, repasseCentavos: REPASSE_PERSONAL_CENTAVOS,
    taxaFixaCentavos: TAXA_FIXA_CENTAVOS, horasMin: HORAS_MIN_AULA, horasMax: HORAS_MAX_AULA, maxSemana: MAX_VEZES_SEMANA_ALUNO, versao: 0
};
/** Aplica taxas vindas do servidor. Ignora (e devolve false) qualquer coisa incoerente — melhor manter o valor anterior do que exibir lixo. */
export function aplicarTaxas(t) {
    const k = ["precoCentavos", "comissaoCentavos", "repasseCentavos", "taxaFixaCentavos", "horasMin", "horasMax", "maxSemana"];
    if (!t || !k.every((x) => Number.isFinite(t[x]) && t[x] >= 0)) return false;
    if (t.comissaoCentavos + t.repasseCentavos !== t.precoCentavos || t.horasMin > t.horasMax) return false;
    Object.assign(TAXAS, Object.fromEntries(k.map((x) => [x, t[x]])), { versao: Number(t.versao) || 0 });
    return true;
}

// ---------- Dinheiro (sempre em CENTAVOS inteiros) ----------
export const reaisParaCentavos = (v) => {
    if (typeof v === "string") v = v.replace(/\./g, "").replace(",", ".");
    const n = Math.round(Number(v) * 100);
    return Number.isFinite(n) ? n : 0;
};

export const minutosEntre = (entrada, saida) => {
    const ok = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ""));
    if (!ok(entrada) || !ok(saida)) return 0;
    const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
    return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
};
export const nivelPorId = (id) => NIVEIS.find((n) => n.id === id) || NIVEIS[0];
export const nivelPorConcluidos = (n) => { const c = Math.max(0, Math.floor(Number(n) || 0)); return [...NIVEIS].reverse().find((x) => c >= x.minConcluidos); };
/** Comissão da plataforma para um nível: o Bronze é a comissão vigente (TAXAS, editável pelo admin); os demais níveis escalam proporcionalmente. */
export const comissaoDoNivel = (id) => Math.round((TAXAS.comissaoCentavos * nivelPorId(id).comissaoPct) / NIVEIS[0].comissaoPct);
/** Divisão da aula por nível (+ bônus de urgência, 100% do personal). O servidor repete este cálculo — o navegador só exibe. */
export function calcularPreco(nivel = "bronze", bonusCentavos = 0) {
    const { precoCentavos: valor, taxaFixaCentavos: taxaFixa, comissaoCentavos: comissaoBase } = TAXAS;
    const bonus = Number.isInteger(bonusCentavos) && bonusCentavos > 0 ? bonusCentavos : 0, n = nivelPorId(nivel), comissao = comissaoDoNivel(n.id);
    return { valor, personal: valor - comissao + bonus, comissao, royalty: comissao, taxaFixa, app: comissao + taxaFixa, total: valor + taxaFixa + bonus,
        pct: (comissao * 100) / valor, bonus, nivel: n.id, comissaoBase, modelo: "aula-v1", versaoTaxas: TAXAS.versao };
}
/** Compatível com o código antigo: o preço é a aula fixa, independente da duração. */
export function calcularAula(minutos) {
    const m = Math.round(minutos);
    if (!Number.isInteger(m) || m <= 0) throw new Error("duração inválida");
    return { ...calcularPreco(), minutos: m, horas: m / 60, liquidoPersonal: TAXAS.repasseCentavos };
}
/** "" se o horário é válido; senão a mensagem de erro. */
export function validarAula(entrada, saida) {
    const m = minutosEntre(entrada, saida);
    if (m <= 0) return "A saída precisa ser depois da entrada.";
    if (m < TAXAS.horasMin * 60) return `A aula precisa ter no mínimo ${TAXAS.horasMin} horas.`;
    if (m > TAXAS.horasMax * 60) return `A aula pode ter no máximo ${TAXAS.horasMax} horas.`;
    return "";
}

// ---------- Semana (segunda a domingo) e frequência por aluno ----------
export const STATUS_QUE_CONTAM = ["aceita", "paga", "concluida"];
const paraUTC = (iso) => { const [a, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const deUTC = (dt) => dt.toISOString().slice(0, 10);
export function limitesSemana(iso) {
    const dt = paraUTC(iso), dow = (dt.getUTCDay() + 6) % 7;
    const ini = new Date(dt); ini.setUTCDate(dt.getUTCDate() - dow);
    const fim = new Date(ini); fim.setUTCDate(ini.getUTCDate() + 6);
    return { inicio: deUTC(ini), fim: deUTC(fim) };
}
export function vezesNaSemana(historico, alunoUid, dataIso, ignorarId = "") {
    const { inicio, fim } = limitesSemana(dataIso);
    return historico.filter((t) => t.id !== ignorarId && t.uid === alunoUid && STATUS_QUE_CONTAM.includes(t.status) && t.data >= inicio && t.data <= fim).length;
}

// ---------- O que cada lado pode VER (privacidade de valores) ----------
/** Aluno: valor cobrado pelo serviço + taxa de serviço fixa. Nunca repasse, royalty ou margem. */
export const visaoAluno = (s) => ({ valor: s.valor, taxaFixa: s.taxaFixa, total: s.total, ...(s.bonus ? { bonus: s.bonus } : {}) });
/** Personal: apenas o líquido que ele recebe. Nunca o total pago pelo aluno. */
export const visaoPersonal = (s) => ({ liquido: s.personal });
/** Líquido do personal de uma aula (aulas antigos, sem o campo novo, caem no cálculo). */
export const valorPersonal = (p) => {
    return Number.isInteger(p.valorPersonalCentavos) ? p.valorPersonalCentavos : TAXAS.repasseCentavos;
};

// ---------- Idade (espelho do servidor; o servidor decide) ----------
export const dataIsoValida = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return false; const d = new Date(iso + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === iso; };
export function calcularIdade(nascIso, refIso = hojeLocal()) {
    const [a, m, d] = nascIso.split("-").map(Number), [ra, rm, rd] = refIso.split("-").map(Number);
    return ra - a - (rm < m || (rm === m && rd < d) ? 1 : 0);
}
/** { erro: "" } se ok; senão a mensagem. Personal trainer: só maiores de 18 anos. */
export function validarNascimento(iso) {
    if (!dataIsoValida(iso)) return { erro: "Informe uma data de nascimento válida." };
    if (iso > hojeLocal()) return { erro: "A data de nascimento não pode estar no futuro." };
    const idade = calcularIdade(iso);
    if (idade < IDADE_MINIMA) return { erro: `É preciso ter pelo menos ${IDADE_MINIMA} anos para se cadastrar.`, idade };
    if (idade > 100) return { erro: "Data de nascimento inválida." };
    return { erro: "", idade };
}
/** Limites do campo <input type=date>: do mais velho possível ao que completa 18 hoje. */
export function limitesNascimento() {
    const [a, m, d] = hojeLocal().split("-").map(Number), f = (anos) => new Date(Date.UTC(a - anos, m - 1, d)).toISOString().slice(0, 10);
    return { min: f(100), max: f(IDADE_MINIMA) };
}
/** "" se o CREF é válido (ex.: 012345-G/SP); senão a mensagem. */
export const crefValido = (v) => { const s = String(v ?? "").toUpperCase().replace(/\s+/g, ""); return CREF_REGEX.test(s) && UFS.includes(s.slice(-2)) ? "" : "Use o formato do seu registro, ex.: 012345-G/SP."; };
export const normalizarCref = (v) => String(v ?? "").toUpperCase().replace(/\s+/g, "");

// ---------- Formatação ----------
export const brl = (centavos) => ((Number(centavos) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtData = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
export const fmtDataHora = (ts) => {
    const d = ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : ts ? new Date(ts) : null;
    return d && !isNaN(d) ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
};
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const soDigitos = (s) => String(s ?? "").replace(/\D/g, "");
export const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const horasEntre = (entrada, saida) => {
    if (!entrada || !saida) return 0;
    const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
    return Math.max(0, (h2 * 60 + m2 - (h1 * 60 + m1)) / 60);
};

// ---------- Máscaras ----------
export const mascaraCPF = (v) => soDigitos(v).slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
export const mascaraCNPJ = (v) => soDigitos(v).slice(0, 14).replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
export const mascaraDoc = (v) => (soDigitos(v).length <= 11 ? mascaraCPF(v) : mascaraCNPJ(v));
export const mascaraTelefone = (v) => {
    const d = soDigitos(v).slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : "";
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

// ---------- Validação de documentos ----------
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
export function cnpjValido(cnpj) {
    cnpj = soDigitos(cnpj);
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
    const calc = (base) => {
        let soma = 0, peso = base.length - 7;
        for (let i = 0; i < base.length; i++) { soma += parseInt(base[i]) * peso--; if (peso < 2) peso = 9; }
        const r = soma % 11;
        return r < 2 ? 0 : 11 - r;
    };
    return calc(cnpj.slice(0, 12)) === parseInt(cnpj[12]) && calc(cnpj.slice(0, 13)) === parseInt(cnpj[13]);
}
export const docValido = (d) => (soDigitos(d).length === 11 ? cpfValido(d) : cnpjValido(d));

// ---------- Aula ----------
export const ROTULO_STATUS = {
    aberta: "Aguardando personal",
    aceita: "Aceito · pagar após o serviço",
    paga: "Pago",
    concluida: "Concluído",
    cancelada: "Cancelado"
};
/** Aula paga = tem nota. Mantém compatível com aulas antigos que usavam só "concluida". */
export const estaPago = (p) => p.status === "paga" || p.status === "concluida";
/** Valor da aula em centavos (aulas antigos guardavam reais em `valor`). */
export const valorCentavos = (p) => (p.valorCentavos ? p.valorCentavos : reaisParaCentavos(p.valor));

// ---------- Modalidades de aula (usado por aluno e personal) ----------
export const MODALIDADES = [
    { v: "Musculação", ico: "🏋️", label: "Musculação" },
    { v: "Treino funcional", ico: "🔥", label: "Funcional" },
    { v: "Emagrecimento", ico: "⚖️", label: "Emagrecimento" },
    { v: "Corrida e endurance", ico: "🏃", label: "Corrida" },
    { v: "Pilates", ico: "🤸", label: "Pilates" },
    { v: "Yoga", ico: "🧘", label: "Yoga" },
    { v: "Lutas e artes marciais", ico: "🥊", label: "Lutas" },
    { v: "Dança e ritmos", ico: "💃", label: "Dança" },
    { v: "Reabilitação e pós-lesão", ico: "🩹", label: "Reabilitação" },
    { v: "Consultoria de treino online", ico: "💻", label: "Consultoria online" },
    { v: "Avaliação física", ico: "📏", label: "Avaliação física" }
];

// ---------- Habilitação por categoria (espelho de server/lib/config.js; test/split.test.js confere) ----------
// O servidor é quem decide (aceitarAula). Aqui só serve para a interface mostrar cadeado/selo sem ir à rede.
export const CATEGORIAS = {
    musculacao: { titulo: "Musculação", ico: "🏋️" }, funcional: { titulo: "Funcional", ico: "🔥" }, endurance: { titulo: "Corrida e endurance", ico: "🏃" },
    mentecorpo: { titulo: "Mente e corpo", ico: "🧘" }, lutas: { titulo: "Lutas", ico: "🥊" }, consultoria: { titulo: "Consultoria", ico: "💻" }
};
export const MODALIDADE_CATEGORIA = {
    "Musculação": "musculacao", "Treino funcional": "funcional", "Corrida e endurance": "endurance", "Pilates": "mentecorpo", "Yoga": "mentecorpo",
    "Lutas e artes marciais": "lutas", "Consultoria de treino online": "consultoria",
    "Emagrecimento": "funcional", "Dança e ritmos": "funcional", "Reabilitação e pós-lesão": "mentecorpo", "Avaliação física": "consultoria"
};
export const categoriaDaModalidade = (foco) => MODALIDADE_CATEGORIA[foco] || null;

// ---------- Textos ----------
// A discriminação de taxas/comissões aparece SOMENTE nos Termos de Uso ("Li e concordo").
// Telas, checkout, resumos e nota mostram apenas o que cada lado precisa ver.
export function textoTermos(perfil) {
    const preco = brl(TAXAS.precoCentavos), com = brl(TAXAS.comissaoCentavos), rep = brl(TAXAS.repasseCentavos);
    const comuns = `<strong>Remuneração e comissão.</strong> A aula padrão é de ${preco} por aula. A comissão da plataforma é <strong>progressiva</strong>, conforme o nível de confiabilidade do personal no momento do aceite: ${NIVEIS.map((n) => `${n.nome} ${String(Math.round(calcularPreco(n.id).pct * 10) / 10).replace(".", ",")}% (comissão de ${brl(calcularPreco(n.id).comissao)}, repasse de ${brl(calcularPreco(n.id).personal)}; a partir de ${n.minConcluidos} chamados concluídos)`).join("; ")}. O valor pago pelo aluno é sempre o mesmo; o nível só muda a divisão. Ficando 2 meses sem concluir chamados, o nível é rebaixado. O repasse é creditado na carteira digital do personal (início no Bronze: retenção de ${com} e repasse de ${rep}). O repasse fica em carência por alguns dias antes de poder ser sacado e pode ser estornado em caso de reembolso ou contestação do pagamento.<br><br>
  <strong>Limites de aula.</strong> Cada aula tem de ${TAXAS.horasMin} a ${TAXAS.horasMax} horas, e o mesmo personal pode trabalhar no máximo ${TAXAS.maxSemana} vezes por semana (segunda a domingo) na mesmo aluno.`;
    if (perfil === "personal") return `<strong>1. Autonomia.</strong> Você é prestador independente; escolhe as aulas que aceita. Não há vínculo empregatício com a plataforma ou com os alunos.<br><br>
  <strong>2.</strong> ${comuns}<br><br>
  <strong>3. Idade e registro profissional.</strong> O cadastro é permitido a partir dos ${IDADE_MINIMA} anos e exige registro ativo no CREF (Lei 9.696/1998). O número é conferido pela equipe antes da aprovação; registro irregular ou vencido suspende a conta.<br><br>
  <strong>4. Treinamento obrigatório.</strong> Para aceitar aulas é preciso concluir todos os vídeos de capacitação do programa Personow.<br><br>
  <strong>5. Aprovação.</strong> Seu cadastro passa por análise antes de liberar as ofertas.<br><br>
  <strong>6. Compromisso.</strong> Aceitou, compareça. Se não puder, use “Desistir” com antecedência para a aula voltar à fila. Desistir ou faltar com menos de ${CANCELAMENTO_TARDIO_HORAS} h do início gera advertência e multa; na 3ª advertência a conta é bloqueada permanentemente.<br><br>
  <strong>6-A. Presença e foto.</strong> O check-in só é aceito a até ${GEO_RAIO_METROS} m do aluno, pelo GPS do aparelho, e o check-out exige uma foto do local da aula, guardada para auditoria do aluno e, quando houver, do parceiro (academia) vinculado. O pagamento só é liberado depois do serviço executado.<br><br>
  <strong>7. Obrigações fiscais.</strong> Seus ganhos podem ter obrigações tributárias. A nota emitida pela plataforma é um comprovante do aluno e não substitui NFS-e.<br><br>
  <strong>8. Dados pessoais.</strong> CPF, nascimento, telefone e chave Pix são guardados cifrados e usados apenas para cadastro, pagamento e obrigações legais.`;
    return `<strong>1. O serviço.</strong> A plataforma conecta a seu aluno a personais autônomos. Eles não têm vínculo empregatício com a plataforma nem com o aluno.<br><br>
  <strong>2.</strong> ${comuns}<br><br>
  <strong>3. Cartão de crédito.</strong> Para solicitar ou pagar um serviço é obrigatório manter um cartão de crédito válido cadastrado.<br><br>
  <strong>4. Pagamento.</strong> Você só paga depois do serviço, por Pix ou cartão, pelo Mercado Pago.<br><br>
  <strong>5. Cancelamento e advertências.</strong> Pode cancelar sem custo com antecedência. Cancelar com menos de ${CANCELAMENTO_TARDIO_HORAS} h do início de uma aula já aceito, ou não receber o personal no horário, gera advertência e multa ao aluno, com registro de infração; na 3ª advertência a conta é bloqueada. Depois do check-in do personal a aula não pode mais ser cancelado.<br><br>
  <strong>5-A. Auditoria.</strong> A foto do check-out fica disponível para o aluno avaliar e, se houver parceiro (academia) vinculado à aula, também para ele, junto com o histórico de presença por GPS.<br><br>
  <strong>6. Nota.</strong> A cada pagamento a plataforma emite uma nota de serviço em nome da sua empresa. Ela é um comprovante e não substitui NFS-e.`;
}
