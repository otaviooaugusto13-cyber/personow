// ============================================================
// HABILITAÇÃO POR CATEGORIA — vídeo + timer + questionário com 100% de acerto
//
// Fluxo (TUDO decidido no servidor; o navegador só exibe):
//   1) iniciar        cria a sessão e fixa o relógio: libera em  = agora + duração do vídeo + 3 s (HAB_MARGEM_SEG)
//   2) ping           o cliente informa a posição do vídeo; o servidor credita só reprodução CONTÍGUA e em tempo real
//   3) questionario   só abre se (relógio do servidor ≥ libera em) E (vídeo validado até o fim). Entrega as perguntas
//                     embaralhadas e SEM o gabarito.
//   4) responder      correção no servidor. 100% → grava a habilitação em personais/{uid}.habilitacoes[categoria].
//                     < 100% → sessão encerrada: é preciso assistir ao vídeo de novo e rodar o timer inteiro do zero.
//
// Por que não dá para burlar pelo navegador: o gabarito nunca sai daqui, o timer é o relógio do servidor,
// o crédito de vídeo é limitado ao tempo real decorrido e o campo "habilitacoes" não está na lista de campos
// que o cliente pode escrever no Firestore (firestore.rules).
// ============================================================
const crypto = require("node:crypto");
const { Falha } = require("./erros");
const C = require("./config");
const V = require("./validacao");

const ids = () => Object.keys(C.CATEGORIAS);
/** Categoria exigida por uma modalidade de aula (null se a modalidade não for conhecido → o aceite falha fechado). */
const categoriaDaModalidade = (foco) => C.MODALIDADE_CATEGORIA[foco] || null;

function embaralhar(n) {              // Fisher-Yates com fonte criptográfica: [0..n-1] em ordem aleatória
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const iso = (t) => (t?.toDate ? t.toDate().toISOString() : t || null);

function criarCategorias({ db, FieldValue }) {
  const catRef = (id) => db.collection("habilitacao_categorias").doc(id);
  const sesRef = (uid, cat) => db.collection("habilitacao_sessoes").doc(`${uid}_${cat}`);
  const profRef = (uid) => db.collection("personais").doc(uid);
  const idCat = (x) => V.opcao(x, ids(), "categoria");

  /** Categoria só vale para treino se estiver ativa e completa (vídeo + 3 a 4 perguntas). Falha fechada. */
  const pronta = (c) => !!c && c.ativo === true && !!c.videoRef && c.duracaoSeg >= 30 && Array.isArray(c.perguntas)
    && c.perguntas.length >= C.HAB_PERGUNTAS_MIN && c.perguntas.length <= C.HAB_PERGUNTAS_MAX;
  const fimOk = (ses) => (ses.validoSeg || 0) >= ses.duracaoSeg - C.HAB_TOLERANCIA_FIM_SEG;
  const restante = (ses) => Math.max(0, (ses.liberaEmMs || 0) - Date.now());

  async function carregar(catId) {
    const c = (await catRef(catId).get()).data();
    if (!pronta(c)) throw new Falha(409, "Este treinamento ainda não foi publicado pela equipe.", "categoria-indisponivel");
    return c;
  }

  /** Selos exibidos na bio/perfil. Lidos SEMPRE do campo gravado pelo servidor (nunca do texto da bio, que o usuário edita). */
  function selosDe(pub) {
    const h = pub?.habilitacoes || {};
    return ids().filter((id) => h[id]).map((id) => ({ categoria: id, titulo: C.CATEGORIAS[id].titulo, ico: C.CATEGORIAS[id].ico, elite: h[id].elite === true, em: iso(h[id].em) }));
  }
  /** O personal pode aceitar aula deste modalidade? (usado pelo aceite; exige a habilitação da categoria correspondente) */
  function exigirParaModalidade(pub, foco) {
    const cat = categoriaDaModalidade(foco);
    if (!cat) throw new Falha(403, "Este modalidade ainda não tem habilitação definida.", "categoria-pendente", { categoria: null });
    if (!pub?.habilitacoes?.[cat]) throw new Falha(403, `Para aceitar aulas de ${C.CATEGORIAS[cat].titulo}, conclua o treinamento e a avaliação dessa categoria.`, "categoria-pendente", { categoria: cat });
    return cat;
  }

  // ---------- leitura (UI) ----------
  async function listar(uid) {
    const todos = ids();
    const [cats, sess, pub] = await Promise.all([Promise.all(todos.map((i) => catRef(i).get())), Promise.all(todos.map((i) => sesRef(uid, i).get())), profRef(uid).get()]);
    const h = pub.data()?.habilitacoes || {};
    return {
      categorias: todos.map((id, i) => {
        const c = cats[i].data() || {}, s = sess[i].data() || null, ativa = s && ["assistindo", "liberado"].includes(s.status);
        return { id, titulo: C.CATEGORIAS[id].titulo, ico: C.CATEGORIAS[id].ico, descricao: c.descricao || "", duracaoSeg: c.duracaoSeg || 0, disponivel: pronta(c),
          habilitado: !!h[id], elite: h[id]?.elite === true, em: iso(h[id]?.em), reprovacoes: s?.reprovacoes || 0,
          sessao: ativa ? { status: s.status, validoSeg: s.validoSeg || 0 } : null };
      }),
      selos: selosDe({ habilitacoes: h })
    };
  }

  // ---------- 1) iniciar / retomar ----------
  async function iniciar(uid, catId) {
    catId = idCat(catId);
    const c = await carregar(catId), agora = Date.now();
    const pub = (await profRef(uid).get()).data();
    if (!pub) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado");
    if (pub.habilitacoes?.[catId]) throw new Falha(409, "Você já está habilitado nesta categoria.", "ja-habilitado");
    const ref = sesRef(uid, catId);
    const ses = await db.runTransaction(async (tx) => {
      const prev = (await tx.get(ref)).data();
      const mesmoConteudo = prev && prev.versao === (c.versao || 0) && prev.videoRef === c.videoRef && prev.duracaoSeg === c.duracaoSeg;
      const retomavel = mesmoConteudo && (prev.status === "assistindo" || (prev.status === "liberado" && (prev.quizExpiraEm || 0) > agora));
      if (retomavel) return prev;
      // sessão nova: vídeo e timer começam do ZERO (também depois de reprovação ou de questionário vencido)
      const nova = { uid, categoria: catId, status: "assistindo", versao: c.versao || 0, videoRef: c.videoRef, duracaoSeg: c.duracaoSeg,
        iniciouMs: agora, liberaEmMs: agora + (c.duracaoSeg + C.HAB_MARGEM_SEG) * 1000, validoSeg: 0, ultimoPingMs: 0, tocando: false,
        reprovacoes: prev?.reprovacoes || 0, atualizadoEm: FieldValue.serverTimestamp() };
      tx.set(ref, nova);                                     // set SEM merge: apaga quiz/resultado antigos
      return nova;
    });
    return { categoria: catId, titulo: C.CATEGORIAS[catId].titulo, provedor: c.provedor, videoRef: c.videoRef, duracaoSeg: ses.duracaoSeg, status: ses.status,
      validoSeg: ses.validoSeg || 0, restanteMs: restante(ses), margemSeg: C.HAB_MARGEM_SEG, videoOk: fimOk(ses), reprovacoes: ses.reprovacoes || 0 };
  }

  // ---------- 2) ping de reprodução (crédito contíguo, limitado ao relógio do servidor) ----------
  // Modelo: "validoSeg" é a fronteira do trecho assistido. Ela só avança se o ping anterior já dizia "tocando", se a posição
  // andou no máximo o tempo real decorrido (sem pulo, sem 2x) e se partiu de perto da fronteira (sem saltar para outro trecho).
  // O navegador manda um ping a cada 5 s e outro em cada play/pause (âncora), então não se perde crédito ao pausar/retomar.
  async function ping(uid, p) {
    const catId = idCat(p.categoria);
    const posicao = V.inteiro(Math.floor(Number(p.posicaoSeg)), "posicaoSeg", { min: 0, max: 86400 });
    const tocando = p.tocando === true, evento = p.evento === true, agora = Date.now(), ref = sesRef(uid, catId);
    return db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      if (!s) throw new Falha(409, "Inicie o treinamento primeiro.", "sessao-inexistente");
      const estado = (x) => ({ categoria: catId, status: x.status, validoSeg: x.validoSeg || 0, duracaoSeg: x.duracaoSeg, restanteMs: restante(x), videoOk: fimOk(x), liberado: fimOk(x) && restante(x) === 0 });
      if (s.status !== "assistindo") return estado(s);
      const minimo = evento ? C.HAB_PING_EVENTO_MIN_MS : C.TREINO_PING_MIN_INTERVALO_MS;
      if (s.ultimoPingMs && agora - s.ultimoPingMs < minimo) return estado(s);                           // rápido demais: ignora, não credita
      let ate = s.validoSeg || 0;
      if (s.ultimoPingMs && s.tocando) {
        const decorrido = Math.min((agora - s.ultimoPingMs) / 1000, C.TREINO_PING_MAX_SEG), avanco = posicao - (s.ultimaPosicao || 0);
        if (avanco >= 0 && avanco <= decorrido + 2 && (s.ultimaPosicao || 0) <= ate + C.HAB_FOLGA_SEG) ate = Math.min(s.duracaoSeg, ate + Math.min(avanco, Math.ceil(decorrido)));
      }
      const novo = { ...s, validoSeg: ate, ultimoPingMs: agora, tocando };
      tx.set(ref, { validoSeg: ate, ultimaPosicao: posicao, tocando, ultimoPingMs: agora, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
      return estado(novo);
    });
  }

  // ---------- 3) liberar questionário (portão duplo: timer zerado E vídeo até o fim) ----------
  async function liberarQuestionario(uid, catId) {
    catId = idCat(catId);
    const c = await carregar(catId), agora = Date.now(), ref = sesRef(uid, catId);
    return db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      if (!s) throw new Falha(409, "Inicie o treinamento primeiro.", "sessao-inexistente");
      if (s.versao !== (c.versao || 0)) throw new Falha(409, "O conteúdo foi atualizado. Reinicie o treinamento.", "conteudo-alterado");
      const montar = (quiz) => quiz.map((q) => { const p = c.perguntas.find((x) => x.id === q.id); return { id: q.id, texto: p.texto, opcoes: q.perm.map((i) => p.opcoes[i]) }; });
      if (s.status === "liberado" && (s.quizExpiraEm || 0) > agora) return { perguntas: montar(s.quiz), expiraEm: s.quizExpiraEm, validadeMs: s.quizExpiraEm - agora };     // idempotente (reabrir o app)
      if (s.status !== "assistindo") throw new Falha(409, "Reinicie o treinamento para tentar de novo.", "sessao-encerrada");
      if (agora < s.liberaEmMs) throw new Falha(409, "O tempo mínimo do treinamento ainda não terminou.", "timer-pendente", { restanteMs: s.liberaEmMs - agora });
      if (!fimOk(s)) throw new Falha(409, "Assista ao vídeo até o fim, sem pular trechos.", "video-incompleto", { validoSeg: s.validoSeg || 0, duracaoSeg: s.duracaoSeg });
      const quiz = embaralhar(c.perguntas.length).map((qi) => ({ id: c.perguntas[qi].id, perm: embaralhar(c.perguntas[qi].opcoes.length) }));
      const expira = agora + C.HAB_QUIZ_VALIDADE_MS;
      tx.set(ref, { status: "liberado", quiz, quizLiberadoMs: agora, quizExpiraEm: expira, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
      return { perguntas: montar(quiz), expiraEm: expira, validadeMs: expira - agora };
    });
  }

  // ---------- 4) corrigir (100% ou nada; uma única tentativa por sessão) ----------
  async function responder(uid, catId, respostas) {
    catId = idCat(catId);
    if (!Array.isArray(respostas) || respostas.length > C.HAB_PERGUNTAS_MAX) throw new Falha(400, "Respostas inválidas.", "dados-invalidos", { campo: "respostas" });
    const agora = Date.now(), ref = sesRef(uid, catId), pRef = profRef(uid), cRef = catRef(catId);
    return db.runTransaction(async (tx) => {
      const [sSnap, cSnap, pSnap] = await Promise.all([tx.get(ref), tx.get(cRef), tx.get(pRef)]);
      const s = sSnap.data(), c = cSnap.data(), pub = pSnap.data();
      if (!s || s.status !== "liberado" || !Array.isArray(s.quiz)) throw new Falha(409, "Não há avaliação aberta. Refaça o treinamento.", "sem-avaliacao");
      if ((s.quizExpiraEm || 0) < agora) throw new Falha(409, "O tempo da avaliação acabou. Refaça o treinamento.", "quiz-expirado");
      if (!pronta(c) || s.versao !== (c.versao || 0)) throw new Falha(409, "O conteúdo foi atualizado. Refaça o treinamento.", "conteudo-alterado");
      if (!pub) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado");
      if (respostas.length !== s.quiz.length) throw new Falha(400, "Responda todas as perguntas.", "dados-invalidos", { campo: "respostas" });
      let acertos = 0;
      s.quiz.forEach((q, i) => {
        const r = respostas[i], p = c.perguntas.find((x) => x.id === q.id);
        if (!Number.isInteger(r) || r < 0 || r >= q.perm.length) throw new Falha(400, "Resposta inválida.", "dados-invalidos", { campo: "respostas" });
        if (q.perm[r] === p.correta) acertos++;                    // r = posição exibida → q.perm[r] = posição original
      });
      const total = s.quiz.length;
      if (acertos === total) {
        const reprov = s.reprovacoes || 0;
        tx.set(pRef, { habilitacoes: { [catId]: { em: FieldValue.serverTimestamp(), tentativas: reprov + 1, elite: reprov === 0 } } }, { merge: true });
        tx.set(ref, { status: "aprovado", quiz: FieldValue.delete(), quizExpiraEm: FieldValue.delete(), concluidoEm: FieldValue.serverTimestamp() }, { merge: true });
        return { aprovado: true, acertos, total, selo: { categoria: catId, titulo: C.CATEGORIAS[catId].titulo, ico: C.CATEGORIAS[catId].ico, elite: reprov === 0 } };
      }
      tx.set(ref, { status: "reprovado", reprovacoes: (s.reprovacoes || 0) + 1, ultimoResultado: { acertos, total }, quiz: FieldValue.delete(), quizExpiraEm: FieldValue.delete(), validoSeg: 0, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
      return { aprovado: false, acertos, total, refazer: true };
    });
  }

  // ---------- administração do conteúdo ----------
  function validarCategoria(b) {
    const o = {};
    o.descricao = V.texto(b.descricao || "", "descrição", { max: 300, obrigatorio: false });
    o.provedor = V.opcao(b.provedor, ["youtube", "mp4"], "provedor");
    o.duracaoSeg = V.inteiro(b.duracaoSeg, "duracaoSeg", { min: 30, max: 7200 });
    o.videoRef = V.texto(b.videoRef, "videoRef", { min: 3, max: 300 });
    if (o.provedor === "youtube" && !/^[\w-]{11}$/.test(o.videoRef)) throw new Falha(400, "Para YouTube informe apenas o ID do vídeo (11 caracteres).", "dados-invalidos");
    if (o.provedor === "mp4" && !/^https:\/\/[^\s]+$/.test(o.videoRef)) throw new Falha(400, "Para vídeo próprio informe uma URL https.", "dados-invalidos");
    if (!Array.isArray(b.perguntas) || b.perguntas.length < C.HAB_PERGUNTAS_MIN || b.perguntas.length > C.HAB_PERGUNTAS_MAX) throw new Falha(400, `Cadastre de ${C.HAB_PERGUNTAS_MIN} a ${C.HAB_PERGUNTAS_MAX} perguntas.`, "dados-invalidos", { campo: "perguntas" });
    o.perguntas = b.perguntas.map((p, i) => {
      if (!p || typeof p !== "object" || !Array.isArray(p.opcoes) || p.opcoes.length < C.HAB_OPCOES_MIN || p.opcoes.length > C.HAB_OPCOES_MAX) throw new Falha(400, `Pergunta ${i + 1}: use de ${C.HAB_OPCOES_MIN} a ${C.HAB_OPCOES_MAX} alternativas.`, "dados-invalidos", { campo: "perguntas" });
      const opcoes = p.opcoes.map((x, k) => V.texto(x, `pergunta ${i + 1}, alternativa ${k + 1}`, { min: 1, max: 140 }));
      if (new Set(opcoes.map((x) => x.toLowerCase())).size !== opcoes.length) throw new Falha(400, `Pergunta ${i + 1}: alternativas repetidas.`, "dados-invalidos", { campo: "perguntas" });
      return { id: `q${i + 1}`, texto: V.texto(p.texto, `pergunta ${i + 1}`, { min: 5, max: 240 }), opcoes, correta: V.inteiro(p.correta, `pergunta ${i + 1}: correta`, { min: 0, max: opcoes.length - 1 }) };
    });
    o.ativo = b.ativo === undefined ? true : V.booleano(b.ativo, "ativo");
    return o;
  }
  async function salvarCategoria(catId, b) {
    catId = idCat(catId);
    const dados = validarCategoria(b || {});
    await catRef(catId).set({ ...dados, categoria: catId, titulo: C.CATEGORIAS[catId].titulo, versao: FieldValue.increment(1), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    return { id: catId };
  }
  /** Visão do admin (inclui gabarito — NUNCA exposta ao personal). */
  async function listarAdmin() {
    const snaps = await Promise.all(ids().map((i) => catRef(i).get()));
    return ids().map((id, i) => { const c = snaps[i].data() || {}; return { id, titulo: C.CATEGORIAS[id].titulo, ico: C.CATEGORIAS[id].ico, configurada: !!c.videoRef, pronta: pronta(c), ...c, atualizadoEm: undefined }; });
  }

  return { listar, iniciar, ping, liberarQuestionario, responder, salvarCategoria, listarAdmin, selosDe, exigirParaModalidade, pronta };
}
module.exports = { criarCategorias, categoriaDaModalidade };
