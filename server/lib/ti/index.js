// Composição do módulo de TI: serviços + middleware de autorização (RBAC por permissão, status do operador consultado a cada requisição).
const crypto = require("crypto");
const { Falha } = require("../erros");
const K = require("./constantes");
const { criarAuditoria } = require("./auditoria");
const { criarOperadores } = require("./operadores");
const { criarAdmins } = require("./admins");
const { criarMetricas } = require("./metricas");
const { criarChamados } = require("./chamados");
const { criarPresenca } = require("./presenca");
const { criarTempoReal } = require("./tempo-real");

function criarTI({ db, admin, FieldValue, Timestamp, V, auth }) {
  const auditoria = criarAuditoria({ db, FieldValue, Timestamp });
  const operadores = criarOperadores({ db, admin, FieldValue, V });
  const admins = criarAdmins({ db, admin, FieldValue, V, definirPapel: (...a) => auth.definirPapel(...a) });
  const metricas = criarMetricas({ db, FieldValue });
  const chamados = criarChamados({ db, FieldValue, Timestamp, V, metricas });
  const presenca = criarPresenca({ db, Timestamp });
  const tempoReal = criarTempoReal({ presenca, chamados });

  /** Identidade de quem age, para a trilha de auditoria. */
  const atorDe = (req) => ({ uid: req.usuario?.uid || "", nome: req.operador?.nome || "", email: req.operador?.email || req.usuario?.email || "", nivel: req.operador?.nivel || "", ip: req.ip || "", ua: req.get?.("user-agent") || "", rota: `${req.method} ${req.path}`, reqId: req.reqId || "" });
  const auditar = (req, dados) => auditoria.registrar(atorDe(req), dados);

  /**
   * Middleware: exige operador de TI ATIVO com a permissão pedida.
   *   1) token válido e não revogado (auth.autenticar)  2) claim role=ti  3) documento ti_operadores ativo (cache ≤10 s)
   *   4) sem troca de senha pendente (exceto rotas que a resolvem)  5) nível com a permissão.
   * Acesso negado de um operador autenticado fica registrado na trilha; tentativas de quem nem é da TI vão só para o log do servidor (sem gravar no banco).
   */
  const exigirTI = (permissao, { permitirTrocaSenha = false } = {}) => async (req, res, next) => {
    try {
      req.reqId = crypto.randomBytes(6).toString("hex"); res.setHeader?.("X-Request-Id", req.reqId);
      const u = await auth.autenticar(req);
      if (u.role !== "ti") { console.warn(JSON.stringify({ evento: "ti.acesso-negado", uid: u.uid, role: u.role || null, rota: `${req.method} ${req.path}`, ip: req.ip })); throw new Falha(403, "Você não tem permissão para esta ação.", "sem-permissao"); }
      const op = await operadores.obter(u.uid);
      if (!op || op.status !== "ativo") throw new Falha(403, "Sua conta de operador está inativa.", "operador-inativo");
      req.usuario = u; req.operador = op;
      if (op.trocarSenha && !permitirTrocaSenha) throw new Falha(403, "Defina uma nova senha para continuar.", "trocar-senha");
      if (permissao && !K.pode(op.nivel, permissao)) { await auditar(req, { acao: "acesso.negado", resultado: "negado", resumo: `Sem permissão: ${permissao}`, meta: { permissao } }); throw new Falha(403, "Seu nível não permite esta ação.", "sem-permissao"); }
      next();
    } catch (e) { next(e); }
  };
  /** Ações sensíveis (criar/excluir operador, resetar senha…): exigem login recente (≤ 5 min). */
  const recente = (req, res, next) => { try { auth.exigirRecente(req.usuario); next(); } catch (e) { next(e); } };

  /**
   * Cria o PRIMEIRO gestor a partir de variáveis de ambiente (TI_BOOTSTRAP_EMAIL / _NOME / _SENHA), sem precisar de terminal.
   * Só age se NÃO existir nenhum operador (ativo ou excluído) — depois disso é ignorado. A senha é de uso único: troca obrigatória no 1º login.
   * Nunca converte uma conta que já existe (ex.: a conta Google de um personal) — nesse caso apenas avisa no log.
   */
  async function bootstrapGestor(env = process.env) {
    const email = String(env.TI_BOOTSTRAP_EMAIL || "").trim().toLowerCase(), senha = env.TI_BOOTSTRAP_SENHA || "", nome = String(env.TI_BOOTSTRAP_NOME || "Gestor de TI").trim();
    if (!email || !senha) return { feito: false, motivo: "nao-configurado" };
    try {
      if (!(await db.collection("ti_operadores").limit(1).get()).empty) return { feito: false, motivo: "ja-existem-operadores" };
      const r = await operadores.criar({ nome, email, nivel: "gestor", senha }, { uid: "sistema", nome: "Bootstrap (variáveis de ambiente)" });
      await db.collection("ti_operadores").doc(r.operador.uid).update({ trocarSenha: true });
      operadores.invalidar(r.operador.uid);
      await auditoria.registrar({ uid: "sistema", nome: "Bootstrap", nivel: "gestor" }, { acao: "operador.criar", resultado: "ok", resumo: `Primeiro gestor criado por variáveis de ambiente: ${email}`, alvoTipo: "operador", alvoId: r.operador.uid });
      console.log(`✅ TI: primeiro gestor criado (${email}). Entre em /painel-ti e troque a senha; depois REMOVA TI_BOOTSTRAP_SENHA do ambiente.`);
      return { feito: true, uid: r.operador.uid };
    } catch (e) {
      console.error(`⚠️  TI: não foi possível criar o primeiro gestor (${e.codigo || e.code || e.message}). ${e.codigo === "email-em-uso" ? "Esse e-mail já tem conta no Firebase Auth — use um e-mail NOVO (ex.: seunome+ti@gmail.com)." : ""}`);
      return { feito: false, motivo: e.codigo || e.code || "erro" };
    }
  }

  /** Zera caches em memória (uso dos testes). */
  const limparCaches = () => { metricas.limparCache(); chamados.invalidarCache(); presenca.limparCache(); presenca._mapa.clear(); presenca._pos.clear(); for (const uid of [...operadores._cache.keys()]) operadores.invalidar(uid); };
  return { auditoria, operadores, admins, metricas, chamados, presenca, tempoReal, bootstrapGestor, exigirTI, recente, auditar, atorDe, limparCaches, K };
}
module.exports = { criarTI };
