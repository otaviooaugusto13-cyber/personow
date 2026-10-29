// Camada de segurança HTTP do Personow: cabeçalhos, CSRF (Origin + Content-Type), CORS fechado, rate limit,
// autenticação robusta (token verificado e checado contra revogação), RBAC (admin) e trilha de auditoria.
// Adaptado do Abastece Já. Diferença deliberada: aqui "aluno" e "personal" NÃO são papéis (claims) — o perfil de
// cada um é a coleção alunos/personais (como o Diego já tinha). Só o `admin` usa custom claim assinada.
const { Falha } = require("./erros");
const C = require("./config");

// ---------- Cabeçalhos (OWASP A05) ----------
/**
 * CSP. ATENÇÃO: os HTMLs do Personow ainda têm handlers inline (onclick="...") e um <script> inline,
 * então `script-src` precisa de 'unsafe-inline'. Para endurecer (remover 'unsafe-inline'), mova esses handlers
 * para addEventListener nos .js — o Abastece Já já fez isso. Todo o resto da política é restritivo.
 * O Google Maps (usado no radar/mapa) exige maps.googleapis.com e maps.gstatic.com.
 */
function cabecalhos({ extraConnect = [] } = {}) {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://cdnjs.cloudflare.com https://sdk.mercadopago.com https://maps.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://maps.googleapis.com https://maps.gstatic.com https://*.ggpht.com",
    `connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://api.mercadopago.com https://maps.googleapis.com ${extraConnect.join(" ")}`.trim(),
    "frame-src https://accounts.google.com https://*.firebaseapp.com https://*.mercadopago.com https://*.mercadopago.com.br",
    "upgrade-insecure-requests"
  ].join("; ");
  return (req, res, next) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=(self), fullscreen=(self)");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups"); // login Google em popup
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.removeHeader?.("X-Powered-By");
    next();
  };
}
/** Respostas da API nunca ficam em cache (dados financeiros/pessoais). */
const semCache = (req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Pragma", "no-cache"); next(); };

// ---------- Origem permitida / CSRF ----------
function origensPermitidas(appUrl, extras = "") {
  const lista = new Set();
  for (const u of [appUrl, process.env.RENDER_EXTERNAL_URL, ...String(extras).split(",")]) { try { if (u && u.trim()) lista.add(new URL(u.trim()).origin); } catch { /* ignora */ } }
  return lista;
}
/**
 * CSRF: a API usa token no cabeçalho Authorization (não cookie), então CSRF clássico não se aplica.
 * Defesa em profundidade: métodos que mudam estado exigem (1) Content-Type JSON e (2) Origin permitida (se presente).
 */
function protecaoCsrf(permitidas, { isentas = [] } = {}) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (isentas.some((p) => req.path === p)) return next();   // webhook server-to-server (assinado)
    const origem = req.get("origin");
    const mesmoHost = origem && req.get("host") && (() => { try { return new URL(origem).host === req.get("host"); } catch { return false; } })();
    const local = origem && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem) && !C.PRODUCAO;
    if (origem && !mesmoHost && !local && !permitidas.has(origem)) return next(new Falha(403, "Origem não permitida.", "origem-invalida"));
    const tipo = String(req.get("content-type") || "").toLowerCase();
    const temCorpo = Number(req.get("content-length") || 0) > 0;
    if (temCorpo && !tipo.startsWith("application/json")) return next(new Falha(415, "Content-Type deve ser application/json.", "tipo-invalido"));
    next();
  };
}
/** Opções do pacote `cors`: lista fechada (localhost só fora de produção). */
const opcoesCors = (permitidas) => ({
  origin: (origem, cb) => cb(null, !origem || permitidas.has(origem) || (!C.PRODUCAO && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem))),
  methods: ["GET", "POST", "PUT", "DELETE"], allowedHeaders: ["Content-Type", "Authorization"], maxAge: 600
});

// ---------- Rate limit (janela deslizante em memória; 1 instância. Com várias, trocar por Redis) ----------
function criarLimitador() {
  const baldes = new Map();
  const faxina = setInterval(() => { const agora = Date.now(); for (const [k, b] of baldes) if (b.at < agora - b.janela) baldes.delete(k); }, 60_000);
  faxina.unref?.();
  const limitar = ({ janelaMs = 60_000, max = 60, nome = "geral", porUsuario = false } = {}) => (req, res, next) => {
    const quem = (porUsuario && req.usuario?.uid) || req.ip || "?";
    const chave = `${nome}:${quem}`, agora = Date.now();
    const b = baldes.get(chave) || { marcas: [], janela: janelaMs, at: agora };
    b.marcas = b.marcas.filter((t) => t > agora - janelaMs); b.at = agora;
    if (b.marcas.length >= max) {
      res.setHeader("Retry-After", String(Math.ceil(janelaMs / 1000)));
      return next(new Falha(429, "Muitas tentativas. Aguarde um instante e tente de novo.", "limite-requisicoes"));
    }
    b.marcas.push(agora); baldes.set(chave, b); next();
  };
  return { limitar, _baldes: baldes, parar: () => clearInterval(faxina) };
}

// ---------- Autenticação / RBAC / auditoria ----------
const ehAdmin = (u) => !!u && (u.role === "admin" || u.admin === true);

function criarAuth({ admin, db, FieldValue }) {
  /** Verifica o ID token (assinatura, expiração E revogação). Só é aceito no cabeçalho Authorization. */
  async function autenticar(req) {
    const h = req.get("authorization") || "";
    if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(h)) throw new Falha(401, "login necessário", "sem-login");
    try {
      const u = await admin.auth().verifyIdToken(h.slice(7), true);   // checkRevoked = true
      if (u.email_verified === false) throw new Error("email nao verificado");   // login Google sempre vem verificado
      return u;
    } catch { throw new Falha(401, "sessão inválida", "sessao-invalida"); }
  }
  /** Middleware: exige login e papel de admin (custom claim assinada — só scripts/definir-admin.cjs a concede). */
  const exigirAdmin = async (req, res, next) => {
    try {
      const u = await autenticar(req);
      if (!ehAdmin(u)) throw new Falha(403, "Você não tem permissão para esta ação.", "sem-permissao");
      if (C.ADMIN_EXIGE_MFA && !u.firebase?.sign_in_second_factor) throw new Falha(403, "Administradores precisam de verificação em duas etapas.", "mfa-obrigatorio");
      req.usuario = u; next();
    } catch (e) { next(e); }
  };
  /** Middleware: exige apenas login (os dados do próprio usuário). */
  const exigirLogin = async (req, res, next) => { try { req.usuario = await autenticar(req); next(); } catch (e) { next(e); } };
  /** Operações sensíveis exigem autenticação recente. */
  const exigirRecente = (u, seg = C.AUTH_RECENTE_SEG) => {
    if (!u.auth_time || Date.now() / 1000 - u.auth_time > seg) throw new Falha(401, "Por segurança, entre novamente para continuar.", "reautenticar");
  };
  async function auditar(req, acao, alvo = "", detalhes = {}) {
    try {
      await db.collection("auditoria").doc().set({
        em: FieldValue.serverTimestamp(), uid: req.usuario?.uid || "", acao, alvo: String(alvo).slice(0, 160),
        ip: req.ip || "", ua: String(req.get?.("user-agent") || "").slice(0, 160), detalhes
      });
    } catch (e) { console.error("falha ao gravar auditoria", acao, e.message); }
  }
  return { autenticar, exigirAdmin, exigirLogin, exigirRecente, auditar };
}

/** Converte qualquer erro em JSON seguro (sem stack/detalhes internos). */
const envelope = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
function tratadorErros(err, req, res, _next) {
  if (err instanceof Falha) return res.status(err.status).json({ erro: err.message, codigo: err.codigo, detalhe: err.detalhe });
  if (err?.type === "entity.too.large") return res.status(413).json({ erro: "Requisição grande demais.", codigo: "corpo-grande" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ erro: "JSON inválido.", codigo: "json-invalido" });
  console.error("erro interno:", req.method, req.path, err?.stack || err);
  res.status(500).json({ erro: "erro interno", codigo: "interno" });
}

module.exports = { ehAdmin, cabecalhos, semCache, origensPermitidas, protecaoCsrf, opcoesCors, criarLimitador, criarAuth, envelope, tratadorErros };
