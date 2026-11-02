// Métricas de produtividade da TI — AGREGADAS por dia, atualizadas na mesma transação de cada mudança de chamado.
// O dashboard lê no máximo ~90 documentos pequenos (nunca varre a coleção de chamados): custo constante, independente do volume.
//   ti_metricas_dia/{YYYY-MM-DD}        { criados, atendidos, resolvidos, cancelados, somaAtendSeg, somaResolSeg, atendNoPrazo, resolNoPrazo, porPrioridade{...} }
//   ti_produtividade/{YYYY-MM-DD}_{uid} { dia, uid, nome, assumidos, resolvidos, somaAtendSeg, somaResolSeg }
// Definições:
//   TMA (tempo médio de atendimento)  = média de (primeira vez que um operador assumiu − abertura), dos chamados assumidos no período.
//   TMR (tempo médio de resolução)    = média de (resolução − abertura − tempo parado em "aguardando usuário"), das resoluções do período.
const K = require("./constantes");

const diaSP = (ms) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const somarDias = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function criarMetricas({ db, FieldValue }) {
  const dia = (d) => db.collection("ti_metricas_dia").doc(d);
  const prod = (d, uid) => db.collection("ti_produtividade").doc(`${d}_${uid}`);
  const inc = FieldValue.increment;
  const cacheMs = 10_000, cache = new Map();

  // ---- escritas: chamadas DENTRO da transação do chamado (tx.set sem leitura → não causam conflito) ----
  const aplicarCriacao = (tx, { ms, prioridade }) => { tx.set(dia(diaSP(ms)), { dia: diaSP(ms), criados: inc(1), porPrioridade: { [prioridade]: inc(1) } }, { merge: true }); cache.clear(); };
  const aplicarAtendimento = (tx, { ms, uid, nome, seg, noPrazo }) => {
    const d = diaSP(ms);
    tx.set(dia(d), { dia: d, atendidos: inc(1), somaAtendSeg: inc(seg), atendNoPrazo: inc(noPrazo ? 1 : 0) }, { merge: true });
    tx.set(prod(d, uid), { dia: d, uid, nome, assumidos: inc(1), somaAtendSeg: inc(seg) }, { merge: true }); cache.clear();
  };
  const aplicarResolucao = (tx, { ms, uid, nome, seg, noPrazo }) => {
    const d = diaSP(ms);
    tx.set(dia(d), { dia: d, resolvidos: inc(1), somaResolSeg: inc(seg), resolNoPrazo: inc(noPrazo ? 1 : 0) }, { merge: true });
    tx.set(prod(d, uid), { dia: d, uid, nome, resolvidos: inc(1), somaResolSeg: inc(seg) }, { merge: true }); cache.clear();
  };
  const aplicarCancelamento = (tx, { ms }) => { tx.set(dia(diaSP(ms)), { dia: diaSP(ms), cancelados: inc(1) }, { merge: true }); cache.clear(); };

  const media = (soma, n) => (n > 0 ? Math.round(soma / n) : null);
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

  /** Período [hoje−(dias−1), hoje] no fuso de São Paulo. */
  const periodo = (dias) => { const ate = diaSP(Date.now()); return { de: somarDias(ate, -(dias - 1)), ate }; };
  const normalizar = (dias) => { dias = Number(dias); return [1, 7, 30, 90].includes(dias) ? dias : 7; };

  async function resumo({ dias = 7 } = {}) {
    dias = normalizar(dias); const k = `r${dias}`, c = cache.get(k); if (c && Date.now() - c.t < cacheMs) return c.v;
    const { de, ate } = periodo(dias);
    const s = await db.collection("ti_metricas_dia").where("dia", ">=", de).where("dia", "<=", ate).get();
    const porDia = Object.fromEntries(s.docs.map((d) => [d.data().dia, d.data()]));
    const serie = []; const t = { criados: 0, atendidos: 0, resolvidos: 0, cancelados: 0, somaAtendSeg: 0, somaResolSeg: 0, atendNoPrazo: 0, resolNoPrazo: 0 };
    for (let i = 0; i < dias; i++) {
      const d = somarDias(de, i), x = porDia[d] || {};
      for (const f of Object.keys(t)) t[f] += x[f] || 0;
      serie.push({ dia: d, criados: x.criados || 0, resolvidos: x.resolvidos || 0, atendidos: x.atendidos || 0, tmaSeg: media(x.somaAtendSeg || 0, x.atendidos || 0) });
    }
    const v = { dias, de, ate, criados: t.criados, atendidos: t.atendidos, resolvidos: t.resolvidos, cancelados: t.cancelados, tmaSeg: media(t.somaAtendSeg, t.atendidos), tmrSeg: media(t.somaResolSeg, t.resolvidos),
      slaAtendimentoPct: pct(t.atendNoPrazo, t.atendidos), slaResolucaoPct: pct(t.resolNoPrazo, t.resolvidos), serie };
    cache.set(k, { t: Date.now(), v }); return v;
  }

  /** Ranking de operadores no período: mais resolvidos primeiro (desempate: mais assumidos, depois menor TMA). */
  async function ranking({ dias = 7, limite = 20 } = {}) {
    dias = normalizar(dias); const k = `k${dias}`, c = cache.get(k); if (c && Date.now() - c.t < cacheMs) return c.v.slice(0, limite);
    const { de, ate } = periodo(dias);
    const s = await db.collection("ti_produtividade").where("dia", ">=", de).where("dia", "<=", ate).get();
    const por = new Map();
    for (const d of s.docs) {
      const x = d.data(), a = por.get(x.uid) || { uid: x.uid, nome: x.nome, assumidos: 0, resolvidos: 0, somaAtendSeg: 0, somaResolSeg: 0 };
      a.nome = x.nome || a.nome; for (const f of ["assumidos", "resolvidos", "somaAtendSeg", "somaResolSeg"]) a[f] += x[f] || 0; por.set(x.uid, a);
    }
    const v = [...por.values()].map((a) => ({ uid: a.uid, nome: a.nome, assumidos: a.assumidos, resolvidos: a.resolvidos, tmaSeg: media(a.somaAtendSeg, a.assumidos), tmrSeg: media(a.somaResolSeg, a.resolvidos) }))
      .sort((a, b) => b.resolvidos - a.resolvidos || b.assumidos - a.assumidos || (a.tmaSeg ?? Infinity) - (b.tmaSeg ?? Infinity) || a.nome.localeCompare(b.nome, "pt-BR"))
      .map((a, i) => ({ posicao: i + 1, ...a }));
    cache.set(k, { t: Date.now(), v }); return v.slice(0, limite);
  }

  return { aplicarCriacao, aplicarAtendimento, aplicarResolucao, aplicarCancelamento, resumo, ranking, diaSP, limparCache: () => cache.clear(), _normalizar: normalizar };
}
module.exports = { criarMetricas, diaSP, somarDias };
