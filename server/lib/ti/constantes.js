// Módulo de TI — constantes, permissões (RBAC), SLA e política de senha. Sem dependências: usado por todos os serviços do módulo.
const crypto = require("crypto");
const { Falha } = require("../erros");

// ---------- Papéis do módulo ----------
// `gestor` administra a equipe, vê toda a auditoria e redistribui chamados; `tecnico` atende chamados e vê só a própria trilha.
const NIVEIS = ["gestor", "tecnico"];
const PERMISSOES = {
  gestor: ["operadores.ler", "operadores.ler.basico", "operadores.gerir", "auditoria.ler", "auditoria.ler.proprio", "auditoria.verificar", "chamados.ler", "chamados.atender", "chamados.atribuir", "metricas.ler", "presenca.ler", "admins.gerir"],
  tecnico: ["operadores.ler.basico", "auditoria.ler.proprio", "chamados.ler", "chamados.atender", "metricas.ler", "presenca.ler"]
};
const pode = (nivel, permissao) => (PERMISSOES[nivel] || []).includes(permissao);

// ---------- Chamados ----------
const STATUS = ["aberto", "em_atendimento", "aguardando_usuario", "resolvido", "cancelado"];
const STATUS_ABERTOS = ["aberto", "em_atendimento", "aguardando_usuario"];
const PRIORIDADES = ["baixa", "media", "alta", "critica"];
const PESO_PRIORIDADE = { critica: 4, alta: 3, media: 2, baixa: 1 };
const CATEGORIAS = ["acesso", "pagamento", "app", "bug", "dados", "infra", "outro"];
/** Transições válidas (máquina de estados). `resolvido` pode ser reaberto; `cancelado` é final. */
const TRANSICOES = {
  aberto: ["em_atendimento", "cancelado"],
  em_atendimento: ["aguardando_usuario", "resolvido", "aberto", "cancelado"],
  aguardando_usuario: ["em_atendimento", "resolvido", "aberto", "cancelado"],
  resolvido: ["em_atendimento"],
  cancelado: []
};
/** Metas de SLA em minutos: primeiro atendimento (atend) e resolução (resol), por prioridade. */
const SLA_MIN = {
  critica: { atend: 15, resol: 4 * 60 },
  alta: { atend: 60, resol: 8 * 60 },
  media: { atend: 4 * 60, resol: 24 * 60 },
  baixa: { atend: 24 * 60, resol: 72 * 60 }
};
// O usuário (aluno/personal) só sugere urgência; "crítica" é decisão da equipe de TI.
const URGENCIA_USUARIO = ["baixa", "media", "alta"];

// ---------- Presença ----------
const PRESENCA_JANELA_MS = 75_000;      // online = pingou nos últimos 75 s (o app pinga a cada 30 s com a aba visível)
const PRESENCA_PING_MIN_MS = 10_000;    // ping mais rápido que isso é ignorado (anti-abuso)

// ---------- Tempo real ----------
const STREAM_INTERVALO_MS = 5_000;
const STREAM_VIDA_MAX_MS = 10 * 60_000; // o stream fecha sozinho: o cliente reconecta com token novo (sessão revogada não fica ouvindo)
const STREAM_MAX_POR_OPERADOR = 3;
const STREAM_MAX_GLOBAL = 200;

// ---------- Senha ----------
const SENHAS_COMUNS = ["senha123456", "123456789012", "password1234", "qwerty123456", "personowtech", "administrador1", "mudar123456a"];
const CLASSES = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/];
/**
 * Política: 12–128 caracteres, ≥ 3 das 4 classes (minúscula, maiúscula, dígito, símbolo), sem a parte local do e-mail,
 * sem repetir o mesmo caractere 4+ vezes e fora de uma lista curta de senhas óbvias.
 */
function validarSenha(senha, { email = "", nome = "" } = {}) {
  const erro = (m) => new Falha(400, m, "senha-fraca");
  if (typeof senha !== "string") throw new Falha(400, "Informe a senha.", "dados-invalidos", { campo: "senha" });
  if (senha.length < 12) throw erro("A senha precisa ter pelo menos 12 caracteres.");
  if (senha.length > 128) throw erro("A senha pode ter no máximo 128 caracteres.");
  if (CLASSES.filter((r) => r.test(senha)).length < 3) throw erro("Use ao menos 3 tipos: minúsculas, maiúsculas, números e símbolos.");
  if (/(.)\1{3,}/.test(senha)) throw erro("Evite repetir o mesmo caractere várias vezes seguidas.");
  const baixa = senha.toLowerCase(), local = String(email).split("@")[0].toLowerCase();
  if (local.length >= 4 && baixa.includes(local)) throw erro("A senha não pode conter o seu e-mail.");
  const primeiroNome = String(nome).trim().split(/\s+/)[0].toLowerCase();
  if (primeiroNome.length >= 4 && baixa.includes(primeiroNome)) throw erro("A senha não pode conter o seu nome.");
  if (SENHAS_COMUNS.includes(baixa)) throw erro("Essa senha é muito comum. Escolha outra.");
  return senha;
}
/** Senha temporária forte (16 caracteres, criptograficamente aleatória, sem caracteres ambíguos). Mostrada UMA vez; exige troca no 1º acesso. */
function senhaTemporaria() {
  const A = { min: "abcdefghijkmnpqrstuvwxyz", mai: "ABCDEFGHJKLMNPQRSTUVWXYZ", num: "23456789", sim: "!@#$%&*?" };
  const todos = Object.values(A).join("");
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = [pick(A.min), pick(A.mai), pick(A.num), pick(A.sim), ...Array.from({ length: 12 }, () => pick(todos))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }   // Fisher–Yates
  return chars.join("");
}

module.exports = {
  NIVEIS, PERMISSOES, pode, STATUS, STATUS_ABERTOS, PRIORIDADES, PESO_PRIORIDADE, CATEGORIAS, TRANSICOES, SLA_MIN, URGENCIA_USUARIO,
  PRESENCA_JANELA_MS, PRESENCA_PING_MIN_MS, STREAM_INTERVALO_MS, STREAM_VIDA_MAX_MS, STREAM_MAX_POR_OPERADOR, STREAM_MAX_GLOBAL,
  validarSenha, senhaTemporaria
};
