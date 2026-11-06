// Mapa de personais ONLINE para o aluno (painel do aluno, tela inicial).
//   GET /personais/online → só personais aprovados (status "ativo") com ping de presença nos últimos 75 s, dentro do raio, perto do aluno.
//
// PRIVACIDADE (regra de ouro): a posição do personal é arredondada para uma grade de ~300 m na ENTRADA (lib/ti/presenca.js) e a distância
// devolvida é calculada a partir do ponto JÁ arredondado — assim nem a distância permite "triangular" o ponto exato. A resposta é montada campo
// a campo (lista branca): nunca CPF, nascimento, telefone, Pix, CREF, e-mail nem qualquer outro campo do cadastro. O ponto de referência do
// aluno é o salvo no perfil dele (servidor), não um valor enviado pela requisição.
module.exports = (app, x) => {
  const { db, auth, G, C, envelope, limitar, ti } = x;
  const M = C.MAPA;
  const https = (u) => (typeof u === "string" && u.startsWith("https://") ? u.slice(0, 300) : "");

  /** Visão PÚBLICA do personal para o aluno. Qualquer campo novo precisa ser adicionado aqui de propósito. */
  const visaoPublica = (uid, d, p, km) => ({
    id: uid,
    nome: String(d.nome || "Personal").slice(0, 100),
    foto: https(d.fotoGoogle),
    ratingMedia: Number.isFinite(d.ratingMedia) ? d.ratingMedia : null,
    ratingQtd: Number.isInteger(d.ratingQtd) ? d.ratingQtd : 0,
    modalidades: d.especialidade ? [String(d.especialidade).slice(0, 60)] : [],
    lat: p.lat, lng: p.lng,                                      // já arredondados (≈300 m)
    distanciaKm: Math.round(km * 10) / 10
  });

  app.get("/personais/online", auth.exigir("aluno"), limitar({ janelaMs: 60_000, max: 12, nome: "personais-online", porUsuario: true }), envelope(async (req, res) => {
    const agora = new Date().toISOString();
    const l = ((await db.collection("alunos").doc(req.usuario.uid).get()).data() || {}).localizacao;
    if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) return res.json({ semLocalizacao: true, raioKm: M.RAIO_KM, total: 0, personais: [], atualizadoEm: agora });
    const origem = { lat: l.lat, lng: l.lng };
    const perto = (await ti.presenca.posicoesPersonais())
      .map((p) => ({ ...p, km: G.distanciaM(origem, p) / 1000 }))
      .filter((p) => p.km <= M.RAIO_KM)
      .sort((a, b) => a.km - b.km).slice(0, M.MAX_PONTOS * 2);
    const docs = await Promise.all(perto.map((p) => db.collection("personais").doc(p.uid).get()));
    const personais = [];
    perto.forEach((p, i) => { const d = docs[i].data(); if (d && d.status === "ativo" && personais.length < M.MAX_PONTOS) personais.push(visaoPublica(p.uid, d, p, p.km)); });
    res.json({ semLocalizacao: false, raioKm: M.RAIO_KM, total: personais.length, personais, atualizadoEm: agora });
  }));
};
