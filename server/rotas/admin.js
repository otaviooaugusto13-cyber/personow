// Painel administrativo (papel "admin" = custom claim assinada, concedida só por scripts/definir-admin.cjs).
// Toda leitura de dado pessoal e toda ação são auditadas. Substitui a aprovação "no console do Firestore".
const { paraCSV, dinheiro, dataBR } = require("../lib/csv");

module.exports = (app, x) => {
  const { db, admin, FieldValue, auth, V, C, R, Cripto, Falha, envelope, limitar } = x;
  const ADM = [limitar({ janelaMs: 60_000, max: 120, nome: "admin" }), auth.exigirAdmin];
  const iso = (ts) => { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toISOString() : null; };
  const tentar = (fn) => { try { return fn(); } catch { return null; } };
  const STATUS = ["pendente", "ativo", "bloqueado"];
  const limite = (q, padrao = 100, max = 500) => Math.max(1, Math.min(max, Number.parseInt(q, 10) || padrao));
  const doPriv = (p, campo, uid) => (p[`${campo}Enc`] ? tentar(() => Cripto.decifrar(p[`${campo}Enc`], `personais_privado/${campo}/${uid}`)) : p[campo] ?? null);

  app.get("/admin/eu", ...ADM, envelope(async (req, res) => res.json({ ok: true, uid: req.usuario.uid, email: req.usuario.email || "" })));

  // ---------- Personais: fila de aprovação ----------
  app.get("/admin/personais", ...ADM, envelope(async (req, res) => {
    const status = V.opcao(req.query.status || "pendente", STATUS, "status");
    const s = await db.collection("personais").where("status", "==", status).limit(limite(req.query.limite, 200)).get();
    const lista = s.docs.map((d) => { const p = d.data(); return { uid: d.id, nome: p.nome || "", cref: p.cref || "", cidade: p.cidade || "", status: p.status, mpConectado: !!p.mpConectado, ratingMedia: p.ratingMedia || null, ratingQtd: p.ratingQtd || 0, criadoEm: iso(p.criadoEm) }; });
    lista.sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));   // mais antigos primeiro (fila)
    res.json(lista);
  }));

  /** Ficha para análise (CPF mascarado, telefone, idade). A leitura é auditada. */
  app.get("/admin/personais/:uid", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid");
    const pub = (await db.collection("personais").doc(uid).get()).data();
    if (!pub) throw new Falha(404, "Personal não encontrado.", "nao-encontrado");
    const priv = (await db.collection("personais_privado").doc(uid).get()).data() || {};
    const cpf = doPriv(priv, "cpf", uid), nasc = doPriv(priv, "nascimento", uid);
    const infr = (await db.collection("infracoes").doc(uid).get()).data() || {};
    await auth.auditar(req, "admin.personal.ver_ficha", uid);
    res.json({
      uid, nome: pub.nome || "", status: pub.status, cref: pub.cref || "", cidade: pub.cidade || "", bio: pub.bio || "", especialidade: pub.especialidade || "",
      experiencias: pub.experiencias || [], mpConectado: !!pub.mpConectado, ratingMedia: pub.ratingMedia || null, ratingQtd: pub.ratingQtd || 0,
      email: priv.email || "", cpfMascarado: cpf ? V.mascararCPF(cpf) : "", cpfCadastrado: !!cpf, telefone: doPriv(priv, "telefone", uid) || "",
      idade: nasc ? V.calcularIdade(nasc) : null, infracoes: infr.total || 0, revisaoManual: !!infr.revisaoManual, recado: pub.recado || null, criadoEm: iso(pub.criadoEm)
    });
  }));

  /** Aprovar / devolver para análise / bloquear. Para devolver ou bloquear, o motivo vira recado visível ao personal. */
  app.post("/admin/personais/:uid/status", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), status = V.opcao(req.body?.status, STATUS, "status");
    const motivo = V.texto(req.body?.motivo, "motivo", { max: 300 });
    const ref = db.collection("personais").doc(uid), p = (await ref.get()).data();
    if (!p) throw new Falha(404, "Personal não encontrado.", "nao-encontrado");
    if (status === "ativo") {
      const priv = (await db.collection("personais_privado").doc(uid).get()).data() || {};
      if (!String(p.cref || "").trim()) throw new Falha(409, "Cadastro incompleto: falta o CREF.", "cadastro-incompleto");
      if (!doPriv(priv, "cpf", uid)) throw new Falha(409, "Cadastro incompleto: falta o CPF.", "cadastro-incompleto");
    }
    if (status !== "ativo" && !motivo && status === "bloqueado") throw new Falha(400, "Informe o motivo do bloqueio (o personal verá a mensagem).", "motivo-obrigatorio");
    const mudanca = { status, statusAtualizadoEm: FieldValue.serverTimestamp() };
    mudanca.recado = status === "ativo" ? FieldValue.delete() : motivo ? { texto: motivo, tipo: status, por: "suporte", em: FieldValue.serverTimestamp() } : FieldValue.delete();
    await ref.set(mudanca, { merge: true });
    if (status === "bloqueado") await admin.auth().revokeRefreshTokens(uid).catch(() => {});   // derruba a sessão aberta
    await auth.auditar(req, `admin.personal.${status}`, uid, { de: p.status, motivo });
    res.json({ ok: true, status });
  }));

  /** Recado do suporte (sem mudar status) para aluno ou personal. */
  app.post("/admin/recado/:tipo/:uid", ...ADM, envelope(async (req, res) => {
    const tipo = V.opcao(req.params.tipo, ["aluno", "personal"], "tipo"), uid = V.idDoc(req.params.uid, "uid");
    const texto = V.texto(req.body?.texto, "mensagem", { min: 3, max: 300 });
    const ref = db.collection(tipo === "aluno" ? "alunos" : "personais").doc(uid);
    if (!(await ref.get()).exists) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado");
    await ref.set({ recado: { texto, tipo: "info", por: "suporte", em: FieldValue.serverTimestamp() } }, { merge: true });
    await auth.auditar(req, "admin.recado", `${tipo}/${uid}`);
    res.json({ ok: true });
  }));

  /** Encerra as sessões de uma conta (celular perdido, suspeita de invasão). Tokens revogados são recusados pela API. */
  app.post("/admin/usuarios/:uid/revogar-sessoes", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid");
    await admin.auth().revokeRefreshTokens(uid);
    await auth.auditar(req, "admin.revogar_sessoes", uid);
    res.json({ ok: true });
  }));

  // ---------- Moderação (chat bloqueado por conter contato externo) ----------
  app.get("/admin/moderacao", ...ADM, envelope(async (req, res) => {
    const [ocorr, infr] = await Promise.all([
      db.collection("moderacao").orderBy("criadoEm", "desc").limit(limite(req.query.limite, 100)).get(),
      db.collection("infracoes").where("revisaoManual", "==", true).limit(100).get()
    ]);
    res.json({
      ocorrencias: ocorr.docs.map((d) => ({ id: d.id, ...d.data(), criadoEm: iso(d.data().criadoEm) })),
      reincidentes: infr.docs.map((d) => ({ uid: d.id, total: d.data().total || 0, ultimaEm: iso(d.data().ultimaEm) }))
    });
  }));

  // ---------- Financeiro (somente leitura; o dinheiro é do Mercado Pago, que divide na hora) ----------
  const ESTADOS_PAGOS = ["paga", "concluida"];
  async function aulasPagas(n) {
    const lotes = await Promise.all(ESTADOS_PAGOS.map((st) => db.collection("aulas").where("status", "==", st).limit(n).get()));
    return lotes.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
  app.get("/admin/financeiro/resumo", ...ADM, envelope(async (req, res) => {
    const pagas = await aulasPagas(1000);
    const soma = (f) => pagas.reduce((t, a) => t + f(a), 0);
    const centavos = (a) => (Number.isInteger(a.valorCentavos) ? a.valorCentavos : Math.round(Number(a.valor || 0) * 100));
    const repasse = (a) => (Number.isInteger(a.valorPersonalCentavos) ? a.valorPersonalCentavos : R.calcularSplit(centavos(a)).personal);
    const [abertas, aceitas, pers, pend] = await Promise.all([
      db.collection("aulas").where("status", "==", "aberta").get(), db.collection("aulas").where("status", "==", "aceita").get(),
      db.collection("personais").where("status", "==", "ativo").get(), db.collection("personais").where("status", "==", "pendente").get()
    ]);
    const volume = soma(centavos), paraPersonais = soma(repasse);
    res.json({
      aulasPagas: pagas.length, volumeCentavos: volume, repasseCentavos: paraPersonais, comissaoCentavos: volume - paraPersonais,
      ticketMedioCentavos: pagas.length ? Math.round(volume / pagas.length) : 0, aulasAbertas: abertas.size, aulasAceitas: aceitas.size,
      personaisAtivos: pers.size, personaisPendentes: pend.size, amostraLimitada: pagas.length >= 1000
    });
  }));
  app.get("/admin/aulas", ...ADM, envelope(async (req, res) => {
    const status = V.opcao(req.query.status || "paga", ["aberta", "aceita", "paga", "concluida", "cancelada"], "status");
    const s = await db.collection("aulas").where("status", "==", status).limit(limite(req.query.limite, 100)).get();
    const lista = s.docs.map((d) => { const a = d.data(); return { id: d.id, data: a.data, horario: a.horario, foco: a.foco, local: a.local, alunoNome: a.alunoNome || "", personalNome: a.personalNome || "", valorCentavos: a.valorCentavos ?? null, valorPersonalCentavos: a.valorPersonalCentavos ?? null, status: a.status, reciboNumero: a.reciboNumero || null }; });
    lista.sort((a, b) => `${b.data}${b.horario}`.localeCompare(`${a.data}${a.horario}`));
    res.json(lista);
  }));

  // ---------- Auditoria ----------
  app.get("/admin/auditoria", ...ADM, envelope(async (req, res) => {
    const s = await db.collection("auditoria").orderBy("em", "desc").limit(limite(req.query.limite, 100)).get();
    res.json(s.docs.map((d) => { const a = d.data(); return { id: d.id, em: iso(a.em), uid: a.uid, acao: a.acao, alvo: a.alvo, ip: a.ip, detalhes: a.detalhes || {} }; }));
  }));

  // ---------- Aviso global (manutenção, recado a todos) ----------
  const AVISO = () => db.collection("config").doc("aviso");
  app.get("/admin/aviso", ...ADM, envelope(async (req, res) => { const d = (await AVISO().get()).data() || {}; res.json({ ativo: !!d.ativo, nivel: d.nivel || "info", texto: d.texto || "" }); }));
  app.put("/admin/aviso", ...ADM, envelope(async (req, res) => {
    const ativo = V.booleano(req.body?.ativo, "ativo"), nivel = V.opcao(req.body?.nivel || "info", ["info", "alerta"], "nível"), texto = V.texto(req.body?.texto, "texto", { min: ativo ? 3 : 0, max: 200 });
    await AVISO().set({ ativo, nivel, texto, atualizadoEm: FieldValue.serverTimestamp() });
    await auth.auditar(req, "admin.aviso", ativo ? "ligar" : "desligar");
    res.json({ ok: true });
  }));
  /** Público: o app consulta ao abrir. Sem dado pessoal. */
  app.get("/aviso", limitar({ janelaMs: 60_000, max: 60, nome: "aviso" }), envelope(async (req, res) => { const d = (await AVISO().get()).data() || {}; res.json(d.ativo ? { ativo: true, nivel: d.nivel || "info", texto: d.texto || "" } : { ativo: false }); }));

  // ---------- Exportação CSV (auditada; células protegidas contra injeção de fórmula) ----------
  app.get("/admin/exportar/:tipo", limitar({ janelaMs: 60_000, max: 6, nome: "csv" }), auth.exigirAdmin, envelope(async (req, res) => {
    const tipo = V.opcao(req.params.tipo, ["personais", "aulas"], "tipo");
    let csv;
    if (tipo === "personais") {
      const s = await db.collection("personais").limit(2000).get();
      csv = paraCSV(["UID", "Nome", "CREF", "Cidade", "Status", "Mercado Pago", "Nota média", "Avaliações", "Criado em"],
        s.docs.map((d) => { const p = d.data(); return [d.id, p.nome, p.cref, p.cidade, p.status, p.mpConectado ? "sim" : "não", p.ratingMedia ?? "", p.ratingQtd ?? 0, dataBR(p.criadoEm)]; }));
    } else {
      const lista = await aulasPagas(2000);
      csv = paraCSV(["Aula", "Data", "Horário", "Foco", "Local", "Aluno", "Personal", "Valor", "Repasse personal", "Comissão", "Recibo"],
        lista.map((a) => { const sp = R.calcularSplit(Number.isInteger(a.valorCentavos) ? a.valorCentavos : Math.round(Number(a.valor || 0) * 100)); return [a.id, a.data, a.horario, a.foco, a.local, a.alunoNome, a.personalNome, dinheiro(sp.valor), dinheiro(sp.personal), dinheiro(sp.comissao), a.reciboNumero ?? ""]; }));
    }
    await auth.auditar(req, "admin.exportar", tipo);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="personow-${tipo}.csv"`);
    res.send(csv);
  }));
};
