// Carteira digital do personal, saque, extrato e exportações CSV (personal e aluno).
const { paraCSV, dinheiro, dataBR } = require("../lib/csv");

module.exports = (app, x) => {
  const { db, auth, V, C, S, Cripto, Falha, envelope, limitar, carteira, taxas } = x;
  const iso = (ts) => { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toISOString() : null; };
  const PIX_CARENCIA_MS = 24 * 3600_000;     // após trocar a chave Pix, saques ficam travados por 24 h (proteção contra sequestro de conta)
  const enviarCSV = (res, nome, csv) => { res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${nome}"`); res.setHeader("X-Content-Type-Options", "nosniff"); res.send(csv); };
  x.enviarCSV = enviarCSV;
  const ROTULO = { credito_aula: "Aula recebida", liberacao: "Saldo liberado", saque: "Saque", saque_devolvido: "Saque devolvido", estorno: "Estorno", comissao: "Comissão", estorno_comissao: "Estorno de comissão" };

  app.get("/carteira", auth.exigir("personal"), envelope(async (req, res) => {
    const uid = req.usuario.uid;
    await carteira.liberarVencidos({ uid });                                       // libera o que já passou da carência
    const [saldo, extrato, saques] = await Promise.all([
      carteira.saldo(uid), carteira.extrato(uid, { limite: 60 }),
      db.collection("saques").where("uid", "==", uid).orderBy("criadoEm", "desc").limit(20).get()
    ]);
    res.json({
      ...saldo, saqueMinimoCentavos: C.SAQUE_MINIMO_CENTAVOS, liberacaoDias: C.LIBERACAO_DIAS,
      extrato: extrato.map((l) => ({ id: l.id, tipo: l.tipo, rotulo: ROTULO[l.tipo] || l.tipo, descricao: l.descricao, dPendente: l.dPendente, dDisponivel: l.dDisponivel, situacao: l.situacao || null, liberaEm: iso(l.liberaEm), em: iso(l.criadoEm) })),
      saques: saques.docs.map((d) => ({ id: d.id, valorCentavos: d.data().valorCentavos, status: d.data().status, em: iso(d.data().criadoEm) }))
    });
  }));

  app.post("/carteira/saque", limitar({ janelaMs: 3600_000, max: 5, nome: "saque", porUsuario: true }), auth.exigir("personal"), envelope(async (req, res) => {
    const uid = req.usuario.uid;
    auth.exigirRecente(req.usuario);
    const valor = V.inteiro(req.body?.valorCentavos, "valorCentavos", { min: 1, max: 100_000_000 });
    const pub = (await db.collection("personais").doc(uid).get()).data(), priv = (await db.collection("personais_privado").doc(uid).get()).data() || {};
    if (!pub || pub.status !== "ativo") throw new Falha(403, "Cadastro não está ativo para saques.", "personal-inativo");
    const alterou = priv.pixAlteradoEm?.toMillis?.() || 0;
    if (alterou && Date.now() - alterou < PIX_CARENCIA_MS) throw new Falha(403, "Você alterou a chave Pix recentemente. Por segurança, saques ficam bloqueados por 24 horas.", "pix-recente");
    const r = await carteira.solicitarSaque({ uid, valorCentavos: valor, pixEnc: priv.pixEnc, pixTipo: priv.pixTipo });
    await auth.auditar(req, "carteira.saque.solicitar", r.id, { valorCentavos: valor });
    res.json({ ok: true, ...r });
  }));

  app.get("/carteira/exportar.csv", limitar({ janelaMs: 60_000, max: 6, nome: "csv", porUsuario: true }), auth.exigir("personal"), envelope(async (req, res) => {
    const linhas = await carteira.extrato(req.usuario.uid, { limite: 500 });
    enviarCSV(res, "personow-carteira.csv", paraCSV(["Data", "Tipo", "Descrição", "Aula", "Carência (R$)", "Disponível (R$)", "Situação"],
      linhas.map((l) => [dataBR(l.criadoEm), ROTULO[l.tipo] || l.tipo, l.descricao, l.aulaId || l.saqueId || "", dinheiro(l.dPendente), dinheiro(l.dDisponivel), l.situacao || ""])));
  }));

  app.get("/aluno/exportar.csv", limitar({ janelaMs: 60_000, max: 6, nome: "csv", porUsuario: true }), auth.exigir("aluno"), envelope(async (req, res) => {
    const uid = req.usuario.uid, taxasVigentes = await taxas.obter();
    const [ped, fin] = await Promise.all([db.collection("aulas").where("uid", "==", uid).get(), db.collection("aulas_financeiro").where("uid", "==", uid).get()]);
    const valores = new Map(fin.docs.map((d) => [d.id, d.data()]));
    const linhas = ped.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => ["paga", "concluida", "estornada"].includes(p.status)).sort((a, b) => String(b.data).localeCompare(String(a.data)));
    enviarCSV(res, "personow-pagamentos.csv", paraCSV(["Nota", "Data do serviço", "Aluno", "Modalidade", "Horário", "Personal", "Total pago (R$)", "Situação", "Pago em"],
      linhas.map((p) => [p.notaNumero ? String(p.notaNumero).padStart(6, "0") : "", p.data, p.aluno, p.foco, p.horario || "", p.personalNome || "", dinheiro(valores.get(p.id)?.total ?? S.calcularPreco(taxasVigentes).total), p.status === "estornada" ? "Estornado" : "Pago", dataBR(p.pagaEm)])));
  }));
};
