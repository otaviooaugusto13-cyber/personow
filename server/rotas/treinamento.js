// Treinamento obrigatório Personow (personal) — o progresso é validado no servidor.
module.exports = (app, x) => {
  const { auth, envelope, limitar, treinamento, V } = x;
  app.get("/treinamento", auth.exigir("personal"), envelope(async (req, res) => {
    const est = await treinamento.estado(req.usuario.uid);
    const sync = await treinamento.sincronizar(req.usuario.uid, est.completo, req.usuario);   // mantém flag/claim coerentes
    res.json({ ...est, atualizarToken: sync.claimAtualizada });
  }));
  // Prova do módulo: as perguntas saem SEM a resposta certa; a correção é feita aqui.
  app.get("/treinamento/modulos/:id/prova", limitar({ janelaMs: 60_000, max: 30, nome: "prova-ver", porUsuario: true }), auth.exigir("personal"), envelope(async (req, res) => {
    res.json(await treinamento.perguntas(req.usuario.uid, req.params.id));
  }));
  app.post("/treinamento/modulos/:id/prova", limitar({ janelaMs: 3_600_000, max: 12, nome: "prova", porUsuario: true }), auth.exigir("personal"), envelope(async (req, res) => {
    res.json(await treinamento.responder(req.usuario.uid, req.params.id, req.body?.respostas, req.usuario));
  }));
  app.post("/treinamento/ping", limitar({ janelaMs: 60_000, max: 20, nome: "ping", porUsuario: true }), auth.exigir("personal"), envelope(async (req, res) => {
    const b = req.body || {};
    res.json(await treinamento.ping(req.usuario.uid, { moduloId: b.moduloId, posicaoSeg: b.posicaoSeg, tocando: b.tocando }, req.usuario));
  }));
};
