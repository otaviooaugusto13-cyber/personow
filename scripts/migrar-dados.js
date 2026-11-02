#!/usr/bin/env node
// Migração para o modelo novo (RBAC + criptografia). Padrão: simulação. Use --executar para gravar.
//   FIREBASE_SERVICE_ACCOUNT=... DATA_ENCRYPTION_KEYS=... DATA_ENCRYPTION_KEY_ID=... BLIND_INDEX_KEY=... node scripts/migrar-dados.js [--executar]
// 1) cifra CPF/telefone/nascimento/Pix que estavam em texto puro em personais_privado (e recifra com a chave atual)
// 2) concede o papel (claim) a quem já tinha conta: alunos → aluno, personais → personal
// 3) move IDs do gateway de cartoes → cartoes_privado
// 4) lista tokens OAuth antigos do Mercado Pago (mp_tokens) — não são mais usados; apague e revogue no painel do MP
const admin = require("firebase-admin");
process.env.AMBIENTE = process.env.AMBIENTE || "producao";
const Cripto = require("../server/lib/cripto");
const exec = process.argv.includes("--executar");
const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!bruto) { console.error("Defina FIREBASE_SERVICE_ACCOUNT."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8"))) });
const db = admin.firestore(), { FieldValue } = admin.firestore;
const ctx = (c, uid) => `personais_privado/${c}/${uid}`;
(async () => {
  let n = { priv: 0, roles: 0, cartoes: 0 };
  for (const d of (await db.collection("personais_privado").get()).docs) {
    const p = d.data(), up = {}, uid = d.id;
    const cpf = p.cpf ? String(p.cpf).replace(/\D/g, "") : null;
    if (cpf && cpf.length === 11) { up.cpfEnc = Cripto.cifrar(cpf, ctx("cpf", uid)); up.cpfIdx = Cripto.indiceCego(cpf); up.cpf = FieldValue.delete(); }
    if (p.telefone) { up.telefoneEnc = Cripto.cifrar(String(p.telefone).replace(/\D/g, ""), ctx("telefone", uid)); up.telefone = FieldValue.delete(); }
    if (p.nascimento && /^\d{4}-\d{2}-\d{2}$/.test(p.nascimento)) { up.nascimentoEnc = Cripto.cifrar(p.nascimento, ctx("nascimento", uid)); up.nascimento = FieldValue.delete(); }
    if (p.pix?.chave) { up.pixEnc = Cripto.cifrar(p.pix, ctx("pix", uid)); up.pixTipo = p.pix.tipo; up.pix = FieldValue.delete(); }
    for (const c of ["cpf", "telefone", "nascimento", "pix"]) { const e = p[`${c}Enc`]; if (e && Cripto.precisaRotacionar(e)) up[`${c}Enc`] = Cripto.cifrar(Cripto.decifrar(e, ctx(c, uid)), ctx(c, uid)); }
    if (Object.keys(up).length) { n.priv++; console.log(`[priv] ${uid}: ${Object.keys(up).join(", ")}`); if (exec) await d.ref.set(up, { merge: true }); }
  }
  for (const [col, role, extra] of [["alunos", "aluno", {}], ["personais", "personal", { treinado: false }]]) {
    for (const d of (await db.collection(col).get()).docs) {
      if (d.data().teste) continue;
      try {
        const u = await admin.auth().getUser(d.id), claims = u.customClaims || {};
        if (claims.role) continue;
        n.roles++; console.log(`[papel] ${d.id} → ${role}`);
        if (exec) { await admin.auth().setCustomUserClaims(d.id, { ...claims, role, ...extra }); await db.collection("usuarios").doc(d.id).set({ uid: d.id, role, email: u.email || "", migradoEm: FieldValue.serverTimestamp() }, { merge: true }); }
        if (exec && role === "personal") await d.ref.set({ treinamentoOk: false, email: FieldValue.delete(), mpUserId: FieldValue.delete(), mpConectado: FieldValue.delete() }, { merge: true });
      } catch (e) { console.warn(`[papel] ${d.id}: ${e.message}`); }
    }
  }
  for (const d of (await db.collection("cartoes").get()).docs) {
    const c = d.data(); if (!c.mpCustomerId && !c.mpCardId) continue;
    n.cartoes++; console.log(`[cartão] ${d.id}`);
    if (exec) { await db.collection("cartoes_privado").doc(d.id).set({ uid: d.id, mpCustomerId: c.mpCustomerId || null, mpCardId: c.mpCardId || null }); await d.ref.set({ mpCustomerId: FieldValue.delete(), mpCardId: FieldValue.delete() }, { merge: true }); }
  }
  const tk = await db.collection("mp_tokens").get();
  console.log(`\n${exec ? "EXECUTADO" : "SIMULAÇÃO"}: ${n.priv} perfis cifrados, ${n.roles} papéis, ${n.cartoes} cartões. mp_tokens legados: ${tk.size} (apague a coleção e revogue no painel do Mercado Pago).`);
  console.log("Personais antigos terão de informar data de nascimento (e responsável, se 16–17) e concluir o treinamento antes de aceitar aulas.");
})().catch((e) => { console.error(e); process.exit(1); });
