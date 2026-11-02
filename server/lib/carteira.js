// ============================================================
// CARTEIRA DIGITAL, LEDGER, ESTORNOS, SAQUES E CONCILIAÇÃO
//
// Princípios:
//  1. Todo movimento de dinheiro é um LANÇAMENTO em `lancamentos/{id}` com id determinístico
//     (idempotência: webhook repetido, clique duplo ou retry nunca lança duas vezes).
//  2. Cada lançamento tem dois deltas: dPendente (carência) e dDisponivel (sacável). Valores em CENTAVOS inteiros.
//  3. O saldo em `carteiras/{uid}` é derivado: sempre = soma dos lançamentos. A conciliação prova isso.
//  4. Só o servidor escreve (regras do Firestore negam qualquer escrita do cliente).
//  5. Os únicos campos mutáveis de um lançamento são `situacao` (pendente → liberado/estornado) — o histórico
//     nunca é apagado: correções são novos lançamentos.
//
// Fluxo do dinheiro (aluno paga R$ 200):
//    pagamento aprovado → [personal: +R$150 pendente] + [PLATAFORMA: +R$50 disponível]
//    após LIBERACAO_DIAS (e liberação do Mercado Pago) → pendente → disponível
//    saque → disponível −X (solicitado) → admin paga via Pix (pago) ou rejeita (devolve)
//    estorno → desfaz R$150 (pendente ou disponível, podendo ficar negativo) e R$50 da plataforma
// ============================================================
const { Falha } = require("./erros");
const C = require("./config");

const ehCentavos = (n) => Number.isInteger(n) && Math.abs(n) <= 1e9;

function criarCarteira({ db, FieldValue, Timestamp }) {
  const refCarteira = (uid) => db.collection("carteiras").doc(uid);
  const refLanc = (id) => db.collection("lancamentos").doc(id);

  // ---------- leitura/escrita dentro de transação ----------
  /** FASE DE LEITURA (antes de qualquer escrita na transação). */
  async function ler(tx, { uids = [], ids = [] }) {
    const unicos = [...new Set(uids)];
    const [cs, ls] = await Promise.all([Promise.all(unicos.map((u) => tx.get(refCarteira(u)))), Promise.all(ids.map((i) => tx.get(refLanc(i))))]);
    const saldos = new Map(unicos.map((u, i) => [u, { pendente: cs[i].data()?.pendenteCentavos || 0, disponivel: cs[i].data()?.disponivelCentavos || 0 }]));
    const existentes = new Map(ids.map((i, k) => [i, ls[k].exists ? ls[k].data() : null]).filter(([, v]) => v));
    return { saldos, existentes };
  }
  /** FASE DE ESCRITA. Ignora lançamentos cujo id já existe (idempotência). Retorna os ids realmente gravados. */
  function escrever(tx, estado, lancs, ator = "sistema") {
    const gravados = [];
    for (const l of lancs) {
      if (estado.existentes.has(l.id)) continue;
      const dP = l.dPendente || 0, dD = l.dDisponivel || 0;
      if (!ehCentavos(dP) || !ehCentavos(dD) || (dP === 0 && dD === 0)) throw new Error(`lançamento inválido ${l.id}`);
      if (!estado.saldos.has(l.uid)) throw new Error(`carteira ${l.uid} não foi lida na transação`);
      tx.set(refLanc(l.id), {
        carteiraUid: l.uid, tipo: l.tipo, dPendente: dP, dDisponivel: dD, descricao: l.descricao || "",
        aulaId: l.aulaId || null, saqueId: l.saqueId || null, ref: l.ref || null,
        ...(l.situacao ? { situacao: l.situacao } : {}), ...(l.liberaEm ? { liberaEm: l.liberaEm } : {}),
        ator, criadoEm: FieldValue.serverTimestamp()
      });
      const s = estado.saldos.get(l.uid); s.pendente += dP; s.disponivel += dD;
      estado.existentes.set(l.id, l); gravados.push(l.id);
    }
    for (const uid of new Set(lancs.map((l) => l.uid))) {
      const s = estado.saldos.get(uid);
      tx.set(refCarteira(uid), { uid, pendenteCentavos: s.pendente, disponivelCentavos: s.disponivel, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    }
    return gravados;
  }

  // ---------- 1) Crédito do pagamento (chamado DENTRO da transação que marca a aula como pago) ----------
  const idsPagamento = (aulaId) => [`pg_${aulaId}_prof`, `pg_${aulaId}_com`];
  const lerParaCredito = (tx, { aulaId, personalUid }) => ler(tx, { uids: [personalUid, C.PLATAFORMA_UID], ids: idsPagamento(aulaId) });
  function creditarPagamento(tx, estado, { aulaId, personalUid, split, liberaEmMs }) {
    if (split.personal + split.app !== split.total) throw new Error("split inconsistente");
    const liberaEm = Timestamp.fromMillis(liberaEmMs);
    return escrever(tx, estado, [
      { id: `pg_${aulaId}_prof`, uid: personalUid, tipo: "credito_aula", dPendente: split.personal, situacao: "pendente", liberaEm, aulaId, descricao: "Aula recebida (em carência)" },
      { id: `pg_${aulaId}_com`, uid: C.PLATAFORMA_UID, tipo: "comissao", dDisponivel: split.app, aulaId, descricao: "Comissão da plataforma" }
    ]);
  }

  // ---------- 2) Liberação: pendente → disponível ----------
  async function liberarVencidos({ uid = null, limite = 200 } = {}) {
    let q = db.collection("lancamentos").where("situacao", "==", "pendente").where("liberaEm", "<=", Timestamp.now());
    if (uid) q = q.where("carteiraUid", "==", uid);
    const vencidos = (await q.limit(limite).get()).docs;
    let liberados = 0;
    for (const d of vencidos) {
      const ok = await db.runTransaction(async (tx) => {
        const cred = await tx.get(refLanc(d.id));
        const c = cred.data();
        if (!c || c.situacao !== "pendente") return false;                 // estornado/liberado por outra execução
        const estado = await ler(tx, { uids: [c.carteiraUid], ids: [`lib_${d.id}`] });
        tx.update(refLanc(d.id), { situacao: "liberado" });
        escrever(tx, estado, [{ id: `lib_${d.id}`, uid: c.carteiraUid, tipo: "liberacao", dPendente: -c.dPendente, dDisponivel: c.dPendente, aulaId: c.aulaId, ref: d.id, descricao: "Saldo liberado para saque" }]);
        return true;
      });
      if (ok) liberados++;
    }
    return { liberados, analisados: vencidos.length };
  }

  // ---------- 3) Estorno (reembolso/chargeback/administrativo) ----------
  /** Desfaz o repasse e a comissão de uma aula paga. Idempotente. Chamar DEPOIS de o estorno existir no Mercado Pago. */
  async function estornarAula({ aulaId, motivo, origem, ator, mpRefundId = null }) {
    return db.runTransaction(async (tx) => {
      const pagRef = db.collection("pagamentos_internos").doc(aulaId), solRef = db.collection("aulas").doc(aulaId);
      const [pagS, solS, credS] = await Promise.all([tx.get(pagRef), tx.get(solRef), tx.get(refLanc(`pg_${aulaId}_prof`))]);
      const pag = pagS.data(), sol = solS.data(), cred = credS.data();
      if (!pag) throw new Falha(404, "Pagamento não encontrado.", "nao-encontrado");
      if (pag.status === "estornado") return { jaEstornado: true };
      if (pag.status !== "aprovado" || !cred) throw new Falha(409, "Só é possível estornar pagamentos aprovados.", "estorno-invalido");
      const notaS = sol?.notaId ? await tx.get(db.collection("notas").doc(sol.notaId)) : null;
      const estado = await ler(tx, { uids: [cred.carteiraUid, C.PLATAFORMA_UID], ids: [`est_${aulaId}_prof`, `est_${aulaId}_com`] });
      const valorProf = cred.dPendente, valorCom = pag.split.app;
      const jaLiberado = cred.situacao === "liberado";
      escrever(tx, estado, [
        { id: `est_${aulaId}_prof`, uid: cred.carteiraUid, tipo: "estorno", dPendente: jaLiberado ? 0 : -valorProf, dDisponivel: jaLiberado ? -valorProf : 0, aulaId, descricao: `Estorno: ${motivo}`.slice(0, 160) },
        { id: `est_${aulaId}_com`, uid: C.PLATAFORMA_UID, tipo: "estorno_comissao", dDisponivel: -valorCom, aulaId, descricao: `Estorno de comissão: ${motivo}`.slice(0, 160) }
      ], ator);
      tx.update(refLanc(`pg_${aulaId}_prof`), { situacao: "estornado" });
      tx.update(pagRef, { status: "estornado", estorno: { motivo: String(motivo).slice(0, 300), origem, ator, mpRefundId, em: FieldValue.serverTimestamp() } });
      if (sol) tx.update(solRef, { status: "estornada", estornadaEm: FieldValue.serverTimestamp() });
      if (notaS?.exists) tx.update(notaS.ref || db.collection("notas").doc(sol.notaId), { status: "cancelada", estornoEm: FieldValue.serverTimestamp() });
      tx.set(db.collection("estornos").doc(aulaId), { aulaId, valorCentavos: pag.split.total, motivo: String(motivo).slice(0, 300), origem, ator, mpRefundId, personalUid: cred.carteiraUid, criadoEm: FieldValue.serverTimestamp() });
      return { estornado: true, saldoNegativo: estado.saldos.get(cred.carteiraUid).disponivel < 0 };
    });
  }

  // ---------- 4) Saques ----------
  async function solicitarSaque({ uid, valorCentavos, pixEnc, pixTipo }) {
    if (!ehCentavos(valorCentavos) || valorCentavos < C.SAQUE_MINIMO_CENTAVOS) throw new Falha(400, `Saque mínimo: R$ ${(C.SAQUE_MINIMO_CENTAVOS / 100).toFixed(2).replace(".", ",")}.`, "saque-minimo");
    if (valorCentavos > C.SAQUE_MAXIMO_CENTAVOS) throw new Falha(400, "Valor acima do limite por saque.", "saque-maximo");
    if (!pixEnc) throw new Falha(400, "Cadastre sua chave Pix antes de sacar.", "sem-pix");
    const ref = db.collection("saques").doc();
    return db.runTransaction(async (tx) => {
      const estado = await ler(tx, { uids: [uid], ids: [`saq_${ref.id}`] });
      if (estado.saldos.get(uid).disponivel < valorCentavos) throw new Falha(409, "Saldo disponível insuficiente.", "saldo-insuficiente");
      tx.set(ref, { uid, valorCentavos, status: "solicitado", pixEnc, pixTipo, criadoEm: FieldValue.serverTimestamp() });
      escrever(tx, estado, [{ id: `saq_${ref.id}`, uid, tipo: "saque", dDisponivel: -valorCentavos, saqueId: ref.id, descricao: "Saque solicitado" }], uid);
      return { id: ref.id, valorCentavos, status: "solicitado" };
    });
  }
  async function resolverSaque({ saqueId, aprovar, adminUid, comprovante = "", motivo = "" }) {
    return db.runTransaction(async (tx) => {
      const ref = db.collection("saques").doc(saqueId), s = (await tx.get(ref)).data();
      if (!s) throw new Falha(404, "Saque não encontrado.", "nao-encontrado");
      if (s.status !== "solicitado") throw new Falha(409, `Saque já está "${s.status}".`, "saque-resolvido");
      if (aprovar) { tx.update(ref, { status: "pago", pagoEm: FieldValue.serverTimestamp(), adminUid, comprovante: String(comprovante).slice(0, 120) }); return { status: "pago" }; }
      const estado = await ler(tx, { uids: [s.uid], ids: [`saqrej_${saqueId}`] });
      tx.update(ref, { status: "rejeitado", rejeitadoEm: FieldValue.serverTimestamp(), adminUid, motivo: String(motivo).slice(0, 200) });
      escrever(tx, estado, [{ id: `saqrej_${saqueId}`, uid: s.uid, tipo: "saque_devolvido", dDisponivel: s.valorCentavos, saqueId, descricao: "Saque rejeitado — valor devolvido" }], adminUid);
      return { status: "rejeitado" };
    });
  }

  // ---------- 5) Consultas ----------
  async function saldo(uid) {
    const d = (await refCarteira(uid).get()).data() || {};
    return { pendenteCentavos: d.pendenteCentavos || 0, disponivelCentavos: d.disponivelCentavos || 0 };
  }
  async function extrato(uid, { limite = 50 } = {}) {
    const s = await db.collection("lancamentos").where("carteiraUid", "==", uid).orderBy("criadoEm", "desc").limit(Math.min(limite, 500)).get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // ---------- 6) Conciliação ----------
  async function* paginas(col, n = 400) {
    let ultimo = null;
    for (;;) {
      let q = db.collection(col).orderBy("__name__").limit(n);
      if (ultimo) q = q.startAfter(ultimo);
      const s = await q.get();
      if (s.empty) return;
      yield s.docs; ultimo = s.docs[s.docs.length - 1];
      if (s.docs.length < n) return;
    }
  }
  /**
   * Prova de que o dinheiro fecha. Verifica: (a) saldo de cada carteira = soma do seu ledger;
   * (b) cada pagamento aprovado tem repasse+comissão = total pago, e cada estornado soma zero;
   * (c) conservação global: Σ saldos + Σ saques (solicitados e pagos) = Σ recebido líquido de estornos;
   * (d) opcional: confronto com a API do Mercado Pago (mpConferir(mpPaymentId) → {status, valor}).
   */
  async function conciliar({ mpConferir = null, limiteMP = 50 } = {}) {
    const div = [], porCarteira = new Map(), porAula = new Map();
    let nLanc = 0;
    for await (const docs of paginas("lancamentos")) for (const d of docs) {
      const l = d.data(); nLanc++;
      const c = porCarteira.get(l.carteiraUid) || { p: 0, d: 0 }; c.p += l.dPendente; c.d += l.dDisponivel; porCarteira.set(l.carteiraUid, c);
      if (l.aulaId) { const p = porAula.get(l.aulaId) || { cred: 0, com: 0, est: 0, estCom: 0 }; if (l.tipo === "credito_aula") p.cred += l.dPendente; else if (l.tipo === "comissao") p.com += l.dDisponivel; else if (l.tipo === "estorno") p.est += l.dPendente + l.dDisponivel; else if (l.tipo === "estorno_comissao") p.estCom += l.dDisponivel; porAula.set(l.aulaId, p); }
    }
    let somaSaldos = 0, nCarteiras = 0;
    for await (const docs of paginas("carteiras")) for (const d of docs) {
      const w = d.data(), esp = porCarteira.get(d.id) || { p: 0, d: 0 }; nCarteiras++;
      if ((w.pendenteCentavos || 0) !== esp.p || (w.disponivelCentavos || 0) !== esp.d) div.push({ tipo: "saldo_carteira", ref: d.id, esperado: esp, encontrado: { p: w.pendenteCentavos || 0, d: w.disponivelCentavos || 0 }, descricao: "Saldo gravado difere da soma do ledger" });
      if ((w.disponivelCentavos || 0) < 0) div.push({ tipo: "saldo_negativo", ref: d.id, esperado: ">= 0", encontrado: w.disponivelCentavos, descricao: "Carteira negativa (estorno após saque/liberação) — recuperar com próximos créditos", informativo: true });
      somaSaldos += (w.pendenteCentavos || 0) + (w.disponivelCentavos || 0);
    }
    for (const [uid, c] of porCarteira) if (!(await refCarteira(uid).get()).exists && (c.p !== 0 || c.d !== 0)) div.push({ tipo: "carteira_inexistente", ref: uid, esperado: c, encontrado: null, descricao: "Há lançamentos sem documento de carteira" });
    let recebidoLiquido = 0, nPag = 0, conferidosMP = 0;
    const vistos = new Set();
    for await (const docs of paginas("pagamentos_internos")) for (const d of docs) {
      const p = d.data(); if (!["aprovado", "estornado"].includes(p.status)) continue; nPag++; vistos.add(d.id);
      const x = porAula.get(d.id) || { cred: 0, com: 0, est: 0, estCom: 0 }, total = p.split?.total;
      if (x.cred + x.com !== total) div.push({ tipo: "pagamento_sem_credito", ref: d.id, esperado: total, encontrado: x.cred + x.com, descricao: "Repasse + comissão ≠ valor pago pelo aluno" });
      if (p.status === "aprovado") recebidoLiquido += total;
      else if (x.cred + x.com + x.est + x.estCom !== 0) div.push({ tipo: "estorno_incompleto", ref: d.id, esperado: 0, encontrado: x.cred + x.com + x.est + x.estCom, descricao: "Aula estornada não zera no ledger" });
      if (p.estornoParcialCentavos > 0) div.push({ tipo: "estorno_parcial_mp", ref: d.id, esperado: 0, encontrado: p.estornoParcialCentavos, descricao: "Mercado Pago registrou estorno parcial — exige ajuste manual" });
      if (mpConferir && !p.simulado && p.mpPaymentId && conferidosMP < limiteMP) {
        conferidosMP++;
        try { const r = await mpConferir(p.mpPaymentId); const esperadoMP = p.status === "aprovado" ? "approved" : ["refunded", "charged_back"];
          const okMP = Array.isArray(esperadoMP) ? esperadoMP.includes(r.status) : r.status === esperadoMP;
          if (!okMP || r.valorCentavos !== total) div.push({ tipo: "mp_divergente", ref: d.id, esperado: { status: esperadoMP, valor: total }, encontrado: r, descricao: "Status/valor diferente do Mercado Pago" });
        } catch (e) { div.push({ tipo: "mp_indisponivel", ref: d.id, esperado: "consulta", encontrado: String(e.message).slice(0, 80), descricao: "Não foi possível consultar o Mercado Pago", informativo: true }); }
      }
    }
    for (const [aulaId, x] of porAula) if (!vistos.has(aulaId) && (x.cred || x.com)) div.push({ tipo: "credito_sem_pagamento", ref: aulaId, esperado: "pagamento aprovado", encontrado: x, descricao: "Lançamento sem pagamento aprovado correspondente" });
    let saquesAbertos = 0, saquesPagos = 0;
    for await (const docs of paginas("saques")) for (const d of docs) { const s = d.data(); if (s.status === "solicitado") saquesAbertos += s.valorCentavos; else if (s.status === "pago") saquesPagos += s.valorCentavos; }
    const diferenca = recebidoLiquido - (somaSaldos + saquesAbertos + saquesPagos);
    if (diferenca !== 0) div.push({ tipo: "conservacao_global", ref: "global", esperado: recebidoLiquido, encontrado: somaSaldos + saquesAbertos + saquesPagos, descricao: "Recebido líquido ≠ saldos + saques" });
    return {
      geradoEm: new Date().toISOString(),
      ok: div.filter((x) => !x.informativo).length === 0,
      totais: { recebidoLiquidoCentavos: recebidoLiquido, saldosCentavos: somaSaldos, saquesSolicitadosCentavos: saquesAbertos, saquesPagosCentavos: saquesPagos, diferencaCentavos: diferenca },
      contagens: { lancamentos: nLanc, carteiras: nCarteiras, pagamentos: nPag, conferidosMP },
      divergencias: div
    };
  }

  return { paginas, ler, escrever, lerParaCredito, creditarPagamento, liberarVencidos, estornarAula, solicitarSaque, resolverSaque, saldo, extrato, conciliar, idsPagamento };
}

module.exports = { criarCarteira };
