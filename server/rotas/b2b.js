// Painel B2B para parceiros/indústrias (papel "parceiro"). Cada parceiro só enxerga as aulas marcadas com o seu parceiroId.
// Quem tem acesso a qual parceiro vive em parceiros/{id}.uids (revogável na hora); o papel "parceiro" é a claim.
const B2B = require("../lib/b2b");

module.exports = (app, x) => {
  const { db, admin, FieldValue, auth, V, C, Falha, envelope, limitar } = x;
  const porUsuario = (nome, max) => limitar({ janelaMs: 60_000, max, nome, porUsuario: true });
  const ADM = [limitar({ janelaMs: 60_000, max: 120, nome: "admin", porUsuario: true }), auth.exigir("admin")];

  async function parceirosDe(uid) {
    return (await db.collection("parceiros").where("uids", "array-contains", uid).get()).docs.filter((d) => d.data().ativo !== false).map((d) => ({ id: d.id, nome: d.data().nome }));
  }

  // ---------- Alunos: lista de parceiros para marcar a aula ----------
  app.get("/parceiros", auth.exigir("aluno"), envelope(async (req, res) => {
    const s = await db.collection("parceiros").where("ativo", "==", true).limit(300).get();
    res.json(s.docs.map((d) => ({ id: d.id, nome: d.data().nome })).sort((a, b) => a.nome.localeCompare(b.nome)));
  }));

  // ---------- Parceiro: painel ----------
  app.get("/b2b/painel", porUsuario("b2b", 40), auth.exigir("parceiro"), envelope(async (req, res) => {
    const parceiros = await parceirosDe(req.usuario.uid);
    if (!parceiros.length) throw new Falha(403, "Sua conta ainda não está vinculada a nenhuma parceiro.", "sem-parceiro");
    const dias = V.opcao(String(req.query.dias || "30"), ["7", "30", "90", "365"], "período"), regiao = String(req.query.regiao || "").slice(0, 100);
    const ids = parceiros.map((m) => m.id), aulas = [];
    for (let i = 0; i < ids.length; i += 10) (await db.collection("aulas").where("parceiroId", "in", ids.slice(i, i + 10)).get()).docs.forEach((d) => aulas.push({ id: d.id, ...d.data() }));
    const out = B2B.agregar(aulas, { desdeMs: Date.now() - Number(dias) * 86_400_000, regiao, instanteSP: V.instanteSP });
    const fotos = [];
    for (const f of out.fotosIds) { const d = (await db.collection("fotos_checkout").doc(f.id).get()).data(); if (d) fotos.push({ ...f, miniatura: `data:image/jpeg;base64,${d.miniatura}` }); }
    delete out.fotosIds;
    res.json({ parceiros, periodoDias: Number(dias), regiao, geradoEm: Date.now(), ...out, fotos });
  }));
  app.get("/b2b/foto/:id", porUsuario("b2bfoto", 60), auth.exigir("parceiro"), envelope(async (req, res) => {
    const id = V.idDoc(req.params.id, "id"), parceiros = (await parceirosDe(req.usuario.uid)).map((m) => m.id), f = (await db.collection("fotos_checkout").doc(id).get()).data();
    if (!f || !f.parceiroId || !parceiros.includes(f.parceiroId)) throw new Falha(404, "Foto não encontrada.", "nao-encontrado");
    res.setHeader("Content-Type", "image/jpeg"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(f.imagem, "base64"));
  }));

  // ---------- Admin: parceiros e acessos ----------
  app.get("/admin/parceiros", ...ADM, envelope(async (req, res) => {
    const s = await db.collection("parceiros").limit(300).get();
    res.json(s.docs.map((d) => ({ id: d.id, nome: d.data().nome, ativo: d.data().ativo !== false, acessos: (d.data().uids || []).length })));
  }));
  app.post("/admin/parceiros", ...ADM, envelope(async (req, res) => {
    const nome = V.texto(req.body?.nome, "nome", { min: 2, max: 80 }), ref = db.collection("parceiros").doc();
    await ref.set({ nome, ativo: true, uids: [], criadoEm: FieldValue.serverTimestamp() });
    await auth.auditar(req, "admin.parceiro.criar", ref.id, { nome }); res.json({ ok: true, id: ref.id });
  }));
  /** Vincula (ou remove) o acesso de um e-mail à parceiro. A pessoa precisa ter entrado uma vez com Google; contas de aluno/personal/admin são recusadas. */
  app.post("/admin/parceiros/:id/acesso", ...ADM, envelope(async (req, res) => {
    const id = V.idDoc(req.params.id, "id"), email = V.texto(req.body?.email, "e-mail", { min: 5, max: 120, re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }), remover = req.body?.remover === true;
    const ref = db.collection("parceiros").doc(id), m = (await ref.get()).data();
    if (!m) throw new Falha(404, "Parceiro não encontrada.", "nao-encontrado");
    let u; try { u = await admin.auth().getUserByEmail(email); } catch { throw new Falha(404, "Nenhuma conta Google com este e-mail. A pessoa precisa entrar uma vez em parceiro.html.", "usuario-inexistente"); }
    const uids = new Set(m.uids || []);
    if (remover) uids.delete(u.uid);
    else {
      const papel = (u.customClaims || {}).role;
      if (papel && papel !== "parceiro") throw new Falha(409, "Esta conta já tem outro perfil (aluno, personal ou admin). Use outro e-mail.", "papel-conflito");
      uids.add(u.uid); await auth.definirPapel(u.uid, "parceiro");
      await db.collection("usuarios").doc(u.uid).set({ uid: u.uid, role: "parceiro", email, criadoEm: FieldValue.serverTimestamp() }, { merge: true });
    }
    await ref.set({ uids: [...uids] }, { merge: true });
    await auth.auditar(req, remover ? "admin.parceiro.remover_acesso" : "admin.parceiro.conceder_acesso", id, { email });
    res.json({ ok: true, acessos: uids.size });
  }));
};
