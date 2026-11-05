// Formação do personal (OPCIONAL — não bloqueia aceitar aulas). Concluir todos os módulos dá o selo "Formado Personow" e peso no ranking.
//   GET  /formacao                       catálogo + progresso (sem gabarito)
//   POST /formacao/modulos/:id/prova     { respostas: [índices] } → nota; ≥ 70% aprova. A correção é feita AQUI.
const { MODULOS, NOTA_MINIMA } = require("../lib/formacao-conteudo");
module.exports = (app, x) => {
  const { db, auth, V, Falha, envelope, limitar, FieldValue } = x;
  const L = [limitar({ janelaMs: 60_000, max: 40, nome: "formacao" }), auth.exigir("personal")];
  const progresso = async (uid) => (await db.collection("formacao").doc(uid).get()).data()?.modulos || {};

  app.get("/formacao", ...L, envelope(async (req, res) => {
    const prog = await progresso(req.usuario.uid), feitos = MODULOS.filter((m) => prog[m.id]?.aprovado).length;
    res.json({
      notaMinima: NOTA_MINIMA, concluidos: feitos, total: MODULOS.length, formado: feitos === MODULOS.length,
      modulos: MODULOS.map((m) => ({ id: m.id, titulo: m.titulo, minutos: m.minutos, resumo: m.resumo, conteudo: m.conteudo, perguntas: m.perguntas.map((q) => ({ p: q.p, o: q.o })), aprovado: !!prog[m.id]?.aprovado, nota: prog[m.id]?.nota ?? null }))
    });
  }));

  app.post("/formacao/modulos/:id/prova", ...L, envelope(async (req, res) => {
    const m = MODULOS.find((v) => v.id === req.params.id); if (!m) throw new Falha(404, "Módulo não encontrado.", "nao-encontrado");
    const r = req.body?.respostas;
    if (!Array.isArray(r) || r.length !== m.perguntas.length || r.some((i) => !Number.isInteger(i) || i < 0 || i > 3)) throw new Falha(400, "Responda todas as perguntas.", "dados-invalidos");
    const uid = req.usuario.uid, acertos = m.perguntas.filter((q, i) => q.certa === r[i]).length, nota = Math.round((acertos / m.perguntas.length) * 100), aprovado = nota >= NOTA_MINIMA;
    const prog = await progresso(uid), anterior = prog[m.id];
    prog[m.id] = { aprovado: aprovado || !!anterior?.aprovado, nota: Math.max(nota, anterior?.nota ?? 0), tentativas: (anterior?.tentativas || 0) + 1, em: new Date().toISOString() };
    const formado = MODULOS.every((v) => prog[v.id]?.aprovado);
    await db.collection("formacao").doc(uid).set({ uid, modulos: prog, formado, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    if (formado) {
      await db.collection("personais").doc(uid).set({ formacaoOk: true, formacaoEm: FieldValue.serverTimestamp() }, { merge: true });
      await auth.definirPapel(uid, "personal", { treinado: true });
    }
    res.json({ nota, aprovado, acertos, total: m.perguntas.length, formado, atualizarToken: formado });
  }));
};
