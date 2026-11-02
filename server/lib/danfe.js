// ============================================================
// COMPROVANTE DE SERVIÇO (layout DANFE simplificado) — lógica pura, sem banco e sem rede.
//
// IMPORTANTE (fiscal): um DANFE é a representação impressa de uma NF-e AUTORIZADA pela SEFAZ (XML assinado com certificado
// digital + protocolo de autorização). Esta plataforma intermedeia serviços e hoje NÃO emite documento fiscal
// (nota.fiscal.nfse = null). Por isso este módulo:
//   • emite um "COMPROVANTE DE SERVIÇO — SEM VALOR FISCAL", com a mesma estrutura de blocos de um DANFE;
//   • usa no código de barras um CÓDIGO DE VERIFICAÇÃO PRÓPRIO (HMAC de 24 dígitos), nunca uma "chave de acesso" inventada;
//   • só trata o documento como fiscal quando a nota trouxer chave de 44 dígitos com dígito verificador válido + protocolo de
//     autorização + data de autorização (dados que só um emissor autorizado, p.ex. um provedor de NFS-e/NF-e, pode fornecer).
// ============================================================
const crypto = require("node:crypto");
const { Falha } = require("./erros");

// ---------- Code 128 (B e C) ----------
// Larguras (barra, espaço, barra, espaço, barra, espaço) de cada símbolo 0..106 (107 = parada, 7 elementos).
const PADROES = ["212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112"];
const START_B = 104, START_C = 105, PARADA = 106;

/** Codifica em Code 128. Só dígitos de tamanho par → subconjunto C (mais denso); senão → subconjunto B (ASCII 32–126). */
function code128(texto) {
  const t = String(texto);
  if (!t.length || t.length > 80) throw new Error("texto do código de barras inválido");
  const codigos = [];
  if (/^\d+$/.test(t) && t.length % 2 === 0) { codigos.push(START_C); for (let i = 0; i < t.length; i += 2) codigos.push(Number(t.slice(i, i + 2))); }
  else {
    codigos.push(START_B);
    for (const ch of t) { const c = ch.charCodeAt(0); if (c < 32 || c > 126) throw new Error("caractere fora do Code 128 B"); codigos.push(c - 32); }
  }
  const dv = codigos.reduce((soma, c, i) => soma + (i === 0 ? c : c * i), 0) % 103;
  codigos.push(dv, PARADA);
  const modulos = codigos.flatMap((c) => PADROES[c].split("").map(Number));       // alterna barra/espaço, começando por barra
  return { texto: t, codigos, modulos, total: modulos.reduce((a, b) => a + b, 0) };
}

// ---------- chave de acesso (44 dígitos, módulo 11) ----------
function chaveAcessoValida(chave) {
  const s = String(chave || "").replace(/\s/g, "");
  if (!/^\d{44}$/.test(s)) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11, dv = r < 2 ? 0 : 11 - r;
  return dv === Number(s[43]);
}
const agrupar = (s, n = 4) => String(s).replace(/\s/g, "").replace(new RegExp(`(.{${n}})`, "g"), "$1 ").trim();

// ---------- código de verificação (anti-adulteração do comprovante) ----------
/** 24 dígitos derivados por HMAC do número, do id, do total e da data de emissão. Só quem tem o segredo do servidor consegue gerar um válido. */
function codigoVerificacao(segredo, { id, numero, totalCentavos, emitidaEmMs }) {
  if (!segredo) throw new Falha(500, "Segredo de verificação não configurado.", "config");
  const chave = crypto.createHash("sha256").update(`nota-v1|${segredo}`).digest();
  const h = crypto.createHmac("sha256", chave).update(`${id}|${numero}|${totalCentavos}|${emitidaEmMs}`).digest("hex").slice(0, 20);
  return (BigInt("0x" + h) % 10n ** 24n).toString().padStart(24, "0");
}
const iguais = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- montagem do documento ----------
const cent = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const isoDe = (t) => (t?.toDate ? t.toDate().toISOString() : t instanceof Date ? t.toISOString() : typeof t === "number" ? new Date(t).toISOString() : null);

/**
 * Converte a nota gravada no pagamento (snapshot imutável) no documento exibido.
 * @param {object} nota   documento de /notas/{id}
 * @param {object} opc    { id, empresa, segredo, via, estornado }
 */
function montarDocumento(nota, { id, empresa, segredo, via = 1, estornado = false }) {
  const v = nota.valores || {}, sv = nota.servico || {}, t = nota.tomador || {}, p = nota.prestador || {}, pg = nota.pagamento || {};
  const valor = cent(v.valor), taxa = cent(v.taxaFixa), total = cent(v.total);
  if (!nota.numero || !nota.emitidaEm || valor + taxa !== total || total <= 0) throw new Falha(409, "Esta nota está inconsistente e não pode ser impressa. Fale com o suporte.", "nota-inconsistente");
  const itens = [
    { codigo: "SRV-001", descricao: sv.descricao || "Aula de treino / consultoria", detalhe: [sv.aluno, sv.data, sv.horario].filter(Boolean).join(" · "), un: "AULA", qtd: 1, unitarioCentavos: valor, totalCentavos: valor },
    { codigo: "TAXA-01", descricao: "Taxa de serviço da plataforma", detalhe: "", un: "UN", qtd: 1, unitarioCentavos: taxa, totalCentavos: taxa }
  ].filter((i) => i.totalCentavos > 0);
  if (itens.reduce((a, i) => a + i.totalCentavos, 0) !== total) throw new Falha(409, "Itens não fecham com o total da nota.", "nota-inconsistente");

  const f = nota.fiscal?.documento || nota.fiscal?.nfse || null;       // contrato para um emissor autorizado futuro
  const fiscal = !!f && chaveAcessoValida(f.chaveAcesso) && /^\d{15,}$/.test(String(f.protocolo || "")) && !!f.autorizadaEm;
  const homolog = fiscal && f.ambiente === "homologacao";
  const emitidaEmMs = nota.emitidaEm.toMillis ? nota.emitidaEm.toMillis() : Number(nota.emitidaEm);
  const verificacao = codigoVerificacao(segredo, { id, numero: nota.numero, totalCentavos: total, emitidaEmMs });
  const alvo = fiscal ? String(f.chaveAcesso).replace(/\s/g, "") : verificacao;       // o que vira código de barras
  const barras = code128(alvo);

  return {
    modo: fiscal ? "fiscal" : "comprovante",
    titulo: fiscal ? "DANFE SIMPLIFICADA — DOCUMENTO AUXILIAR" : "COMPROVANTE DE SERVIÇO",
    subtitulo: fiscal ? "Representação do documento fiscal eletrônico autorizado" : "Documento auxiliar não fiscal — layout baseado no DANFE",
    semValorFiscal: !fiscal || homolog,
    marcaDagua: !fiscal ? "SEM VALOR FISCAL" : homolog ? "HOMOLOGAÇÃO — SEM VALOR FISCAL" : "",
    estornado: !!estornado,
    via, emitidoAgora: new Date().toISOString(),
    emitente: { razaoSocial: empresa.razaoSocial, cnpj: empresa.cnpj, cidade: empresa.cidade, email: empresa.email },
    identificacao: {
      numero: nota.numero, numeroFmt: nota.numeroFmt || String(nota.numero).padStart(6, "0"), serie: nota.serie || "A1", emissao: isoDe(nota.emitidaEm),
      natureza: "Intermediação e prestação de serviço de aula de treino personalizado", tipo: nota.tipo || "nota_servico_plataforma"
    },
    codigo: { rotulo: fiscal ? "CHAVE DE ACESSO" : "CÓDIGO DE VERIFICAÇÃO", valor: alvo, formatado: agrupar(alvo), barras: { modulos: barras.modulos, total: barras.total }, protocolo: fiscal ? String(f.protocolo) : "", autorizadaEm: fiscal ? isoDe(f.autorizadaEm) : null, verificacao: agrupar(verificacao) },
    destinatario: { nome: t.nome || "—", documento: t.documento || "", endereco: t.endereco || "", email: t.email || "" },
    prestador: { nome: p.nome || "—", documento: p.documento || "" },
    servico: { aluno: sv.aluno || "", data: sv.data || "", horario: sv.horario || "" },
    itens,
    calculo: { valorServicosCentavos: valor, taxaServicoCentavos: taxa, descontoCentavos: 0, baseCalculoCentavos: valor + taxa, impostos: fiscal ? (f.impostos || null) : null, totalCentavos: total },
    pagamento: { metodo: pg.metodo || "", referencia: pg.mpPaymentId ? String(pg.mpPaymentId) : "", simulado: !!pg.simulado, status: estornado ? "estornado" : "pago" },
    adicionais: [
      fiscal ? "" : "Este comprovante é emitido pela plataforma e NÃO substitui nota fiscal (NF-e/NFS-e) do prestador, quando exigida. Tributos não destacados.",
      `Aula de origem: ${nota.aulaId || "—"}. Nota nº ${String(nota.numero).padStart(6, "0")}, série ${nota.serie || "A1"}.`,
      "Autenticidade: confira o código de verificação em /verificar.html informando o código do documento e os 24 dígitos acima."
    ].filter(Boolean)
  };
}

module.exports = { code128, PADROES, chaveAcessoValida, codigoVerificacao, iguais, montarDocumento, agrupar };
