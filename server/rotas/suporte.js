// Chat de suporte (equipe ↔ aluno/personal) e registro de aparelhos para notificação push.
// Leitura em tempo real pelo navegador (regras do Firestore); TODA escrita passa por aqui.
module.exports = (app, x) => {
  const { db, auth, V, C, Cripto, Falha, envelope, limitar, suporte, habilitacao, treinamento } = x;
  const USU = ["aluno", "personal"];
  const limUsuario = limitar({ janelaMs: 60_000, max: 20, nome: "suporte-msg", porUsuario: true });
  const limAdmin = limitar({ janelaMs: 60_000, max: 60, nome: "suporte-adm", porUsuario: true });
  const PAGINA = { aluno: "index.html", personal: "personal.html" };

  // ---------- lado do usuário ----------
  app.post("/suporte/mensagem", auth.exigir(...USU), limUsuario, envelope(async (req, res) => {
    const texto = V.texto(req.body?.texto, "mensagem", { min: 1, max: 1000 }), uid = req.usuario.uid;
    const { nome } = await suporte.postar({ uid, de: "usuario", texto, autorUid: uid, dica: req.usuario.role });
    await suporte.enviarPush({ admins: true, titulo: `Suporte · ${nome || "nova mensagem"}`, corpo: texto, url: "admin.html#suporte" });
    res.json({ ok: true });
  }));
  app.post("/suporte/lido", auth.exigir(...USU), limUsuario, envelope(async (req, res) => { await suporte.marcarLido(req.usuario.uid, "usuario"); res.json({ ok: true }); }));

  // ---------- lado da equipe ----------
  app.post("/admin/suporte/:uid/mensagem", auth.exigir("admin"), limAdmin, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), texto = V.texto(req.body?.texto, "mensagem", { min: 1, max: 1000 });
    const { tipo } = await suporte.postar({ uid, de: "suporte", texto, autorUid: req.usuario.uid });
    await auth.auditar(req, "admin.suporte.responder", uid, { tamanho: texto.length });
    await suporte.enviarPush({ uid, titulo: "Suporte Personow", corpo: texto, url: `${PAGINA[tipo] || "index.html"}?suporte=1` });
    res.json({ ok: true });
  }));
  app.post("/admin/suporte/:uid/lido", auth.exigir("admin"), limAdmin, envelope(async (req, res) => { await suporte.marcarLido(V.idDoc(req.params.uid, "uid"), "suporte"); res.json({ ok: true }); }));

  // ---------- perfil 360 para o atendente (carregado ao abrir/receber um chamado) ----------
  const iso = (ts) => { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toISOString() : null; };
  const tentar = (fn) => { try { return fn(); } catch { return null; } };
  const limPerfil = limitar({ janelaMs: 60_000, max: 90, nome: "suporte-perfil", porUsuario: true });
  const RESUMO_MAX = 8;   // últimos aulas exibidos no painel

  /**
   * Tudo o que o atendente precisa para atender sem abrir outras telas: cadastro (CPF mascarado), status na plataforma,
   * pendências, histórico de aulas, últimas ações da equipe sobre a conta e dados da conversa. UMA chamada, leituras em paralelo.
   * A leitura de dados pessoais é auditada (mesma regra da ficha de análise).
   */
  app.get("/admin/suporte/:uid/perfil", auth.exigir("admin"), limPerfil, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), leve = req.query.leve === "1";   // leve = pré-carga do cache: sem dados pessoais decifrados e sem auditoria
    const [conv, usu, ident] = await Promise.all([db.collection("suporte_conversas").doc(uid).get(), db.collection("usuarios").doc(uid).get(), suporte.identificar(uid)]);
    const tipo = conv.data()?.tipo || ident?.tipo;
    if (!tipo) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado");
    const email = usu.data()?.email || "";

    const aulasQ = tipo === "aluno" ? db.collection("aulas").where("uid", "==", uid) : db.collection("aulas").where("personalUid", "==", uid);
    const [aulasSnap, audSnap, msgsSnap] = await Promise.all([aulasQ.limit(200).get(), db.collection("auditoria").where("alvo", "==", uid).limit(60).get(), db.collection("suporte_mensagens").where("uid", "==", uid).limit(500).get()]);

    const aulas = aulasSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
    const porStatus = {}; for (const t of aulas) porStatus[t.status] = (porStatus[t.status] || 0) + 1;
    const historico = {
      total: aulas.length, porStatus,
      ultimos: aulas.slice(0, RESUMO_MAX).map((t) => ({ id: t.id, data: t.data || null, entrada: t.entrada || null, saida: t.saida || null, foco: t.foco || "", status: t.status, contraparte: tipo === "aluno" ? t.personalNome || "" : t.aluno || "" }))
    };
    const acoes = audSnap.docs.map((d) => d.data()).sort((a, b) => (b.em?.toMillis?.() || 0) - (a.em?.toMillis?.() || 0)).slice(0, 5).map((a) => ({ acao: a.acao, em: iso(a.em) }));   // sem "detalhes": o painel não precisa e pode conter dados sensíveis
    const c = conv.data() || {};
    const conversa = { desde: iso(c.criadoEm), mensagens: msgsSnap.size, naoLidas: c.naoLidasSuporte || 0, ultimaEm: iso(c.ultimaEm) };

    let cadastro;
    if (tipo === "personal") {
      const { pub, priv, nascimento } = await habilitacao.perfil(uid);
      if (!pub) throw new Falha(404, "Personal não encontrado.", "nao-encontrado");
      const cx = (campo) => `personais_privado/${campo}/${uid}`;
      const cpf = leve ? null : tentar(() => Cripto.decifrar(priv.cpfEnc, cx("cpf"))), idade = nascimento ? V.calcularIdade(nascimento) : null;
      const [trein, hab] = await Promise.all([treinamento.estado(uid), habilitacao.situacao(uid)]);
      cadastro = {
        nome: pub.nome || "", status: pub.status, statusMotivo: pub.statusMotivo || "", cidade: pub.cidade || "", especialidade: pub.especialidade || "",
        telefone: leve ? "" : tentar(() => Cripto.decifrar(priv.telefoneEnc, cx("telefone"))) || "", cpfMascarado: cpf ? V.mascararCPF(cpf) : "", nascimento: nascimento || null, idade,
        cref: pub.cref || "", ratingMedia: pub.ratingMedia || null, criadoEm: iso(pub.criadoEm),
        treinamento: { concluidos: trein?.concluidos ?? 0, total: trein?.total ?? 0 }, pendencias: hab?.pendencias || [], habilitacoes: Object.keys(pub.habilitacoes || {})
      };
    } else {
      const [l, cartao] = await Promise.all([db.collection("alunos").doc(uid).get(), db.collection("cartoes").doc(uid).get()]);
      const x = l.data() || {};
      cadastro = { nome: x.nomeCompleto || x.nome || "", status: x.status || "ativo", documento: x.documento || "", objetivo: x.objetivo || "", telefone: x.telefone || "", endereco: x.endereco || "", criadoEm: iso(x.criadoEm), cartao: cartao.data()?.status || "sem cartão" };
    }
    if (!leve) await auth.auditar(req, "admin.suporte.ver_perfil", uid, { tipo });
    res.json({ uid, tipo, email, cadastro, historico, acoes, conversa, parcial: leve, carregadoEm: new Date().toISOString() });
  }));

  // ---------- aparelhos (push) ----------
  const tokenValido = (t) => { if (typeof t !== "string" || t.length < 20 || t.length > 4096 || /\s/.test(t)) throw new Falha(400, "Token de notificação inválido.", "dados-invalidos"); return t; };
  app.post("/push/registrar", auth.exigir("aluno", "personal", "admin"), limUsuario, envelope(async (req, res) => {
    await suporte.registrarToken({ uid: req.usuario.uid, token: tokenValido(req.body?.token), admin: req.usuario.role === "admin", ua: req.get("user-agent") });
    res.json({ ok: true });
  }));
  app.post("/push/remover", auth.exigir("aluno", "personal", "admin"), limUsuario, envelope(async (req, res) => {
    await suporte.removerToken({ uid: req.usuario.uid, token: tokenValido(req.body?.token) }); res.json({ ok: true });
  }));
};
