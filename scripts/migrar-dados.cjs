// ============================================================
// Migra os dados do Personow antigo para o vocabulário novo (fitness).
//   contratantes        → alunos
//   profissionais       → personais (público) + personais_privado (CPF, telefone, Pix, banco, e-mail)
//   solicitacoes        → aulas (loja→local, promotor*→personal*, valor em centavos, split calculado)
//
// Uso (precisa de serviceAccountKey.json na raiz ou FIREBASE_SERVICE_ACCOUNT):
//   node scripts/migrar-dados.cjs            ← simulação (não grava nada, só mostra o que faria)
//   node scripts/migrar-dados.cjs --aplicar  ← grava. Os documentos antigos NÃO são apagados.
//
// Perfis de personal cujo documento tinha o CPF como id (login antigo "por CPF") e não têm `uid` do Google
// NÃO podem ser migrados: não existe como saber qual conta Google é de quem. Eles são listados no relatório
// e precisam entrar de novo com o Google (e ser aprovados de novo) — esse era justamente o furo de segurança.
// ============================================================
const R = require("../server/regras");

const PUBLICOS = ["nome", "uid", "status", "indicadoPor", "criadoEm", "fotoGoogle", "especialidade", "cref", "bio", "cidade", "valorMin", "disponibilidade", "lat", "lng", "refCode", "ratingQtd", "ratingSoma", "ratingMedia", "mpConectado", "mpUserId"];
const PRIVADOS = ["cpf", "telefone", "nascimento", "banco", "pix", "email"];
const pegar = (o, chaves) => Object.fromEntries(chaves.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));

/** profissionais/{id} → { uid, publico, privado } ou null se não dá para saber a conta Google. */
function mapearProfissional(id, d) {
  const uid = d.uid || (/^[A-Za-z0-9]{20,}$/.test(id) ? id : "");
  if (!uid) return null;
  const publico = pegar(d, PUBLICOS); publico.uid = uid;
  return { uid, publico, privado: { ...pegar(d, PRIVADOS), uid } };
}

/** solicitacoes/{id} → { aula, interno } ; personaisPorUid evita apontar para um uid que não existe. */
function mapearSolicitacao(id, d, personaisPorUid = new Set()) {
  const reais = Number.isFinite(Number(d.valor)) ? Number(d.valor) : 0;
  const centavos = Number.isInteger(d.valorCentavos) ? d.valorCentavos : Math.round(reais * 100);
  const aula = {
    alunoUid: d.alunoUid || d.uid, alunoNome: d.alunoNome || "Aluno", local: d.local || d.loja || "", data: d.data, entrada: d.entrada, saida: d.saida || "",
    horario: d.horario || `${d.entrada}–${d.saida}`, minutos: R.minutosEntre(d.entrada, d.saida), foco: d.foco || "Musculação",
    status: d.status || "aberta", criadoEm: d.criadoEm || null
  };
  if (centavos > 0) { const sp = R.calcularSplit(centavos); aula.valorCentavos = sp.valor; aula.valorPersonalCentavos = sp.personal; }
  const personal = d.personalUid || d.promotorUid || d.promotorChave;
  if (personal && personaisPorUid.has(personal)) { aula.personalUid = personal; aula.personalNome = d.personalNome || d.promotorNome || ""; }
  else if (personal) aula._semPersonal = true;     // aceita por alguém que não foi migrado
  if (d.promotorPreferido) aula.personalPreferidoNome = d.promotorPreferido;
  if (d.aceitoEm) aula.aceitoEm = d.aceitoEm;
  for (const k of ["reciboId", "reciboNumero", "pagaEm", "avaliacao"]) if (d[k] !== undefined) aula[k] = d[k];
  return { aula, interno: centavos > 0 ? { alunoUid: aula.alunoUid, split: R.calcularSplit(centavos), status: "migrado" } : null };
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const admin = require("firebase-admin");
  const fs = require("fs"), path = require("path");
  const chave = process.env.FIREBASE_SERVICE_ACCOUNT || (fs.existsSync(path.join(__dirname, "..", "serviceAccountKey.json")) ? fs.readFileSync(path.join(__dirname, "..", "serviceAccountKey.json"), "utf8") : "");
  if (!chave) { console.error("Defina FIREBASE_SERVICE_ACCOUNT ou coloque serviceAccountKey.json na raiz."); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(chave.trim().startsWith("{") ? chave : Buffer.from(chave, "base64").toString("utf8"))) });
  const db = admin.firestore();
  console.log(aplicar ? "▶ MODO APLICAR (vai gravar)" : "▶ SIMULAÇÃO (nada será gravado). Use --aplicar para gravar.");

  const rel = { alunos: 0, personais: 0, personaisIgnorados: [], aulas: 0, aulasSemPersonal: [] };
  const lote = [];

  for (const d of (await db.collection("contratantes").get()).docs) { rel.alunos++; lote.push([db.collection("alunos").doc(d.id), { uid: d.id, ...d.data() }]); }

  const personaisUid = new Set();
  for (const d of (await db.collection("profissionais").get()).docs) {
    const m = mapearProfissional(d.id, d.data());
    if (!m) { rel.personaisIgnorados.push(d.id.slice(0, 3) + "***" + " (" + (d.data().nome || "sem nome") + ")"); continue; }
    rel.personais++; personaisUid.add(m.uid);
    lote.push([db.collection("personais").doc(m.uid), m.publico], [db.collection("personais_privado").doc(m.uid), m.privado]);
  }

  for (const d of (await db.collection("solicitacoes").get()).docs) {
    const { aula, interno } = mapearSolicitacao(d.id, d.data(), personaisUid);
    if (aula._semPersonal) { rel.aulasSemPersonal.push(d.id); delete aula._semPersonal; if (aula.status === "aceita") { aula.status = "aberta"; } }
    rel.aulas++;
    lote.push([db.collection("aulas").doc(d.id), aula]);
    if (interno) lote.push([db.collection("pagamentos_internos").doc(d.id), interno]);
  }

  if (aplicar) {
    for (let i = 0; i < lote.length; i += 400) { const b = db.batch(); lote.slice(i, i + 400).forEach(([ref, dados]) => b.set(ref, dados, { merge: true })); await b.commit(); }
  }
  console.log(JSON.stringify(rel, null, 2));
  console.log(aplicar ? `✅ ${lote.length} documentos gravados.` : `ℹ️  ${lote.length} documentos seriam gravados.`);
}

module.exports = { mapearProfissional, mapearSolicitacao };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
