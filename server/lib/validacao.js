// Validação e sanitização de entrada. Tudo que vem do cliente passa por aqui.
// Equivalente "NoSQL" da defesa contra injeção: tipos estritos (objetos nunca viram strings),
// tamanhos máximos, listas de valores permitidos e remoção de campos desconhecidos.
const { Falha } = require("./erros");
const C = require("./config");

const invalido = (campo, extra = "") => new Falha(400, `Campo inválido: ${campo}${extra ? " — " + extra : ""}`, "dados-invalidos", { campo });
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g; // controle + bidi/zero-width

function texto(x, campo, { min = 0, max = 200, re = null, obrigatorio = true } = {}) {
  if (x === undefined || x === null || x === "") { if (obrigatorio && min > 0) throw invalido(campo, "obrigatório"); return ""; }
  if (typeof x !== "string") throw invalido(campo, "esperado texto");
  const t = x.replace(CONTROLE, "").trim();
  if (t.length < min) throw invalido(campo, `mínimo ${min} caracteres`);
  if (t.length > max) throw invalido(campo, `máximo ${max} caracteres`);
  if (re && t && !re.test(t)) throw invalido(campo);
  return t;
}
const idDoc = (x, campo = "id") => {
  if (typeof x !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(x)) throw invalido(campo);
  return x;
};
const opcao = (x, lista, campo) => { if (!lista.includes(x)) throw invalido(campo); return x; };
const inteiro = (x, campo, { min = -Infinity, max = Infinity } = {}) => {
  if (typeof x !== "number" || !Number.isInteger(x) || x < min || x > max) throw invalido(campo);
  return x;
};
const booleano = (x, campo) => { if (typeof x !== "boolean") throw invalido(campo); return x; };
const soDigitos = (s) => String(s ?? "").replace(/\D/g, "");

// ---------- datas ----------
const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const dataIsoValida = (iso) => {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso; // rejeita 2026-02-31
};
/** Idade completa em anos (aritmética de strings: sem fuso, sem erro de bissexto). */
function calcularIdade(nascIso, refIso = hojeSP()) {
  const [a, m, d] = nascIso.split("-").map(Number), [ra, rm, rd] = refIso.split("-").map(Number);
  return ra - a - (rm < m || (rm === m && rd < d) ? 1 : 0);
}
/**
 * Valida a data de nascimento do personal. Mínimo 18 anos (C.IDADE_MINIMA_PERSONAL; o CREF exige maioridade).
 * Devolve { nascimento, idade }.
 */
function validarNascimento(nasc, refIso = hojeSP()) {
  if (!dataIsoValida(nasc)) throw new Falha(400, "Informe uma data de nascimento válida.", "nascimento-invalido");
  if (nasc > refIso) throw new Falha(400, "A data de nascimento não pode estar no futuro.", "nascimento-invalido");
  const idade = calcularIdade(nasc, refIso);
  if (idade < C.IDADE_MINIMA_PERSONAL) throw new Falha(403, `Para atuar como personal é preciso ter pelo menos ${C.IDADE_MINIMA_PERSONAL} anos.`, "idade-minima");
  if (idade > C.IDADE_MAXIMA_PLAUSIVEL) throw new Falha(400, "Data de nascimento inválida.", "nascimento-invalido");
  return { nascimento: nasc, idade };
}

// ---------- documentos / contato ----------
function cpfValido(cpf) {
  cpf = soDigitos(cpf);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += parseInt(cpf[i], 10) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== parseInt(cpf[t], 10)) return false;
  }
  return true;
}
function cpf(x, campo = "cpf") {
  const d = soDigitos(texto(x, campo, { min: 11, max: 14 }));
  if (!cpfValido(d)) throw new Falha(400, "CPF inválido. Confira os 11 dígitos.", "cpf-invalido", { campo });
  return d;
}
function telefone(x, campo = "telefone") {
  const d = soDigitos(texto(x, campo, { min: 10, max: 20 })).replace(/^55(?=\d{10,11}$)/, "");
  if (!/^[1-9][1-9]9?\d{8}$/.test(d)) throw invalido(campo, "use DDD + número");
  return d;
}
function chavePix(tipo, chave) {
  if (tipo === "Chave Aleatória") tipo = "Aleatória";      // rótulo do <select> do app
  tipo = opcao(tipo, ["CPF", "E-mail", "Celular", "Aleatória"], "tipo da chave Pix");
  chave = texto(chave, "chave Pix", { min: 3, max: 80 });
  if (tipo === "CPF") return { tipo, chave: cpf(chave, "chave Pix") };
  if (tipo === "Celular") return { tipo, chave: telefone(chave, "chave Pix") };
  if (tipo === "E-mail" && !/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(chave)) throw invalido("chave Pix", "e-mail inválido");
  if (tipo === "Aleatória" && !/^[0-9a-fA-F-]{32,36}$/.test(chave)) throw invalido("chave Pix", "chave aleatória inválida");
  return { tipo, chave: chave.toLowerCase() === chave || tipo !== "E-mail" ? chave : chave.toLowerCase() };
}

// ---------- máscaras para exibição ----------
const mascararCPF = (c) => { const d = soDigitos(c); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : ""; };
const mascararTelefone = (t) => { const d = soDigitos(t); return d.length >= 10 ? `(${d.slice(0, 2)}) *****-${d.slice(-4)}` : ""; };
const mascararChave = (c) => { const s = String(c || ""); return s.length <= 6 ? "••••" : `${s.slice(0, 3)}••••${s.slice(-3)}`; };

// ---------- coordenadas (aula e personal) ----------
/** { lat, lng } dentro da caixa do Brasil, arredondados a 3 casas (~110 m: suficiente para distância, sem expor a porta de casa). */
function coordenada(lat, lng, campo = "localização") {
  const { LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX } = C.GEO;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX) throw invalido(campo);
  return { lat: Number(lat.toFixed(3)), lng: Number(lng.toFixed(3)) };
}

/** Remove tudo que não está na lista (mass assignment). */
const somente = (obj, chaves) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => chaves.includes(k)));

module.exports = {
  Falha, texto, idDoc, opcao, inteiro, booleano, soDigitos, hojeSP, dataIsoValida, calcularIdade, validarNascimento,
  cpfValido, cpf, telefone, chavePix, coordenada, mascararCPF, mascararTelefone, mascararChave, somente
};
