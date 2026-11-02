// Chamados de TI. Quem abre: alunos, personais e admins (POST /chamados) ou a própria equipe em nome de alguém (POST /ti/chamados).
//   chamados_ti/{id}                 o chamado (estado, prioridade, SLA, responsável, tempos)
//   chamados_ti/{id}/eventos/{evId}  linha do tempo (criado, assumido, comentário, mudança de status…) — `interno: true` nunca chega ao usuário
//   contadores/chamados_ti           { n } — número do protocolo (TI-000123)
// Toda mudança roda em UMA transação que atualiza o chamado, a linha do tempo e as métricas agregadas (ver metricas.js).
const crypto = require("crypto");
const { Falha } = require("../erros");
const K = require("./constantes");

function criarChamados({ db, FieldValue, Timestamp, V, metricas }) {
  const COL = "chamados_ti";
  const ref = (id) => db.collection(COL).doc(id);
  const evCol = (id) => db.collection(`${COL}/${id}/eventos`);
  let ultimo = 0;   // ids de evento estritamente crescentes (ordem cronológica = ordem do id)
  const novoEv = () => { ultimo = Math.max(Date.now(), ultimo + 1); return `${String(ultimo).padStart(13, "0")}_${crypto.randomBytes(3).toString("hex")}`; };
  const SISTEMA = { uid: "SISTEMA", nome: "Sistema", nivel: "gestor" };
  const sla = (prioridade, baseMs) => ({ atendMs: baseMs + K.SLA_MIN[prioridade].atend * 60_000, resolMs: baseMs + K.SLA_MIN[prioridade].resol * 60_000 });
  const toIso = (m) => (m ? new Date(m).toISOString() : null);
  const falhaEstado = (de, para) => new Falha(409, `Não é possível ir de "${de}" para "${para}".`, "transicao-invalida", { de, para });

  const visaoTI = (t) => ({ id: t.id, protocolo: t.protocolo, titulo: t.titulo, descricao: t.descricao, categoria: t.categoria, prioridade: t.prioridade, status: t.status, origem: t.origem,
    solicitante: { uid: t.solicitanteUid || "", tipo: t.solicitanteTipo || "", nome: t.solicitanteNome || "" }, atribuidoUid: t.atribuidoUid || "", atribuidoNome: t.atribuidoNome || "",
    criadoEm: toIso(t.criadoMs), atualizadoEm: toIso(t.atualizadoMs), atendidoEm: toIso(t.atendidoMs), resolvidoEm: toIso(t.resolvidoMs), tempoAtendSeg: t.tempoAtendSeg ?? null, tempoResolSeg: t.tempoResolSeg ?? null,
    slaAtendEm: toIso(t.slaAtendMs), slaResolEm: toIso(t.slaResolMs), reaberturas: t.reaberturas || 0, resolucao: t.resolucao || "", comentarios: t.nComentarios || 0 });
  /** O que o SOLICITANTE vê: sem notas internas, sem SLA, sem dados de outros usuários. */
  const visaoUsuario = (t) => ({ id: t.id, protocolo: t.protocolo, titulo: t.titulo, descricao: t.descricao, categoria: t.categoria, status: t.status, criadoEm: toIso(t.criadoMs), atualizadoEm: toIso(t.atualizadoMs), resolvidoEm: toIso(t.resolvidoMs), resolucao: t.resolucao || "" });
  const visaoEv = (e) => ({ id: e.id, tipo: e.tipo, autor: e.autorNome, autorTipo: e.autorTipo, texto: e.texto || "", interno: !!e.interno, de: e.de || "", para: e.para || "", em: toIso(e.emMs) });

  // ---------- criação ----------
  /** `solicitante`: { uid, tipo: "aluno"|"personal"|"admin"|"ti"|"externo", nome }. `criador`: quem registrou (o próprio usuário ou o operador). */
  async function criar({ titulo, descricao, categoria, prioridade }, { solicitante, origem, criador }) {
    titulo = V.texto(titulo, "título", { min: 5, max: 120 }); descricao = V.texto(descricao, "descrição", { min: 10, max: 2000 });
    categoria = V.opcao(categoria || "outro", K.CATEGORIAS, "categoria"); prioridade = V.opcao(prioridade || "media", K.PRIORIDADES, "prioridade");
    const r = db.collection(COL).doc(), agora = Date.now(), s = sla(prioridade, agora);
    const nome = V.texto(solicitante.nome || "", "solicitante", { max: 100, obrigatorio: false }) || solicitante.tipo;
    return db.runTransaction(async (tx) => {
      const cref = db.collection("contadores").doc("chamados_ti"), n = ((await tx.get(cref)).data()?.n || 0) + 1;
      const t = { id: r.id, protocolo: `TI-${String(n).padStart(6, "0")}`, titulo, descricao, categoria, prioridade, status: "aberto", origem, solicitanteUid: solicitante.uid || "", solicitanteTipo: solicitante.tipo, solicitanteNome: nome,
        atribuidoUid: "", atribuidoNome: "", criadoMs: agora, atualizadoMs: agora, slaAtendMs: s.atendMs, slaResolMs: s.resolMs, atendidoMs: null, tempoAtendSeg: null, resolvidoMs: null, tempoResolSeg: null, pausadoSeg: 0, pausadoDesdeMs: null, reaberturas: 0, resolucao: "", nComentarios: 0 };
      tx.set(cref, { n }, { merge: true });
      tx.set(r, { ...t, criadoEm: Timestamp.fromMillis(agora), atualizadoEm: Timestamp.fromMillis(agora) });
      tx.set(evCol(r.id).doc(novoEv()), { tipo: "criado", autorUid: criador.uid, autorNome: criador.nome || "", autorTipo: criador.tipo, texto: "", interno: false, emMs: agora, em: Timestamp.fromMillis(agora) });
      metricas.aplicarCriacao(tx, { ms: agora, prioridade });
      return t;
    });
  }

  // ---------- transação genérica ----------
  /** `fn(t, agora)` valida e devolve { patch, evento, metrica?(tx) }; qualquer Falha cancela a transação inteira. */
  async function aplicar(id, ator, fn) {
    V.idDoc(id, "id");
    return db.runTransaction(async (tx) => {
      const t = (await tx.get(ref(id))).data(); if (!t) throw new Falha(404, "Chamado não encontrado.", "nao-encontrado");
      const agora = Date.now(), { patch, evento, metrica } = fn(t, agora);
      tx.update(ref(id), { ...patch, atualizadoMs: agora, atualizadoEm: Timestamp.fromMillis(agora) });
      tx.set(evCol(id).doc(novoEv()), { autorUid: ator.uid, autorNome: ator.nome || "", autorTipo: ator.tipo || "ti", interno: false, ...evento, emMs: agora, em: Timestamp.fromMillis(agora) });
      metrica?.(tx, agora);
      return { ...t, ...patch, atualizadoMs: agora };
    });
  }
  const gestor = (a) => a.nivel === "gestor";
  const donoOuGestor = (t, a) => { if (t.atribuidoUid && t.atribuidoUid !== a.uid && !gestor(a)) throw new Falha(403, `Este chamado está com ${t.atribuidoNome || "outro operador"}.`, "nao-e-seu"); };
  /** Primeira vez que alguém assume: fixa o tempo de atendimento e credita o operador. */
  const primeiroAtendimento = (t, agora, op) => {
    if (t.atendidoMs) return { patch: {}, metrica: null };
    const seg = Math.max(0, Math.round((agora - t.criadoMs) / 1000));
    return { patch: { atendidoMs: agora, tempoAtendSeg: seg }, metrica: (tx, ms) => metricas.aplicarAtendimento(tx, { ms, uid: op.uid, nome: op.nome, seg, noPrazo: agora <= t.slaAtendMs }) };
  };

  const assumir = (id, ator) => aplicar(id, ator, (t, agora) => {
    if (t.status === "aberto" || (t.status === "em_atendimento" && !t.atribuidoUid)) { /* ok */ }
    else if (t.atribuidoUid && t.atribuidoUid !== ator.uid) throw new Falha(409, `Já está com ${t.atribuidoNome}.`, "ja-atribuido");
    else throw falhaEstado(t.status, "em_atendimento");
    const pa = primeiroAtendimento(t, agora, ator);
    return { patch: { status: "em_atendimento", atribuidoUid: ator.uid, atribuidoNome: ator.nome, ...pa.patch }, evento: { tipo: "assumido", texto: "" }, metrica: pa.metrica };
  });

  const atribuir = (id, ator, alvo) => aplicar(id, ator, (t, agora) => {
    if (!["aberto", "em_atendimento", "aguardando_usuario"].includes(t.status)) throw falhaEstado(t.status, "atribuído");
    if (t.atribuidoUid === alvo.uid) throw new Falha(409, "O chamado já está com este operador.", "ja-atribuido");
    const pa = primeiroAtendimento(t, agora, alvo);
    return { patch: { atribuidoUid: alvo.uid, atribuidoNome: alvo.nome, status: t.status === "aberto" ? "em_atendimento" : t.status, ...pa.patch }, evento: { tipo: "atribuido", texto: `Encaminhado para ${alvo.nome}`, para: alvo.nome, de: t.atribuidoNome || "" }, metrica: pa.metrica };
  });

  const mudarStatus = (id, ator, para, nota = "") => aplicar(id, ator, (t, agora) => {
    para = V.opcao(para, K.STATUS, "status");
    if (!K.TRANSICOES[t.status].includes(para)) throw falhaEstado(t.status, para);
    if (!t.atribuidoUid && !gestor(ator) && para !== "em_atendimento") throw new Falha(409, "Assuma o chamado antes de alterá-lo.", "assuma-primeiro");
    donoOuGestor(t, ator);
    const texto = V.texto(nota, "nota", { max: 1000, min: para === "resolvido" || para === "cancelado" ? 5 : 0 });
    const patch = { status: para }; let metrica = null;
    // saindo de "aguardando usuário": o tempo parado não conta para o prazo de resolução (empurra o SLA)
    if (t.status === "aguardando_usuario") { const parado = Math.max(0, Math.round((agora - (t.pausadoDesdeMs || agora)) / 1000)); patch.pausadoSeg = (t.pausadoSeg || 0) + parado; patch.pausadoDesdeMs = null; patch.slaResolMs = t.slaResolMs + parado * 1000; }
    if (para === "aguardando_usuario") patch.pausadoDesdeMs = agora;
    if (para === "aberto") { patch.atribuidoUid = ""; patch.atribuidoNome = ""; patch.slaAtendMs = agora + K.SLA_MIN[t.prioridade].atend * 60_000; }   // voltou para a fila: novo prazo de pegada
    if (para === "em_atendimento" && t.status === "resolvido") { patch.reaberturas = (t.reaberturas || 0) + 1; patch.resolvidoMs = null; patch.tempoResolSeg = null; patch.resolucao = ""; patch.slaResolMs = agora + K.SLA_MIN[t.prioridade].resol * 60_000; }
    if (para === "em_atendimento" && !t.atribuidoUid) { patch.atribuidoUid = ator.uid; patch.atribuidoNome = ator.nome; const pa = primeiroAtendimento(t, agora, ator); Object.assign(patch, pa.patch); metrica = pa.metrica; }
    if (para === "resolvido") {
      const credito = t.atribuidoUid ? { uid: t.atribuidoUid, nome: t.atribuidoNome } : ator;
      const pausadoFinal = patch.pausadoSeg ?? t.pausadoSeg ?? 0, slaFinal = patch.slaResolMs ?? t.slaResolMs;
      const seg = Math.max(0, Math.round((agora - t.criadoMs) / 1000) - pausadoFinal);
      Object.assign(patch, { resolvidoMs: agora, tempoResolSeg: seg, resolucao: texto });
      metrica = (tx, ms) => metricas.aplicarResolucao(tx, { ms, uid: credito.uid, nome: credito.nome, seg, noPrazo: agora <= slaFinal });
    }
    if (para === "cancelado") metrica = (tx, ms) => metricas.aplicarCancelamento(tx, { ms });
    return { patch, evento: { tipo: "status", de: t.status, para, texto }, metrica };
  });

  const comentar = (id, ator, texto, interno = true) => aplicar(id, ator, (t) => {
    if (t.status === "cancelado") throw new Falha(409, "Chamado cancelado.", "estado-invalido");
    return { patch: { nComentarios: (t.nComentarios || 0) + 1 }, evento: { tipo: "comentario", texto: V.texto(texto, "comentário", { min: 1, max: 1000 }), interno: !!interno } };
  });

  const alterarPrioridade = (id, ator, prioridade) => aplicar(id, ator, (t) => {
    prioridade = V.opcao(prioridade, K.PRIORIDADES, "prioridade");
    if (!["aberto", "em_atendimento", "aguardando_usuario"].includes(t.status)) throw falhaEstado(t.status, "outra prioridade");
    if (t.prioridade === prioridade) throw new Falha(409, "Já está com esta prioridade.", "sem-mudanca");
    const s = sla(prioridade, t.criadoMs);
    return { patch: { prioridade, ...(t.atendidoMs ? {} : { slaAtendMs: s.atendMs }), slaResolMs: s.resolMs + (t.pausadoSeg || 0) * 1000 }, evento: { tipo: "prioridade", de: t.prioridade, para: prioridade, texto: `Prioridade: ${t.prioridade} → ${prioridade}` } };
  });

  /** Resposta do SOLICITANTE (só no próprio chamado). Se estava "aguardando usuário", o atendimento é retomado. */
  const responderComoUsuario = (id, usuario, texto) => aplicar(id, { uid: usuario.uid, nome: usuario.nome, tipo: usuario.tipo }, (t, agora) => {
    if (t.solicitanteUid !== usuario.uid) throw new Falha(404, "Chamado não encontrado.", "nao-encontrado");
    if (!["aberto", "em_atendimento", "aguardando_usuario"].includes(t.status)) throw new Falha(409, "Este chamado já foi encerrado. Abra um novo, se precisar.", "estado-invalido");
    const patch = { nComentarios: (t.nComentarios || 0) + 1 };
    if (t.status === "aguardando_usuario") { const parado = Math.max(0, Math.round((agora - (t.pausadoDesdeMs || agora)) / 1000)); Object.assign(patch, { status: t.atribuidoUid ? "em_atendimento" : "aberto", pausadoSeg: (t.pausadoSeg || 0) + parado, pausadoDesdeMs: null, slaResolMs: t.slaResolMs + parado * 1000 }); }
    return { patch, evento: { tipo: "comentario", texto: V.texto(texto, "mensagem", { min: 1, max: 1000 }), interno: false } };
  });

  /** Chamados em andamento de um operador voltam para a fila (usado ao excluir o operador). */
  async function devolverFila(operadorUid, ator = SISTEMA) {
    const s = await db.collection(COL).where("atribuidoUid", "==", operadorUid).where("status", "in", ["em_atendimento", "aguardando_usuario"]).limit(200).get();
    let n = 0; for (const d of s.docs) { try { await mudarStatus(d.id, { ...ator, nivel: "gestor" }, "aberto", "Devolvido à fila: operador removido da equipe."); n++; } catch (e) { console.warn("devolverFila:", d.id, e.message); } }
    return n;
  }

  // ---------- leitura ----------
  const peso = (t) => K.PESO_PRIORIDADE[t.prioridade] || 0;
  /** visao: "abertos" (fila de trabalho, mais urgentes primeiro) | "resolvidos" (paginado) | "todos" (recentes). Filtros extras são aplicados sobre a página. */
  async function listar({ visao = "abertos", prioridade, atribuidoUid, categoria, q, limite = 100, cursor } = {}) {
    V.opcao(visao, ["abertos", "resolvidos", "todos"], "visão"); if (prioridade) V.opcao(prioridade, K.PRIORIDADES, "prioridade"); if (categoria) V.opcao(categoria, K.CATEGORIAS, "categoria");
    limite = Math.max(1, Math.min(Number(limite) || 100, visao === "abertos" ? 300 : 100));
    let consulta = db.collection(COL);
    if (visao === "abertos") consulta = consulta.where("status", "in", K.STATUS_ABERTOS).orderBy("criadoMs", "asc");
    else if (visao === "resolvidos") { consulta = consulta.where("status", "==", "resolvido"); if (cursor) consulta = consulta.where("resolvidoMs", "<", Number(cursor)); consulta = consulta.orderBy("resolvidoMs", "desc"); }
    else { if (cursor) consulta = consulta.where("criadoMs", "<", Number(cursor)); consulta = consulta.orderBy("criadoMs", "desc"); }
    const s = await consulta.limit(limite + 1).get(), todos = s.docs.map((d) => d.data()), pagina = todos.slice(0, limite);
    const termo = String(q || "").trim().toLowerCase();
    let itens = pagina.filter((t) => (!prioridade || t.prioridade === prioridade) && (!categoria || t.categoria === categoria) && (!atribuidoUid || (atribuidoUid === "nenhum" ? !t.atribuidoUid : t.atribuidoUid === atribuidoUid))
      && (!termo || `${t.protocolo} ${t.titulo} ${t.solicitanteNome}`.toLowerCase().includes(termo)));
    if (visao === "abertos") itens = itens.sort((a, b) => peso(b) - peso(a) || a.criadoMs - b.criadoMs);
    const ultimaPagina = pagina[pagina.length - 1];
    return { itens: itens.map(visaoTI), truncado: todos.length > limite, proximo: visao !== "abertos" && todos.length > limite ? String(visao === "resolvidos" ? ultimaPagina.resolvidoMs : ultimaPagina.criadoMs) : null };
  }

  async function detalhe(id) {
    const t = (await ref(V.idDoc(id, "id")).get()).data(); if (!t) throw new Falha(404, "Chamado não encontrado.", "nao-encontrado");
    const ev = (await evCol(id).orderBy("__name__", "asc").limit(300).get()).docs.map((d) => visaoEv({ id: d.id, ...d.data() }));
    return { ...visaoTI(t), eventos: ev };
  }

  const meus = async (uid) => (await db.collection(COL).where("solicitanteUid", "==", uid).orderBy("criadoMs", "desc").limit(30).get()).docs.map((d) => visaoUsuario(d.data()));
  async function detalheDoUsuario(uid, id) {
    const t = (await ref(V.idDoc(id, "id")).get()).data(); if (!t || t.solicitanteUid !== uid) throw new Falha(404, "Chamado não encontrado.", "nao-encontrado");   // IDOR: chamado alheio = 404
    const ev = (await evCol(id).orderBy("__name__", "asc").limit(300).get()).docs.map((d) => visaoEv({ id: d.id, ...d.data() })).filter((e) => !e.interno)
      .map((e) => ({ tipo: e.tipo, autor: e.autorTipo === "ti" ? "Equipe de TI" : e.autor, texto: e.texto, em: e.em, de: e.de, para: e.para })).filter((e) => e.tipo !== "atribuido" && e.tipo !== "prioridade");
    return { ...visaoUsuario(t), eventos: ev };
  }

  // ---------- contagens (agregação no servidor do banco: 1 leitura a cada 1000 itens do índice) ----------
  let cacheCont = null;
  async function contagens() {
    if (cacheCont && Date.now() - cacheCont.t < 4000) return cacheCont.v;
    const agora = Date.now(), n = async (q) => (await q.count().get()).data().count, col = db.collection(COL);
    const [aberto, emAtendimento, aguardandoUsuario, vencidosFila, vencidosResolucao] = await Promise.all([
      n(col.where("status", "==", "aberto")), n(col.where("status", "==", "em_atendimento")), n(col.where("status", "==", "aguardando_usuario")),
      n(col.where("status", "==", "aberto").where("slaAtendMs", "<", agora)), n(col.where("status", "==", "em_atendimento").where("slaResolMs", "<", agora))]);
    const v = { aberto, emAtendimento, aguardandoUsuario, totalAbertos: aberto + emAtendimento + aguardandoUsuario, foraDoPrazo: vencidosFila + vencidosResolucao };
    cacheCont = { t: Date.now(), v }; return v;
  }

  return { visaoTI, criar, assumir, atribuir, mudarStatus, comentar, alterarPrioridade, responderComoUsuario, devolverFila, listar, detalhe, meus, detalheDoUsuario, contagens, invalidarCache: () => { cacheCont = null; }, SISTEMA };
}
module.exports = { criarChamados };
