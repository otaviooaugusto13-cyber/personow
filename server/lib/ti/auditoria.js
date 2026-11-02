// Trilha de auditoria do módulo de TI — append-only, com ENCADEAMENTO DE HASH (cada registro inclui o hash do anterior).
// Alterar ou apagar um registro no banco quebra a cadeia e o gestor vê isso em GET /ti/auditoria/verificar.
//   ti_auditoria/{seq 10 dígitos}   um registro (acao, quem, alvo, antes/depois sem segredos, IP, UA, hash, prevHash, ord)
//   ti_auditoria_cadeia/estado      { seq, hash } — cabeça da cadeia (atualizada na mesma transação de cada registro)
// `ord` = "<ms 13 dígitos>_<seq 10 dígitos>": string ordenável por tempo e única, usada em filtros por período e paginação por cursor.
const crypto = require("crypto");

const SEGREDO = /senha|password|passwd|token|secret|authorization|cpf|pix|chave/i;
const pad = (n, t) => String(n).padStart(t, "0");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** JSON canônico (chaves ordenadas, sem undefined): o hash não depende da ordem em que o banco devolve os campos. */
function canonico(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(",")}}`;
}
/** Remove segredos e limita tamanho/profundidade antes de gravar `antes`/`depois`/`meta`. */
function limpar(v, nivel = 0) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.length > 300 ? v.slice(0, 300) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (nivel >= 3) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => limpar(x, nivel + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [k, SEGREDO.test(k) ? "[omitido]" : limpar(x, nivel + 1)]));
  return String(v).slice(0, 100);
}

function criarAuditoria({ db, FieldValue, Timestamp }) {
  const COL = "ti_auditoria", CADEIA = "ti_auditoria_cadeia";
  let fila = Promise.resolve();   // serializa as gravações desta instância (menos retentativas de transação)

  const nucleo = (e) => ({ seq: e.seq, prevHash: e.prevHash, emMs: e.emMs, acao: e.acao, resultado: e.resultado, operadorUid: e.operadorUid, operadorNome: e.operadorNome, operadorEmail: e.operadorEmail, nivel: e.nivel,
    alvoTipo: e.alvoTipo, alvoId: e.alvoId, resumo: e.resumo, antes: e.antes, depois: e.depois, meta: e.meta, ip: e.ip, ua: e.ua, rota: e.rota, reqId: e.reqId });
  const hashDe = (e) => sha256(`${e.prevHash}|${canonico(nucleo(e))}`);

  /**
   * Registra uma ação. `ator` = { uid, nome, email, nivel, ip, ua, rota, reqId } (use ator.de(req)).
   * Nunca lança: falha de auditoria não pode derrubar a operação já feita — mas é registrada em stderr (1 linha JSON) para o log drain.
   */
  function registrar(ator, { acao, alvoTipo = "", alvoId = "", resumo = "", antes = null, depois = null, resultado = "ok", meta = null }) {
    const bruto = { acao: String(acao).slice(0, 60), resultado, operadorUid: ator?.uid || "", operadorNome: String(ator?.nome || "").slice(0, 100), operadorEmail: String(ator?.email || "").slice(0, 120), nivel: ator?.nivel || "",
      alvoTipo: String(alvoTipo).slice(0, 30), alvoId: String(alvoId).slice(0, 128), resumo: String(resumo).slice(0, 300), antes: limpar(antes), depois: limpar(depois), meta: limpar(meta),
      ip: String(ator?.ip || "").slice(0, 64), ua: String(ator?.ua || "").slice(0, 160), rota: String(ator?.rota || "").slice(0, 120), reqId: String(ator?.reqId || "").slice(0, 40) };
    const gravar = async () => {
      for (let tentativa = 1; ; tentativa++) {
        try {
          return await db.runTransaction(async (tx) => {
            const cref = db.collection(CADEIA).doc("estado"), est = (await tx.get(cref)).data() || {};
            const seq = (est.seq || 0) + 1, emMs = Date.now();
            const e = { ...bruto, seq, prevHash: est.hash || "GENESIS", emMs }; e.hash = hashDe(e); e.ord = `${pad(emMs, 13)}_${pad(seq, 10)}`;
            tx.set(db.collection(COL).doc(pad(seq, 10)), { ...e, em: Timestamp.fromMillis(emMs) });
            tx.set(cref, { seq, hash: e.hash, atualizadoEm: FieldValue.serverTimestamp() });
            return e;
          });
        } catch (err) {
          if (tentativa >= 4) { console.error(JSON.stringify({ nivel: "erro", evento: "ti.auditoria.falhou", acao: bruto.acao, operador: bruto.operadorUid, alvo: bruto.alvoId, msg: err.message })); return null; }
          await new Promise((r) => setTimeout(r, 40 * tentativa));
        }
      }
    };
    const p = fila.then(gravar, gravar); fila = p.catch(() => {}); return p;
  }

  const visao = (d) => ({ seq: d.seq, ord: d.ord, em: new Date(d.emMs).toISOString(), acao: d.acao, resultado: d.resultado, operadorUid: d.operadorUid, operadorNome: d.operadorNome, operadorEmail: d.operadorEmail, nivel: d.nivel,
    alvoTipo: d.alvoTipo, alvoId: d.alvoId, resumo: d.resumo, antes: d.antes, depois: d.depois, meta: d.meta, ip: d.ip, ua: d.ua, rota: d.rota, reqId: d.reqId, hash: d.hash });

  /** Consulta paginada (mais recentes primeiro). Filtros: operadorUid, acao, alvoId, resultado, de/ate (ms). Devolve { itens, proximo } — `proximo` é o cursor da próxima página. */
  async function listar({ operadorUid, acao, alvoId, resultado, deMs, ateMs, limite = 50, cursor } = {}) {
    limite = Math.max(1, Math.min(Number(limite) || 50, 200));
    let q = db.collection(COL);
    if (operadorUid) q = q.where("operadorUid", "==", operadorUid);
    if (acao) q = q.where("acao", "==", acao);
    if (alvoId) q = q.where("alvoId", "==", alvoId);
    if (resultado) q = q.where("resultado", "==", resultado);
    if (deMs) q = q.where("ord", ">=", `${pad(deMs, 13)}_`);
    const topo = ateMs ? `${pad(ateMs, 13)}_~` : null;   // "~" > dígitos: inclui todos os registros do milissegundo final
    if (cursor && (!topo || cursor <= topo)) q = q.where("ord", "<", cursor); else if (topo) q = q.where("ord", "<=", topo);
    const s = await q.orderBy("ord", "desc").limit(limite + 1).get();
    const docs = s.docs.map((d) => d.data()), itens = docs.slice(0, limite).map(visao);
    return { itens, proximo: docs.length > limite ? itens[itens.length - 1].ord : null };
  }

  /** Confere a cadeia dos últimos `limite` registros: hash de cada um, encadeamento com o anterior, ausência de buracos na sequência e cabeça da cadeia. */
  async function verificar({ limite = 500 } = {}) {
    limite = Math.max(2, Math.min(Number(limite) || 500, 2000));
    const [s, est] = await Promise.all([db.collection(COL).orderBy("seq", "desc").limit(limite).get(), db.collection(CADEIA).doc("estado").get()]);
    const regs = s.docs.map((d) => d.data()).sort((a, b) => a.seq - b.seq), problemas = [];
    regs.forEach((e, i) => {
      if (hashDe(e) !== e.hash) problemas.push({ seq: e.seq, problema: "conteudo-alterado" });
      if (i > 0) { if (e.seq !== regs[i - 1].seq + 1) problemas.push({ seq: e.seq, problema: "sequencia-com-buraco" }); else if (e.prevHash !== regs[i - 1].hash) problemas.push({ seq: e.seq, problema: "encadeamento-quebrado" }); }
    });
    const cab = est.data(), ultimo = regs[regs.length - 1];
    if (cab && (!ultimo || ultimo.seq !== cab.seq || ultimo.hash !== cab.hash)) problemas.push({ seq: cab.seq, problema: "cabeca-divergente" });
    return { ok: problemas.length === 0, verificados: regs.length, primeiroSeq: regs[0]?.seq || 0, ultimoSeq: ultimo?.seq || 0, problemas: problemas.slice(0, 50) };
  }

  return { registrar, listar, verificar, _hashDe: hashDe };
}
module.exports = { criarAuditoria, canonico, limpar };
