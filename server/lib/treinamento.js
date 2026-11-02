// ============================================================
// TREINAMENTO OBRIGATÓRIO — programa Personow
//
// O personal só aceita aulas depois de concluir TODOS os módulos OBRIGATÓRIOS ativos, em ordem.
// Cursos opcionais (obrigatorio:false, por categoria) ficam sempre abertos e NÃO entram na habilitação.
// A conclusão NÃO é declarada pelo navegador: o cliente envia "pings" de reprodução e o servidor
// credita apenas progresso contíguo e em tempo real (limitado ao relógio do servidor), a partir
// do ponto já validado. Pular para o fim, acelerar o tempo ou repetir um trecho não conclui o módulo.
//
// Falha fechada: sem nenhum módulo ativo cadastrado, ninguém é habilitado.
// ============================================================
const { Falha } = require("./erros");
const C = require("./config");
const V = require("./validacao");

// Prova opcional por módulo (perguntas + alternativas, nota mínima). Sem perguntas, o módulo conclui só com o vídeo.
const NOTA_MINIMA_PADRAO = C.TREINO_NOTA_MINIMA || 70;
const temProva = (m) => Array.isArray(m.perguntas) && m.perguntas.length > 0;

function validarPerguntas(l) {
  if (!Array.isArray(l) || l.length > 20) throw new Falha(400, "Informe até 20 perguntas.", "dados-invalidos");
  return l.map((q, i) => {
    const enunciado = V.texto(q?.enunciado, `pergunta ${i + 1}`, { min: 5, max: 300 });
    if (!Array.isArray(q?.alternativas) || q.alternativas.length < 2 || q.alternativas.length > 6) throw new Falha(400, `Pergunta ${i + 1}: use de 2 a 6 alternativas.`, "dados-invalidos");
    const alternativas = q.alternativas.map((a, j) => V.texto(a, `alternativa ${j + 1} da pergunta ${i + 1}`, { min: 1, max: 150 }));
    const correta = V.inteiro(q.correta, `resposta correta da pergunta ${i + 1}`, { min: 0, max: alternativas.length - 1 });
    return { enunciado, alternativas, correta };
  });
}

function criarTreinamento({ db, FieldValue, Timestamp, admin }) {
  const progRef = (uid, mod) => db.collection("treinamento_progresso").doc(`${uid}_${mod}`);

  async function modulosAtivos() {
    const s = await db.collection("treinamento_modulos").where("ativo", "==", true).get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.ordem - b.ordem);
  }
  const limiar = (m) => Math.max(1, Math.floor((m.duracaoSeg * (m.pctMinimo || C.TREINO_PCT_MINIMO)) / 100));

  /** Estado completo para a UI e para a decisão de habilitação. */
  async function estado(uid) {
    const modulos = await modulosAtivos();
    const progs = await Promise.all(modulos.map((m) => progRef(uid, m.id).get()));
    let liberado = true; // módulo OBRIGATÓRIO N só abre depois do N-1; opcionais não entram na fila
    const lista = modulos.map((m, i) => {
      const p = progs[i].data() || {}, prova = temProva(m);
      const videoOk = p.videoOk ?? p.concluido === true, provaOk = p.provaOk === true;   // legado: concluido:true sem videoOk = vídeo visto
      const concluido = videoOk && (!prova || provaOk);                                  // com prova, só conclui depois de aprovado
      const obrigatorio = m.obrigatorio !== false;                       // módulos antigos (sem o campo) continuam obrigatórios
      const bloqueado = obrigatorio && !liberado;
      const item = { id: m.id, ordem: m.ordem, titulo: m.titulo, descricao: m.descricao || "", provedor: m.provedor, videoRef: bloqueado ? null : m.videoRef,
        duracaoSeg: m.duracaoSeg, validoSeg: p.validoSeg || 0, limiarSeg: limiar(m), concluido, bloqueado,
        obrigatorio, categoria: obrigatorio ? "habilitacao" : (C.CURSO_CATEGORIAS.includes(m.categoria) && m.categoria !== "habilitacao" ? m.categoria : "geral"),
        temProva: prova, totalPerguntas: prova ? m.perguntas.length : 0, notaMinima: m.notaMinima || NOTA_MINIMA_PADRAO, videoOk, provaOk, nota: p.melhorNota ?? null };
      if (obrigatorio && !concluido) liberado = false;
      return item;
    });
    const obrig = lista.filter((m) => m.obrigatorio), opc = lista.filter((m) => !m.obrigatorio);
    const completo = obrig.length > 0 && obrig.every((m) => m.concluido);
    return { projeto: "Personow", modulos: lista, concluidos: obrig.filter((m) => m.concluido).length, total: obrig.length, completo,
      opcionais: { concluidos: opc.filter((m) => m.concluido).length, total: opc.length } };
  }

  /** Autoridade única: pode aceitar aulas? (idempotente, lê direto dos módulos ativos) */
  const completo = async (uid) => (await estado(uid)).completo;

  /** Mantém flag no perfil e claim do token em sincronia (claim é usada pelas regras do Firestore). */
  async function sincronizar(uid, estaCompleto, claimsAtuais = {}) {
    const ref = db.collection("personais").doc(uid);
    const atual = (await ref.get()).data() || {};
    if (Boolean(atual.treinamentoOk) !== estaCompleto) {
      await ref.set({ treinamentoOk: estaCompleto, ...(estaCompleto ? { treinamentoConcluidoEm: FieldValue.serverTimestamp() } : {}) }, { merge: true });
    }
    if (Boolean(claimsAtuais.treinado) !== estaCompleto) {
      const u = await admin.auth().getUser(uid);
      await admin.auth().setCustomUserClaims(uid, { ...(u.customClaims || {}), treinado: estaCompleto });
      return { claimAtualizada: true };
    }
    return { claimAtualizada: false };
  }

  /**
   * Registra um "ping" de reprodução. Devolve o progresso validado e se o módulo concluiu.
   * @param {{moduloId:string, posicaoSeg:number, tocando:boolean}} p
   */
  async function ping(uid, p, claimsAtuais = {}) {
    const moduloId = V.idDoc(p.moduloId, "moduloId");
    const posicao = V.inteiro(Math.floor(Number(p.posicaoSeg)), "posicaoSeg", { min: 0, max: 86400 });
    const tocando = p.tocando === true;
    const est = await estado(uid);
    const m = est.modulos.find((x) => x.id === moduloId);
    if (!m) throw new Falha(404, "Módulo não encontrado.", "modulo-inexistente");
    if (m.bloqueado) throw new Falha(403, "Conclua o módulo anterior primeiro.", "modulo-bloqueado");
    if (m.videoOk) return { moduloId, validoSeg: m.limiarSeg, limiarSeg: m.limiarSeg, concluido: m.concluido, obrigatorio: m.obrigatorio, videoOk: true, provaPendente: m.temProva && !m.provaOk, treinamentoCompleto: est.completo };

    const ref = progRef(uid, moduloId), agora = Date.now();
    const r = await db.runTransaction(async (tx) => {
      const prev = (await tx.get(ref)).data() || { validoSeg: 0, ultimoPingMs: 0 };
      let ate = prev.validoSeg || 0;
      if (prev.ultimoPingMs && agora - prev.ultimoPingMs < C.TREINO_PING_MIN_INTERVALO_MS) throw new Falha(429, "Ping rápido demais.", "ping-rapido");
      if (tocando && prev.ultimoPingMs && prev.tocando) {
        const permitido = Math.min((agora - prev.ultimoPingMs) / 1000, C.TREINO_PING_MAX_SEG);
        // só conta se a posição é continuação do trecho já validado (sem pular, sem voltar)
        if (posicao >= ate - 1 && posicao <= ate + permitido + 2) ate = Math.max(ate, Math.min(posicao, Math.floor(ate + permitido)));
      }
      const concluiu = ate >= limiar(m) && ate <= m.duracaoSeg + 5;
      tx.set(ref, { uid, moduloId, validoSeg: ate, ultimaPosicao: posicao, tocando, ultimoPingMs: agora, videoOk: concluiu, concluido: concluiu && !m.temProva, ...(concluiu ? { videoOkEm: FieldValue.serverTimestamp() } : {}), ...(concluiu && !m.temProva ? { concluidoEm: FieldValue.serverTimestamp() } : {}), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
      return { ate, concluiu };
    });
    let completoAgora = false;
    if (r.concluiu && !m.temProva) { completoAgora = (await estado(uid)).completo; await sincronizar(uid, completoAgora, claimsAtuais); }
    return { moduloId, validoSeg: r.ate, limiarSeg: m.limiarSeg, concluido: r.concluiu && !m.temProva, obrigatorio: m.obrigatorio, videoOk: r.concluiu, provaPendente: r.concluiu && m.temProva, treinamentoCompleto: completoAgora, pontoDeRetomada: r.ate };
  }

  // ---------- prova do módulo (a resposta certa NUNCA sai do servidor) ----------
  async function moduloDaProva(uid, moduloId) {
    const id = V.idDoc(moduloId, "moduloId"), est = await estado(uid), m = est.modulos.find((x) => x.id === id);
    if (!m) throw new Falha(404, "Módulo não encontrado.", "modulo-inexistente");
    if (m.bloqueado) throw new Falha(403, "Conclua o módulo anterior primeiro.", "modulo-bloqueado");
    if (!m.temProva) throw new Falha(409, "Este módulo não tem prova.", "sem-prova");
    if (!m.videoOk) throw new Falha(403, "Assista ao vídeo até o fim antes da prova.", "assista-primeiro");
    const doc = (await db.collection("treinamento_modulos").doc(id).get()).data();
    return { id, m, perguntas: doc.perguntas };
  }
  async function perguntas(uid, moduloId) {
    const { id, m, perguntas: l } = await moduloDaProva(uid, moduloId);
    return { moduloId: id, notaMinima: m.notaMinima, jaAprovado: m.provaOk, perguntas: l.map((q, i) => ({ i, enunciado: q.enunciado, alternativas: q.alternativas })) };
  }
  async function responder(uid, moduloId, respostas, claimsAtuais = {}) {
    const { id, m, perguntas: l } = await moduloDaProva(uid, moduloId);
    if (m.provaOk) return { aprovado: true, jaAprovado: true, nota: m.nota, notaMinima: m.notaMinima, treinamentoCompleto: (await estado(uid)).completo };
    if (!Array.isArray(respostas) || respostas.length !== l.length || !respostas.every((r, i) => Number.isInteger(r) && r >= 0 && r < l[i].alternativas.length)) throw new Falha(400, "Responda todas as perguntas.", "dados-invalidos");
    const acertos = l.filter((q, i) => respostas[i] === q.correta).length, nota = Math.round((acertos * 100) / l.length), aprovado = nota >= m.notaMinima;
    const ref = progRef(uid, id), prev = (await ref.get()).data() || {};
    await ref.set({ uid, moduloId: id, tentativas: (prev.tentativas || 0) + 1, ultimaNota: nota, melhorNota: Math.max(prev.melhorNota || 0, nota),
      ...(aprovado ? { provaOk: true, concluido: true, provaEm: FieldValue.serverTimestamp(), concluidoEm: FieldValue.serverTimestamp() } : {}), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    let completoAgora = false, atualizarToken = false;
    if (aprovado) { completoAgora = (await estado(uid)).completo; atualizarToken = (await sincronizar(uid, completoAgora, claimsAtuais)).claimAtualizada; }
    return { aprovado, nota, acertos, total: l.length, notaMinima: m.notaMinima, treinamentoCompleto: completoAgora, atualizarToken };   // não revela quais questões erraram
  }

  // ---------- administração do catálogo ----------
  function validarModulo(b, { parcial = false } = {}) {
    const o = {};
    const set = (k, fn) => { if (!parcial || b[k] !== undefined) o[k] = fn(); };
    set("ordem", () => V.inteiro(b.ordem, "ordem", { min: 1, max: 999 }));
    set("titulo", () => V.texto(b.titulo, "título", { min: 3, max: 120 }));
    set("descricao", () => V.texto(b.descricao || "", "descrição", { max: 400, obrigatorio: false }));
    set("provedor", () => V.opcao(b.provedor, ["youtube", "mp4"], "provedor"));
    set("duracaoSeg", () => V.inteiro(b.duracaoSeg, "duracaoSeg", { min: 30, max: 7200 }));
    set("videoRef", () => {
      const prov = b.provedor ?? o.provedor, ref = V.texto(b.videoRef, "videoRef", { min: 3, max: 300 });
      if (prov === "youtube" && !/^[\w-]{11}$/.test(ref)) throw new Falha(400, "Para YouTube informe apenas o ID do vídeo (11 caracteres).", "dados-invalidos");
      if (prov === "mp4" && !/^https:\/\/[^\s]+$/.test(ref)) throw new Falha(400, "Para vídeo próprio informe uma URL https.", "dados-invalidos");
      return ref;
    });
    if (b.notaMinima !== undefined) o.notaMinima = V.inteiro(b.notaMinima, "notaMinima", { min: 50, max: 100 });
    if (b.perguntas !== undefined) o.perguntas = validarPerguntas(b.perguntas);
    if (b.pctMinimo !== undefined) o.pctMinimo = V.inteiro(b.pctMinimo, "pctMinimo", { min: 50, max: 100 });
    if (b.ativo !== undefined) o.ativo = V.booleano(b.ativo, "ativo");
    if (b.obrigatorio !== undefined) o.obrigatorio = V.booleano(b.obrigatorio, "obrigatorio");
    if (b.categoria !== undefined) o.categoria = V.opcao(b.categoria, C.CURSO_CATEGORIAS, "categoria");
    return o;
  }
  async function salvarModulo(id, b) {
    const ref = id ? db.collection("treinamento_modulos").doc(V.idDoc(id)) : db.collection("treinamento_modulos").doc();
    const existe = id ? (await ref.get()).exists : false;
    if (id && !existe) throw new Falha(404, "Módulo não encontrado.", "nao-encontrado");
    const dados = validarModulo(b, { parcial: existe });
    // coerência: obrigatório ⇒ categoria "habilitacao"; opcional nunca fica em "habilitacao"
    const atual = existe ? (await ref.get()).data() || {} : {};
    const obrig = dados.obrigatorio ?? (atual.obrigatorio !== false);
    dados.obrigatorio = obrig;
    dados.categoria = obrig ? "habilitacao" : (dados.categoria && dados.categoria !== "habilitacao" ? dados.categoria : (atual.categoria && atual.categoria !== "habilitacao" ? atual.categoria : "geral"));
    await ref.set({ ...dados, ...(existe ? {} : { ativo: dados.ativo ?? true }), versao: FieldValue.increment ? FieldValue.increment(1) : 1, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    return { id: ref.id };
  }
  async function listarTodos() {
    const s = await db.collection("treinamento_modulos").get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.ordem - b.ordem);
  }

  return { estado, completo, sincronizar, ping, perguntas, responder, salvarModulo, listarTodos, modulosAtivos };
}
module.exports = { criarTreinamento };
