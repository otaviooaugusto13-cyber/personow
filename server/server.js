// ============================================================
// PERSONOW — Servidor Node.js / Express (Render)
// Raiz de composição: segurança HTTP + rotas por domínio. A verdade das regras de negócio mora AQUI.
//
//   rotas/conta.js        cadastro (aluno/personal, 16+), dados privados cifrados, habilitação
//   rotas/treinamento.js  treinamento obrigatório Personow
//   rotas/categorias.js   habilitação por categoria (vídeo + timer + questionário 100%)
//   rotas/aulas.js      aulas, aceite (com todas as travas), cancelar, desistir, avaliar, cartão
//   rotas/pagamentos.js   checkout (conta da plataforma), webhook assinado, confirmação
//   rotas/nota.js         comprovante de serviço (layout DANFE simplificado, sem valor fiscal) + verificação pública — ver NOTA-COMPROVANTE.md
//   rotas/carteira.js     carteira digital, saque, extrato e CSV (personal e aluno)
//   rotas/taxas.js        taxas e regras de aula editáveis pelo admin (GET /config/taxas público, PUT /admin/taxas)
//   rotas/admin.js        aprovação, módulos, estornos, saques, conciliação, auditoria (papel admin)
//   rotas/ti.js           módulo de TI: operadores, trilha de auditoria, chamados, dashboard, tempo real, presença (papel ti) — ver TI-MODULO.md
//   rotas/execucao.js     check-in (geofence 100 m), check-out com foto, falta do aluno, auditoria da foto, local do aluno
//   rotas/relampago.js      chamado relâmpago + alertas por proximidade (push)
//   rotas/reputacao.js    níveis/vidas/infrações, admin e cron de manutenção
//   rotas/b2b.js          painel dos parceiros e administração de parceiros
//   rotas/teste.js        sandbox (só com MODO_TESTE=1 e fora de produção)
// ============================================================
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const S = require("./split");
const C = require("./lib/config");
const { Falha } = require("./lib/erros");
const Seg = require("./lib/seguranca");
const Cripto = require("./lib/cripto");
const V = require("./lib/validacao");
const G = require("./lib/geo");
const { criarReputacao } = require("./lib/reputacao");
const { criarCarteira } = require("./lib/carteira");
const { criarTreinamento } = require("./lib/treinamento");
const { criarHabilitacao } = require("./lib/habilitacao");
const { criarTaxas } = require("./lib/taxas");
const { criarSuporte } = require("./lib/suporte");
const { criarCategorias } = require("./lib/categorias");
const { criarTI } = require("./lib/ti");
const { criarBootstrapAdmin } = require("./lib/bootstrap-admin");
const { criarAuthProxy } = require("./lib/auth-proxy");

// ---------- Ambiente ----------
const MODO_TESTE = ["1", "true", "sim"].includes(String(process.env.MODO_TESTE || "").trim().toLowerCase());
if (MODO_TESTE && C.PRODUCAO) { console.error("🛑 MODO_TESTE não pode ficar ligado em produção. Defina AMBIENTE=homolog (ou desligue MODO_TESTE) e reinicie."); process.exit(1); }
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";      // conta da PLATAFORMA: todo pagamento entra aqui
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
if (C.PRODUCAO) {
  const faltam = [["MP_ACCESS_TOKEN", MP_ACCESS_TOKEN], ["MP_WEBHOOK_SECRET", MP_WEBHOOK_SECRET], ["APP_URL", APP_URL]].filter(([, v]) => !v).map(([k]) => k);
  if (faltam.length) { console.error(`🛑 Variáveis obrigatórias ausentes em produção: ${faltam.join(", ")}`); process.exit(1); }
}

// ---------- Firebase Admin ----------
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "";   // id do projeto Firebase do Personow (sem padrão embutido: cada ambiente informa o seu)
if (!PROJECT_ID && C.PRODUCAO) { console.error("🛑 FIREBASE_PROJECT_ID ausente em produção."); process.exit(1); }
function credencialFirebase() {
  let bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) {
    for (const caminho of [path.join(__dirname, "..", "serviceAccountKey.json"), path.join(__dirname, "serviceAccountKey.json")]) {
      try { if (fs.existsSync(caminho)) { bruto = fs.readFileSync(caminho, "utf8"); break; } } catch (e) { console.error("Erro ao ler credenciais locais:", e.message); }
    }
  }
  if (!bruto) return null;
  const texto = bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8");
  return admin.credential.cert(JSON.parse(texto));
}
if (!admin.apps.length) {
  const credential = credencialFirebase();
  if (!credential && !process.env.FIRESTORE_EMULATOR_HOST) console.error("⚠️  FIREBASE_SERVICE_ACCOUNT ausente: o acesso ao Firestore vai falhar.");
  admin.initializeApp({ ...(credential ? { credential } : {}), projectId: PROJECT_ID });
}
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

// ---------- Utilidades compartilhadas ----------
const MP_API = "https://api.mercadopago.com";
const getBaseUrl = (req) => {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  return `${req.get("x-forwarded-proto") === "https" ? "https" : req.protocol}://${req.get("host")}`;
};
const urlPublicaHttps = (u) => /^https:\/\/[^/\s]+\.[^/\s]+/.test(u) && !/localhost|127\.0\.0\.1/.test(u);
async function mp(caminho, init = {}, token = MP_ACCESS_TOKEN) {
  if (!token) throw new Falha(500, "Mercado Pago não configurado no servidor.", "mp-nao-configurado");
  let r;
  try { r = await fetch(MP_API + caminho, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } }); }
  catch (e) { console.error("MP rede", caminho, e.message); throw new Falha(502, "Não foi possível falar com o Mercado Pago agora. Tente novamente.", "mp-rede"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("MP erro", caminho, r.status, JSON.stringify(j).slice(0, 500));
    throw new Falha(502, r.status === 401 || r.status === 403 ? "O Mercado Pago não aceitou a credencial da plataforma." : r.status === 404 ? "O Mercado Pago não encontrou o recurso aula." : "Mercado Pago recusou a operação.", "mp", { status: r.status });
  }
  return j;
}

const auth = Seg.criarAuth({ admin, db, FieldValue, modoTeste: MODO_TESTE });
const limitador = Seg.criarLimitador(), { limitar } = limitador;
const carteira = criarCarteira({ db, FieldValue, Timestamp });
const treinamento = criarTreinamento({ db, FieldValue, Timestamp, admin });
const categorias = criarCategorias({ db, FieldValue });
const habilitacao = criarHabilitacao({ db, treinamento, categorias });
const taxas = criarTaxas({ db, FieldValue, S });          // taxas/regras de aula dinâmicas (configuracoes/taxas)
const suporte = criarSuporte({ db, admin, FieldValue });
const ti = criarTI({ db, admin, FieldValue, Timestamp, V, auth });   // módulo de TI (operadores, auditoria, chamados, métricas, presença)
const reputacao = criarReputacao({ db, admin, FieldValue, Timestamp, auth, carteira, taxas });   // níveis, vidas, multas e banimento
const ctx = {
  db, admin, express, FieldValue, Timestamp, S, C, V, G, Cripto, Falha, auth, perfisDasClaims: Seg.perfisDasClaims, PERFIS: Seg.PERFIS, limitar, carteira, treinamento, categorias, habilitacao, taxas, suporte, mp, ti, reputacao,
  envelope: Seg.envelope, MODO_TESTE, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, CRON_SECRET, APP_URL, getBaseUrl, urlPublicaHttps,
  __reset: () => { limitador._baldes.clear(); ti.limparCaches(); },   // uso exclusivo dos testes
  hojeSP: V.hojeSP, reais: (c) => Number((c / 100).toFixed(2)),
  visaoAluno: (sp) => ({ valor: sp.valor, taxaFixa: sp.taxaFixa, total: sp.total, ...(sp.bonus ? { bonus: sp.bonus } : {}) })
};

// ---------- Pipeline HTTP ----------
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
const permitidas = Seg.origensPermitidas(APP_URL, process.env.ORIGENS_PERMITIDAS);
app.use(criarAuthProxy({ projectId: PROJECT_ID }));   // /__/auth/* → Firebase (login Google por redirecionamento no mesmo domínio)
app.use(Seg.cabecalhos());
app.use(cors(Seg.opcoesCors(permitidas)));
const jsonPadrao = express.json({ limit: C.BODY_LIMITE });
app.use((req, res, next) => (req.path === "/checkout" ? next() : jsonPadrao(req, res, next)));   // /checkout tem parser próprio (foto do local da aula)
app.use(Seg.protecaoCsrf(permitidas, { isentas: ["/webhookMP"] }));
app.use(limitar({ janelaMs: 60_000, max: 240, nome: "global" }));
app.use(/^\/(saude|cadastro|perfil|habilitacao|habilitacoes|treinamento|criar|aceitar|cancelar|desistir|avaliar|cartao|confirmar|webhook|carteira|aluno|admin|interno|aviso|teste|suporte|push|config\/taxas|ti\/|chamados|presenca|nota\/|checkin|checkout|reportar|auditar|execucao|reputacao|personal\/|parceiros|b2b)/, Seg.semCache);

app.get("/saude", (req, res) => res.json({ ok: true }));

for (const rota of ["conta", "treinamento", "categorias", "aulas", "pagamentos", "nota", "carteira", "taxas", "admin", "suporte", "ti", "execucao", "relampago", "reputacao", "b2b", "teste"]) require(`./rotas/${rota}`)(app, ctx);


// ---------- Site estático (somente extensões permitidas; nada de código do servidor, regras ou segredos) ----------
const RAIZ = path.join(__dirname, "..");
const BLOQUEADOS = /^\/(server|functions|test|scripts|node_modules|docs)(\/|$)|(^|\/)\./i;
// Rotas limpas dos painéis: a URL pública é /painel-aluno e /painel-personal (as páginas continuam sendo index.html e personal.html).
// Sem barra final (/painel-aluno/ redireciona): os scripts e estilos usam caminhos relativos e quebrariam dentro de uma "pasta".
const PAINEIS = { "painel-aluno": "index.html", "painel-personal": "personal.html", "painel-parceiro": "parceiro.html", "painel-admin": "admin.html", "painel-ti": "ti.html" };
app.get(/^\/(painel-aluno|painel-personal|painel-parceiro|painel-admin|painel-ti)\/?$/, (req, res) => {
  const nome = req.path.replace(/\//g, "");
  if (req.path.endsWith("/")) return res.redirect(302, `/${nome}${req.url.slice(req.path.length)}`);
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(RAIZ, PAINEIS[nome]));
});
app.use((req, res, next) => {
  const p = decodeURIComponent(req.path);
  if (BLOQUEADOS.test(p) || !/^\/([\w.-]+\/)*[\w.-]*$/.test(p)) return res.status(404).send("Not Found");
  if (p !== "/" && !/\.(html|css|js|png|svg|ico|webp|woff2)$/i.test(p) && p !== "/manifest.json") return res.status(404).send("Not Found");
  next();
});
app.use(express.static(RAIZ, { dotfiles: "ignore", index: ["index.html"], maxAge: 0, setHeaders: (res, f) => { if (f.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache"); } }));
app.use((req, res) => res.status(404).json({ erro: "não encontrado", codigo: "rota-inexistente" }));
app.use(Seg.tratadorErros);

if (require.main === module) {
  criarBootstrapAdmin({ admin, db, FieldValue, auth }).rodar();   // ADMIN_BOOTSTRAP_EMAIL: concede o papel de admin à conta Google informada (sem terminal)
  ti.bootstrapGestor();                                     // 1º gestor de TI via variáveis de ambiente (só se ainda não houver operadores)
  ti.presenca.iniciar();                                    // publica os pings desta instância (contador de usuários online)
  taxas.iniciar();                                          // listener em tempo real: a mudança do admin vale em milissegundos
  app.listen(PORT, "0.0.0.0", () => console.log(`Servidor rodando na porta ${PORT}${MODO_TESTE ? " — MODO_TESTE ligado" : ""}`));
}
module.exports = { app, ctx };
