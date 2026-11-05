// Academias parceiras (B2B): painel SOMENTE LEITURA com números agregados das aulas dadas no local (sem dado pessoal de aluno/personal).
//   Academia (claim separada `academia: true`, preserva as demais):
//     GET  /academia/painel?dias=7|30|90|365&id=   métricas agregadas
//     POST /academia/reivindicar                   ativa o acesso se o e-mail (verificado) foi convidado por um admin
//   Admin:
//     GET  /admin/academias                        lista
//     POST /admin/academias                        cadastra { nome, cidade, aliases[] }
//     PUT  /admin/academias/:id                    edita { nome?, cidade?, aliases?, ativo? }
//     POST /admin/academias/:id/acesso             vincula/remove conta por e-mail { email, remover? } (login recente)
// Coleção `academias/{id}`: { nome, cidade, aliases[], ativo, uids[], convites[], criadoEm }. Só o servidor lê/escreve.
const Acad = require("../lib/academias");

module.exports = (app, x) => {
  const { db, admin, FieldValue, auth, V, Falha, envelope, limitar } = x;
  const ADM = [limitar({ janelaMs: 60_000, max: 120, nome: "admin-academias", porUsuario: true }), auth.exigir("admin")];
  const RECENTE = (req, res, next) => { try { auth.exigirRecente(req.usuario); next(); } catch (e) { next(e); } };
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const iso = (ts) => { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toISOString() : null; };

  /** Academia: login (e-mail verificado, sessão não revogada) + claim `academia: true`. */
  const exigirAcademia = async (req, res, next) => {
    try {
      const u = await auth.autenticar(req);
      if (u.academia !== true) throw new Falha(403, "Sua conta não tem acesso de academia parceira.", "sem-permissao");
      req.usuario = u; next();
    } catch (e) { next(e); }
  };
  const semCache = (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); };

  const apelidosValidos = (lista) => {
    if (!Array.isArray(lista) || lista.length > 20) throw new Falha(400, "Informe até 20 apelidos de local.", "dados-invalidos");
    const out = [...new Set(lista.map((a) => V.texto(a, "apelido", { min: Acad.ALIAS_MIN, max: 80 }).trim()))];
    return out;
  };
  const publica = (id, a) => ({ id, nome: a.nome, cidade: a.cidade || "", aliases: a.aliases || [], ativo: a.ativo !== false, acessos: (a.uids || []).length, convites: (a.convites || []).length, criadoEm: iso(a.criadoEm) });

  // ---------- Painel da academia ----------
  async function academiasDe(uid) {
    const s = await db.collection("academias").where("uids", "array-contains", uid).get();
    return s.docs.filter((d) => d.data().ativo !== false).map((d) => ({ id: d.id, ...d.data() }));
  }
  app.get("/academia/painel", limitar({ janelaMs: 60_000, max: 40, nome: "academia", porUsuario: true }), semCache, exigirAcademia, envelope(async (req, res) => {
    const minhas = await academiasDe(req.usuario.uid);
    if (!minhas.length) throw new Falha(403, "Sua conta ainda não está vinculada a uma academia.", "sem-academia");
    const dias = V.opcao(String(req.query.dias || "30"), ["7", "30", "90", "365"], "período");
    const alvo = req.query.id ? minhas.find((a) => a.id === String(req.query.id)) : minhas[0];
    if (!alvo) throw new Falha(404, "Academia não encontrada.", "nao-encontrado");
    const desde = new Date(Date.now() - Number(dias) * 86_400_000).toISOString().slice(0, 10);
    const lotes = await Promise.all(["concluida", "paga"].map((st) => db.collection("aulas").where("status", "==", st).where("data", ">=", desde).limit(5000).get()));
    const aulas = lotes.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
    const out = Acad.agregar(aulas, alvo, { desde });
    res.json({ academias: minhas.map((a) => ({ id: a.id, nome: a.nome })), academia: { id: alvo.id, nome: alvo.nome, cidade: alvo.cidade || "" }, periodoDias: Number(dias), geradoEm: Date.now(), amostraLimitada: lotes.some((s) => s.docs.length >= 5000), ...out });
  }));

  /** Primeiro acesso de quem foi convidado antes de ter conta: confere o e-mail VERIFICADO e ativa o vínculo. */
  app.post("/academia/reivindicar", limitar({ janelaMs: 60_000, max: 10, nome: "academia-reiv", porUsuario: true }), semCache, auth.exigirLogin, envelope(async (req, res) => {
    const u = req.usuario, email = String(u.email || "").toLowerCase();
    if (!email) throw new Falha(403, "Conta sem e-mail.", "sem-permissao");
    const s = await db.collection("academias").where("convites", "array-contains", email).get();
    const alvos = s.docs.filter((d) => d.data().ativo !== false);
    if (!alvos.length) throw new Falha(404, "Nenhum convite de academia para este e-mail. Peça à equipe do Personow.", "sem-convite");
    for (const d of alvos) await d.ref.set({ uids: [...new Set([...(d.data().uids || []), u.uid])], convites: (d.data().convites || []).filter((e) => e !== email) }, { merge: true });
    await concederClaim(u.uid);
    await db.collection("usuarios").doc(u.uid).set({ uid: u.uid, email, criadoEm: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true, atualizarToken: true, academias: alvos.map((d) => d.data().nome) });
  }));

  /** Liga/desliga a claim `academia` mantendo TODAS as outras (role, perfis, admin, treinado…). */
  async function concederClaim(uid) { const atual = (await admin.auth().getUser(uid)).customClaims || {}; await admin.auth().setCustomUserClaims(uid, { ...atual, academia: true }); }
  async function retirarClaim(uid) { const { academia, ...resto } = (await admin.auth().getUser(uid)).customClaims || {}; await admin.auth().setCustomUserClaims(uid, resto); }

  // ---------- Admin ----------
  app.get("/admin/academias", ...ADM, envelope(async (req, res) => {
    const s = await db.collection("academias").limit(500).get();
    res.json(s.docs.map((d) => publica(d.id, d.data())).sort((a, b) => a.nome.localeCompare(b.nome)));
  }));
  app.post("/admin/academias", ...ADM, envelope(async (req, res) => {
    const b = V.somente(req.body, ["nome", "cidade", "aliases"]);
    const nome = V.texto(b.nome, "nome", { min: 3, max: 80 }), cidade = V.texto(b.cidade || "", "cidade", { max: 80, obrigatorio: false });
    const aliases = apelidosValidos(b.aliases || []), ref = db.collection("academias").doc();
    await ref.set({ nome, cidade, aliases, ativo: true, uids: [], convites: [], criadoEm: FieldValue.serverTimestamp() });
    await auth.auditar(req, "admin.academia.criar", ref.id, { nome });
    res.json({ ok: true, id: ref.id });
  }));
  app.put("/admin/academias/:id", ...ADM, envelope(async (req, res) => {
    const id = V.idDoc(req.params.id, "id"), b = V.somente(req.body, ["nome", "cidade", "aliases", "ativo"]), ref = db.collection("academias").doc(id);
    if (!(await ref.get()).exists) throw new Falha(404, "Academia não encontrada.", "nao-encontrado");
    const mud = {};
    if (b.nome !== undefined) mud.nome = V.texto(b.nome, "nome", { min: 3, max: 80 });
    if (b.cidade !== undefined) mud.cidade = V.texto(b.cidade, "cidade", { max: 80, obrigatorio: false });
    if (b.aliases !== undefined) mud.aliases = apelidosValidos(b.aliases);
    if (b.ativo !== undefined) mud.ativo = V.booleano(b.ativo, "ativo");
    if (!Object.keys(mud).length) throw new Falha(400, "Nada para alterar.", "dados-invalidos");
    await ref.set(mud, { merge: true });
    await auth.auditar(req, "admin.academia.editar", id, { campos: Object.keys(mud) });
    res.json({ ok: true });
  }));
  /** Vincula (ou remove) o acesso de um e-mail. Sem conta ainda: vira convite e é ativado no primeiro acesso (POST /academia/reivindicar). */
  app.post("/admin/academias/:id/acesso", ...ADM, RECENTE, envelope(async (req, res) => {
    const id = V.idDoc(req.params.id, "id"), remover = req.body?.remover === true;
    const email = V.texto(req.body?.email, "e-mail", { min: 5, max: 120, re: EMAIL }).toLowerCase();
    const ref = db.collection("academias").doc(id), a = (await ref.get()).data();
    if (!a) throw new Falha(404, "Academia não encontrada.", "nao-encontrado");
    let u = null; try { u = await admin.auth().getUserByEmail(email); } catch { u = null; }
    const uids = new Set(a.uids || []), convites = new Set(a.convites || []);
    let pendente = false;
    if (remover) {
      convites.delete(email);
      if (u) {
        uids.delete(u.uid);
        const outras = (await db.collection("academias").where("uids", "array-contains", u.uid).get()).docs.filter((d) => d.id !== id);
        if (!outras.length) await retirarClaim(u.uid);
      }
    } else if (u) {
      if ((u.customClaims || {}).role === "ti") throw new Falha(409, "Conta de operador de TI não pode ser de academia.", "papel-conflito");
      uids.add(u.uid); convites.delete(email); await concederClaim(u.uid);
      await db.collection("usuarios").doc(u.uid).set({ uid: u.uid, email, criadoEm: FieldValue.serverTimestamp() }, { merge: true });
    } else { convites.add(email); pendente = true; }
    await ref.set({ uids: [...uids], convites: [...convites] }, { merge: true });
    await auth.auditar(req, remover ? "admin.academia.remover_acesso" : "admin.academia.conceder_acesso", id, { email, pendente });
    res.json({ ok: true, acessos: uids.size, convites: convites.size, pendente });
  }));
};
