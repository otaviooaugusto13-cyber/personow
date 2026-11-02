// Habilitação para aceitar aulas: TODAS as travas num lugar só, avaliadas no servidor a cada aceite.
//   1) cadastro aprovado pela equipe (status "ativo")
//   2) maioridade verificada (≥ 18) a partir da data de nascimento cifrada
//   3) registro no CREF informado (o admin o confere no CONFEF antes de aprovar)
//   4) capacitação Personow 100% concluída
//   5) habilitação (vídeo + questionário 100%) na CATEGORIA da modalidade da aula
const { Falha } = require("./erros");
const C = require("./config");
const V = require("./validacao");
const Cripto = require("./cripto");

function criarHabilitacao({ db, treinamento, categorias }) {
  /** Lê o perfil completo do personal (público + privado decifrado) — uso interno do servidor. */
  async function perfil(uid) {
    const [pub, priv] = await Promise.all([db.collection("personais").doc(uid).get(), db.collection("personais_privado").doc(uid).get()]);
    const p = pub.data() || null, x = priv.data() || {};
    let nascimento = null;
    try { nascimento = x.nascimentoEnc ? Cripto.decifrar(x.nascimentoEnc, `personais_privado/nascimento/${uid}`) : null; } catch { nascimento = null; }
    return { pub: p, priv: x, nascimento };
  }

  /** Lança Falha se o personal NÃO puder aceitar a aula `s`. Retorna { idade }. */
  async function exigirPodeAceitar(uid, s) {
    const { pub, nascimento } = await perfil(uid);
    if (!pub || pub.status !== "ativo") throw new Falha(403, "Seu cadastro ainda não foi aprovado.", "personal-inativo");
    if (!nascimento || !V.dataIsoValida(nascimento)) throw new Falha(403, "Informe sua data de nascimento para continuar.", "idade-nao-verificada");
    const ref = s?.data && V.dataIsoValida(s.data) ? s.data : V.hojeSP();
    const idade = V.calcularIdade(nascimento, ref);
    if (idade < C.IDADE_MINIMA) throw new Falha(403, `É preciso ter pelo menos ${C.IDADE_MINIMA} anos.`, "idade-minima");
    if (!pub.cref) throw new Falha(403, "Informe o número do seu registro no CREF para continuar.", "cref-pendente");
    if (!(await treinamento.completo(uid))) throw new Falha(403, "Conclua o treinamento obrigatório Personow para aceitar aulas.", "treinamento-pendente");
    if (s) categorias.exigirParaModalidade(pub, s.foco);     // por último: só aceita aula das categorias em que está habilitado (vídeo + questionário 100%)
    return { idade };
  }

  /** Resumo (sem dados sensíveis) para a UI do próprio personal. */
  async function situacao(uid) {
    const { pub, nascimento } = await perfil(uid);
    const idade = nascimento && V.dataIsoValida(nascimento) ? V.calcularIdade(nascimento) : null;
    const t = await treinamento.estado(uid);
    const pendencias = [];
    if (!pub || pub.status !== "ativo") pendencias.push("aprovacao");
    if (idade === null) pendencias.push("nascimento"); else if (idade < C.IDADE_MINIMA) pendencias.push("idade-minima");
    if (!pub?.cref) pendencias.push("cref");
    if (!t.completo) pendencias.push("treinamento");
    return { habilitado: pendencias.length === 0, pendencias, status: pub?.status || "inexistente", categorias: Object.keys(pub?.habilitacoes || {}), treinamento: { concluidos: t.concluidos, total: t.total, completo: t.completo } };
  }
  /**
   * Quem já usa este CPF (outro uid)? Registros ÓRFÃOS (existe o privado, mas o perfil `personais/{uid}` não) NÃO contam:
   * eram o que travava o cadastro de quem teve o perfil removido. Devolve { uid, email } ou null.
   */
  async function cpfEmUso(cpfDigitos, uidIgnorar = "") {
    const s = await db.collection("personais_privado").where("cpfIdx", "==", Cripto.indiceCego(cpfDigitos)).limit(10).get();
    for (const d of s.docs) {
      if (d.id === uidIgnorar) continue;
      if (!(await db.collection("personais").doc(d.id).get()).exists) continue;
      const email = (await db.collection("usuarios").doc(d.id).get()).data()?.email || "";
      return { uid: d.id, email };
    }
    return null;
  }
  return { perfil, exigirPodeAceitar, situacao, cpfEmUso };
}
module.exports = { criarHabilitacao };
