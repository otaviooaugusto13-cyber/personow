// Painel administrativo (papel "admin"). O papel é uma custom claim assinada, concedida só por scripts/definir-admin.js.
// Toda ação sensível é auditada; operações de dinheiro exigem login recente.
const { paraCSV, dinheiro, dataBR } = require("../lib/csv");

module.exports = (app, x) => {
  const { db, admin, FieldValue, auth, V, C, S, Cripto, Falha, envelope, limitar, carteira, treinamento, categorias, habilitacao, suporte, mp, CRON_SECRET, ti } = x;
  const PAGINA = { aluno: "index.html", personal: "personal.html" };
  /** Registra a mensagem no chat do usuário e avisa o aparelho dele (push é melhor esforço). */
  const avisarNoChat = async (req, uid, tipo, texto) => { await suporte.postar({ uid, de: "suporte", texto, autorUid: req.usuario.uid, dica: tipo }); await suporte.enviarPush({ uid, titulo: "Suporte Personow", corpo: texto, url: `${PAGINA[tipo]}?suporte=1` }); };
  const ADM = [limitar({ janelaMs: 60_000, max: 120, nome: "admin", porUsuario: true }), auth.exigir("admin")];
  const iso = (ts) => { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toISOString() : null; };
  const cx = (campo, uid) => `personais_privado/${campo}/${uid}`;
  const tentar = (fn) => { try { return fn(); } catch { return null; } };

  // ---------- Personais ----------
  app.get("/admin/personais", ...ADM, envelope(async (req, res) => {
    const status = V.opcao(req.query.status || "pendente", ["pendente", "ativo", "bloqueado"], "status");
    const s = await db.collection("personais").where("status", "==", status).limit(200).get();
    res.json(s.docs.map((d) => { const p = d.data(); return { uid: d.id, nome: p.nome || "", cidade: p.cidade || "", status: p.status, treinamentoOk: !!p.treinamentoOk, ratingMedia: p.ratingMedia || null, criadoEm: iso(p.criadoEm) }; }));
  }));

  /** Ficha para análise de cadastro (inclui o CREF a conferir no CONFEF). A leitura é auditada. */
  app.get("/admin/personais/:uid", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), { pub, priv, nascimento } = await habilitacao.perfil(uid);
    if (!pub) throw new Falha(404, "Personal não encontrado.", "nao-encontrado");
    const cpf = tentar(() => Cripto.decifrar(priv.cpfEnc, cx("cpf", uid)));
    const idade = nascimento ? V.calcularIdade(nascimento) : null;
    await auth.auditar(req, "admin.personal.ver_ficha", uid);
    res.json({
      uid, nome: pub.nome, email: (await db.collection("usuarios").doc(uid).get()).data()?.email || "", status: pub.status, cidade: pub.cidade || "", bio: pub.bio || "", especialidade: pub.especialidade || "",
      valorMin: Number.isInteger(pub.valorMin) ? pub.valorMin : null, disponibilidade: pub.disponibilidade || null, idade, cref: pub.cref || "", crefConferidoEm: iso(pub.crefConferidoEm),
      nascimento: nascimento || null, cpfMascarado: cpf ? V.mascararCPF(cpf) : "", telefone: tentar(() => Cripto.decifrar(priv.telefoneEnc, cx("telefone", uid))) || "",
      treinamento: await treinamento.estado(uid), habilitacao: await habilitacao.situacao(uid)
    });
  }));

  /** Recado do suporte para um personal ou um aluno, sem mudar status (ex.: "confira seu CPF e fale com o suporte"). */
  app.post("/admin/recado/:tipo/:uid", ...ADM, envelope(async (req, res) => {
    const tipo = V.opcao(req.params.tipo, ["aluno", "personal"], "tipo"), uid = V.idDoc(req.params.uid, "uid");
    const texto = V.texto(req.body?.texto, "mensagem", { min: 3, max: 300 });
    const ref = db.collection(tipo === "aluno" ? "alunos" : "personais").doc(uid);
    if (!(await ref.get()).exists) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado");
    await ref.set({ recado: { texto, tipo: "info", por: "suporte", em: FieldValue.serverTimestamp() } }, { merge: true });
    await avisarNoChat(req, uid, tipo, texto);
    await auth.auditar(req, "admin.recado.enviar", uid, { tipo, texto });
    res.json({ ok: true });
  }));

  app.post("/admin/personais/:uid/status", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), status = V.opcao(req.body?.status, ["ativo", "pendente", "bloqueado"], "status");
    const motivo = V.texto(req.body?.motivo || "", "motivo", { max: 300, obrigatorio: false });
    const { pub, nascimento } = await habilitacao.perfil(uid);
    if (!pub) throw new Falha(404, "Personal não encontrado.", "nao-encontrado");
    // DESBLOQUEIO (bloqueado → ativo/pendente) nunca depende de dados cadastrais faltando (contas antigas sem nascimento ficavam presas).
    // Mesmo liberada, a pessoa só ACEITA aulas depois de completar tudo: habilitacao.exigirPodeAceitar() confere nascimento, idade,
    // CREF e capacitação a cada aceite — a trava legal continua, só deixou de impedir a reativação.
    const desbloqueando = pub.status === "bloqueado" && status !== "bloqueado";
    if (status === "ativo" && !desbloqueando) {                                  // 1ª aprovação exige cadastro legalmente completo (use "Editar" para corrigir os dados)
      if (!nascimento) throw new Falha(409, "Não é possível aprovar: data de nascimento ausente. Abra Editar perfil e informe a data (ou peça ao personal para completar o cadastro).", "cadastro-incompleto");
      const idade = V.calcularIdade(nascimento);
      if (idade < C.IDADE_MINIMA) throw new Falha(409, `Não é possível aprovar: menor de ${C.IDADE_MINIMA} anos.`, "idade-minima");
      if (!pub.cref) throw new Falha(409, "Não é possível aprovar: o personal ainda não informou o número do CREF.", "cref-pendente");
    } else if (desbloqueando && nascimento && V.calcularIdade(nascimento) < C.IDADE_MINIMA) {
      throw new Falha(409, `Não é possível liberar: a data de nascimento cadastrada indica menor de ${C.IDADE_MINIMA} anos. Corrija o dado em Editar perfil, se estiver errado.`, "idade-minima");   // data AUSENTE passa; data conhecida < 18 não
    }
    // O motivo vira um recado visível para o próprio personal (ao aprovar, o recado antigo some).
    const recado = motivo && status !== "ativo" ? { texto: motivo, tipo: status, por: "suporte", em: FieldValue.serverTimestamp() } : FieldValue.delete();
    const conferiu = status === "ativo" && !desbloqueando ? { crefConferidoEm: FieldValue.serverTimestamp(), crefConferidoPor: req.usuario.uid } : {};   // aprovar = o admin atesta que conferiu o CREF no CONFEF
    await db.collection("personais").doc(uid).set({ status, statusMotivo: motivo, statusPor: req.usuario.uid, statusEm: FieldValue.serverTimestamp(), recado, ...conferiu }, { merge: true });
    if (motivo && status !== "ativo") await avisarNoChat(req, uid, "personal", motivo);   // o motivo também entra no histórico do chat
    if (status === "bloqueado") await admin.auth().revokeRefreshTokens(uid);   // derruba as sessões do bloqueado
    await auth.auditar(req, "admin.personal.status", uid, { status, motivo, desbloqueio: desbloqueando, semNascimento: !nascimento });
    res.json({ ok: true, status });
  }));


  // ---------- Equipe de TI (o admin cadastra, remove e libera o acesso dos operadores do painel /painel-ti) ----------
  // O admin é a autoridade sobre a equipe de TI: aqui NÃO vale a trava "sempre sobra um gestor" (o admin sempre pode cadastrar outro).
  // Tudo cai em DOIS logs: o do admin (`auditoria`) e a trilha encadeada do TI (`ti_auditoria`), onde o gestor de TI enxerga o que o admin fez.
  const RECENTE = (req, res, next) => { try { auth.exigirRecente(req.usuario); next(); } catch (e) { next(e); } };   // login recente (o painel reautentica sozinho)
  const euAdmin = (req) => ({ uid: req.usuario.uid, nome: "Administrador", email: req.usuario.email || "", nivel: "admin", tipo: "admin" });
  const atorTI = (req) => ({ ...euAdmin(req), ip: req.ip || "", ua: String(req.get?.("user-agent") || ""), rota: `${req.method} ${req.path}`, reqId: "" });
  /** Registra nos dois logs. `acao` sem prefixo (ex.: "criar"). Nunca lança (auditoria é melhor esforço, como no resto do painel). */
  const auditarTI = async (req, acao, uid, resumo, { antes = null, depois = null, meta = null } = {}) => {
    await auth.auditar(req, `admin.ti.${acao}`, uid, { resumo, ...(meta || {}) });
    await ti.auditoria.registrar(atorTI(req), { acao: `operador.${acao}`, alvoTipo: "operador", alvoId: uid, resumo: `[Admin] ${resumo}`, antes, depois, meta: { origem: "painel-admin", ...(meta || {}) } });
  };
  const uidTI = (req) => V.idDoc(req.params.uid, "uid");

  app.get("/admin/ti/operadores", ...ADM, envelope(async (req, res) => {
    res.json(await ti.operadores.listar({ status: V.opcao(req.query.status || "ativo", ["ativo", "excluido"], "status") }));
  }));

  app.post("/admin/ti/operadores", ...ADM, RECENTE, envelope(async (req, res) => {
    const b = V.somente(req.body, ["nome", "email", "nivel", "senha", "acesso", "exigirTroca"]);
    const r = await ti.operadores.criar({ nome: b.nome, email: b.email, nivel: b.nivel, senha: b.senha, acesso: b.acesso, exigirTroca: b.exigirTroca === true }, euAdmin(req));
    await auditarTI(req, "criar", r.operador.uid, `Cadastrou ${r.operador.nome} (${r.operador.nivel}, acesso ${r.operador.acesso})`, { depois: { nome: r.operador.nome, email: r.operador.email, nivel: r.operador.nivel, acesso: r.operador.acesso, senhaTemporaria: !!r.senhaTemporaria } });
    res.json(r);
  }));

  app.put("/admin/ti/operadores/:uid/nivel", ...ADM, RECENTE, envelope(async (req, res) => {
    const uid = uidTI(req), r = await ti.operadores.alterarNivel(uid, req.body?.nivel, euAdmin(req)); ti.tempoReal.encerrarDe(uid);
    await auditarTI(req, "nivel", uid, `Nível de ${r.operador.nome}: ${r.antes.nivel} → ${r.depois.nivel}`, { antes: r.antes, depois: r.depois });
    res.json({ operador: r.operador });
  }));

  /** Define a senha: informada pelo admin (`senha`) ou temporária aleatória (sem `senha`). Revoga as sessões; por padrão exige trocar no próximo acesso. */
  app.post("/admin/ti/operadores/:uid/senha", ...ADM, envelope(async (req, res) => {
    const uid = uidTI(req), b = V.somente(req.body, ["senha", "exigirTroca", "motivo"]), motivo = V.texto(b.motivo, "motivo", { min: 5, max: 200 }), informada = typeof b.senha === "string" && b.senha !== "";
    const r = await ti.operadores.definirSenha(uid, informada ? { senha: b.senha, forcarTroca: b.exigirTroca !== false } : { temporaria: true }); ti.tempoReal.encerrarDe(uid);
    await auditarTI(req, "senha", uid, informada ? "Definiu uma nova senha e revogou as sessões" : "Gerou senha temporária e revogou as sessões", { depois: { trocarSenha: informada ? b.exigirTroca !== false : true }, meta: { motivo } });
    res.json(r);
  }));

  /** Remover = exclusão lógica: desativa o login, revoga as sessões e devolve os chamados dele à fila. O histórico/auditoria continuam apontando para a pessoa. */
  app.post("/admin/ti/operadores/:uid/excluir", ...ADM, envelope(async (req, res) => {
    const uid = uidTI(req), r = await ti.operadores.excluir(uid, req.body?.motivo, euAdmin(req));
    const devolvidos = await ti.chamados.devolverFila(uid, { uid: req.usuario.uid, nome: "Administrador", nivel: "admin", tipo: "admin" }); ti.tempoReal.encerrarDe(uid);
    await auditarTI(req, "excluir", uid, `Removeu ${r.operador.nome} (exclusão lógica)`, { antes: r.antes, depois: r.depois, meta: { motivo: r.operador.motivoExclusao, chamadosDevolvidos: devolvidos } });
    res.json({ operador: r.operador, chamadosDevolvidos: devolvidos });
  }));

  /** Libera o acesso de volta a um operador removido (senha temporária nova, ou só Google se ele era só-Google). */
  app.post("/admin/ti/operadores/:uid/restaurar", ...ADM, RECENTE, envelope(async (req, res) => {
    const uid = uidTI(req), r = await ti.operadores.restaurar(uid);
    await auditarTI(req, "restaurar", uid, `Liberou o acesso de ${r.operador.nome} novamente`, { antes: { status: "excluido" }, depois: { status: "ativo" } });
    res.json(r);
  }));

  // ---------- Edição de perfis (personal e aluno) ----------
  // Admin altera qualquer dado cadastral. NÃO edita aqui: chave Pix e saldos (destino/valor de dinheiro = vetor clássico de fraude interna;
  // use "Recado" para pedir que a pessoa regrave a chave com login recente) e o e-mail de login (é a identidade Google da conta).
  const vazioParaNada = (v) => (v === "" || v === null ? "" : v);
  app.put("/admin/personais/:uid", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), b = V.somente(req.body, ["nome", "cidade", "bio", "especialidade", "valorMin", "disponibilidade", "cpf", "nascimento", "telefone", "cref"]);
    const pubRef = db.collection("personais").doc(uid), privRef = db.collection("personais_privado").doc(uid);
    const [pubSnap, privSnap] = await Promise.all([pubRef.get(), privRef.get()]);
    if (!pubSnap.exists) throw new Falha(404, "Personal não encontrado.", "nao-encontrado");
    const atual = privSnap.data() || {}, pub = {}, priv = {}, campos = [];
    if (b.nome !== undefined) { pub.nome = V.texto(b.nome, "nome", { min: 2, max: 100 }); campos.push("nome"); }
    if (b.cidade !== undefined) { pub.cidade = V.texto(vazioParaNada(b.cidade), "cidade", { max: 80, obrigatorio: false }); campos.push("cidade"); }
    if (b.bio !== undefined) { pub.bio = V.texto(vazioParaNada(b.bio), "bio", { max: 300, obrigatorio: false }); campos.push("bio"); }
    if (b.especialidade !== undefined) { pub.especialidade = V.texto(vazioParaNada(b.especialidade), "especialidade", { max: 60, obrigatorio: false }); campos.push("especialidade"); }   // o app grava o RÓTULO da modalidade (ex.: "Corrida"), não o valor da lista
    if (b.cref !== undefined) {
      const cref = V.cref(b.cref);
      const dup = await db.collection("personais").where("cref", "==", cref).limit(2).get();
      if (dup.docs.some((d) => d.id !== uid)) throw new Falha(409, "Este CREF já pertence a outro cadastro.", "cref-duplicado");
      pub.cref = cref; pub.crefConferidoEm = FieldValue.delete(); campos.push("cref");   // mudou o registro: precisa ser conferido de novo
    }
    if (b.valorMin !== undefined) { pub.valorMin = b.valorMin === null || b.valorMin === "" ? FieldValue.delete() : V.inteiro(b.valorMin, "valorMin", { min: 0, max: 100000 }); campos.push("valorMin"); }
    if (b.disponibilidade !== undefined) {
      const d = b.disponibilidade;
      if (d === null) pub.disponibilidade = FieldValue.delete();
      else { if (typeof d !== "object" || Array.isArray(d)) throw new Falha(400, "Campo inválido: disponibilidade", "dados-invalidos"); pub.disponibilidade = { inicio: V.hhmm(d.inicio, "disponibilidade.inicio"), fim: V.hhmm(d.fim, "disponibilidade.fim") }; }
      campos.push("disponibilidade");
    }
    if (b.telefone !== undefined) { priv.telefoneEnc = Cripto.cifrar(V.telefone(b.telefone), cx("telefone", uid)); campos.push("telefone"); }
    if (b.nascimento !== undefined) { const n = V.validarNascimento(b.nascimento); priv.nascimentoEnc = Cripto.cifrar(n.nascimento, cx("nascimento", uid)); priv.nascimentoTravadoEm = FieldValue.serverTimestamp(); campos.push("nascimento"); }
    if (b.cpf !== undefined) {
      const cpf = V.cpf(b.cpf);
      if (await habilitacao.cpfEmUso(cpf, uid)) throw new Falha(409, "Este CPF já pertence a outro cadastro.", "cpf-duplicado");
      priv.cpfEnc = Cripto.cifrar(cpf, cx("cpf", uid)); priv.cpfIdx = Cripto.indiceCego(cpf); campos.push("cpf");
    }
    if (!campos.length) throw new Falha(400, "Nenhum campo para alterar.", "dados-invalidos");
    const meta = { atualizadoEm: FieldValue.serverTimestamp(), editadoPor: req.usuario.uid };
    const lote = db.batch();
    if (Object.keys(pub).length) lote.set(pubRef, { ...pub, ...meta }, { merge: true });
    if (Object.keys(priv).length) lote.set(privRef, { uid, ...priv, ...meta }, { merge: true });
    await lote.commit();
    await auth.auditar(req, "admin.personal.editar", uid, { campos });   // só os NOMES dos campos: dados pessoais não vão para o log
    res.json({ ok: true, campos });
  }));

  app.put("/admin/alunos/:uid", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), b = V.somente(req.body, ["nome", "nomeCompleto", "documento", "endereco", "email", "telefone", "objetivo"]);
    const ref = db.collection("alunos").doc(uid);
    if (!(await ref.get()).exists) throw new Falha(404, "Aluno não encontrada.", "nao-encontrado");
    const novo = {};
    if (b.nome !== undefined) novo.nome = V.texto(vazioParaNada(b.nome), "nome", { max: 100, obrigatorio: false });
    if (b.nomeCompleto !== undefined) novo.nomeCompleto = V.texto(b.nomeCompleto, "razão social", { min: 3, max: 160 });
    if (b.documento !== undefined) novo.documento = b.documento === "" || b.documento === null ? "" : V.documento(b.documento);
    if (b.endereco !== undefined) novo.endereco = V.texto(vazioParaNada(b.endereco), "endereço", { max: 200, obrigatorio: false });
    if (b.email !== undefined) {
      const e = V.texto(vazioParaNada(b.email), "e-mail", { max: 120, obrigatorio: false });
      if (e && !/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e)) throw new Falha(400, "Campo inválido: e-mail", "dados-invalidos", { campo: "email" });
      novo.email = e;
    }
    if (b.telefone !== undefined) novo.telefone = b.telefone === "" || b.telefone === null ? "" : V.telefone(b.telefone);
    if (b.objetivo !== undefined) novo.objetivo = V.texto(vazioParaNada(b.objetivo), "objetivo", { max: 60, obrigatorio: false });
    const campos = Object.keys(novo);
    if (!campos.length) throw new Falha(400, "Nenhum campo para alterar.", "dados-invalidos");
    await ref.set({ ...novo, atualizadoEm: FieldValue.serverTimestamp(), editadoPor: req.usuario.uid }, { merge: true });
    await auth.auditar(req, "admin.aluno.editar", uid, { campos });
    res.json({ ok: true, campos });
  }));

  // ---------- Exclusão permanente de perfil ----------
  // Remove os dados pessoais e as credenciais (Firebase Auth). MANTÉM o que a lei/contabilidade exige e a conciliação precisa:
  // aulas, notas, pagamentos, lançamentos, saques, estornos e auditoria (guardam só o uid, sem dados pessoais).
  const brlTxt = (c) => ((Number(c) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  async function usuarioAuth(uid) { try { return await admin.auth().getUser(uid); } catch (e) { if (e.code === "auth/user-not-found") return null; throw e; } }

  async function excluirPerfil(req, res, tipo) {
    auth.exigirRecente(req.usuario);                                              // ação destrutiva: login recente (o painel reautentica sozinho)
    const uid = V.idDoc(req.params.uid, "uid"), motivo = V.texto(req.body?.motivo, "motivo", { min: 5, max: 200 });
    if (req.body?.confirmar !== "EXCLUIR") throw new Falha(400, "Confirmação ausente: digite EXCLUIR.", "confirmacao-obrigatoria");
    if (uid === req.usuario.uid) throw new Falha(409, "Você não pode excluir a própria conta.", "exclusao-proibida");
    const colecao = tipo === "aluno" ? "alunos" : "personais", outra = tipo === "aluno" ? "personais" : "alunos";
    const [perfilSnap, outraSnap, conta] = await Promise.all([db.collection(colecao).doc(uid).get(), db.collection(outra).doc(uid).get(), usuarioAuth(uid)]);
    if (!perfilSnap.exists && !conta) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado");
    if (!perfilSnap.exists && outraSnap.exists) throw new Falha(404, `Esta conta é de ${tipo === "aluno" ? "personal" : "aluno"}, não de ${tipo}.`, "nao-encontrado");
    const claims = conta?.customClaims || {};
    if (claims.role === "admin" || claims.admin === true || (claims.perfis || []).includes("admin")) throw new Falha(409, "Esta conta tem permissão de administrador. Remova o acesso de admin (scripts/definir-admin.js) antes de excluir.", "exclusao-proibida");

    // Trava de dinheiro e de trabalho em andamento
    const motivos = []; let canceladas = [];
    if (tipo === "personal") {
      const [ped, saq, cart] = await Promise.all([db.collection("aulas").where("personalUid", "==", uid).get(), db.collection("saques").where("uid", "==", uid).where("status", "==", "solicitado").get(), db.collection("carteiras").doc(uid).get()]);
      const aceitos = ped.docs.filter((d) => d.data().status === "aceita").length;
      if (aceitos) motivos.push(`${aceitos} aula(s) aceito(s) ainda sem pagamento`);
      if (saq.docs.length) motivos.push(`${saq.docs.length} saque(s) aguardando pagamento`);
      const w = cart.data() || {}, saldo = (w.pendenteCentavos || 0) + (w.disponivelCentavos || 0);
      if (saldo !== 0) motivos.push(`saldo na carteira de ${brlTxt(saldo)} (pague/rejeite os saques, aguarde a carência ou estorne antes)`);
    } else {
      const ped = await db.collection("aulas").where("uid", "==", uid).where("status", "in", ["aberta", "aceita"]).get();
      canceladas = ped.docs.map((d) => d.ref);                                    // aulas não pagos do aluno são cancelados junto (não há quem os cancele depois)
    }
    if (motivos.length) throw new Falha(409, `Não é possível excluir agora: ${motivos.join("; ")}.`, "exclusao-bloqueada", { motivos });

    try { await admin.auth().revokeRefreshTokens(uid); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
    const lote = db.batch();
    for (const r of canceladas) lote.update(r, { status: "cancelada", canceladoEm: FieldValue.serverTimestamp(), canceladoPor: "admin" });
    const apagar = tipo === "aluno"
      ? [["alunos", uid], ["cartoes", uid], ["cartoes_privado", uid], ["usuarios", uid]]
      : [["personais", uid], ["personais_privado", uid], ["usuarios", uid]];
    if (tipo === "personal") for (const m of await db.collection("treinamento_progresso").where("uid", "==", uid).get().then((q) => q.docs)) lote.delete(m.ref);
    for (const [c, id] of apagar) lote.delete(db.collection(c).doc(id));
    await lote.commit();
    if (conta) { try { await admin.auth().deleteUser(uid); } catch (e) { if (e.code !== "auth/user-not-found") throw new Falha(500, "Dados removidos, mas a credencial do Auth não pôde ser apagada. Repita a exclusão para concluir.", "auth-pendente"); } }
    await auth.auditar(req, `admin.${tipo}.excluir`, uid, { motivo, aulasCancelados: canceladas.length, authRemovido: !!conta });
    res.json({ ok: true, aulasCancelados: canceladas.length });
  }
  app.post("/admin/personais/:uid/excluir", limitar({ janelaMs: 3600_000, max: 30, nome: "excluir", porUsuario: true }), auth.exigir("admin"), envelope((req, res) => excluirPerfil(req, res, "personal")));
  app.post("/admin/alunos/:uid/excluir", limitar({ janelaMs: 3600_000, max: 30, nome: "excluir", porUsuario: true }), auth.exigir("admin"), envelope((req, res) => excluirPerfil(req, res, "aluno")));

  app.post("/admin/usuarios/:uid/revogar-sessoes", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"); await admin.auth().revokeRefreshTokens(uid);
    await auth.auditar(req, "admin.sessoes.revogar", uid); res.json({ ok: true });
  }));

  // ---------- Catálogo de capacitação Personow ----------
  app.get("/admin/treinamento/modulos", ...ADM, envelope(async (req, res) => res.json(await treinamento.listarTodos())));
  app.post("/admin/treinamento/modulos", ...ADM, envelope(async (req, res) => { const r = await treinamento.salvarModulo(null, req.body || {}); await auth.auditar(req, "admin.treinamento.criar", r.id); res.json(r); }));
  app.put("/admin/treinamento/modulos/:id", ...ADM, envelope(async (req, res) => { const r = await treinamento.salvarModulo(V.idDoc(req.params.id), req.body || {}); await auth.auditar(req, "admin.treinamento.editar", r.id); res.json(r); }));

  // ---------- Pagamentos / estornos ----------
  // ---------- Conteúdo da habilitação por categoria (vídeo + 3 a 4 perguntas com gabarito) ----------
  app.get("/admin/habilitacoes/categorias", ...ADM, envelope(async (req, res) => res.json(await categorias.listarAdmin())));
  app.put("/admin/habilitacoes/categorias/:id", ...ADM, envelope(async (req, res) => { const r = await categorias.salvarCategoria(req.params.id, req.body || {}); await auth.auditar(req, "admin.habilitacao.salvar", r.id); res.json(r); }));

  app.get("/admin/pagamentos", ...ADM, envelope(async (req, res) => {
    const s = await db.collection("pagamentos_internos").where("status", "in", ["aprovado", "estornado"]).limit(300).get();
    res.json(s.docs.map((d) => ({ id: d.id, ...resumoPag(d.data()) })).sort((a, b) => String(b.pagoEm).localeCompare(String(a.pagoEm))));
  }));
  const resumoPag = (p) => ({ status: p.status, totalCentavos: p.split?.total, repasseCentavos: p.split?.personal, comissaoCentavos: p.split?.app, mpPaymentId: p.mpPaymentId || "", metodo: p.metodo || "", simulado: !!p.simulado, pagoEm: iso(p.pagoEm), estornoParcialCentavos: p.estornoParcialCentavos || 0, personalUid: p.personalUid || "" });

  app.post("/admin/aulas/:id/estornar", limitar({ janelaMs: 3600_000, max: 20, nome: "estorno", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);
    const id = V.idDoc(req.params.id, "id"), motivo = V.texto(req.body?.motivo, "motivo", { min: 5, max: 200 });
    const r = await x.estornarPagamento({ aulaId: id, motivo, ator: req.usuario.uid, origem: "admin" });
    await auth.auditar(req, "admin.pagamento.estornar", id, { motivo, resultado: r });
    res.json({ ok: true, ...r });
  }));

  // ---------- Saques ----------
  app.get("/admin/saques", ...ADM, envelope(async (req, res) => {
    const status = V.opcao(req.query.status || "solicitado", ["solicitado", "pago", "rejeitado"], "status");
    const s = await db.collection("saques").where("status", "==", status).limit(200).get();
    const lista = s.docs.map((d) => ({ id: d.id, ...d.data() })).map((q) => {
      const pix = q.status === "solicitado" ? tentar(() => Cripto.decifrar(q.pixEnc, cx("pix", q.uid))) : null;   // chave Pix só aparece para quem vai pagar
      return { id: q.id, uid: q.uid, valorCentavos: q.valorCentavos, status: q.status, em: iso(q.criadoEm), pagoEm: iso(q.pagoEm), comprovante: q.comprovante || "", pix: pix ? { tipo: pix.tipo, chave: pix.chave } : null };
    });
    if (status === "solicitado") await auth.auditar(req, "admin.saques.listar_com_pix", "", { qtd: lista.length });
    res.json(lista);
  }));
  app.post("/admin/saques/:id/pagar", limitar({ janelaMs: 60_000, max: 30, nome: "saque-admin", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);
    const id = V.idDoc(req.params.id, "id"), comprovante = V.texto(req.body?.comprovante, "comprovante", { min: 3, max: 120 });
    const r = await carteira.resolverSaque({ saqueId: id, aprovar: true, adminUid: req.usuario.uid, comprovante });
    await auth.auditar(req, "admin.saque.pagar", id, { comprovante }); res.json({ ok: true, ...r });
  }));
  app.post("/admin/saques/:id/rejeitar", limitar({ janelaMs: 60_000, max: 30, nome: "saque-admin", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);
    const id = V.idDoc(req.params.id, "id"), motivo = V.texto(req.body?.motivo, "motivo", { min: 3, max: 200 });
    const r = await carteira.resolverSaque({ saqueId: id, aprovar: false, adminUid: req.usuario.uid, motivo });
    await auth.auditar(req, "admin.saque.rejeitar", id, { motivo }); res.json({ ok: true, ...r });
  }));

  // ---------- Conciliação / liberação / auditoria ----------
  const mpConferir = async (id) => { const p = await mp(`/v1/payments/${encodeURIComponent(id)}`); return { status: p.status, valorCentavos: Math.round(Number(p.transaction_amount) * 100) }; };
  app.get("/admin/conciliacao", limitar({ janelaMs: 60_000, max: 6, nome: "conciliar", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    const r = await carteira.conciliar({ mpConferir: req.query.mp === "1" ? mpConferir : null });
    await auth.auditar(req, "admin.conciliacao", "", { ok: r.ok, divergencias: r.divergencias.length }); res.json(r);
  }));
  app.post("/admin/liberar-saldos", ...ADM, envelope(async (req, res) => { const r = await carteira.liberarVencidos({ limite: 500 }); await auth.auditar(req, "admin.liberar_saldos", "", r); res.json(r); }));
  // Agendador externo (Render Cron): POST com o cabeçalho x-cron-secret
  app.post("/interno/liberar", limitar({ janelaMs: 60_000, max: 10, nome: "cron" }), envelope(async (req, res) => {
    if (!CRON_SECRET || !Cripto.igualSeguro(req.get("x-cron-secret") || "", CRON_SECRET)) throw new Falha(401, "não autorizado", "nao-autenticado");
    res.json(await carteira.liberarVencidos({ limite: 500 }));
  }));
  app.get("/admin/auditoria", ...ADM, envelope(async (req, res) => {
    const s = await db.collection("auditoria").orderBy("em", "desc").limit(Math.min(Number(req.query.limite) || 100, 300)).get();
    res.json(s.docs.map((d) => ({ id: d.id, ...d.data(), em: iso(d.data().em) })));
  }));

  // ---------- Aviso global (exibido aos usuários via GET /aviso) ----------
  const AVISO = () => db.collection("configuracoes").doc("aviso");
  app.get("/admin/aviso", ...ADM, envelope(async (req, res) => { const d = (await AVISO().get()).data() || {}; res.json({ ativo: !!d.ativo, nivel: d.nivel || "info", texto: d.texto || "" }); }));
  app.put("/admin/aviso", ...ADM, envelope(async (req, res) => {
    const texto = V.texto(req.body?.texto || "", "texto", { max: 280, obrigatorio: false }), nivel = V.opcao(req.body?.nivel || "info", ["info", "alerta"], "nivel"), ativo = !!req.body?.ativo && !!texto;
    await AVISO().set({ ativo, nivel, texto, porUid: req.usuario.uid, em: FieldValue.serverTimestamp() });
    await auth.auditar(req, "admin.aviso.salvar", "", { ativo, nivel }); res.json({ ok: true, ativo });
  }));
  app.get("/aviso", limitar({ janelaMs: 60_000, max: 60, nome: "aviso" }), envelope(async (req, res) => { const d = (await AVISO().get()).data() || {}; res.json(d.ativo ? { ativo: true, nivel: d.nivel || "info", texto: d.texto } : { ativo: false }); }));

  // Registra na auditoria as exportações feitas na própria tela (as de CSV do servidor já se auditam sozinhas).
  app.post("/admin/auditar-exportacao", ...ADM, envelope(async (req, res) => {
    const tipo = V.opcao(req.body?.tipo, ["personais", "alunos", "missoes", "pagamentos", "auditoria"], "tipo");
    await auth.auditar(req, "admin.exportar", tipo, { linhas: Math.min(Number(req.body?.linhas) || 0, 1_000_000), origem: "tela" }); res.json({ ok: true });
  }));
  // Resumo financeiro leve (sem dados de Pix): saques parados aparecem no painel sem consultar chaves.
  app.get("/admin/financeiro/resumo", ...ADM, envelope(async (req, res) => {
    const s = await db.collection("saques").where("status", "==", "solicitado").limit(500).get();
    let valorCentavos = 0, antigo = null;
    for (const d of s.docs) { const q = d.data(), t = q.criadoEm?.toDate ? q.criadoEm.toDate() : null; valorCentavos += q.valorCentavos || 0; if (t && (!antigo || t < antigo)) antigo = t; }
    res.json({ saquesAbertos: { qtd: s.size, valorCentavos, maisAntigoEm: antigo ? antigo.toISOString() : null } });
  }));

  // ---------- Exportações CSV ----------
  app.get("/admin/exportar/:tipo", limitar({ janelaMs: 60_000, max: 6, nome: "csv", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    const tipo = V.opcao(String(req.params.tipo).replace(/\.csv$/, ""), ["lancamentos", "pagamentos", "saques", "estornos", "conciliacao"], "tipo");
    const linhas = []; let cab;
    if (tipo === "lancamentos") {
      cab = ["Data", "Carteira", "Tipo", "Descrição", "Aula", "Saque", "Carência (R$)", "Disponível (R$)", "Situação"];
      for await (const docs of carteira.paginas("lancamentos")) for (const d of docs) { const l = d.data(); linhas.push([dataBR(l.criadoEm), l.carteiraUid, l.tipo, l.descricao, l.aulaId || "", l.saqueId || "", dinheiro(l.dPendente), dinheiro(l.dDisponivel), l.situacao || ""]); }
    } else if (tipo === "pagamentos") {
      cab = ["Aula", "Status", "Total (R$)", "Repasse (R$)", "Comissão (R$)", "Taxa MP (R$)", "ID Mercado Pago", "Método", "Pago em", "Simulado"];
      for await (const docs of carteira.paginas("pagamentos_internos")) for (const d of docs) { const p = d.data(); if (!["aprovado", "estornado"].includes(p.status)) continue; linhas.push([d.id, p.status, dinheiro(p.split.total), dinheiro(p.split.personal), dinheiro(p.split.app), dinheiro(p.taxaMpCentavos || 0), p.mpPaymentId || "", p.metodo || "", dataBR(p.pagoEm), p.simulado ? "sim" : "não"]); }
    } else if (tipo === "saques") {
      cab = ["Saque", "Personal", "Valor (R$)", "Status", "Solicitado em", "Pago em", "Comprovante"];
      for await (const docs of carteira.paginas("saques")) for (const d of docs) { const q = d.data(); linhas.push([d.id, q.uid, dinheiro(q.valorCentavos), q.status, dataBR(q.criadoEm), dataBR(q.pagoEm), q.comprovante || ""]); }
    } else if (tipo === "estornos") {
      cab = ["Aula", "Valor (R$)", "Motivo", "Origem", "Personal", "ID reembolso MP", "Data"];
      for await (const docs of carteira.paginas("estornos")) for (const d of docs) { const e = d.data(); linhas.push([e.aulaId, dinheiro(e.valorCentavos), e.motivo, e.origem, e.personalUid, e.mpRefundId || "", dataBR(e.criadoEm)]); }
    } else {
      const r = await carteira.conciliar();
      cab = ["Tipo", "Referência", "Esperado", "Encontrado", "Descrição", "Informativo"];
      for (const d of r.divergencias) linhas.push([d.tipo, d.ref, JSON.stringify(d.esperado), JSON.stringify(d.encontrado), d.descricao, d.informativo ? "sim" : "não"]);
      linhas.push(["TOTAIS", "", "", "", `recebido líquido ${r.totais.recebidoLiquidoCentavos} | saldos ${r.totais.saldosCentavos} | saques ${r.totais.saquesSolicitadosCentavos + r.totais.saquesPagosCentavos} | diferença ${r.totais.diferencaCentavos} (centavos)`, ""]);
    }
    await auth.auditar(req, "admin.exportar", tipo, { linhas: linhas.length });
    x.enviarCSV(res, `personow-${tipo}-${V.hojeSP()}.csv`, paraCSV(cab, linhas));
  }));
};
