// Cria o PRIMEIRO gestor de TI (depois disso, tudo é feito pelo painel em /painel-ti).
// Uso:  node scripts/criar-operador-ti.js "Nome Completo" email@empresa.com [gestor|tecnico]
// Credencial: FIREBASE_SERVICE_ACCOUNT (JSON ou base64) ou serviceAccountKey.json na raiz — igual a definir-admin.js.
// Gera uma senha temporária (mostrada UMA vez; o primeiro acesso exige trocá-la) e registra a ação na trilha de auditoria.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { criarTI } = require("../server/lib/ti");
const V = require("../server/lib/validacao");

const [nome, email, nivel = "gestor"] = process.argv.slice(2);
if (!nome || !email) { console.error('Uso: node scripts/criar-operador-ti.js "Nome Completo" email@empresa.com [gestor|tecnico]'); process.exit(1); }

let bruto = process.env.FIREBASE_SERVICE_ACCOUNT || (fs.existsSync(path.join(RAIZ, "serviceAccountKey.json")) ? fs.readFileSync(path.join(RAIZ, "serviceAccountKey.json"), "utf8") : "");
if (!bruto) { console.error("Credencial ausente: defina FIREBASE_SERVICE_ACCOUNT ou coloque serviceAccountKey.json na raiz."); process.exit(1); }
bruto = bruto.replace(/^﻿/, "").trim(); if (!bruto.startsWith("{")) bruto = Buffer.from(bruto, "base64").toString("utf8");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(bruto)) });

const { FieldValue, Timestamp } = admin.firestore;
const ti = criarTI({ db: admin.firestore(), admin, FieldValue, Timestamp, V, auth: null });
const sistema = { uid: "SCRIPT", nome: "scripts/criar-operador-ti.js", nivel: "gestor", ip: "local" };

try {
  const r = await ti.operadores.criar({ nome, email, nivel }, sistema);
  await ti.auditoria.registrar(sistema, { acao: "operador.criar", alvoTipo: "operador", alvoId: r.operador.uid, resumo: `Bootstrap: cadastrou ${r.operador.nome} (${r.operador.nivel}) via script`, depois: { nome: r.operador.nome, email: r.operador.email, nivel: r.operador.nivel } });
  console.log(`\n✅ Operador criado: ${r.operador.nome} <${r.operador.email}> (${r.operador.nivel})\n   UID: ${r.operador.uid}\n   Senha temporária (guarde agora, não será exibida de novo):\n\n      ${r.senhaTemporaria}\n\nAcesse /painel-ti, entre e defina a sua senha.`);
  process.exit(0);
} catch (e) { console.error("\n❌", e.message || e); process.exit(1); }
