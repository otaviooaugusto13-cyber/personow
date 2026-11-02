// Eneagrama automático: normaliza o resultado do teste externo e o vincula ao perfil do personal, sem digitação.
// Tudo aqui roda só no servidor (e nos scripts de importação). Documentação: ENEAGRAMA-AUTOMATICO.md
//
// Coleções (todas só do servidor; o firestore.rules nega acesso do navegador por padrão):
//   personais_perfil/{uid}     → eneagrama {tipo, asa, instinto} + eneagramaMeta {origem, codigo, loteId, travado, aplicadoEm, anterior?}
//   eneagrama_resultados/{indice}  → resultado ainda sem cadastro; {indice} = HMAC do e-mail (nunca o e-mail em claro); expira (TTL)
//   eneagrama_lotes/{loteId}       → livro de cada importação (arquivo, sha256, totais) — evita reimportar o mesmo arquivo
"use strict";

const INSTINTOS = ["SP", "SX", "SO"];
const SUBTIPOS = { SP: "SP", AUTOPRESERVACAO: "SP", CONSERVACAO: "SP", PRESERVACAO: "SP", SELFPRESERVATION: "SP", SX: "SX", SEXUAL: "SX", UMAUM: "SX", ONETOONE: "SX", SO: "SO", SOCIAL: "SO" };
const ALIAS = {
  email: ["email", "e_mail", "mail", "email_address", "email_do_candidato"],
  codigo: ["codigo", "code", "resultado", "result", "perfil", "eneagrama"],
  tipo: ["tipo", "type", "eneatipo", "tipo_principal"],
  asa: ["asa", "wing"],
  instinto: ["instinto", "subtipo", "variante", "subtype", "instinct"],
};

const asasDoTipo = (t) => [t === 1 ? 9 : t - 1, t === 9 ? 1 : t + 1];
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const chaveColuna = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const codigo = (e) => (e && e.tipo ? `PW-${e.tipo}${e.asa ? `w${e.asa}` : ""}${e.instinto ? `-${e.instinto}` : ""}` : "");
const valido = (e) => !!e && Number.isInteger(e.tipo) && e.tipo >= 1 && e.tipo <= 9 && (!e.asa || asasDoTipo(e.tipo).includes(e.asa)) && (!e.instinto || INSTINTOS.includes(e.instinto));

/** Mesma leitura do navegador (lerCodigoEneagrama em perfil-inteligente.js): "PW-3w2-SO", "3w2 SO", "3-2-SO", "tipo 3 asa 2". */
function lerCodigo(txt) {
  const t = String(txt ?? "").toUpperCase().replace(/^PW[-\s]?/, "");
  const m = t.match(/(?:TIPO\s*)?([1-9])\s*(?:W|ASA|-|\/|\s)?\s*([1-9])?\b(?:\s*[-\/ ]?\s*(SP|SX|SO))?/);
  if (!m) return null;
  const tipo = Number(m[1]); let asa = m[2] ? Number(m[2]) : 0;
  if (asa && !asasDoTipo(tipo).includes(asa)) asa = 0;
  return { tipo, asa, instinto: m[3] || "" };
}

const normalizarEmail = (e) => { const v = String(e ?? "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254 ? v : ""; };
/** Chave de busca do e-mail: HMAC com a BLIND_INDEX_KEY do servidor (o mesmo valor no Render e no script). */
const chaveEmail = (Cripto, email) => Cripto.indiceCego(normalizarEmail(email), "eneagrama-email");

/**
 * Lê UMA linha de planilha/JSON (chaves em qualquer caixa/acento) e devolve { valor:{tipo,asa,instinto}, avisos } ou { erro }.
 * Aceita código ("PW-3w2-SO") e/ou colunas tipo / asa / instinto (ou "subtipo": sp, sx, so, social, sexual, autopreservação…).
 */
function extrairResultado(bruta) {
  const l = {};
  for (const [k, v] of Object.entries(bruta || {})) l[chaveColuna(k)] = v;
  if (l.eneagrama && typeof l.eneagrama === "object") for (const [k, v] of Object.entries(l.eneagrama)) l[chaveColuna(k)] = v;
  const campo = (nomes) => { for (const n of nomes) { const v = l[n]; if ((typeof v === "string" || typeof v === "number") && String(v).trim() !== "") return String(v).trim(); } return undefined; };
  const avisos = [];
  const cod = campo(ALIAS.codigo), t = campo(ALIAS.tipo), a = campo(ALIAS.asa), i = campo(ALIAS.instinto);
  const base = cod !== undefined ? lerCodigo(cod) : null;
  if (cod !== undefined && !base) return { erro: `código de Eneagrama ilegível: "${cod.slice(0, 30)}"` };

  let tipo = base ? base.tipo : 0, asa = base ? base.asa : 0, instinto = base ? base.instinto : "";
  if (t !== undefined) {
    const puro = t.match(/^(?:TIPO\s*)?([1-9])$/i), comb = !puro && /[w\-\/]/i.test(t) ? lerCodigo(t) : null;
    const col = puro ? { tipo: Number(puro[1]), asa: 0, instinto: "" } : comb;
    if (!col) return { erro: `tipo inválido: "${t.slice(0, 20)}"` };
    if (base && base.tipo !== col.tipo) return { erro: "o código e a coluna tipo divergem" };
    tipo = col.tipo; asa = asa || col.asa; instinto = instinto || col.instinto;
  }
  if (a !== undefined) { const m = a.match(/^(?:W|ASA)?\s*([1-9])$/i); if (!m) return { erro: `asa inválida: "${a.slice(0, 20)}"` }; asa = Number(m[1]); }
  if (i !== undefined) { const s = SUBTIPOS[semAcento(i).toUpperCase().replace(/[^A-Z]/g, "")]; if (!s) return { erro: `instinto/subtipo inválido: "${i.slice(0, 20)}"` }; instinto = s; }
  if (!tipo) return { erro: "resultado ausente (informe o código ou a coluna tipo)" };
  if (asa && !asasDoTipo(tipo).includes(asa)) { avisos.push(`asa ${asa} descartada (não é vizinha do tipo ${tipo})`); asa = 0; }
  return { valor: { tipo, asa, instinto }, avisos };
}

// ---------- link assinado (fluxo automatizado): amarra resultado + e-mail + validade ----------
function assinarToken(Cripto, { resultado, email, validadeDias = 30, agora = Date.now() }) {
  if (!valido(resultado) || !normalizarEmail(email)) throw new Error("resultado ou e-mail inválido para o link.");
  const corpo = Buffer.from(JSON.stringify({ c: codigo(resultado), k: chaveEmail(Cripto, email), x: Math.floor(agora / 1000) + validadeDias * 86400 })).toString("base64url");
  return `${corpo}.${Cripto.indiceCego(corpo, "eneagrama-token")}`;
}
/** Devolve o resultado se o token for autêntico, não expirou e foi emitido para ESTE e-mail; senão null. */
function verificarToken(Cripto, token, email, agora = Date.now()) {
  const s = String(token ?? ""); if (s.length > 600) return null;
  const [corpo, ass] = s.split("."); if (!corpo || !ass) return null;
  if (!Cripto.igualSeguro(ass, Cripto.indiceCego(corpo, "eneagrama-token"))) return null;
  let d; try { d = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")); } catch { return null; }
  if (!d || typeof d.x !== "number" || d.x < Math.floor(agora / 1000)) return null;
  if (!normalizarEmail(email) || !Cripto.igualSeguro(String(d.k), chaveEmail(Cripto, email))) return null;
  const r = lerCodigo(d.c); return r && valido(r) ? r : null;
}

// ---------- gravação ----------
/** Grava o resultado no perfil e o TRAVA (o usuário não digita nem altera). Idempotente. */
async function aplicar({ db, FieldValue, uid, resultado, origem, loteId = "", manterManual = false }) {
  if (!valido(resultado)) throw new Error("Eneagrama inválido.");
  const ref = db.collection("personais_perfil").doc(uid);
  return db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).data() || {};
    const manual = !!atual.eneagrama && !(atual.eneagramaMeta && atual.eneagramaMeta.travado);
    if (manterManual && manual) return { aplicado: false, motivo: "mantido-manual" };
    if (atual.eneagramaMeta && atual.eneagramaMeta.travado && atual.eneagrama && codigo(atual.eneagrama) === codigo(resultado)) return { aplicado: false, motivo: "ja-vinculado" };
    const meta = { origem, codigo: codigo(resultado), loteId, travado: true, aplicadoEm: FieldValue.serverTimestamp() };
    if (manual) meta.anterior = codigo(atual.eneagrama);
    tx.set(ref, { uid, eneagrama: { tipo: resultado.tipo, asa: resultado.asa || 0, instinto: resultado.instinto || "" }, eneagramaMeta: meta, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    return { aplicado: true, sobrescreveu: manual };
  });
}

/** Guarda o resultado de quem ainda não se cadastrou. O ID do documento é o HMAC do e-mail. */
async function registrarPendente({ db, FieldValue, Cripto, email, resultado, loteId = "", origem = "importacao", ttlDias = 180, agora = Date.now() }) {
  if (!valido(resultado) || !normalizarEmail(email)) throw new Error("resultado ou e-mail inválido.");
  const id = chaveEmail(Cripto, email);
  await db.collection("eneagrama_resultados").doc(id).set({ eneagrama: { tipo: resultado.tipo, asa: resultado.asa || 0, instinto: resultado.instinto || "" }, codigo: codigo(resultado), origem, loteId, importadoEm: FieldValue.serverTimestamp(), expiraEm: new Date(agora + ttlDias * 86400000) });
  return id;
}

/**
 * Atribuição automática: chamada no cadastro do personal (e, por garantia, ao abrir o perfil).
 * Só vincula com e-mail VERIFICADO. Prioridade: link assinado válido > resultado importado. Consome o pendente.
 * Devolve { eneagrama, codigo, origem } ou null. Nunca lança por falta de resultado.
 */
async function vincularNoCadastro({ db, FieldValue, Cripto, uid, email, emailVerificado, token, auditar, agora = Date.now() }) {
  const mail = normalizarEmail(email);
  if (!mail || emailVerificado !== true) return null;
  const ref = db.collection("eneagrama_resultados").doc(chaveEmail(Cripto, mail));
  const snap = await ref.get();
  let resultado = null, origem = "", loteId = "";

  const viaToken = token ? verificarToken(Cripto, token, mail, agora) : null;
  if (viaToken) { resultado = viaToken; origem = "link"; }
  else if (snap.exists) {
    const d = snap.data() || {};
    const ms = d.expiraEm && typeof d.expiraEm.toMillis === "function" ? d.expiraEm.toMillis() : new Date(d.expiraEm || 0).getTime();
    if (ms > agora && valido(d.eneagrama)) { resultado = d.eneagrama; origem = d.origem || "importacao"; loteId = d.loteId || ""; }
  }
  if (snap.exists && !resultado) await ref.delete();              // expirado/inválido: não deixa lixo
  if (!resultado) return null;

  await aplicar({ db, FieldValue, uid, resultado, origem, loteId });
  if (snap.exists) await ref.delete();                              // uso único
  if (typeof auditar === "function") await auditar("eneagrama.vincular", uid, { origem, codigo: codigo(resultado), loteId });
  return { eneagrama: { tipo: resultado.tipo, asa: resultado.asa || 0, instinto: resultado.instinto || "" }, codigo: codigo(resultado), origem };
}

module.exports = { INSTINTOS, asasDoTipo, chaveColuna, codigo, valido, lerCodigo, normalizarEmail, chaveEmail, extrairResultado, assinarToken, verificarToken, aplicar, registrarPendente, vincularNoCadastro };
