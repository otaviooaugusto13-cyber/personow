// Camada de segurança HTTP: cabeçalhos, CSRF (Origin + Content-Type), CORS fechado, rate limit,
// autenticação robusta (token verificado e checado contra revogação), RBAC e trilha de auditoria.
const { Falha } = require("./erros");
const C = require("./config");

// ---------- Cabeçalhos (OWASP A05) ----------
/** Origem (https) do teste do Eneagrama, se for exibido DENTRO do app (iframe). Vazio = desligado. */
function origemTesteEneagrama() { try { const u = process.env.ENEAGRAMA_TESTE_ORIGEM; return u ? new URL(u).origin : ""; } catch { return ""; } }
function cabecalhos({ extraConnect = [] } = {}) {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // sem 'unsafe-inline' em scripts: todo JS do app é arquivo externo
    "script-src 'self' https://www.gstatic.com https://apis.google.com https://cdnjs.cloudflare.com https://sdk.mercadopago.com https://www.youtube.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://i.ytimg.com",
    "media-src 'self' https: blob:",
    `connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://api.mercadopago.com ${extraConnect.join(" ")}`.trim(),
    `frame-src 'self' https://accounts.google.com https://*.firebaseapp.com https://www.youtube-nocookie.com https://www.youtube.com https://*.mercadopago.com https://*.mercadopago.com.br ${origemTesteEneagrama()}`.trim(),
    "upgrade-insecure-requests"
  ].join("; ");
  return (req, res, next) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(self), payment=(self), fullscreen=(self)");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups"); // necessário para o login Google em popup
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
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
  for (const u of [appUrl, ...String(extras).split(",")]) { try { if (u && u.trim()) lista.add(new URL(u.trim()).origin); } catch { /* ignora */ } }
  return lista;
}
/**
 * CSRF: a API usa token no cabeçalho Authorization (não cookie), então CSRF clássico não se aplica.
 * Ainda assim, como defesa em profundidade, métodos que mudam estado exigem:
 *   1) Content-Type: application/json (força preflight CORS em requisições cross-site) e
 *   2) Origin (quando presente) dentro da lista permitida.
 */
function protecaoCsrf(permitidas, { isentas = [] } = {}) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (isentas.some((p) => req.path === p)) return next();   // webhook server-to-server (assinado)
    const origem = req.get("origin");
    const mesmoHost = origem && req.get("host") && (() => { try { return new URL(origem).host === req.get("host"); } catch { return false; } })();
    if (origem && !mesmoHost && !permitidas.has(origem)) return next(new Falha(403, "Origem não permitida.", "origem-invalida"));
    const tipo = String(req.get("content-type") || "").toLowerCase();
    const temCorpo = Number(req.get("content-length") || 0) > 0;
    if (temCorpo && !tipo.startsWith("application/json")) return next(new Falha(415, "Content-Type deve ser application/json.", "tipo-invalido"));
    next();
  };
}
/** Opções para o pacote `cors`: lista fechada (nada de `origin: true`). */
const opcoesCors = (permitidas) => ({
  origin: (origem, cb) => cb(null, !origem || permitidas.has(origem)),
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

// ---------- Perfis (uma conta Google pode ter mais de um) ----------
const PERFIS = ["aluno", "personal", "admin"];
/**
 * Perfis a que a conta TEM DIREITO segundo as custom claims (só o servidor as escreve).
 * `role` é o perfil ATIVO (é ele que as regras do Firestore e o RBAC leem); `perfis` guarda todos os que a conta possui,
 * para que trocar de portal não faça a conta "perder" os outros (ex.: admin que também testa o portal do aluno).
 */
function perfisDasClaims(c = {}) {
  const s = new Set(Array.isArray(c.perfis) ? c.perfis : []);
  if (PERFIS.includes(c.role)) s.add(c.role);
  if (c.admin === true) s.add("admin");
  return PERFIS.filter((p) => s.has(p));
}

// ---------- Autenticação / RBAC / auditoria ----------
function criarAuth({ admin, db, FieldValue, modoTeste = false }) {
  /** Verifica o ID token (assinatura, expiração E revogação). O token só é aceito no cabeçalho Authorization. */
  async function autenticar(req, checarRevogacao = true) {
    const h = req.get("authorization") || "";
    if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(h)) throw new Falha(401, "login necessário", "nao-autenticado");
    try {
      const u = await admin.auth().verifyIdToken(h.slice(7), checarRevogacao);   // checkRevoked = true (padrão): consulta o Auth a cada chamada
      const teste = modoTeste && u.teste === true;
      if (!teste && u.email_verified !== true && u.firebase?.sign_in_provider !== "custom") throw new Error("email nao verificado");
      return u;
    } catch { throw new Falha(401, "sessão inválida ou expirada", "sessao-invalida"); }
  }
  /** Só assinatura + validade (verificação LOCAL, sem ida ao Auth). Para chamadas de altíssima frequência e baixo risco, como o ping de presença. */
  const autenticarLeve = (req) => autenticar(req, false);
  /**
   * Middleware: exige login e um dos papéis (RBAC). Papel vem de custom claim assinada — só o servidor a define.
   * Conta banida (claim "banido", definida pelo servidor na 3ª advertência) é recusada em TODAS as rotas, exceto nas que
   * usam `exigirMesmoBanido` (ver o motivo do bloqueio). O banimento também revoga as sessões, então o token antigo nem chega aqui.
   */
  const construir = (permitirBanido) => (...papeis) => async (req, res, next) => {
    try {
      const u = await autenticar(req);
      if (papeis.length && !papeis.includes(u.role)) throw new Falha(403, "Você não tem permissão para esta ação.", "sem-permissao");
      if (u.banido === true && !permitirBanido) throw new Falha(403, "Conta bloqueada permanentemente por advertências. Veja o motivo na tela inicial.", "conta-banida");
      if (u.role === "admin" && C.ADMIN_EXIGE_MFA && !u.firebase?.sign_in_second_factor) throw new Falha(403, "Administradores precisam de verificação em duas etapas.", "mfa-obrigatorio");
      req.usuario = u; next();
    } catch (e) { next(e); }
  };
  const exigir = construir(false), exigirMesmoBanido = construir(true);
  /** Operações sensíveis (Pix, saque, estorno) exigem autenticação recente. */
  const exigirRecente = (u, seg = C.AUTH_RECENTE_SEG) => {
    if (!u.auth_time || Date.now() / 1000 - u.auth_time > seg) throw new Falha(401, "Por segurança, entre novamente para continuar.", "reautenticar");
  };
  async function auditar(req, acao, alvo = "", detalhes = {}) {
    try {
      await db.collection("auditoria").doc().set({
        em: FieldValue.serverTimestamp(), uid: req.usuario?.uid || "", papel: req.usuario?.role || "", acao, alvo: String(alvo).slice(0, 160),
        ip: req.ip || "", ua: String(req.get?.("user-agent") || "").slice(0, 160), detalhes
      });
    } catch (e) { console.error("falha ao gravar auditoria", acao, e.message); }
  }
  /** Claims atuais lidas direto do Auth (não do token, que pode estar velho). */
  async function claimsDe(uid) { return (await admin.auth().getUser(uid)).customClaims || {}; }
  /**
   * Define o perfil ATIVO (claim `role`) e acrescenta-o a `perfis`, sem apagar os outros que a conta já tem.
   * Único ponto que concede/troca papéis. O cliente precisa renovar o token depois (getIdToken(true)).
   */
  async function definirPapel(uid, role, { perfis: conhecidos = [], ...extra } = {}) {
    const atual = await claimsDe(uid), tem = new Set([...perfisDasClaims(atual), ...conhecidos.filter((p) => PERFIS.includes(p)), role]);
    await admin.auth().setCustomUserClaims(uid, { ...atual, role, perfis: PERFIS.filter((p) => tem.has(p)), ...extra });
  }
  return { autenticar, autenticarLeve, exigir, exigirMesmoBanido, exigirRecente, auditar, definirPapel, claimsDe };
}

/** Converte qualquer erro em JSON seguro (sem stack/detalhes internos). */
const envelope = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) { next(e); }
};
function tratadorErros(err, req, res, _next) {
  if (err instanceof Falha) return res.status(err.status).json({ erro: err.message, codigo: err.codigo, detalhe: err.detalhe });
  if (err?.type === "entity.too.large") return res.status(413).json({ erro: "Requisição grande demais.", codigo: "corpo-grande" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ erro: "JSON inválido.", codigo: "json-invalido" });
  console.error("erro interno:", req.method, req.path, err?.stack || err);
  res.status(500).json({ erro: "erro interno", codigo: "interno" });
}

module.exports = { PERFIS, perfisDasClaims, cabecalhos, semCache, origensPermitidas, protecaoCsrf, opcoesCors, criarLimitador, criarAuth, envelope, tratadorErros };
