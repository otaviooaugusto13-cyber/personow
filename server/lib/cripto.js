// Criptografia de dados sensíveis em repouso (CPF, nascimento, telefone, Pix, dados do responsável).
//  - AES-256-GCM (autenticada). IV aleatório de 96 bits por valor.
//  - AAD amarra o texto cifrado ao "contexto" (coleção/campo/uid): copiar o valor de outro usuário/campo falha.
//  - Versão de chave no prefixo (v1., v2.…): permite rotação sem reencriptar tudo de uma vez.
//  - Índice cego (HMAC-SHA256 com chave separada) para checar CPF duplicado sem guardar o CPF em claro.
// Chaves vêm do ambiente (Render > Environment), nunca do Git:
//   DATA_ENCRYPTION_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>"   DATA_ENCRYPTION_KEY_ID=2   BLIND_INDEX_KEY=<base64 32 bytes>
// Gerar uma chave:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
const crypto = require("crypto");
const { PRODUCAO } = require("./config");

function carregarChaves() {
  const mapa = new Map();
  for (const par of String(process.env.DATA_ENCRYPTION_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [id, b64] = par.split(":");
    const k = Buffer.from(b64 || "", "base64");
    if (!/^\d+$/.test(id || "") || k.length !== 32) throw new Error(`DATA_ENCRYPTION_KEYS: chave "${id}" inválida (precisa ter 32 bytes em base64).`);
    mapa.set(id, k);
  }
  let atual = process.env.DATA_ENCRYPTION_KEY_ID || (mapa.size ? [...mapa.keys()].pop() : "");
  let indice = process.env.BLIND_INDEX_KEY ? Buffer.from(process.env.BLIND_INDEX_KEY, "base64") : null;
  if (!mapa.size || !indice || indice.length !== 32) {
    if (PRODUCAO) throw new Error("Em produção, defina DATA_ENCRYPTION_KEYS, DATA_ENCRYPTION_KEY_ID e BLIND_INDEX_KEY (32 bytes cada, base64).");
    console.warn("⚠️  Chaves de criptografia ausentes: usando chaves EFÊMERAS (dados cifrados não sobrevivem ao reinício). Só para desenvolvimento.");
    if (!mapa.size) { mapa.set("0", crypto.randomBytes(32)); atual = "0"; }
    if (!indice || indice.length !== 32) indice = crypto.randomBytes(32);
  }
  if (!mapa.has(atual)) throw new Error(`DATA_ENCRYPTION_KEY_ID=${atual} não existe em DATA_ENCRYPTION_KEYS.`);
  return { mapa, atual, indice };
}
let K = null;
const chaves = () => (K ||= carregarChaves());
const b64u = (b) => b.toString("base64url");

/** Cifra um valor (string ou objeto JSON). `contexto` ex.: "profissionais_privado/cpf/UID". */
function cifrar(valor, contexto) {
  if (valor === undefined || valor === null || valor === "") return null;
  const { mapa, atual } = chaves();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", mapa.get(atual), iv);
  c.setAAD(Buffer.from(String(contexto)));
  const ct = Buffer.concat([c.update(JSON.stringify(valor), "utf8"), c.final()]);
  return `v${atual}.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
}
function decifrar(token, contexto) {
  if (!token) return null;
  const [v, iv, tag, ct] = String(token).split(".");
  const id = /^v(\d+)$/.exec(v || "")?.[1];
  const chave = id && chaves().mapa.get(id);
  if (!chave || !iv || !tag || !ct) throw new Error("dado cifrado inválido ou chave desconhecida");
  const d = crypto.createDecipheriv("aes-256-gcm", chave, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(String(contexto)));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8"));
}
/** Índice cego determinístico (para unicidade/consulta sem expor o dado). */
const indiceCego = (valor, ns = "cpf") => crypto.createHmac("sha256", chaves().indice).update(`${ns}:${valor}`).digest("hex");
/** true se o token foi cifrado com uma chave que não é a atual (candidato a re-cifragem). */
const precisaRotacionar = (token) => !String(token || "").startsWith(`v${chaves().atual}.`);

const igualSeguro = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = { cifrar, decifrar, indiceCego, precisaRotacionar, igualSeguro, _reset: () => { K = null; } };
