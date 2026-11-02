// Taxas da plataforma e regras de aula, editáveis pelo admin SEM deploy.
//   GET /config/taxas   público  → o app (aluno/personal/login/termos) busca os valores vigentes
//   GET /admin/taxas    admin    → valores vigentes + metadados (versão, quem alterou, quando) e limites aceitos
//   PUT /admin/taxas    admin    → valida, grava em configuracoes/taxas, audita (antes/depois) e vale NA HORA
module.exports = (app, x) => {
  const { auth, S, Falha, envelope, limitar, taxas } = x;
  const ADM = [limitar({ janelaMs: 60_000, max: 120, nome: "admin", porUsuario: true }), auth.exigir("admin")];

  app.get("/config/taxas", limitar({ janelaMs: 60_000, max: 120, nome: "taxas-publicas" }), envelope(async (req, res) => {
    res.json(taxas.visaoPublica(await taxas.obter()));
  }));

  app.get("/admin/taxas", ...ADM, envelope(async (req, res) => {
    res.json({ ...(await taxas.obter()), limites: S.LIMITES, padrao: S.PADRAO });
  }));

  app.put("/admin/taxas", limitar({ janelaMs: 3600_000, max: 30, nome: "taxas-salvar", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);                                      // mexe em dinheiro: exige login recente, como estorno e saque
    const corpo = req.body || {};
    const { erro, cfg } = S.validarTaxas(corpo);
    if (erro) throw new Falha(400, erro, "taxas-invalidas");
    const versaoEsperada = corpo.versao === undefined ? undefined : Number(corpo.versao);
    if (versaoEsperada !== undefined && !Number.isInteger(versaoEsperada)) throw new Falha(400, "Versão inválida.", "taxas-invalidas");

    const { antes, depois } = await taxas.salvar(cfg, { ator: req.usuario.uid, versaoEsperada });
    const campos = (t) => t && Object.fromEntries(Object.keys(cfg).map((k) => [k, t[k]]));
    await auth.auditar(req, "admin.taxas.salvar", `v${depois.versao}`, { antes: campos(antes), depois: campos(depois) });
    res.json({ ok: true, ...depois, limites: S.LIMITES, padrao: S.PADRAO });
  }));
};
