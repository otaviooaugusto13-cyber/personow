// Comprovante de aula com código de verificação (documento SEM valor fiscal; o recibo da aula continua em recibo.html).
//   POST /comprovante/:aulaId/emitir    aluno ou personal da aula PAGA → { codigo, dados } (idempotente)
//   GET  /comprovante/:aulaId/pdf       PDF do comprovante (mesmos donos)
//   POST /comprovante/verificar         PÚBLICO (rate limit): { codigo } → dados mínimos, sem dados pessoais
const { codigoDe, fmtCodigo, gerarPDF } = require("../lib/comprovante");
module.exports = (app, x) => {
  const { db, auth, V, C, Falha, envelope, limitar, FieldValue, estaPaga, splitDaAula, primeiroNome } = x;
  const L = [limitar({ janelaMs: 60_000, max: 30, nome: "comprovante" }), auth.exigir("aluno", "personal")];

  async function carregar(aulaId, uid) {
    const id = V.idDoc(aulaId, "aula"), a = (await db.collection("aulas").doc(id).get()).data();
    if (!a || (a.alunoUid !== uid && a.personalUid !== uid)) throw new Falha(404, "Aula não encontrada.", "nao-encontrado");
    if (!estaPaga(a)) throw new Falha(409, "O comprovante fica disponível depois do pagamento.", "nao-paga");
    const sp = splitDaAula(a), numero = a.reciboNumero || 0, codigo = codigoDe(id, numero, sp.total);
    return { id, a, sp, numero, codigo };
  }
  const dadosPublicos = (id, a, sp, numero) => ({ aulaId: id, numero, foco: a.foco, data: a.data, horario: a.horario, local: String(a.local || "").slice(0, 60), personal: primeiroNome(a.personalNome), totalCentavos: sp.total });

  app.post("/comprovante/:aulaId/emitir", ...L, envelope(async (req, res) => {
    const { id, a, sp, numero, codigo } = await carregar(req.params.aulaId, req.usuario.uid), dados = dadosPublicos(id, a, sp, numero);
    await db.collection("comprovantes").doc(codigo).set({ ...dados, codigo, emitidoEm: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ codigo, codigoFormatado: fmtCodigo(codigo), dados });
  }));
  app.get("/comprovante/:aulaId/pdf", ...L, envelope(async (req, res) => {
    const { id, a, sp, numero, codigo } = await carregar(req.params.aulaId, req.usuario.uid);
    const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const pdf = gerarPDF([
      { t: "PERSONOW", tam: 22, neg: true }, { t: "Comprovante de aula (sem valor fiscal)", tam: 12 }, { esp: 14 },
      { t: `Aula: ${a.foco}`, tam: 13, neg: true }, { t: `Data: ${a.data}   Horario: ${a.horario}` }, { t: `Local: ${String(a.local || "").slice(0, 80)}` },
      { t: `Personal: ${a.personalNome || ""}`, }, { t: `Aluno: ${a.alunoNome || ""}` }, { esp: 10 },
      { t: `Valor da aula: ${brl(sp.valor)}` }, { t: `Total pago: ${brl(sp.total)}`, neg: true }, { t: `Recibo n. ${String(numero).padStart(6, "0")}` }, { esp: 14 },
      { t: "Codigo de verificacao", neg: true }, { t: fmtCodigo(codigo), tam: 15 }, { t: "Confira em /verificar.html", tam: 9 }, { esp: 30 },
      { t: "Documento sem valor fiscal. A nota fiscal do servico, quando aplicavel, e de responsabilidade do prestador.", tam: 8 }
    ]);
    res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `inline; filename="comprovante-${id}.pdf"`);
    res.send(pdf);
  }));
  app.post("/comprovante/verificar", limitar({ janelaMs: 60_000, max: 12, nome: "comprovante-verificar" }), envelope(async (req, res) => {
    const codigo = String(req.body?.codigo || "").replace(/\D/g, "");
    if (!/^\d{24}$/.test(codigo)) throw new Falha(400, "Digite os 24 dígitos do código.", "dados-invalidos");
    const d = (await db.collection("comprovantes").doc(codigo).get()).data();
    if (!d) return res.json({ valido: false });
    res.json({ valido: true, dados: { foco: d.foco, data: d.data, horario: d.horario, local: d.local, personal: d.personal, totalCentavos: d.totalCentavos, numero: d.numero } });
  }));
};
