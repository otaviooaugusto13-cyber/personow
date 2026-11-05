// Extrato (somente leitura): o aluno vê o que pagou; o personal vê o que recebeu, a comissão e o repasse. SEM saque e SEM custódia:
// o dinheiro do personal é repassado na hora pelo Mercado Pago (split). Aqui só se mostra o histórico.
//   GET /extrato?mes=AAAA-MM      resumo + itens do mês (papel ativo da sessão)
//   GET /extrato.csv?mes=AAAA-MM  o mesmo em CSV (proteção contra injeção de fórmula)
const { paraCSV, dinheiro } = require("../lib/csv");

module.exports = (app, x) => {
  const { db, auth, V, Falha, envelope, limitar, estaPaga, splitDaAula } = x;
  const L = [limitar({ janelaMs: 60_000, max: 60, nome: "extrato" }), auth.exigir("aluno", "personal")];

  async function montar(u, mesParam) {
    const mes = mesParam ? V.texto(mesParam, "mês", { max: 7, re: /^\d{4}-(0[1-9]|1[0-2])$/ }) : "";
    const personal = u.role === "personal", campo = personal ? "personalUid" : "alunoUid";
    const snap = await db.collection("aulas").where(campo, "==", u.uid).get();
    const itens = [], meses = {};
    for (const d of snap.docs) {
      const a = d.data();
      if (!estaPaga(a)) continue;
      let sp; try { sp = splitDaAula(a); } catch { continue; }
      const m = String(a.data || "").slice(0, 7);
      const item = {
        id: d.id, data: a.data, horario: a.horario || "", foco: a.foco || "", local: a.local || "",
        contraparte: personal ? a.alunoNome || "Aluno" : a.personalNome || "Personal",
        valorCentavos: sp.valor, totalPagoCentavos: sp.total, comissaoCentavos: sp.app, repasseCentavos: sp.personal, reciboId: a.reciboId || null
      };
      const r = (meses[m] = meses[m] || { mes: m, aulas: 0, totalPagoCentavos: 0, comissaoCentavos: 0, repasseCentavos: 0 });
      r.aulas++; r.totalPagoCentavos += sp.total; r.comissaoCentavos += sp.app; r.repasseCentavos += sp.personal;
      if (!mes || m === mes) itens.push(item);
    }
    itens.sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.horario).localeCompare(String(a.horario)));
    const resumo = Object.values(meses).sort((a, b) => b.mes.localeCompare(a.mes));
    const sel = mes ? meses[mes] || { mes, aulas: 0, totalPagoCentavos: 0, comissaoCentavos: 0, repasseCentavos: 0 } : resumo.reduce((t, r) => ({ ...t, aulas: t.aulas + r.aulas, totalPagoCentavos: t.totalPagoCentavos + r.totalPagoCentavos, comissaoCentavos: t.comissaoCentavos + r.comissaoCentavos, repasseCentavos: t.repasseCentavos + r.repasseCentavos }), { mes: "", aulas: 0, totalPagoCentavos: 0, comissaoCentavos: 0, repasseCentavos: 0 });
    return { papel: personal ? "personal" : "aluno", mes, resumo: sel, meses: resumo, itens: itens.slice(0, 300) };
  }

  app.get("/extrato", ...L, envelope(async (req, res) => res.json(await montar(req.usuario, req.query.mes))));
  app.get("/extrato.csv", ...L, envelope(async (req, res) => {
    const e = await montar(req.usuario, req.query.mes), p = e.papel === "personal";
    const cab = p ? ["Data", "Horário", "Foco", "Aluno", "Valor da aula", "Comissão", "Repasse a você"] : ["Data", "Horário", "Foco", "Personal", "Valor da aula", "Total pago"];
    const linhas = e.itens.map((i) => p ? [i.data, i.horario, i.foco, i.contraparte, dinheiro(i.valorCentavos), dinheiro(i.comissaoCentavos), dinheiro(i.repasseCentavos)] : [i.data, i.horario, i.foco, i.contraparte, dinheiro(i.valorCentavos), dinheiro(i.totalPagoCentavos)]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="extrato-${e.mes || "geral"}.csv"`);
    res.send(paraCSV(cab, linhas));
  }));
};
