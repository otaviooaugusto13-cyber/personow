// Comprovante de serviço (layout DANFE simplificado): emissão sob demanda para o aluno + verificação pública de autenticidade.
// Os valores vêm do snapshot gravado no momento do pagamento (notas/{id}: imutável); o estado do pagamento (estornado) é lido ao vivo.
const { montarDocumento, codigoVerificacao, iguais } = require("../lib/danfe");
module.exports = (app, x) => {
  const { db, FieldValue, auth, V, C, Falha, envelope, limitar } = x;
  const SEGREDO = process.env.NOTA_HMAC_KEY || process.env.BLIND_INDEX_KEY || "";
  const nao = () => new Falha(404, "Nota não encontrada.", "nao-encontrado");

  // O aluno dona da nota (ou a equipe) pede a emissão. Cada aula conta como uma via (1ª via, 2ª via…): fica auditado.
  app.post("/nota/:id/emitir", limitar({ janelaMs: 60_000, max: 30, nome: "nota-emitir", porUsuario: true }), auth.exigir("aluno", "admin"), envelope(async (req, res) => {
    const id = V.idDoc(req.params.id, "id"), ref = db.collection("notas").doc(id), u = req.usuario;
    const antes = (await ref.get()).data();
    if (!antes || (u.role !== "admin" && antes.alunoUid !== u.uid)) throw nao();          // 404 também para nota alheia: não revela que existe
    const pagRef = db.collection("pagamentos_internos").doc(String(antes.aulaId || "_"));
    const { nota, pag } = await db.runTransaction(async (tx) => {
      const [n, p] = await Promise.all([tx.get(ref), tx.get(pagRef)]), nota = n.data();
      if (!nota) throw nao();
      tx.update(ref, { emissoes: (nota.emissoes || 0) + 1, ultimaEmissaoEm: FieldValue.serverTimestamp(), ultimaEmissaoPor: u.uid });
      return { nota: { ...nota, emissoes: (nota.emissoes || 0) + 1 }, pag: p.data() };
    });
    const doc = montarDocumento(nota, { id, empresa: C.EMPRESA, segredo: SEGREDO, via: nota.emissoes, estornado: pag?.status === "estornado" });
    await auth.auditar(req, "nota.emitir", id, { via: nota.emissoes });
    res.json({ id, ...doc });
  }));

  // Qualquer pessoa com o documento em mãos confere se ele é autêntico (id + 24 dígitos). Não exige login e não devolve dados pessoais.
  app.post("/nota/verificar", limitar({ janelaMs: 60_000, max: 15, nome: "nota-verificar" }), envelope(async (req, res) => {
    const id = String(req.body?.id || "").trim(), cod = String(req.body?.codigo || "").replace(/\D/g, "");
    if (!/^[A-Za-z0-9]{4,40}$/.test(id) || cod.length !== 24) return res.json({ valida: false });
    const n = (await db.collection("notas").doc(id).get()).data();
    if (!n || !n.emitidaEm) return res.json({ valida: false });
    const esperado = codigoVerificacao(SEGREDO, { id, numero: n.numero, totalCentavos: n.valores?.total, emitidaEmMs: n.emitidaEm.toMillis() });
    if (!iguais(esperado, cod)) return res.json({ valida: false });
    const pag = (await db.collection("pagamentos_internos").doc(String(n.aulaId || "_")).get()).data();
    res.json({ valida: true, numeroFmt: n.numeroFmt, serie: n.serie || "A1", emitidaEm: n.emitidaEm.toDate().toISOString(), estornado: pag?.status === "estornado" });
  }));
};
