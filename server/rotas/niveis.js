// Níveis, conquistas e advertências ("gamificação" do Abastece, adaptada ao treino).
//   GET  /niveis/eu                        papel ativo: personal → nível pelo nº de aulas concluídas, progresso, advertências;
//                                          aluno → aulas feitas, sequência semanal e conquistas
//   POST /admin/personais/:uid/advertencia admin: +1 advertência (motivo obrigatório); na 3ª o personal é bloqueado e a sessão cai
// Aula concluída = status "paga" ou "concluida". Nível/contagem são gravados no doc do personal SÓ pelo servidor (as regras do Firestore
// não deixam o navegador escrever esses campos), para o aluno ver o selo no perfil público.
const MAX_ADVERTENCIAS = 3;
module.exports = (app, x) => {
  const { db, admin, auth, V, Falha, envelope, limitar, FieldValue, estaPaga } = x;
  const L = [limitar({ janelaMs: 60_000, max: 60, nome: "niveis" }), auth.exigir("aluno", "personal")];

  const semanaIso = (ymd) => { const d = new Date(ymd + "T12:00:00Z"); const dia = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dia); return d.toISOString().slice(0, 10); };
  /** Semanas seguidas (terminando na atual ou na anterior) com pelo menos uma aula. */
  function sequenciaSemanal(datas, hoje) {
    const set = new Set(datas.map(semanaIso)); let cur = semanaIso(hoje);
    if (!set.has(cur)) { const d = new Date(cur + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 7); cur = d.toISOString().slice(0, 10); }
    let n = 0;
    while (set.has(cur)) { n++; const d = new Date(cur + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 7); cur = d.toISOString().slice(0, 10); }
    return n;
  }
  const conquistas = (aulas, seq, focos) => [
    { id: "primeira", titulo: "Primeira aula", icone: "🎯", ok: aulas >= 1 }, { id: "cinco", titulo: "5 aulas", icone: "💪", ok: aulas >= 5 },
    { id: "dez", titulo: "10 aulas", icone: "🔥", ok: aulas >= 10 }, { id: "vinte5", titulo: "25 aulas", icone: "🏆", ok: aulas >= 25 },
    { id: "seq4", titulo: "4 semanas seguidas", icone: "📅", ok: seq >= 4 }, { id: "variado", titulo: "3 focos diferentes", icone: "🤸", ok: focos >= 3 }
  ];

  app.get("/niveis/eu", ...L, envelope(async (req, res) => {
    const u = req.usuario, personal = u.role === "personal";
    const snap = await db.collection("aulas").where(personal ? "personalUid" : "alunoUid", "==", u.uid).get();
    const feitas = snap.docs.map((d) => d.data()).filter(estaPaga);
    const seq = sequenciaSemanal(feitas.map((a) => a.data).filter(Boolean), V.hojeSP()), focos = new Set(feitas.map((a) => a.foco)).size;
    if (!personal) return res.json({ papel: "aluno", aulas: feitas.length, sequenciaSemanas: seq, conquistas: conquistas(feitas.length, seq, focos) });
    const t = await x.taxas.ler(), nivel = x.taxas.nivelPorAulas(t.niveis, feitas.length);
    const prox = t.niveis.find((n) => n.minAulas > feitas.length) || null;
    const ref = db.collection("personais").doc(u.uid), p = (await ref.get()).data() || {};
    if (p.nivelId !== nivel.id || p.aulasConcluidas !== feitas.length) await ref.set({ nivelId: nivel.id, aulasConcluidas: feitas.length }, { merge: true });
    res.json({
      papel: "personal", aulas: feitas.length, sequenciaSemanas: seq, nivel, proximo: prox, faltam: prox ? prox.minAulas - feitas.length : 0,
      progressoPct: prox ? Math.round(((feitas.length - nivel.minAulas) / (prox.minAulas - nivel.minAulas)) * 100) : 100,
      niveis: t.niveis, comissaoPorNivel: t.comissaoPorNivel, advertencias: p.advertencias || 0, maxAdvertencias: MAX_ADVERTENCIAS,
      conquistas: conquistas(feitas.length, seq, focos), formacaoOk: p.formacaoOk === true
    });
  }));

  app.post("/admin/personais/:uid/advertencia", limitar({ janelaMs: 60_000, max: 30, nome: "advertencia" }), auth.exigir("admin"), envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), motivo = V.texto(req.body?.motivo, "motivo", { min: 5, max: 300 });
    const ref = db.collection("personais").doc(uid), p = (await ref.get()).data();
    if (!p) throw new Falha(404, "Personal não encontrado.", "nao-encontrado");
    const total = (p.advertencias || 0) + 1, bloquear = total >= MAX_ADVERTENCIAS;
    await ref.set({
      advertencias: total, recado: { texto: bloquear ? `Conta bloqueada por ${MAX_ADVERTENCIAS} advertências. Último motivo: ${motivo}` : `Advertência ${total}/${MAX_ADVERTENCIAS}: ${motivo}`, tipo: bloquear ? "bloqueado" : "advertencia", por: "suporte", em: FieldValue.serverTimestamp() },
      ...(bloquear ? { status: "bloqueado", statusAtualizadoEm: FieldValue.serverTimestamp() } : {})
    }, { merge: true });
    if (bloquear) await admin.auth().revokeRefreshTokens(uid).catch(() => {});
    await auth.auditar(req, "admin.personal.advertencia", uid, { total, bloqueado: bloquear, motivo });
    res.json({ ok: true, advertencias: total, bloqueado: bloquear });
  }));
};
