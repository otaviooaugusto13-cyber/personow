// Módulo de TI — API.   Painel: /painel-ti (ti.html)   Documentação: TI-MODULO.md
//   /ti/sessao ...            login do operador (auditado), troca da própria senha
//   /ti/operadores ...        cadastro, nível, reset de senha, exclusão lógica/restauração           (gestor)
//   /ti/auditoria ...         trilha de auditoria: consulta, exportação CSV, verificação da cadeia     (gestor; técnico vê só a sua)
//   /ti/chamados ...          fila e atendimento de chamados
//   /ti/dashboard, /ti/stream métricas, ranking e tempo real (online + fila)
//   /ti/administradores ...   contas de ADMIN criadas pela TI: criar, redefinir senha, remover acesso (gestor)
//   /ti/solicitantes/:uid/perfil  perfil completo do aluno/personal que abriu o chamado (CPF mascarado; consulta auditada)
//   /chamados ...             lado do SOLICITANTE (aluno/personal/admin): abrir, acompanhar, responder
//   /presenca/ping            batimento do app para o contador de usuários online
const { paraCSV } = require("../lib/csv");

module.exports = (app, x) => {
  const { auth, V, Falha, envelope, limitar, suporte, db, C, Cripto, habilitacao } = x;
  const ti = x.ti, { operadores, admins, chamados, metricas, presenca, tempoReal, auditoria, K } = ti;
  const lim = limitar({ janelaMs: 60_000, max: 180, nome: "ti", porUsuario: true });
  const limSens = limitar({ janelaMs: 3_600_000, max: 40, nome: "ti-sens", porUsuario: true });
  const limCsv = limitar({ janelaMs: 60_000, max: 6, nome: "ti-csv", porUsuario: true });
  const limAud = limitar({ janelaMs: 60_000, max: 30, nome: "ti-aud", porUsuario: true });
  /** Cadeia padrão: autoriza (permissão) → [login recente] → limite por operador. */
  /** Motivo obrigatório das ações administrativas: vai para a auditoria junto com QUEM fez (nome, e-mail, IP). */
  const motivoDe = (req) => V.texto(req.body?.motivo, "motivo", { min: 5, max: 200 });
  const S = (permissao, { sensivel = false, ...opc } = {}) => [ti.exigirTI(permissao, opc), ...(sensivel ? [ti.recente, limSens] : [lim])];
  const eu = (req) => ({ uid: req.usuario.uid, nome: req.operador.nome, nivel: req.operador.nivel, tipo: "ti" });

  /**
   * Executa uma ação que MUDA estado e a registra na trilha: sucesso → "ok"; recusa por regra (403/409) → "negado"/"erro" com o motivo.
   * `fn(req)` devolve { resposta, aud: { alvoId, resumo, antes, depois, meta } }.
   */
  const mutar = (base, fn) => envelope(async (req, res) => {
    const b = typeof base === "function" ? base(req) : base;
    let r;
    try { r = await fn(req); }
    catch (e) {
      if (e instanceof Falha && (e.status === 403 || e.status === 409)) await ti.auditar(req, { ...b, resultado: e.status === 403 ? "negado" : "erro", resumo: `${b.resumo || b.acao} — ${e.message}`.slice(0, 300), meta: { codigo: e.codigo } });
      throw e;
    }
    await ti.auditar(req, { ...b, ...(r.aud || {}) }); res.json(r.resposta);
  });
  const uidParam = (req) => V.idDoc(req.params.uid, "uid");

  // ================= sessão =================
  app.post("/ti/sessao", ...S(null, { permitirTrocaSenha: true }), envelope(async (req, res) => {
    if (await operadores.registrarLogin(req.usuario.uid, { ip: req.ip, authTime: req.usuario.auth_time })) await ti.auditar(req, { acao: "sessao.login", alvoTipo: "operador", alvoId: req.usuario.uid, resumo: "Entrou no painel de TI" });
    res.json({ operador: operadores.visao(req.operador), permissoes: K.PERMISSOES[req.operador.nivel] || [], config: { niveis: K.NIVEIS, prioridades: K.PRIORIDADES, categorias: K.CATEGORIAS, status: K.STATUS, transicoes: K.TRANSICOES, slaMin: K.SLA_MIN } });
  }));
  app.post("/ti/sessao/sair", ...S(null, { permitirTrocaSenha: true }), envelope(async (req, res) => { await ti.auditar(req, { acao: "sessao.logout", alvoTipo: "operador", alvoId: req.usuario.uid, resumo: "Saiu do painel de TI" }); res.json({ ok: true }); }));

  /** A própria senha. Exige login recente (o front reautentica com a senha atual). Revoga as sessões: é preciso entrar de novo. */
  app.post("/ti/eu/senha", ...S(null, { permitirTrocaSenha: true, sensivel: true }), mutar({ acao: "operador.senha.propria", alvoTipo: "operador" }, async (req) => {
    const uid = req.usuario.uid; await operadores.definirSenha(uid, { senha: req.body?.senhaNova }); tempoReal.encerrarDe(uid);
    return { resposta: { ok: true, relogin: true }, aud: { alvoId: uid, resumo: "Alterou a própria senha", depois: { trocarSenha: false } } };
  }));

  // ================= operadores =================
  app.get("/ti/operadores", ...S("operadores.ler.basico"), envelope(async (req, res) => {
    if (K.pode(req.operador.nivel, "operadores.ler")) return res.json(await operadores.listar({ status: V.opcao(req.query.status || "ativo", ["ativo", "excluido"], "status") }));
    res.json(await operadores.listarBasico());           // técnico: só nome/nível (para encaminhar chamados)
  }));
  app.post("/ti/operadores", ...S("operadores.gerir", { sensivel: true }), mutar({ acao: "operador.criar", alvoTipo: "operador" }, async (req) => {
    const b = req.body || {}, r = await operadores.criar({ nome: b.nome, email: b.email, nivel: b.nivel, senha: b.senha }, eu(req));
    return { resposta: r, aud: { alvoId: r.operador.uid, resumo: `Cadastrou ${r.operador.nome} (${r.operador.nivel})`, depois: { nome: r.operador.nome, email: r.operador.email, nivel: r.operador.nivel, senhaTemporaria: !!r.senhaTemporaria } } };
  }));
  app.put("/ti/operadores/:uid/nivel", ...S("operadores.gerir", { sensivel: true }), mutar((req) => ({ acao: "operador.nivel", alvoTipo: "operador", alvoId: req.params.uid, resumo: "Alterar nível" }), async (req) => {
    const uid = uidParam(req), r = await operadores.alterarNivel(uid, req.body?.nivel, eu(req)); tempoReal.encerrarDe(uid);
    return { resposta: { operador: r.operador }, aud: { alvoId: uid, resumo: `Nível de ${r.operador.nome}: ${r.antes.nivel} → ${r.depois.nivel}`, antes: r.antes, depois: r.depois } };
  }));
  /** Reset por gestor: gera senha temporária (mostrada uma vez), revoga sessões e obriga a troca no próximo acesso. */
  app.post("/ti/operadores/:uid/senha", ...S("operadores.gerir"), mutar((req) => ({ acao: "operador.senha.reset", alvoTipo: "operador", alvoId: req.params.uid, resumo: "Redefinir senha" }), async (req) => {
    const uid = uidParam(req); if (uid === req.usuario.uid) throw new Falha(409, "Para a sua própria senha, use \"Alterar minha senha\".", "proprio-usuario");
    const motivo = motivoDe(req), senha = req.body?.senha, definida = typeof senha === "string" && senha !== "";
    const r = await operadores.definirSenha(uid, definida ? { senha, forcarTroca: true } : { temporaria: true }); tempoReal.encerrarDe(uid);
    return { resposta: r, aud: { alvoId: uid, resumo: `Redefiniu a senha (${definida ? "definida pelo gestor" : "temporária"}, troca obrigatória) e revogou as sessões`, depois: { trocarSenha: true }, meta: { motivo } } };
  }));
  app.post("/ti/operadores/:uid/excluir", ...S("operadores.gerir"), mutar((req) => ({ acao: "operador.excluir", alvoTipo: "operador", alvoId: req.params.uid, resumo: "Excluir operador" }), async (req) => {
    const uid = uidParam(req), r = await operadores.excluir(uid, req.body?.motivo, eu(req));
    const devolvidos = await chamados.devolverFila(uid, eu(req)); tempoReal.encerrarDe(uid);
    return { resposta: { operador: r.operador, chamadosDevolvidos: devolvidos }, aud: { alvoId: uid, resumo: `Excluiu ${r.operador.nome} (exclusão lógica)`, antes: r.antes, depois: r.depois, meta: { motivo: r.operador.motivoExclusao, chamadosDevolvidos: devolvidos } } };
  }));
  app.post("/ti/operadores/:uid/restaurar", ...S("operadores.gerir", { sensivel: true }), mutar((req) => ({ acao: "operador.restaurar", alvoTipo: "operador", alvoId: req.params.uid, resumo: "Restaurar operador" }), async (req) => {
    const uid = uidParam(req), r = await operadores.restaurar(uid);
    return { resposta: r, aud: { alvoId: uid, resumo: `Restaurou ${r.operador.nome} (senha temporária, troca obrigatória)`, antes: { status: "excluido" }, depois: { status: "ativo", trocarSenha: true } } };
  }));

  // ================= auditoria =================
  /** Gestor consulta tudo; técnico só vê as próprias ações (transparência sem expor os colegas). */
  const filtrosAud = (req) => {
    const q = req.query, gestor = K.pode(req.operador.nivel, "auditoria.ler"), data = (v, fim) => { if (!v) return undefined; if (!V.dataIsoValida(v)) throw new Falha(400, "Data inválida.", "dados-invalidos"); return Date.parse(`${v}T${fim ? "23:59:59.999" : "00:00:00.000"}-03:00`); };
    return { operadorUid: gestor ? (q.operador ? V.idDoc(String(q.operador), "operador") : undefined) : req.usuario.uid, acao: q.acao ? V.texto(String(q.acao), "ação", { max: 60, re: /^[a-z0-9._-]+$/ }) : undefined,
      alvoId: q.alvo ? V.idDoc(String(q.alvo), "alvo") : undefined, resultado: q.resultado ? V.opcao(String(q.resultado), ["ok", "negado", "erro"], "resultado") : undefined, deMs: data(q.de, false), ateMs: data(q.ate, true), cursor: q.cursor ? V.texto(String(q.cursor), "cursor", { max: 30, re: /^\d{13}_\d{10}$/ }) : undefined };
  };
  app.get("/ti/auditoria", ti.exigirTI("auditoria.ler.proprio"), limAud, envelope(async (req, res) => {
    const f = filtrosAud(req), r = await auditoria.listar({ ...f, limite: req.query.limite });
    await ti.auditar(req, { acao: "auditoria.consultar", alvoTipo: "auditoria", resumo: "Consultou a trilha de auditoria", meta: { operador: f.operadorUid || "todos", acao: f.acao || "", de: req.query.de || "", ate: req.query.ate || "" } });
    res.json(r);
  }));
  app.get("/ti/auditoria/exportar", ti.exigirTI("auditoria.ler"), limCsv, envelope(async (req, res) => {
    const f = filtrosAud(req); let itens = [], cursor = f.cursor;
    for (let i = 0; i < 10; i++) { const p = await auditoria.listar({ ...f, cursor, limite: 200 }); itens = itens.concat(p.itens); if (!p.proximo) break; cursor = p.proximo; }
    await ti.auditar(req, { acao: "auditoria.exportar", alvoTipo: "auditoria", resumo: `Exportou ${itens.length} registros da trilha`, meta: { linhas: itens.length } });
    const br = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    x.enviarCSV(res, `personow-ti-auditoria-${V.hojeSP()}.csv`, paraCSV(["Seq", "Data/hora", "Operador", "E-mail", "Nível", "Ação", "Resultado", "Alvo", "ID do alvo", "Resumo", "IP", "Hash"],
      itens.map((a) => [a.seq, br(a.em), a.operadorNome, a.operadorEmail, a.nivel, a.acao, a.resultado, a.alvoTipo, a.alvoId, a.resumo, a.ip, a.hash])));
  }));
  app.get("/ti/auditoria/verificar", ti.exigirTI("auditoria.verificar"), limAud, envelope(async (req, res) => {
    const r = await auditoria.verificar({ limite: req.query.limite });
    await ti.auditar(req, { acao: "auditoria.verificar", alvoTipo: "auditoria", resumo: r.ok ? `Cadeia íntegra (${r.verificados} registros)` : `INCONSISTÊNCIAS: ${r.problemas.length}`, resultado: r.ok ? "ok" : "erro", meta: { verificados: r.verificados, problemas: r.problemas.length } });
    res.json(r);
  }));

  // ================= chamados (equipe) =================
  const chamadoId = (req) => V.idDoc(req.params.id, "id");
  const resumoCh = (t) => ({ status: t.status, atribuidoNome: t.atribuidoNome || "", prioridade: t.prioridade });
  app.get("/ti/chamados", ...S("chamados.ler"), envelope(async (req, res) => {
    const q = req.query; res.json(await chamados.listar({ visao: q.visao || "abertos", prioridade: q.prioridade || undefined, categoria: q.categoria || undefined, atribuidoUid: q.atribuido ? V.idDoc(String(q.atribuido), "atribuido") : undefined,
      q: q.q ? V.texto(String(q.q), "busca", { max: 60 }) : undefined, limite: q.limite, cursor: q.cursor ? V.texto(String(q.cursor), "cursor", { max: 16, re: /^\d{1,16}$/ }) : undefined }));
  }));
  app.get("/ti/chamados/:id", ...S("chamados.ler"), envelope(async (req, res) => res.json(await chamados.detalhe(chamadoId(req)))));
  /** Abrir chamado em nome de alguém (telefone, WhatsApp…). `solicitanteUid` opcional vincula a um aluno/personal existente. */
  app.post("/ti/chamados", ...S("chamados.atender"), mutar({ acao: "chamado.criar", alvoTipo: "chamado" }, async (req) => {
    const b = req.body || {}; let solicitante = { uid: "", tipo: "externo", nome: V.texto(b.solicitanteNome, "solicitante", { min: 2, max: 100 }) };
    if (b.solicitanteUid) { const uid = V.idDoc(b.solicitanteUid, "solicitanteUid"), i = await suporte.identificar(uid); if (!i) throw new Falha(404, "Usuário não encontrado.", "nao-encontrado"); solicitante = { uid, tipo: i.tipo, nome: i.nome }; }
    const t = await chamados.criar({ titulo: b.titulo, descricao: b.descricao, categoria: b.categoria, prioridade: b.prioridade }, { solicitante, origem: "ti", criador: eu(req) });
    return { resposta: chamados.visaoTI(t), aud: { alvoId: t.id, resumo: `Abriu ${t.protocolo} — ${t.titulo}`.slice(0, 300), depois: { protocolo: t.protocolo, prioridade: t.prioridade, categoria: t.categoria, solicitante: solicitante.nome } } };
  }));
  app.post("/ti/chamados/:id/assumir", ...S("chamados.atender"), mutar((req) => ({ acao: "chamado.assumir", alvoTipo: "chamado", alvoId: req.params.id, resumo: "Assumir chamado" }), async (req) => {
    const antes = await chamados.detalhe(chamadoId(req)), t = await chamados.assumir(antes.id, eu(req));
    return { resposta: chamados.visaoTI(t), aud: { resumo: `Assumiu ${t.protocolo}`, antes: resumoCh(antes), depois: resumoCh(t) } };
  }));
  app.post("/ti/chamados/:id/atribuir", ...S("chamados.atribuir"), mutar((req) => ({ acao: "chamado.atribuir", alvoTipo: "chamado", alvoId: req.params.id, resumo: "Encaminhar chamado" }), async (req) => {
    const alvo = await operadores.obter(V.idDoc(String(req.body?.operadorUid || ""), "operadorUid")); if (!alvo || alvo.status !== "ativo") throw new Falha(404, "Operador não encontrado ou inativo.", "nao-encontrado");
    const antes = await chamados.detalhe(chamadoId(req)), t = await chamados.atribuir(antes.id, eu(req), { uid: alvo.uid, nome: alvo.nome });
    return { resposta: chamados.visaoTI(t), aud: { resumo: `Encaminhou ${t.protocolo} para ${alvo.nome}`, antes: resumoCh(antes), depois: resumoCh(t) } };
  }));
  app.post("/ti/chamados/:id/status", ...S("chamados.atender"), mutar((req) => ({ acao: "chamado.status", alvoTipo: "chamado", alvoId: req.params.id, resumo: "Alterar status" }), async (req) => {
    const antes = await chamados.detalhe(chamadoId(req)), t = await chamados.mudarStatus(antes.id, eu(req), req.body?.status, req.body?.nota);
    return { resposta: chamados.visaoTI(t), aud: { resumo: `${t.protocolo}: ${antes.status} → ${t.status}`, antes: resumoCh(antes), depois: resumoCh(t), meta: { nota: String(req.body?.nota || "").slice(0, 200) } } };
  }));
  app.put("/ti/chamados/:id/prioridade", ...S("chamados.atender"), mutar((req) => ({ acao: "chamado.prioridade", alvoTipo: "chamado", alvoId: req.params.id, resumo: "Alterar prioridade" }), async (req) => {
    const antes = await chamados.detalhe(chamadoId(req)), t = await chamados.alterarPrioridade(antes.id, eu(req), req.body?.prioridade);
    return { resposta: chamados.visaoTI(t), aud: { resumo: `${t.protocolo}: prioridade ${antes.prioridade} → ${t.prioridade}`, antes: { prioridade: antes.prioridade }, depois: { prioridade: t.prioridade } } };
  }));
  app.post("/ti/chamados/:id/comentarios", ...S("chamados.atender"), mutar((req) => ({ acao: "chamado.comentar", alvoTipo: "chamado", alvoId: req.params.id, resumo: "Comentar chamado" }), async (req) => {
    const interno = req.body?.interno !== false, t = await chamados.comentar(chamadoId(req), eu(req), req.body?.texto, interno);
    return { resposta: chamados.visaoTI(t), aud: { resumo: `Comentou em ${t.protocolo} (${interno ? "nota interna" : "visível ao solicitante"})`, meta: { tamanho: String(req.body?.texto || "").length } } };
  }));

  // ================= dashboard e tempo real =================
  app.get("/ti/dashboard", ...S("metricas.ler"), envelope(async (req, res) => {
    const dias = metricas._normalizar(req.query.dias);
    const [fila, online, periodo, ranking] = await Promise.all([chamados.contagens(), presenca.contar(), metricas.resumo({ dias }), metricas.ranking({ dias, limite: 10 })]);
    res.json({ fila, online, periodo, ranking, slaMin: K.SLA_MIN, geradoEm: new Date().toISOString() });
  }));
  app.get("/ti/stream", ti.exigirTI("presenca.ler"), limitar({ janelaMs: 60_000, max: 20, nome: "ti-stream", porUsuario: true }), (req, res, next) => { tempoReal.assinar(req, res).catch(next); });

  // ================= solicitante (aluno / personal / admin) =================
  const USU = ["aluno", "personal", "admin"];
  const limNovo = limitar({ janelaMs: 3_600_000, max: 5, nome: "chamado-novo", porUsuario: true });
  const limUsu = limitar({ janelaMs: 60_000, max: 30, nome: "chamado-usu", porUsuario: true });
  const quem = async (u) => { let nome = ""; if (u.role === "aluno" || u.role === "personal") { try { nome = (await suporte.identificar(u.uid, u.role))?.nome || ""; } catch { /* usa o e-mail */ } } return { uid: u.uid, tipo: u.role, nome: nome || u.name || u.email || u.role }; };
  app.post("/chamados", auth.exigir(...USU), limNovo, envelope(async (req, res) => {
    const b = req.body || {}, sol = await quem(req.usuario);
    const t = await chamados.criar({ titulo: b.titulo, descricao: b.descricao, categoria: b.categoria, prioridade: V.opcao(b.urgencia || "media", K.URGENCIA_USUARIO, "urgência") }, { solicitante: sol, origem: "usuario", criador: sol });
    res.json({ id: t.id, protocolo: t.protocolo, status: t.status });
  }));
  app.get("/chamados/meus", auth.exigir(...USU), limUsu, envelope(async (req, res) => res.json(await chamados.meus(req.usuario.uid))));
  app.get("/chamados/:id", auth.exigir(...USU), limUsu, envelope(async (req, res) => res.json(await chamados.detalheDoUsuario(req.usuario.uid, req.params.id))));
  app.post("/chamados/:id/responder", auth.exigir(...USU), limUsu, envelope(async (req, res) => {
    const t = await chamados.responderComoUsuario(V.idDoc(req.params.id, "id"), await quem(req.usuario), req.body?.texto); res.json({ ok: true, status: t.status });
  }));

  // ================= presença =================
  /** Batimento do app. Verificação LOCAL do token (sem ida ao Auth): é a rota mais frequente da plataforma e só alimenta um contador. */
  app.post("/presenca/ping", async (req, res, next) => { try { req.usuario = await auth.autenticarLeve(req); next(); } catch (e) { next(e); } }, limitar({ janelaMs: 60_000, max: 8, nome: "ping", porUsuario: true }),
    (req, res) => res.json({ ok: true, contado: presenca.ping(req.usuario.uid, req.usuario.role) }));

  // ================= perfil do solicitante (aluno/personal) — tudo numa tela, para atender o chamado =================
  // CPF sai SÓ mascarado; documento de aluno, telefone e e-mail aparecem porque o atendimento precisa confirmar a identidade. A consulta é auditada.
  const iso = (ts) => (ts?.toDate ? ts.toDate().toISOString() : null);
  const decifrar = (priv, campo, uid) => { try { return priv?.[`${campo}Enc`] ? Cripto.decifrar(priv[`${campo}Enc`], `personais_privado/${campo}/${uid}`) : ""; } catch { return ""; } };
  app.get("/ti/solicitantes/:uid/perfil", ...S("chamados.ler"), envelope(async (req, res) => {
    const uid = uidParam(req), id = await suporte.identificar(uid, V.opcao(req.query.tipo || "", ["", "aluno", "personal"], "tipo") || undefined);
    if (!id) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado");
    const tipo = id.tipo, base = (await db.collection(tipo === "aluno" ? "alunos" : "personais").doc(uid).get()).data() || {};
    const usuario = (await db.collection("usuarios").doc(uid).get()).data() || {};
    const campo = tipo === "aluno" ? "uid" : "personalUid";
    const ms = (await db.collection("aulas").where(campo, "==", uid).limit(200).get()).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
    const porStatus = {}; for (const m of ms) porStatus[m.status || "?"] = (porStatus[m.status || "?"] || 0) + 1;
    const out = {
      uid, tipo, nome: id.nome, email: usuario.email || base.email || "", status: base.status || (tipo === "aluno" ? "ativo" : ""), criadoEm: iso(base.criadoEm), cidade: base.cidade || "", nivel: base.nivel || null,
      missoes: { total: ms.length, porStatus, recentes: ms.slice(0, 8).map((m) => ({ id: m.id, data: m.data || "", horario: m.horario || "", aluno: m.aluno || "", status: m.status || "" })) }
    };
    if (tipo === "aluno") {
      const cartao = (await db.collection("cartoes").doc(uid).get()).data();
      Object.assign(out, { nomeCompleto: base.nomeCompleto || "", documento: base.documento || "", telefone: base.telefone || "", endereco: base.endereco || "", objetivo: base.objetivo || "", cartao: cartao?.status === "ativo" ? `${cartao.bandeira || "cartão"} •••• ${cartao.ultimos4}` : "sem cartão" });
    } else {
      const { priv, nascimento } = await habilitacao.perfil(uid), cpf = decifrar(priv, "cpf", uid), idade = nascimento ? V.calcularIdade(nascimento) : null, cart = (await db.collection("carteiras").doc(uid).get()).data();
      Object.assign(out, {
        cpfMascarado: cpf ? V.mascararCPF(cpf) : "", nascimento: nascimento || "", idade, cref: base.cref || "", telefone: decifrar(priv, "telefone", uid),
        treinamentoOk: !!base.treinamentoOk, habilitacao: await habilitacao.situacao(uid), carteira: cart ? { disponivelCentavos: cart.disponivelCentavos || 0, pendenteCentavos: cart.pendenteCentavos || 0 } : null, notaMedia: base.ratingMedia || null, avaliacoes: base.ratingQtd || 0
      });
    }
    await ti.auditar(req, { acao: "solicitante.perfil.ver", alvoTipo: tipo, alvoId: uid, resumo: `Abriu o perfil de ${id.nome || tipo}` });
    res.json(out);
  }));

  // ================= administradores (conta de admin criada pela TI; só gestor) =================
  app.get("/ti/administradores", ...S("admins.gerir"), envelope(async (req, res) => res.json(await admins.listar())));
  app.post("/ti/administradores", ...S("admins.gerir", { sensivel: true }), mutar({ acao: "admin.criar", alvoTipo: "admin" }, async (req) => {
    const b = req.body || {}, r = await admins.criar({ nome: b.nome, email: b.email, senha: b.senha }, eu(req));
    return { resposta: r, aud: { alvoId: r.administrador.uid, resumo: `Criou o administrador ${r.administrador.email}`, depois: { nome: r.administrador.nome, email: r.administrador.email, senhaTemporaria: !!r.senhaTemporaria } } };
  }));
  app.post("/ti/administradores/:uid/senha", ...S("admins.gerir"), mutar((req) => ({ acao: "admin.senha.reset", alvoTipo: "admin", alvoId: req.params.uid, resumo: "Redefinir senha de administrador" }), async (req) => {
    const uid = uidParam(req), motivo = motivoDe(req), r = await admins.redefinirSenha(uid, { senha: req.body?.senha });
    return { resposta: r, aud: { alvoId: uid, resumo: `Redefiniu a senha do administrador ${r.email} e encerrou as sessões`, depois: { senhaTemporaria: !!r.senhaTemporaria }, meta: { motivo } } };
  }));
  app.post("/ti/administradores/:uid/revogar", ...S("admins.gerir"), mutar((req) => ({ acao: "admin.revogar", alvoTipo: "admin", alvoId: req.params.uid, resumo: "Remover acesso de administrador" }), async (req) => {
    const uid = uidParam(req), motivo = motivoDe(req), r = await admins.revogar(uid, eu(req));
    return { resposta: { ok: true }, aud: { alvoId: uid, resumo: `Removeu o acesso de administrador de ${r.email}`, meta: { motivo } } };
  }));
};
