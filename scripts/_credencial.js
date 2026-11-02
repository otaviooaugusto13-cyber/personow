// Leitura da credencial do Firebase (UTF-8, UTF-8 com BOM, UTF-16) — compartilhada pelos scripts administrativos.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function decodificar(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString("utf16le"); }
  if (buf.length >= 2 && buf[0] === 0x7b && buf[1] === 0x00) return buf.toString("utf16le");
  return buf.toString("utf8");
}

/** Ordem: --chave <arquivo> → FIREBASE_SERVICE_ACCOUNT (JSON ou base64) → serviceAccountKey.json → *firebase-adminsdk*.json na raiz. */
export function carregarCredencial(chaveArg = null) {
  let arquivo = null;
  if (chaveArg) arquivo = path.resolve(chaveArg);
  else if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    const padrao = path.join(RAIZ, "serviceAccountKey.json");
    arquivo = fs.existsSync(padrao) ? padrao : (fs.readdirSync(RAIZ).filter((f) => /firebase-adminsdk.*\.json$/i.test(f)).map((f) => path.join(RAIZ, f))[0] || null);
  }
  let texto;
  if (arquivo) {
    if (!fs.existsSync(arquivo)) throw new Error(`Arquivo de credencial não encontrado: ${arquivo}`);
    texto = decodificar(fs.readFileSync(arquivo));
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const b = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    texto = b.startsWith("{") ? b : Buffer.from(b, "base64").toString("utf8");
  } else throw new Error(`Não encontrei a chave do Firebase em ${RAIZ}. Salve-a como serviceAccountKey.json ou use --chave <arquivo>.`);
  let cred;
  try { cred = JSON.parse(texto.replace(/^\uFEFF/, "").trim()); } catch (e) { throw new Error(`Credencial não é um JSON válido (${e.message}).`); }
  if (typeof cred.private_key === "string") cred.private_key = cred.private_key.replace(/\\n/g, "\n");
  for (const c of ["project_id", "client_email", "private_key"]) if (!cred[c]) throw new Error(`Credencial sem o campo "${c}".`);
  return cred;
}
