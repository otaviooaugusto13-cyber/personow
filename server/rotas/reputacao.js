// Reputação: níveis, vidas, infrações e banimento (consulta do próprio usuário + painel admin + manutenção agendada).
module.exports = (app, x) => {
  const { db, auth, V, C, Cripto, Falha, envelope, limitar, reputacao, carteira, CRON_SECRET } = x;
  const ADM = [limitar({ janelaMs: 60_000, max: 120, nome: "admin", porUsuario: true }), auth.exigir("admin")];
  const iso = (t) => (t?.toDate ? t.toDate().toISOString() : null);

  /** Estado do próprio usuário. Funciona mesmo para conta banida (é por aqui que a tela vermelha mostra o motivo). */
  app.get("/reputacao", limitar({ janelaMs: 60_000, max: 60, nome: "reputacao", porUsuario: true }), auth.exigirMesmoBanido("aluno", "personal"), envelope(async (req, res) => {
    const u = req.usuario;
    if (u.role === "personal" && !u.banido) await reputacao.varrerFaltas({ uid: u.uid });          // faltas pendentes valem já
    res.json(await reputacao.resumo(u.uid, u.role));
  }));

  // ---------- Admin ----------
  app.get("/admin/infracoes", ...ADM, envelope(async (req, res) => {
    const status = V.opcao(req.query.status || "ativa", ["ativa", "revogada"], "status");
    const s = await db.collection("infracoes").where("status", "==", status).limit(200).get();
    res.json(s.docs.map((d) => ({ id: d.id, ...d.data(), em: iso(d.data().em), revogadaEm: iso(d.data().revogadaEm) })).sort((a, b) => String(b.em).localeCompare(String(a.em))));
  }));
  app.get("/admin/banidos", ...ADM, envelope(async (req, res) => {
    const s = await db.collection("reputacao").where("banido", "==", true).limit(200).get();
    res.json(s.docs.map((d) => ({ uid: d.id, papel: d.data().papel, motivo: d.data().banidoMotivo || "", em: iso(d.data().banidoEm) })));
  }));
  app.post("/admin/infracoes/:id/revogar", ...ADM, envelope(async (req, res) => {
    const id = V.idDoc(req.params.id, "id"), motivo = V.texto(req.body?.motivo, "motivo", { min: 5, max: 200 });
    const r = await reputacao.revogarInfracao({ id, ator: req.usuario.uid, motivo });
    await auth.auditar(req, "admin.infracao.revogar", id, { motivo }); res.json(r);
  }));
  app.post("/admin/infracoes/:id/multa-cobrada", ...ADM, envelope(async (req, res) => {
    const id = V.idDoc(req.params.id, "id"), r = await reputacao.marcarMultaCobrada({ id, ator: req.usuario.uid });
    await auth.auditar(req, "admin.infracao.multa_cobrada", id); res.json(r);
  }));
  app.post("/admin/contas/:uid/desbanir", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), motivo = V.texto(req.body?.motivo, "motivo", { min: 5, max: 200 });
    const r = await reputacao.desbanir({ uid, ator: req.usuario.uid, motivo, zerar: req.body?.zerar === true });
    await auth.auditar(req, "admin.conta.desbanir", uid, { motivo }); res.json(r);
  }));

  // ---------- Manutenção agendada (Render Cron, a cada hora): saldos, faltas, relampagos expiradas, inatividade ----------
  app.post("/interno/manutencao", limitar({ janelaMs: 60_000, max: 10, nome: "cron" }), envelope(async (req, res) => {
    if (!CRON_SECRET || !Cripto.igualSeguro(req.get("x-cron-secret") || "", CRON_SECRET)) throw new Falha(401, "não autorizado", "nao-autenticado");
    const liberacao = await carteira.liberarVencidos({ limite: 500 }), faltas = await reputacao.varrerFaltas(), relampagos = await x.expirarRelampagos();
    let rebaixados = 0;
    for (const d of (await db.collection("reputacao").where("papel", "==", "personal").limit(1000).get()).docs) {
      const r = d.data(); if (r.nivel && r.nivel !== "bronze" && reputacao.calcularInatividade(r).periodos) { await reputacao.avaliarInatividade(d.id); rebaixados++; }
    }
    res.json({ liberacao, ...faltas, ...relampagos, rebaixados });
  }));
};
