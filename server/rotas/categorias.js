// Habilitação por categoria (personal): vídeo com timer + questionário 100%. A lógica vive em lib/categorias.js.
module.exports = (app, x) => {
  const { auth, envelope, limitar, categorias } = x;
  const porUsuario = (nome, max, janelaMs = 60_000) => limitar({ janelaMs, max, nome, porUsuario: true });
  const uid = (req) => req.usuario.uid;

  app.get("/habilitacoes", porUsuario("hab-lista", 60), auth.exigir("personal"), envelope(async (req, res) => res.json(await categorias.listar(uid(req)))));
  app.post("/habilitacoes/iniciar", porUsuario("hab-iniciar", 20), auth.exigir("personal"), envelope(async (req, res) => res.json(await categorias.iniciar(uid(req), req.body?.categoria))));
  app.post("/habilitacoes/ping", porUsuario("hab-ping", 40), auth.exigir("personal"), envelope(async (req, res) => {
    const b = req.body || {};
    res.json(await categorias.ping(uid(req), { categoria: b.categoria, posicaoSeg: b.posicaoSeg, tocando: b.tocando, evento: b.evento }));
  }));
  app.post("/habilitacoes/questionario", porUsuario("hab-quiz", 20), auth.exigir("personal"), envelope(async (req, res) => res.json(await categorias.liberarQuestionario(uid(req), req.body?.categoria))));
  app.post("/habilitacoes/responder", porUsuario("hab-resp", 20), auth.exigir("personal"), envelope(async (req, res) => res.json(await categorias.responder(uid(req), req.body?.categoria, req.body?.respostas))));
};
