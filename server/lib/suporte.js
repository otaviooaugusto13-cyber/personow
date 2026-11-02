// Suporte: conversa 1-a-1 entre a equipe e cada aluno/personal (histórico no Firestore) + notificações push (FCM).
//   suporte_conversas/{uid}   resumo: tipo, nome, última mensagem, contadores de não lidas (usuário e suporte)
//   suporte_mensagens/{id}    uma mensagem; o id começa com o relógio, então ordenar por id = ordem cronológica
//   push_tokens/{sha256}      aparelhos que aceitaram receber avisos (token FCM → uid)
// O navegador só LÊ estas coleções (regras do Firestore); toda escrita passa por aqui: validada, limitada e auditável.
const crypto = require("crypto");
const { Falha } = require("./erros");

function criarSuporte({ db, admin, FieldValue }) {
  const resumo = (t) => String(t).replace(/\s+/g, " ").trim().slice(0, 120);
  let ultimoTempo = 0;   // garante ids estritamente crescentes nesta instância, mesmo com várias mensagens no mesmo milissegundo
  const novoId = () => { ultimoTempo = Math.max(Date.now(), ultimoTempo + 1); return `${String(ultimoTempo).padStart(13, "0")}_${crypto.randomBytes(4).toString("hex")}`; };
  const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

  /** Descobre se o uid é aluno ou personal (e o nome a mostrar para a equipe). `dica` desempata conta com os dois perfis. */
  async function identificar(uid, dica) {
    const [l, p] = await Promise.all([db.collection("alunos").doc(uid).get(), db.collection("personais").doc(uid).get()]);
    const ordem = dica === "aluno" ? ["aluno", "personal"] : ["personal", "aluno"];
    for (const tipo of ordem) {
      const d = tipo === "aluno" ? l : p;
      if (d.exists) { const x = d.data(); return { tipo, nome: String(tipo === "aluno" ? x.nomeCompleto || x.nome || x.email || "Aluno" : x.nome || "Personal").slice(0, 100) }; }
    }
    return null;
  }

  /**
   * Grava uma mensagem e atualiza o resumo da conversa (não lidas do OUTRO lado +1).
   *   de: "usuario" | "suporte". Devolve { tipo, nome, id }.
   */
  async function postar({ uid, de, texto, autorUid = "", dica }) {
    const cref = db.collection("suporte_conversas").doc(uid), atual = (await cref.get()).data();
    let { tipo, nome } = atual || {};
    if (!atual) { const i = await identificar(uid, dica); if (!i) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado"); ({ tipo, nome } = i); }
    const id = novoId(), lote = db.batch();
    lote.set(db.collection("suporte_mensagens").doc(id), { uid, de, texto, autorUid, criadoEm: FieldValue.serverTimestamp() });
    lote.set(cref, {
      uid, tipo, nome, ultimaMsg: resumo(texto), ultimaDe: de, ultimaEm: FieldValue.serverTimestamp(),
      ...(de === "suporte" ? { naoLidasUsuario: FieldValue.increment(1) } : { naoLidasSuporte: FieldValue.increment(1) }),
      ...(atual ? {} : { criadoEm: FieldValue.serverTimestamp(), ...(de === "suporte" ? { naoLidasSuporte: 0 } : { naoLidasUsuario: 0 }) })
    }, { merge: true });
    await lote.commit();
    return { tipo, nome, id };
  }

  /** Zera as não lidas de um lado ("usuario" = a pessoa leu; "suporte" = a equipe leu). */
  async function marcarLido(uid, lado) {
    const ref = db.collection("suporte_conversas").doc(uid);
    if ((await ref.get()).exists) await ref.set({ [lado === "usuario" ? "naoLidasUsuario" : "naoLidasSuporte"]: 0 }, { merge: true });
  }

  // ---------- push (FCM) ----------
  async function registrarToken({ uid, token, admin: ehAdmin, ua = "" }) {
    await db.collection("push_tokens").doc(hashToken(token)).set({ uid, token, admin: !!ehAdmin, ua: String(ua).slice(0, 160), atualizadoEm: FieldValue.serverTimestamp() });
  }
  async function removerToken({ uid, token }) {
    const ref = db.collection("push_tokens").doc(hashToken(token)), d = await ref.get();
    if (d.exists && d.data().uid === uid) await ref.delete();
  }
  /**
   * Envia aviso a todos os aparelhos de `uid` (ou de todos os admins com `admins: true`). Nunca lança: push é "melhor esforço"
   * e não pode derrubar o envio da mensagem. Tokens mortos são apagados. Devolve quantos aparelhos receberam.
   */
  async function enviarPush({ uid, admins = false, titulo, corpo, url }) {
    try {
      const msg = admin.messaging?.(); if (!msg) return 0;
      const s = await db.collection("push_tokens").where(admins ? "admin" : "uid", "==", admins ? true : uid).limit(50).get();
      const alvos = s.docs.map((d) => ({ id: d.id, token: d.data().token })).filter((a) => a.token);
      if (!alvos.length) return 0;
      const r = await msg.sendEachForMulticast({ tokens: alvos.map((a) => a.token), data: { titulo: String(titulo).slice(0, 80), corpo: resumo(corpo), url: String(url || "") }, webpush: { headers: { Urgency: "high", TTL: "86400" } } });
      await Promise.all(r.responses.map((x, i) => (!x.success && /not-registered|invalid-registration|invalid-argument/.test(x.error?.code || "") ? db.collection("push_tokens").doc(alvos[i].id).delete() : null)));
      return r.successCount;
    } catch (e) { console.warn("push falhou:", e.message); return 0; }
  }

  return { postar, marcarLido, registrarToken, removerToken, enviarPush, identificar };
}
module.exports = { criarSuporte };
