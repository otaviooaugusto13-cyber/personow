// ============================================================
// PERSONOW — Servidor Node.js / Express (Render)
//
//  Regras de negócio (a verdade mora AQUI, não no navegador):
//    POST /criarAula        aluno: valida horário/valor, calcula o split, cria o pedido de aula
//    POST /aceitarAula      personal: transação — sem choque de horário, respeita exclusividade
//    POST /enviarMensagem   chat da aula (bloqueia contatos/Pix fora do app e registra a infração)
//    POST /avaliarAula      aluno avalia o personal (1x, só depois de pagar)
//  Mercado Pago:
//    /mpConectarUrl, /mpCallback   OAuth do personal (para receber o repasse)
//    POST /criarCobranca           checkout com split automático
//    /webhookMP, POST /confirmarPagamento
//  Diagnóstico: GET /saude, GET /diagnostico
//  Segurança / operação (módulos adaptados do Abastece Já):
//    lib/seguranca.js   CSP/HSTS, CSRF, CORS fechado, rate limit, token com checagem de revogação, auditoria
//    lib/validacao.js   entrada estrita (tipos, tamanhos, listas permitidas)   lib/cripto.js  AES-256-GCM em repouso
//    rotas/perfil.js    dados sensíveis cifrados, perfil inteligente, recado    rotas/admin.js painel administrativo
// ============================================================
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const R = require("./regras");
const C = require("./lib/config");
const { Falha } = require("./lib/erros");
const Seg = require("./lib/seguranca");
const Cripto = require("./lib/cripto");
const V = require("./lib/validacao");

const app = express();
app.set("trust proxy", 1);
app.disable?.("x-powered-by");

// ---------- Firebase Admin ----------
function credencialFirebase() {
  let bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) {
    for (const caminho of [path.join(__dirname, "..", "serviceAccountKey.json"), path.join(__dirname, "serviceAccountKey.json")]) {
      try { if (fs.existsSync(caminho)) { bruto = fs.readFileSync(caminho, "utf8"); break; } }
      catch (e) { console.error("Erro ao ler credenciais locais do Firebase:", e.message); }
    }
  }
  if (!bruto) return null;
  const texto = bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8");
  return admin.credential.cert(JSON.parse(texto));
}

if (!admin.apps.length) {
  const credential = credencialFirebase();
  if (!credential && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error("⚠️  FIREBASE_SERVICE_ACCOUNT não definida e nenhum serviceAccountKey.json encontrado: o acesso ao Firestore vai falhar.");
  }
  admin.initializeApp({ ...(credential ? { credential } : {}), projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "app-diego-e0591" });
}
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

// ---------- Configuração (Environment no Render) ----------
const MP_CLIENT_SECRET = process.env.MP_CLIENT_SECRET || "";
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";
const MP_CLIENT_ID = process.env.MP_CLIENT_ID || "";
const APP_URL = process.env.APP_URL || "";
const PORT = process.env.PORT || 3000;
const MP_API = "https://api.mercadopago.com";

// Em produção o servidor se recusa a subir sem o essencial (melhor falhar no deploy do que cobrar errado).
if (C.PRODUCAO) {
  const faltam = [["MP_CLIENT_ID", MP_CLIENT_ID], ["MP_CLIENT_SECRET", MP_CLIENT_SECRET], ["MP_WEBHOOK_SECRET", MP_WEBHOOK_SECRET], ["APP_URL", APP_URL],
    ["DATA_ENCRYPTION_KEYS", process.env.DATA_ENCRYPTION_KEYS], ["BLIND_INDEX_KEY", process.env.BLIND_INDEX_KEY]].filter(([, v]) => !v).map(([k]) => k);
  if (faltam.length) { console.error(`🛑 Variáveis obrigatórias ausentes em produção: ${faltam.join(", ")}`); process.exit(1); }
}

const appUrl = () => (APP_URL || "").replace(/\/$/, "");
const origemDe = (u) => { try { return new URL(u).origin; } catch { return ""; } };
const getBaseUrl = (req) => {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") === "https" ? "https" : req.protocol;
  return `${proto}://${req.get("host")}`;
};
const urlPublicaHttps = (u) => /^https:\/\/[^/\s]+\.[^/\s]+/.test(u) && !/localhost|127\.0\.0\.1/.test(u);
const reais = (c) => Number((c / 100).toFixed(2));
const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const horaSP = () => new Date().toLocaleTimeString("sv-SE", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0].slice(0, 30);
const cpfMascarado = (cpf) => { const d = String(cpf || "").replace(/\D/g, ""); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : ""; };
const estaPaga = (a) => a.status === "paga" || a.status === "concluida";

// ---------- Pipeline HTTP (segurança) ----------
const permitidas = Seg.origensPermitidas(APP_URL, process.env.ORIGENS_PERMITIDAS);
const auth = Seg.criarAuth({ admin, db, FieldValue });
const limitador = Seg.criarLimitador(), { limitar } = limitador;
app.use(Seg.cabecalhos());
app.use(cors(Seg.opcoesCors(permitidas)));
app.use(express.json({ limit: C.BODY_LIMITE }));
app.use(Seg.protecaoCsrf(permitidas, { isentas: ["/webhookMP"] }));
app.use(limitar({ janelaMs: 60_000, max: 240, nome: "global" }));
// Limites por rota (por IP). Registrados com app.use para não alterar a assinatura das rotas abaixo.
app.use("/criarAula", limitar({ janelaMs: 60_000, max: 10, nome: "criar-aula" }));
app.use("/aceitarAula", limitar({ janelaMs: 60_000, max: 30, nome: "aceitar-aula" }));
app.use("/enviarMensagem", limitar({ janelaMs: 60_000, max: 40, nome: "chat" }));
app.use("/avaliarAula", limitar({ janelaMs: 60_000, max: 20, nome: "avaliar" }));
app.use("/criarCobranca", limitar({ janelaMs: 60_000, max: 10, nome: "cobranca" }));
app.use("/confirmarPagamento", limitar({ janelaMs: 60_000, max: 30, nome: "confirmar" }));
app.use("/mpConectarUrl", limitar({ janelaMs: 60_000, max: 10, nome: "mp-conectar" }));
app.use(/^\/(saude|diagnostico|perfil|admin|aviso|criar|aceitar|enviar|avaliar|confirmar|mpConectarUrl)/, Seg.semCache);

/** Trilha de auditoria para eventos do próprio sistema (webhook, pagamento). Nunca derruba a operação. */
async function auditarSistema(acao, alvo = "", detalhes = {}) {
  try { await db.collection("auditoria").doc().set({ em: FieldValue.serverTimestamp(), uid: "sistema", acao, alvo: String(alvo).slice(0, 160), detalhes }); }
  catch (e) { console.error("auditoria", acao, e.message); }
}

// ---------- Autenticação ----------
async function usuario(req) {
  const h = req.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new Falha(401, "login necessário", "sem-login");
  try {
    const u = await admin.auth().verifyIdToken(token, true);   // true = recusa sessões revogadas (ex.: conta bloqueada pelo admin)
    if (u.email_verified === false) throw new Error("email nao verificado");
    return u;
  } catch { throw new Falha(401, "sessão inválida", "sessao-invalida"); }
}

const envelope = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof Falha) return res.status(e.status).json({ erro: e.message, codigo: e.codigo, detalhe: e.detalhe });
    console.error(e);
    res.status(500).json({ erro: "erro interno", codigo: "interno" });
  }
};

const assinar = (texto) => crypto.createHmac("sha256", MP_CLIENT_SECRET).update(texto).digest("hex");

async function mp(caminho, token, init = {}) {
  let r;
  try {
    r = await fetch(MP_API + caminho, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  } catch (e) {
    console.error("MP rede", caminho, e.message);
    throw new Falha(502, "Não foi possível falar com o Mercado Pago agora. Tente novamente.", "mp-rede");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const motivo = j.message || j.error || j.cause?.[0]?.description || `HTTP ${r.status}`;
    console.error("MP erro", caminho, r.status, JSON.stringify(j));
    const amigavel = r.status === 401 || r.status === 403 ? "O Mercado Pago não aceitou a credencial. O personal precisa reconectar a conta."
      : r.status === 404 ? "O Mercado Pago não encontrou o recurso pedido."
      : `Mercado Pago recusou a operação: ${motivo}`;
    throw new Falha(502, amigavel, "mp", { status: r.status, motivo });
  }
  return j;
}

function configMP() {
  if (!MP_CLIENT_ID || !MP_CLIENT_SECRET) throw new Falha(500, "Mercado Pago não configurado no servidor (MP_CLIENT_ID / MP_CLIENT_SECRET).", "mp-nao-configurado");
}

async function tokenDoPersonal(uid) {
  const ref = db.collection("mp_tokens").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new Falha(400, "O personal ainda não conectou o Mercado Pago.", "personal-sem-mp");
  const t = snap.data();
  if (t.expiraEm && t.expiraEm.toMillis() - Date.now() > 3600_000) return t.accessToken;
  configMP();
  const r = await fetch(`${MP_API}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: MP_CLIENT_ID, client_secret: MP_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t.refreshToken })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("refresh MP", j); throw new Falha(400, "A conexão do personal com o Mercado Pago expirou. Peça para ele reconectar.", "personal-sem-mp"); }
  await ref.set({ accessToken: j.access_token, refreshToken: j.refresh_token, expiraEm: Timestamp.fromMillis(Date.now() + j.expires_in * 1000) }, { merge: true });
  return j.access_token;
}

/** Split de uma aula já gravada. Aulas antigas (sem centavos) caem no valor em reais. */
function splitDaAula(a) {
  const c = Number.isInteger(a.valorCentavos) ? a.valorCentavos : Math.round(Number(a.valor) * 100);
  if (!(c >= R.VALOR_MINIMO_CENTAVOS && c <= R.VALOR_MAXIMO_CENTAVOS)) throw new Falha(400, "Valor da aula fora do permitido.", "valor-invalido");
  return R.calcularSplit(c);
}

// ============================================================
// SAÚDE / DIAGNÓSTICO
// ============================================================
app.get("/saude", (req, res) => res.json({ ok: true }));
app.get("/diagnostico", async (req, res) => {
  // Em produção só o admin vê o detalhe da configuração (evita mapear o servidor para um atacante).
  if (C.PRODUCAO) { let adm = false; try { adm = Seg.ehAdmin(await auth.autenticar(req)); } catch {} if (!adm) return res.json({ ok: true }); }
  const problemas = [];
  if (!MP_CLIENT_ID) problemas.push("MP_CLIENT_ID ausente");
  if (!MP_CLIENT_SECRET) problemas.push("MP_CLIENT_SECRET ausente");
  if (!urlPublicaHttps(appUrl())) problemas.push("APP_URL ausente ou inválida (precisa ser https)");
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.FIRESTORE_EMULATOR_HOST && !fs.existsSync(path.join(__dirname, "serviceAccountKey.json")) && !fs.existsSync(path.join(__dirname, "..", "serviceAccountKey.json"))) problemas.push("Credenciais do Firebase ausentes");
  if (!MP_WEBHOOK_SECRET) problemas.push("MP_WEBHOOK_SECRET ausente (opcional, mas recomendado)");
  res.json({ ok: problemas.filter((p) => !p.includes("opcional")).length === 0, problemas, redirectUrlParaCadastrarNoMercadoPago: `${getBaseUrl(req)}/mpCallback` });
});

// ============================================================
// 1) CRIAR AULA (pedido do aluno)
// ============================================================
app.post("/criarAula", envelope(async (req, res) => {
  const u = await usuario(req);
  const b = req.body || {};
  const local = String(b.local || "").trim(), data = String(b.data || ""), entrada = String(b.entrada || ""), saida = String(b.saida || "");
  const foco = String(b.foco || "").trim();
  const valorCentavos = b.valorCentavos;

  if (local.length < 3 || local.length > 160) throw new Falha(400, "Informe a academia ou o endereço do treino.", "dados-invalidos");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < hojeSP()) throw new Falha(400, "Escolha hoje ou uma data futura.", "dados-invalidos");
  if (!R.FOCOS.includes(foco)) throw new Falha(400, "Escolha o foco do treino.", "dados-invalidos");
  const erro = R.validarAula(entrada, saida, valorCentavos);
  if (erro) throw new Falha(400, erro, "aula-invalida");
  if (data === hojeSP() && entrada <= horaSP()) throw new Falha(400, "O horário de início já passou. Escolha um horário futuro.", "aula-invalida");

  const abertas = await db.collection("aulas").where("alunoUid", "==", u.uid).where("status", "==", "aberta").get();
  if (abertas.docs.length >= R.MAX_AULAS_ABERTAS_ALUNO) throw new Falha(429, `Você já tem ${R.MAX_AULAS_ABERTAS_ALUNO} pedidos em aberto. Cancele ou aguarde algum deles.`, "muitos-pedidos");

  const sp = R.calcularSplit(valorCentavos);
  const ref = db.collection("aulas").doc();
  let geo = null;
  if (b.lat !== undefined || b.lng !== undefined) { try { geo = V.coordenada(b.lat, b.lng, "localização do treino"); } catch { geo = null; } }   // opcional: coordenada ruim é ignorada, não derruba o pedido
  const aula = {
    alunoUid: u.uid, alunoNome: primeiroNome(u.name) || "Aluno", local, data, entrada, saida, horario: `${entrada}–${saida}`,
    minutos: R.minutosEntre(entrada, saida), foco, valorCentavos: sp.valor, valorPersonalCentavos: sp.personal,
    status: "aberta", criadoEm: FieldValue.serverTimestamp(), ...(geo || {})
  };

  if (b.personalPreferidoUid) {
    const alvo = await db.collection("personais").doc(String(b.personalPreferidoUid)).get();
    if (!alvo.exists || alvo.data().status !== "ativo") throw new Falha(400, "Este personal não está disponível agora.", "personal-indisponivel");
    if (String(b.personalPreferidoUid) === u.uid) throw new Falha(400, "Você não pode chamar a si mesmo.", "dados-invalidos");
    aula.personalPreferidoUid = alvo.id;
    aula.personalPreferidoNome = String(alvo.data().nome || "").slice(0, 80);
    aula.exclusivoAte = Timestamp.fromMillis(Date.now() + R.EXCLUSIVIDADE_MINUTOS * 60 * 1000);
  }

  const lote = db.batch();
  lote.set(ref, aula);
  lote.set(db.collection("pagamentos_internos").doc(ref.id), { alunoUid: u.uid, split: sp, status: "pendente", criadoEm: FieldValue.serverTimestamp() });
  await lote.commit();
  res.json({ id: ref.id, valorCentavos: sp.valor, valorPersonalCentavos: sp.personal });
}));

// ============================================================
// 2) ACEITAR AULA (transação: sem choque de horário, respeita exclusividade)
// ============================================================
app.post("/aceitarAula", envelope(async (req, res) => {
  const u = await usuario(req);
  const { aulaId } = req.body || {};
  if (!aulaId) throw new Falha(400, "Aula não informada.", "dados-invalidos");
  const pRef = db.collection("personais").doc(u.uid);
  const aRef = db.collection("aulas").doc(String(aulaId));

  await db.runTransaction(async (tx) => {
    const [prof, snap] = await Promise.all([tx.get(pRef), tx.get(aRef)]);
    const p = prof.data();
    if (!p || p.status !== "ativo") throw new Falha(403, "Seu cadastro ainda não foi aprovado.", "personal-inativo");
    if (!p.mpConectado) throw new Falha(403, "Conecte o Mercado Pago na aba Carteira para aceitar aulas.", "personal-sem-mp");

    const s = snap.data();
    if (!s) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
    if (s.alunoUid === u.uid) throw new Falha(403, "Você não pode aceitar o seu próprio pedido.", "proprio-pedido");
    if (s.status !== "aberta") throw new Falha(409, "Esta aula não está mais disponível.", "aula-indisponivel");
    if (s.data < hojeSP()) throw new Falha(409, "Esta aula já passou.", "aula-indisponivel");
    if (s.exclusivoAte && s.exclusivoAte.toMillis() > Date.now() && s.personalPreferidoUid && s.personalPreferidoUid !== u.uid) {
      throw new Falha(403, "Este pedido está reservado por alguns minutos para outro personal.", "exclusivo");
    }
    if (p.valorMin && s.valorPersonalCentavos < Math.round(Number(p.valorMin) * 100)) {
      throw new Falha(409, "O valor desta aula é menor que o mínimo das suas preferências.", "abaixo-do-minimo");
    }

    const doDia = await tx.get(db.collection("aulas").where("personalUid", "==", u.uid).where("data", "==", s.data));
    const agenda = doDia.docs.map((d) => ({ id: d.id, ...d.data() }));
    const choque = R.conflitoNaAgenda(agenda, s, snap.id);
    if (choque) throw new Falha(409, `Choque de horário com outra aula sua (${choque.horario}).`, "conflito-horario");

    tx.update(aRef, { status: "aceita", personalUid: u.uid, personalNome: p.nome || u.name || "Personal", aceitoEm: FieldValue.serverTimestamp() });
  });
  res.json({ ok: true });
}));

// ============================================================
// 3) CHAT DA AULA (só as duas partes; contatos externos são bloqueados)
// ============================================================
app.post("/enviarMensagem", envelope(async (req, res) => {
  const u = await usuario(req);
  const { aulaId } = req.body || {};
  const texto = String(req.body?.texto || "").trim();
  if (!aulaId || !texto) throw new Falha(400, "Mensagem vazia.", "dados-invalidos");
  if (texto.length > 500) throw new Falha(400, "Mensagem muito longa (máximo 500 caracteres).", "dados-invalidos");
  const aRef = db.collection("aulas").doc(String(aulaId));
  const a = (await aRef.get()).data();
  if (!a || (a.alunoUid !== u.uid && a.personalUid !== u.uid)) throw new Falha(403, "Esta conversa não é sua.", "sem-permissao");
  if (!["aceita", "paga", "concluida"].includes(a.status)) throw new Falha(409, "O chat abre quando um personal aceita a aula.", "chat-fechado");

  if (R.mensagemSuspeita(texto)) {
    const regRef = db.collection("infracoes").doc(u.uid);
    const antes = (await regRef.get()).data() || {};
    const total = (antes.total || 0) + 1;
    await regRef.set({ uid: u.uid, total, ultimaEm: FieldValue.serverTimestamp(), revisaoManual: total >= 2 }, { merge: true });
    await db.collection("moderacao").doc().set({ uid: u.uid, aulaId: String(aulaId), trecho: texto.slice(0, 200), criadoEm: FieldValue.serverTimestamp() });
    throw new Falha(422, "Por segurança de todos, não é permitido enviar telefone, e-mail, links ou Pix pelo chat. Combine tudo pelo app. Reincidência pode bloquear a conta.", "contato-externo", { infracoes: total });
  }
  const mRef = aRef.collection("mensagens").doc();
  await mRef.set({ de: u.uid, texto, criadoEm: FieldValue.serverTimestamp() });
  res.json({ ok: true, id: mRef.id });
}));

// ============================================================
// 4) AVALIAÇÃO (aluno → personal, uma única vez, depois de pagar)
// ============================================================
app.post("/avaliarAula", envelope(async (req, res) => {
  const u = await usuario(req);
  const { aulaId } = req.body || {};
  const estrelas = Number(req.body?.estrelas);
  const comentario = String(req.body?.comentario || "").trim().slice(0, 300);
  if (!aulaId || !Number.isInteger(estrelas) || estrelas < 1 || estrelas > 5) throw new Falha(400, "Escolha de 1 a 5 estrelas.", "dados-invalidos");
  const aRef = db.collection("aulas").doc(String(aulaId));
  await db.runTransaction(async (tx) => {
    const a = (await tx.get(aRef)).data();
    if (!a || a.alunoUid !== u.uid) throw new Falha(403, "Esta aula não é sua.", "sem-permissao");
    if (!estaPaga(a)) throw new Falha(409, "Você pode avaliar depois de pagar a aula.", "nao-paga");
    if (a.avaliacao) throw new Falha(409, "Esta aula já foi avaliada.", "ja-avaliada");
    const pRef = db.collection("personais").doc(a.personalUid);
    const p = (await tx.get(pRef)).data() || {};
    const qtd = (p.ratingQtd || 0) + 1, soma = (p.ratingSoma || 0) + estrelas;
    tx.update(aRef, { avaliacao: { estrelas, comentario, em: FieldValue.serverTimestamp() } });
    tx.set(pRef, { ratingQtd: qtd, ratingSoma: soma, ratingMedia: Math.round((soma / qtd) * 10) / 10 }, { merge: true });
  });
  res.json({ ok: true });
}));

// ============================================================
// 5) MERCADO PAGO — OAUTH DO PERSONAL
// ============================================================
app.all("/mpConectarUrl", envelope(async (req, res) => {
  const { uid } = await usuario(req);
  configMP();
  const prof = await db.collection("personais").doc(uid).get();
  if (!prof.exists) throw new Falha(403, "Cadastro de personal não encontrado.", "sem-cadastro");
  const redirectUri = `${getBaseUrl(req)}/mpCallback`;
  const state = `${uid}.${assinar(uid)}`;
  const url = `https://auth.mercadopago.com.br/authorization?client_id=${encodeURIComponent(MP_CLIENT_ID)}&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.json({ url, redirectUri });
}));

app.get("/mpCallback", async (req, res) => {
  const volta = (q) => res.redirect(`${appUrl()}/personal.html?mp=${q}`);
  try {
    configMP();
    const { code, state = "" } = req.query;
    const [uid, sig] = String(state).split(".");
    if (!code || !uid || !sig) return volta("erro");
    const esperado = assinar(uid);
    if (esperado.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(sig))) return volta("erro");
    const r = await fetch(`${MP_API}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: MP_CLIENT_ID, client_secret: MP_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: `${getBaseUrl(req)}/mpCallback` })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return volta("erro");
    await db.collection("mp_tokens").doc(uid).set({ accessToken: j.access_token, refreshToken: j.refresh_token, mpUserId: j.user_id, expiraEm: Timestamp.fromMillis(Date.now() + j.expires_in * 1000), conectadoEm: FieldValue.serverTimestamp() });
    await db.collection("personais").doc(uid).set({ mpConectado: true, mpUserId: String(j.user_id) }, { merge: true });
    volta("ok");
  } catch (e) { console.error("mpCallback", e); volta("erro"); }
});

// ============================================================
// 6) COBRANÇA COM SPLIT AUTOMÁTICO
// ============================================================
app.post("/criarCobranca", envelope(async (req, res) => {
  const u = await usuario(req);
  const { aulaId } = req.body || {};
  if (!aulaId) throw new Falha(400, "Aula não informada.", "dados-invalidos");
  const ref = db.collection("aulas").doc(String(aulaId));
  const a = (await ref.get()).data();
  if (!a || a.alunoUid !== u.uid) throw new Falha(403, "Esta aula pertence a outra conta.", "sem-permissao");
  if (estaPaga(a)) throw new Falha(400, "Esta aula já foi paga.", "ja-paga");
  if (a.status !== "aceita" || !a.personalUid) throw new Falha(400, "Esta aula ainda não foi aceita por um personal.", "nao-aceita");
  configMP();
  if (!urlPublicaHttps(appUrl())) throw new Falha(500, "APP_URL não configurada no servidor (precisa ser https).", "app-url-invalida");

  const sp = splitDaAula(a);
  const token = await tokenDoPersonal(a.personalUid);
  const base = getBaseUrl(req);
  const corpo = {
    items: [{ id: ref.id, title: `Aula de ${a.foco} — ${a.personalNome || "Personal"}`.slice(0, 120), description: `${a.local} · ${a.data} ${a.horario}`.slice(0, 200), quantity: 1, currency_id: "BRL", unit_price: reais(sp.total) }],
    marketplace_fee: reais(sp.app),
    external_reference: ref.id,
    back_urls: ["success", "failure", "pending"].reduce((o, k) => ({ ...o, [k]: `${appUrl()}/pagar.html?id=${encodeURIComponent(ref.id)}&retorno=${k}` }), {}),
    auto_return: "approved",
    statement_descriptor: "PERSONOW",
    payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 }
  };
  if (urlPublicaHttps(base)) corpo.notification_url = `${base}/webhookMP?sid=${encodeURIComponent(ref.id)}`;
  const pref = await mp("/checkout/preferences", token, { method: "POST", body: JSON.stringify(corpo) });

  await db.collection("pagamentos_internos").doc(ref.id).set({ alunoUid: u.uid, split: sp, preferenceId: pref.id, status: "iniciado", iniciadoEm: FieldValue.serverTimestamp() }, { merge: true });
  res.json({ init_point: pref.init_point, valorCentavos: sp.valor, totalCentavos: sp.total });
}));

// ============================================================
// 7) CONFIRMAÇÃO DO PAGAMENTO → RECIBO
// ============================================================
async function finalizarPagamento(aulaId, { paymentId, metodo, taxaMpCentavos = 0 }) {
  const ref = db.collection("aulas").doc(aulaId);
  const s = (await ref.get()).data();
  if (!s) throw new Falha(404, "Aula não encontrada.", "nao-encontrado");
  const sp = splitDaAula(s);

  const reciboId = await db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).data();
    if (estaPaga(atual)) return atual.reciboId || null;
    const contRef = db.collection("contadores").doc("recibos");
    const [cont, aluno, privado, personal] = await Promise.all([
      tx.get(contRef),
      tx.get(db.collection("alunos").doc(atual.alunoUid)),
      tx.get(db.collection("personais_privado").doc(atual.personalUid)),
      tx.get(db.collection("personais").doc(atual.personalUid))
    ]);
    const proximo = (cont.data()?.ultimo || 0) + 1;
    tx.set(contRef, { ultimo: proximo });
    const al = aluno.data() || {}, pv = privado.data() || {}, pe = personal.data() || {};
    const cpfPersonal = pv.cpfEnc ? (() => { try { return Cripto.decifrar(pv.cpfEnc, `personais_privado/cpf/${atual.personalUid}`); } catch { return ""; } })() : pv.cpf;
    const rRef = db.collection("recibos").doc();
    tx.set(rRef, {
      numero: proximo, numeroFmt: String(proximo).padStart(6, "0"), serie: "A1", tipo: "recibo_aula_plataforma", fiscal: { nfse: null },
      aulaId, alunoUid: atual.alunoUid,
      aluno: { nome: al.nome || atual.alunoNome || "", email: al.email || "" },
      personal: { nome: pe.nome || atual.personalNome || "", cref: pe.cref || "", documentoMascarado: cpfMascarado(cpfPersonal) },
      servico: { descricao: `Aula de personal trainer — ${atual.foco}`, local: atual.local, data: atual.data, horario: atual.horario },
      valores: { valor: sp.valor, taxaFixa: sp.taxaFixa, total: sp.total },
      pagamento: { mpPaymentId: String(paymentId), metodo: metodo || "" },
      emitidoEm: FieldValue.serverTimestamp()
    });
    tx.update(ref, { status: "paga", reciboId: rRef.id, reciboNumero: proximo, pagaEm: FieldValue.serverTimestamp() });
    tx.set(db.collection("pagamentos_internos").doc(aulaId), { alunoUid: atual.alunoUid, split: sp, status: "aprovado", mpPaymentId: String(paymentId), metodo: metodo || "", taxaMpCentavos, pagoEm: FieldValue.serverTimestamp() }, { merge: true });
    return rRef.id;
  });
  await auditarSistema("pagamento.aprovado", aulaId, { paymentId: String(paymentId), metodo: metodo || "", total: sp.total });
  return { aprovado: true, reciboId };
}

async function processarPagamento(aulaId, paymentId) {
  const ref = db.collection("aulas").doc(aulaId);
  const s = (await ref.get()).data();
  if (!s) throw new Falha(404, "Aula não encontrada.", "nao-encontrado");
  if (estaPaga(s)) return { jaPaga: true, aprovado: true, reciboId: s.reciboId || null };
  if (!s.personalUid) throw new Falha(400, "Aula sem personal.", "nao-aceita");
  const sp = splitDaAula(s);
  const token = await tokenDoPersonal(s.personalUid);
  const pg = await mp(`/v1/payments/${encodeURIComponent(paymentId)}`, token);
  if (pg.external_reference !== aulaId) throw new Falha(400, "Este pagamento não pertence a esta aula.", "pagamento-alheio");
  if (pg.status !== "approved") return { aprovado: false, status: pg.status };
  if (Math.round(Number(pg.transaction_amount) * 100) !== sp.total) {
    console.error("Valor divergente", aulaId, pg.transaction_amount, sp.total);
    throw new Falha(400, "O valor pago não confere com o valor da aula.", "valor-divergente");
  }
  const taxaMp = Math.round((pg.fee_details || []).filter((f) => f.type === "mercadopago_fee").reduce((acc, f) => acc + f.amount, 0) * 100);
  return finalizarPagamento(aulaId, { paymentId, metodo: pg.payment_type_id, taxaMpCentavos: taxaMp });
}

function assinaturaWebhookValida(req, dataId) {
  if (!MP_WEBHOOK_SECRET) return true;   // sem segredo: a conferência na API do MP (acima) continua protegendo
  const sig = req.get("x-signature") || "", reqId = req.get("x-request-id") || "";
  const ts = /ts=([^,]+)/.exec(sig)?.[1], v1 = /v1=([^,]+)/.exec(sig)?.[1];
  if (!ts || !v1) return false;
  const esperado = crypto.createHmac("sha256", MP_WEBHOOK_SECRET).update(`id:${String(dataId).toLowerCase()};request-id:${reqId};ts:${ts};`).digest("hex");
  return esperado.length === v1.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
}

/** O Mercado Pago avisa aqui quando o pagamento muda. Idempotente: pode chegar várias vezes. */
app.all("/webhookMP", async (req, res) => {
  try {
    const sid = req.query.sid;
    const dataId = req.body?.data?.id || req.query["data.id"] || req.query.id;
    const tipo = req.body?.type || req.query.type || req.query.topic;
    if (!sid || !dataId || (tipo && tipo !== "payment")) return res.sendStatus(200);
    if (!assinaturaWebhookValida(req, dataId)) return res.sendStatus(401);
    await processarPagamento(String(sid), String(dataId));
    res.sendStatus(200);
  } catch (e) {
    console.error("webhook", e.message);
    res.sendStatus(e instanceof Falha && e.status < 500 ? 200 : 500);   // 5xx faz o MP tentar de novo
  }
});

/** pagar.html chama isto ao voltar do checkout (não depende de o webhook já ter chegado). */
app.post("/confirmarPagamento", envelope(async (req, res) => {
  const u = await usuario(req);
  const { aulaId, paymentId } = req.body || {};
  if (!aulaId || !paymentId) throw new Falha(400, "Dados incompletos.", "dados-invalidos");
  const a = (await db.collection("aulas").doc(String(aulaId)).get()).data();
  if (!a || a.alunoUid !== u.uid) throw new Falha(403, "Esta aula pertence a outra conta.", "sem-permissao");
  res.json(await processarPagamento(String(aulaId), String(paymentId)));
}));

// ============================================================
// PERFIL (dados cifrados, perfil inteligente, recado) e ADMIN
// ============================================================
const ctx = { db, admin, FieldValue, Timestamp, R, C, V, Cripto, Falha, auth, limitar, envelope: Seg.envelope };
require("./rotas/perfil")(app, ctx);
require("./rotas/admin")(app, ctx);

// ============================================================
// SITE ESTÁTICO (o servidor também serve o app) — só extensões de front; nada de código do servidor, regras ou segredos
// ============================================================
const RAIZ = path.join(__dirname, "..");
const BLOQUEADOS = /^\/(server|functions|test|scripts|node_modules|docs)(\/|$)|(^|\/)\./i;
app.use((req, res, next) => {
  let p; try { p = decodeURIComponent(req.path); } catch { return res.status(400).send("Bad Request"); }
  if (BLOQUEADOS.test(p) || !/^\/([\w.-]+\/)*[\w.-]*$/.test(p)) return res.status(404).send("Not Found");
  if (p !== "/" && !/\.(html|css|js|png|jpe?g|svg|ico|webp|woff2)$/i.test(p) && p !== "/manifest.json") return res.status(404).send("Not Found");
  next();
});
app.use(express.static(RAIZ, { dotfiles: "ignore", index: ["index.html"], maxAge: 0, setHeaders: (res, f) => { if (f.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache"); } }));

app.use((req, res) => {
  if (req.method !== "GET" || /^\/(mp|criar|aceitar|enviar|avaliar|confirmar|webhook|perfil|admin|aviso)/.test(req.path)) {
    return res.status(404).json({ erro: `rota não encontrada: ${req.method} ${req.path}`, codigo: "rota-inexistente" });
  }
  res.status(404).send("Not Found");
});
app.use(Seg.tratadorErros);

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => console.log(`Personow rodando na porta ${PORT}`));
}
module.exports = { app, ctx, finalizarPagamento, processarPagamento };
