#!/usr/bin/env node
// Cifra os dados sensíveis que ainda estão em TEXTO PURO em personais_privado (cpf, telefone, nascimento, banco, pix).
//   node scripts/migrar-cripto.cjs            ← simulação: só relata o que faria
//   node scripts/migrar-cripto.cjs --aplicar  ← grava (cifra, cria o índice cego do CPF e apaga o texto puro)
// Precisa de DATA_ENCRYPTION_KEYS, DATA_ENCRYPTION_KEY_ID e BLIND_INDEX_KEY (npm run gerar-chaves) e da credencial do Firebase.
// CPF repetido em duas contas NÃO é migrado (vai para o relatório): resolva com o suporte antes de rodar de novo.
const fs = require("node:fs"), path = require("node:path");
const Cripto = require("../server/lib/cripto");

const CAMPOS = ["cpf", "telefone", "nascimento", "banco", "pix"];

/** Puro/testável: devolve o que gravar e o que apagar para UM documento. `cpfsVistos`: Map cpfIdx → uid. */
function converter(uid, d, cpfsVistos = new Map()) {
  const grava = {}, remover = [], avisos = [];
  for (const campo of CAMPOS) {
    const v = d[campo];
    if (v === undefined || v === null || v === "" || (typeof v === "object" && !Object.keys(v).length)) continue;
    if (d[`${campo}Enc`]) { remover.push(campo); continue; }   // já cifrado: sobrou só o texto puro duplicado
    if (campo === "cpf") {
      const limpo = String(v).replace(/\D/g, ""), idx = Cripto.indiceCego(limpo);
      if (cpfsVistos.has(idx) && cpfsVistos.get(idx) !== uid) { avisos.push(`CPF repetido (também em ${cpfsVistos.get(idx)}): não migrado`); continue; }
      cpfsVistos.set(idx, uid);
      grava.cpfEnc = Cripto.cifrar(limpo, `personais_privado/cpf/${uid}`); grava.cpfIdx = idx;
    } else if (campo === "pix") {
      grava.pixEnc = Cripto.cifrar(v, `personais_privado/pix/${uid}`); if (v.tipo) grava.pixTipo = v.tipo;
    } else grava[`${campo}Enc`] = Cripto.cifrar(v, `personais_privado/${campo}/${uid}`);
    remover.push(campo);
  }
  return { grava, remover, avisos };
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const admin = require("firebase-admin");
  let bruto = process.env.FIREBASE_SERVICE_ACCOUNT || (fs.existsSync(path.join(__dirname, "..", "serviceAccountKey.json")) ? fs.readFileSync(path.join(__dirname, "..", "serviceAccountKey.json"), "utf8") : "");
  if (!bruto) throw new Error("Credencial ausente (FIREBASE_SERVICE_ACCOUNT ou serviceAccountKey.json).");
  bruto = bruto.replace(/^﻿/, "").trim();
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(bruto.startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8"))) });
  const db = admin.firestore(), { FieldValue } = admin.firestore;
  const snap = await db.collection("personais_privado").get(), vistos = new Map();
  for (const d of snap.docs) { const x = d.data(); if (x.cpfIdx) vistos.set(x.cpfIdx, d.id); }
  let alterados = 0, avisos = 0;
  for (const d of snap.docs) {
    const { grava, remover, avisos: av } = converter(d.id, d.data(), vistos);
    av.forEach((a) => { avisos++; console.warn(`⚠️  ${d.id}: ${a}`); });
    if (!remover.length) continue;
    alterados++; console.log(`${aplicar ? "cifrando" : "[simulação] cifraria"} ${d.id}: ${remover.join(", ")}`);
    if (aplicar) await d.ref.set({ ...grava, ...Object.fromEntries(remover.map((c) => [c, FieldValue.delete()])), migradoCriptoEm: FieldValue.serverTimestamp() }, { merge: true });
  }
  console.log(`\n${aplicar ? "Concluído" : "Simulação"}: ${alterados} documento(s) ${aplicar ? "migrado(s)" : "a migrar"}, ${avisos} aviso(s).${aplicar ? "" : " Rode com --aplicar para gravar."}`);
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { converter };
