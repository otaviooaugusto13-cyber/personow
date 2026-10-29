#!/usr/bin/env node
// Concede (ou retira) o papel de administrador a uma conta Google: custom claim assinada `role: "admin"`.
// Uso:   node scripts/definir-admin.cjs voce@gmail.com            (concede)
//        node scripts/definir-admin.cjs voce@gmail.com --remover  (retira)
// A conta precisa já ter feito login uma vez (existir no Firebase Auth). Depois, sair e entrar de novo no /admin.html.
// Credencial: FIREBASE_SERVICE_ACCOUNT (JSON ou base64) ou serviceAccountKey.json na raiz.
const fs = require("node:fs"), path = require("node:path");

function credencial(admin) {
  let bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) { const f = path.join(__dirname, "..", "serviceAccountKey.json"); if (fs.existsSync(f)) bruto = fs.readFileSync(f, "utf8"); }
  if (!bruto) throw new Error("Credencial ausente: defina FIREBASE_SERVICE_ACCOUNT ou salve serviceAccountKey.json na raiz do projeto.");
  bruto = bruto.replace(/^﻿/, "").trim();
  return admin.credential.cert(JSON.parse(bruto.startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8")));
}

/** Nova lista de claims (preserva as demais). Exportada para teste. */
function novasClaims(atuais, conceder) {
  const c = { ...(atuais || {}) };
  if (conceder) c.role = "admin"; else { if (c.role === "admin") delete c.role; delete c.admin; }
  return c;
}

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase(), remover = process.argv.includes("--remover");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("Uso: node scripts/definir-admin.cjs email@dominio.com [--remover]"); process.exit(1); }
  const admin = require("firebase-admin");   // só quando for usar de verdade (os testes não precisam)
  admin.initializeApp({ credential: credencial(admin) });
  const u = await admin.auth().getUserByEmail(email).catch(() => null);
  if (!u) { console.error(`Nenhuma conta com o e-mail ${email}. Entre uma vez no app com essa conta Google e rode de novo.`); process.exit(1); }
  await admin.auth().setCustomUserClaims(u.uid, novasClaims(u.customClaims, !remover));
  await admin.auth().revokeRefreshTokens(u.uid);   // força renovar o token com as claims novas
  console.log(`${remover ? "Papel de admin retirado de" : "Papel de admin concedido a"} ${email} (uid ${u.uid}). Entre de novo em /admin.html.`);
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { novasClaims };
