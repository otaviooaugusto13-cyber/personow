// Execução da aula: CHECK-IN por geofencing (≤ 100 m do aluno) e CHECK-OUT com foto do local da aula.
//
//   aceita ──check-in (GPS no raio, na janela)──▶ fase "em_andamento" ──check-out (foto)──▶ fase "executada" ──pagamento──▶ paga
//
// Tudo é decidido aqui: o navegador envia a leitura de GPS e a foto; o servidor calcula distância, janela, permanência e integridade.
// A foto fica no Firestore (fotos_checkout/{aula}) e só é entregue por esta API, a quem tem direito (aluno dona, personal, admin, parceiro).
const Img = require("../lib/imagem");

module.exports = (app, x) => {
  const { db, express, FieldValue, Timestamp, auth, V, C, G, Falha, envelope, limitar, reputacao, MODO_TESTE } = x;
  const porUsuario = (nome, max, janelaMs = 60_000) => limitar({ janelaMs, max, nome, porUsuario: true });
  const ehTeste = (u) => MODO_TESTE && u.teste === true && C.CONTAS_TESTE.includes(u.uid);
  const MIN = 60_000, ts = () => FieldValue.serverTimestamp();
  const ms = (t) => (t?.toMillis ? t.toMillis() : 0);
  const hhmm = (m) => V.horaSP(m);
  const jsonFoto = express.json({ limit: C.BODY_FOTO_LIMITE });

  /** Registro imutável de cada tentativa (inclusive as negadas): base da "presença auditada por GPS". */
  const logPresenca = (dados) => db.collection("presencas").doc(dados.id || undefined).set({ ...dados, id: undefined, em: ts() }).catch((e) => console.error("presenca", e.message));

  // ---------- janela do check-in ----------
  function janelaCheckin(s) {
    const inicio = V.instanteSP(s.data, s.entrada);
    return { abre: inicio - C.GEO.CHECKIN_ANTES_MIN * MIN, fecha: inicio + C.GEO.CHECKIN_ATE_MIN * MIN, inicio };
  }
  /** Regras de estado da aula para check-in (sem GPS). Lança Falha. */
  function exigirPodeCheckin(s, uid, teste, agora) {
    if (!s || s.personalUid !== uid) throw new Falha(404, "Aula não encontrado.", "nao-encontrado");
    if (s.status !== "aceita") throw new Falha(409, "Este aula não está aceito.", "estado-invalido");
    if (s.fase) throw new Falha(409, s.fase === "executada" ? "Este serviço já foi finalizado." : "Você já fez check-in nesta aula.", "checkin-ja-feito");
    if (!s.local || !Number.isFinite(s.local.lat)) throw new Falha(409, "O aluno ainda não tem localização cadastrada. Fale com o suporte.", "aluno-sem-localizacao");
    if (teste) return;
    const j = janelaCheckin(s);
    if (agora < j.abre) throw new Falha(409, `O check-in abre às ${hhmm(j.abre)} (${C.GEO.CHECKIN_ANTES_MIN} min antes do início).`, "checkin-cedo", { abreEm: new Date(j.abre).toISOString() });
    if (agora > j.fecha) throw new Falha(409, "O prazo de check-in desta aula terminou.", "checkin-expirado", { fechouEm: new Date(j.fecha).toISOString() });
  }

  // ---------- CHECK-IN ----------
  app.post("/checkin", porUsuario("checkin", 15), auth.exigir("personal"), envelope(async (req, res) => {
    const u = req.usuario, sid = V.idDoc(req.body?.aulaId, "aulaId"), fix = G.lerFix(req.body), teste = ehTeste(u), sRef = db.collection("aulas").doc(sid);
    const agora = Date.now(), pre = (await sRef.get()).data();
    exigirPodeCheckin(pre, u.uid, teste, agora);
    const av = teste ? { ok: true, distanciaM: Math.ceil(G.distanciaM(fix, pre.local)), raioM: pre.raioM || C.GEO.RAIO_METROS, precisaoM: fix.precisaoM } : G.avaliarPresenca({ fix, local: pre.local, raioM: pre.raioM || C.GEO.RAIO_METROS });
    const base = { aulaId: sid, personalUid: u.uid, alunoUid: pre.uid, parceiroId: pre.parceiroId || null, lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM, distanciaM: av.distanciaM, raioM: av.raioM, simulado: teste };
    if (!av.ok) {                                                                         // tentativa negada: fica registrada
      await logPresenca({ ...base, tipo: "checkin_negado", ok: false, motivo: av.codigo });
      await sRef.set({ checkinNegados: FieldValue.increment(1) }, { merge: true }).catch(() => {});
      throw new Falha(409, av.mensagem, av.codigo, { distanciaM: av.distanciaM, raioM: av.raioM, precisaoM: av.precisaoM });
    }
    await db.runTransaction(async (tx) => {
      const s = (await tx.get(sRef)).data();
      exigirPodeCheckin(s, u.uid, teste, Date.now());
      tx.update(sRef, { fase: "em_andamento", checkinEm: Timestamp.now(), checkinAtrasoMin: Math.max(0, Math.round((Date.now() - janelaCheckin(s).inicio) / MIN)), checkin: { em: Timestamp.now(), lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM, distanciaM: av.distanciaM, noRaio: true, simulado: teste } });
      tx.set(db.collection("presencas").doc(`${sid}_in`), { ...base, tipo: "checkin", ok: true, em: ts() });
    });
    res.json({ ok: true, distanciaM: av.distanciaM, raioM: av.raioM });
  }));

  // ---------- CHECK-OUT (foto obrigatória) ----------
  app.post("/checkout", jsonFoto, porUsuario("checkout", 10), auth.exigir("personal"), envelope(async (req, res) => {
    const u = req.usuario, b = req.body || {}, sid = V.idDoc(b.aulaId, "aulaId"), teste = ehTeste(u);
    const conclusao = V.opcao(b.conclusao, C.CONCLUSAO, "como foi a aula"), observacao = V.texto(b.observacao || "", "observação", { max: 300, obrigatorio: false });
    // 1) a foto: JPEG íntegro, dimensões mínimas e foto nunca usada antes (anti-reaproveitamento)
    const img = Img.jpegDeDataUrl(b.foto, "foto", { min: C.FOTO.MIN_BYTES, max: C.FOTO.MAX_BYTES });
    const mini = Img.jpegDeDataUrl(b.miniatura, "miniatura", { min: 300, max: C.FOTO.MINIATURA_MAX_BYTES });
    const dim = Img.dimensoesJpeg(img);
    if (Math.min(dim.largura, dim.altura) < C.FOTO.LADO_MIN || Math.max(dim.largura, dim.altura) > C.FOTO.LADO_MAX) throw new Falha(400, `A foto precisa ter pelo menos ${C.FOTO.LADO_MIN}px no menor lado.`, "foto-invalida");
    const hash = Img.sha256(img);
    const dup = await db.collection("fotos_checkout").where("sha256", "==", hash).limit(2).get();
    if (dup.docs.some((d) => d.id !== sid)) throw new Falha(409, "Esta foto já foi usada em outro serviço. Tire uma foto nova do local.", "foto-repetida");
    // 2) GPS do check-out (opcional: registrado para auditoria, não bloqueia)
    let fix = null; try { if (b.lat !== undefined) fix = G.lerFix(b); } catch { fix = null; }
    await reputacao.garantir(u.uid, "personal");

    const sRef = db.collection("aulas").doc(sid), fotoRef = db.collection("fotos_checkout").doc(sid);
    const r = await db.runTransaction(async (tx) => {
      const [sS, repS] = await Promise.all([tx.get(sRef), tx.get(db.collection("reputacao").doc(u.uid))]);
      const s = sS.data(), agora = Date.now();
      if (!s || s.personalUid !== u.uid) throw new Falha(404, "Aula não encontrado.", "nao-encontrado");
      if (s.status !== "aceita") throw new Falha(409, "Este aula não está aceito.", "estado-invalido");
      if (s.fase === "executada") throw new Falha(409, "Este serviço já foi finalizado.", "checkout-ja-feito");
      if (s.fase !== "em_andamento" || !s.checkin?.em) throw new Falha(409, "Faça o check-in no local antes de finalizar o serviço.", "checkin-pendente");
      const noLocalMs = agora - ms(s.checkin.em);
      const exigidoMin = s.tipo === "relampago" ? C.GEO.PERMANENCIA_MIN_RELAMPAGO_MIN : Math.ceil(((s.minutos || 0) * C.GEO.PERMANENCIA_MIN_PCT) / 100);
      if (!teste && noLocalMs < exigidoMin * MIN) throw new Falha(409, `Finalize depois de ${exigidoMin} min no local (faltam ${Math.ceil((exigidoMin * MIN - noLocalMs) / MIN)} min).`, "permanencia-minima", { faltamMin: Math.ceil((exigidoMin * MIN - noLocalMs) / MIN), exigidoMin });
      const dist = fix && s.local ? Math.ceil(G.distanciaM(fix, s.local)) : null;
      const minutosNoLocal = Math.round(noLocalMs / MIN);
      tx.set(fotoRef, { aulaId: sid, personalUid: u.uid, alunoUid: s.uid, parceiroId: s.parceiroId || null, regiao: s.regiao || null, bytes: img.length, sha256: hash, mime: "image/jpeg", largura: dim.largura, altura: dim.altura,
        imagem: img.toString("base64"), miniatura: mini.toString("base64"), conclusao, observacao, ...(fix ? { lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM } : {}), criadoEm: ts() });
      const divergencias = [];   // campos legados (v2) que o painel admin usa para acompanhar atraso e saída antecipada
      if ((s.checkinAtrasoMin || 0) > 15) divergencias.push("atraso");
      if (minutosNoLocal < Math.floor((s.minutos || 0) * 0.8)) divergencias.push("saida-antecipada");
      tx.update(sRef, { fase: "executada", executadaEm: ts(), checkoutEm: Timestamp.now(), trabalhadoMin: minutosNoLocal, divergencias, fotoId: sid,
        checkout: { em: Timestamp.now(), conclusao, observacao, minutosNoLocal, fotoSha256: hash, ...(fix ? { lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM, distanciaM: dist, noRaio: dist !== null && dist <= (s.raioM || C.GEO.RAIO_METROS) } : { semGps: true }), simulado: teste } });
      tx.set(db.collection("presencas").doc(`${sid}_out`), { aulaId: sid, tipo: "checkout", personalUid: u.uid, alunoUid: s.uid, parceiroId: s.parceiroId || null, ok: true, simulado: teste, minutosNoLocal, conclusao, ...(fix ? { lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM, distanciaM: dist } : {}), em: ts() });
      const nivel = reputacao.concluirChamadoTx(tx, u.uid, repS.data());                 // +1 chamado concluído (possível subida de nível)
      return { nivel, minutosNoLocal };
    });
    res.json({ ok: true, minutosNoLocal: r.minutosNoLocal, nivel: r.nivel });
  }));

  // ---------- Aluno ausente (personal no local, serviço não realizado) ----------
  app.post("/reportarFaltaAluno", porUsuario("faltaaluno", 6, 3600_000), auth.exigir("personal"), envelope(async (req, res) => {
    const u = req.usuario, sid = V.idDoc(req.body?.aulaId, "aulaId"), motivo = V.texto(req.body?.motivo, "motivo", { min: 5, max: 200 }), sRef = db.collection("aulas").doc(sid);
    const s = await db.runTransaction(async (tx) => {
      const o = (await tx.get(sRef)).data();
      if (!o || o.personalUid !== u.uid) throw new Falha(404, "Aula não encontrado.", "nao-encontrado");
      if (o.status !== "aceita" || o.fase !== "em_andamento" || !o.checkin?.em) throw new Falha(409, "Só é possível reportar o aluno depois do check-in e antes do check-out.", "estado-invalido");
      const espera = Date.now() - ms(o.checkin.em);
      if (!ehTeste(u) && espera < C.GEO.FALTA_ALUNO_APOS_MIN * MIN) throw new Falha(409, `Aguarde ${C.GEO.FALTA_ALUNO_APOS_MIN} min após o check-in antes de reportar o aluno (faltam ${Math.ceil((C.GEO.FALTA_ALUNO_APOS_MIN * MIN - espera) / MIN)} min).`, "aguarde");
      tx.update(sRef, { status: "cancelada", motivoCancelamento: "falta_aluno", canceladoPor: "personal", canceladoEm: ts(), faltaAluno: { motivo, em: Timestamp.now() } });
      return o;
    });
    const infracao = await reputacao.aplicarInfracao({ uid: s.uid, papel: "aluno", tipo: "falta_aluno", aulaId: sid, origem: "reportado_personal", chave: String(ms(s.aceitoEm)), detalhe: `${s.aluno} · ${s.data} ${s.horario || ""} · ${motivo}`.slice(0, 300) });
    await auth.auditar(req, "execucao.falta_aluno", sid, { motivo });
    res.json({ ok: true, infracaoId: infracao.id || null });
  }));

  // ---------- Auditoria da foto pelo aluno ----------
  app.post("/auditarFoto", porUsuario("auditar", 20), auth.exigir("aluno"), envelope(async (req, res) => {
    const sid = V.idDoc(req.body?.aulaId, "aulaId"), resultado = V.opcao(req.body?.resultado, ["aprovada", "contestada"], "resultado");
    const comentario = V.texto(req.body?.comentario || "", "comentário", { max: 300, obrigatorio: resultado === "contestada" ? true : false, min: resultado === "contestada" ? 5 : 0 });
    const ref = db.collection("aulas").doc(sid);
    await db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      if (!s || s.uid !== req.usuario.uid) throw new Falha(404, "Aula não encontrado.", "nao-encontrado");
      if (s.fase !== "executada") throw new Falha(409, "O serviço ainda não foi finalizado pelo personal.", "estado-invalido");
      if (s.auditoriaAluno) throw new Falha(409, "Você já avaliou esta foto.", "ja-auditado");
      tx.update(ref, { auditoriaAluno: { resultado, comentario, em: Timestamp.now() } });
    });
    res.json({ ok: true });
  }));

  // ---------- Entrega da foto (autorizada: aluno dona, personal da aula, admin) ----------
  app.get("/execucao/foto/:id", porUsuario("foto", 60), auth.exigir("aluno", "personal", "admin"), envelope(async (req, res) => {
    const id = V.idDoc(req.params.id, "id"), u = req.usuario, f = (await db.collection("fotos_checkout").doc(id).get()).data();
    const permitido = f && (u.role === "admin" || (u.role === "aluno" && f.alunoUid === u.uid) || (u.role === "personal" && f.personalUid === u.uid));
    if (!permitido) throw new Falha(404, "Foto não encontrada.", "nao-encontrado");
    res.setHeader("Content-Type", "image/jpeg"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(req.query.miniatura === "1" ? f.miniatura : f.imagem, "base64"));
  }));

  // ---------- Localização do aluno (ponto do geofence) ----------
  app.post("/aluno/localizacao", porUsuario("localizacao", 20), auth.exigir("aluno"), envelope(async (req, res) => {
    const b = req.body || {}, c = G.coordenadas(b, "aluno"), reg = x.regiaoValida(b), fonte = V.opcao(b.fonte || "gps", ["gps", "manual"], "fonte");
    const precisao = Number.isFinite(b.precisao) && b.precisao >= 0 ? Math.round(b.precisao) : null;
    const localizacao = { ...c, ...reg, fonte, precisaoM: precisao, definidaEm: Timestamp.now() };
    await db.collection("alunos").doc(req.usuario.uid).set({ localizacao }, { merge: true });
    await auth.auditar(req, "aluno.localizacao", req.usuario.uid, { fonte, ...c });
    res.json({ ok: true, localizacao: { ...c, ...reg, fonte, precisaoM: precisao } });
  }));
};
