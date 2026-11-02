// ============================================================
// REPUTAÇÃO: níveis de confiabilidade (comissão progressiva) + advertências, "vidas", multas e banimento.
//
//  reputacao/{uid}   estado de cada conta (personal ou aluno). Só o servidor escreve; o dono lê (regras do Firestore).
//  infracoes/{id}    registro imutável de cada infração (id determinístico → idempotente: repetir não pune duas vezes).
//  niveis_historico  subidas e rebaixamentos (auditoria).
//
// Níveis (split.js): Bronze 25% · Prata 20% · Ouro 15% · Platina 10%. O contador sobe no CHECK-OUT (serviço executado).
// Inatividade: 2 meses sem concluir chamados → rebaixa 1 nível por período inativo (ou volta ao Bronze: INATIVIDADE_MODO).
// Infrações: desistência/cancelamento em cima da hora e faltas → advertência + multa. 3 advertências = banimento automático.
//   Personal: a multa é DEBITADA da carteira (ledger: pode ficar negativa e é recuperada nos próximos créditos).
//   Aluno: a multa fica registrada como "pendente" para cobrança (não há cobrança automática no cartão sem o CVV).
// ============================================================
const { Falha } = require("./erros");
const C = require("./config");
const V = require("./validacao");
const S = require("../split");

const DIA = 86_400_000;
const ms = (ts) => (ts?.toMillis ? ts.toMillis() : typeof ts === "number" ? ts : 0);

/** PURA: efeito da inatividade sobre um estado de reputação. */
function calcularInatividade(rep, agoraMs = Date.now()) {
  const atual = S.nivelPorId(rep?.nivel), idx = S.indiceNivel(atual.id);
  if (idx === 0) return { periodos: 0 };
  const periodo = C.INATIVIDADE_DIAS * DIA, ref = ms(rep.atividadeRefEm) || ms(rep.nivelDesde) || agoraMs;
  const periodos = Math.floor((agoraMs - ref) / periodo);
  if (periodos <= 0) return { periodos: 0, rebaixaEmMs: ref + periodo };
  const resetar = C.INATIVIDADE_MODO === "resetar";
  const novo = S.NIVEIS[resetar ? 0 : Math.max(0, idx - periodos)];
  return { periodos, de: atual.id, para: novo.id, novoConcluidos: Math.min(rep.concluidos || 0, novo.minConcluidos), novaRefMs: resetar || novo.id === "bronze" ? agoraMs : ref + periodos * periodo };
}

function criarReputacao({ db, admin, FieldValue, Timestamp, auth, carteira, taxas }) {
  const refRep = (uid) => db.collection("reputacao").doc(uid);
  const ts = () => FieldValue.serverTimestamp();

  /** Garante o documento. Personais antigos entram com o nível correspondente aos serviços já pagos. */
  async function garantir(uid, papel) {
    const r = await refRep(uid).get();
    if (r.exists) return r.data();
    const base = { uid, papel, advertencias: 0, banido: false, criadoEm: ts() };
    if (papel === "personal") {
      const s = await db.collection("aulas").where("personalUid", "==", uid).get();
      const n = s.docs.filter((d) => ["paga", "concluida"].includes(d.data().status)).length;
      Object.assign(base, { concluidos: n, nivel: S.nivelPorConcluidos(n).id, nivelDesde: Timestamp.now(), atividadeRefEm: Timestamp.now() });
    }
    await refRep(uid).set(base, { merge: true });
    return (await refRep(uid).get()).data();
  }

  // ---------- níveis ----------
  /** Aplica (se houver) o rebaixamento por inatividade. Idempotente. Devolve o estado atualizado. */
  async function avaliarInatividade(uid) {
    const rep = await garantir(uid, "personal");
    if (!calcularInatividade(rep).periodos) return rep;
    await db.runTransaction(async (tx) => {
      const doc = (await tx.get(refRep(uid))).data(), c = calcularInatividade(doc);
      if (!c.periodos) return;
      tx.set(refRep(uid), { nivel: c.para, concluidos: c.novoConcluidos, nivelDesde: Timestamp.now(), atividadeRefEm: Timestamp.fromMillis(c.novaRefMs), ultimoRebaixamentoEm: ts() }, { merge: true });
      tx.set(db.collection("niveis_historico").doc(), { uid, de: c.de, para: c.para, motivo: "inatividade", periodos: c.periodos, modo: C.INATIVIDADE_MODO, em: ts() });
    });
    return (await refRep(uid).get()).data();
  }
  /** Nível vigente no momento do aceite (a comissão da aula fica "congelada" nele). */
  async function nivelParaAceite(uid) { return S.nivelPorId((await avaliarInatividade(uid)).nivel); }

  /** Dentro da transação do check-out: +1 chamado concluído, possível subida de nível. `rep` foi lido com tx.get ANTES de qualquer escrita. */
  function concluirChamadoTx(tx, uid, rep) {
    let atual = { ...rep };
    const ina = calcularInatividade(atual);
    if (ina.periodos) {                                                    // a inatividade vale ANTES de contar o novo chamado
      atual = { ...atual, nivel: ina.para, concluidos: ina.novoConcluidos };
      tx.set(db.collection("niveis_historico").doc(), { uid, de: ina.de, para: ina.para, motivo: "inatividade", periodos: ina.periodos, modo: C.INATIVIDADE_MODO, em: ts() });
    }
    const antes = S.nivelPorId(atual.nivel), concluidos = (atual.concluidos || 0) + 1, depois = S.nivelPorConcluidos(concluidos);
    const sobe = S.indiceNivel(depois.id) > S.indiceNivel(antes.id);
    tx.set(refRep(uid), { concluidos, nivel: depois.id, ultimaConclusaoEm: Timestamp.now(), atividadeRefEm: Timestamp.now(), ...(depois.id !== S.nivelPorId(rep.nivel).id || sobe ? { nivelDesde: Timestamp.now() } : {}) }, { merge: true });
    if (sobe) tx.set(db.collection("niveis_historico").doc(), { uid, de: antes.id, para: depois.id, motivo: "conclusoes", concluidos, em: ts() });
    return { subiu: sobe, de: antes.id, para: depois.id, concluidos };
  }

  // ---------- infrações ----------
  const textoBanimento = (rotulo, n) => `Conta bloqueada permanentemente: ${n} advertências acumuladas (limite: ${C.VIDAS_MAX}). Última infração: ${rotulo}.`;

  async function liberarAulasDe(uid, papel) {
    if (papel === "personal") {
      const s = await db.collection("aulas").where("personalUid", "==", uid).where("status", "==", "aceita").get();
      for (const d of s.docs) if (!d.data().fase) await d.ref.update({ status: "aberta", personalUid: FieldValue.delete(), personalNome: FieldValue.delete(), aceitoEm: FieldValue.delete(), nivelAceite: FieldValue.delete(), personalNivel: FieldValue.delete(), comissaoPct: FieldValue.delete() });
    } else {
      const s = await db.collection("aulas").where("uid", "==", uid).get();
      for (const d of s.docs) { const o = d.data(); if (["aberta", "aceita"].includes(o.status) && !o.fase) await d.ref.update({ status: "cancelada", motivoCancelamento: "conta_bloqueada", canceladoPor: "sistema", canceladoEm: ts() }); }
    }
  }
  async function banirConta(uid, papel) {
    await auth.definirPapel(uid, papel, { banido: true });
    await admin.auth().revokeRefreshTokens(uid);                            // derruba as sessões; o novo login já nasce com a claim "banido"
    if (papel === "personal") await db.collection("personais").doc(uid).set({ status: "bloqueado", statusMotivo: "Banimento automático por advertências", statusPor: "sistema", statusEm: ts(), banidoAutomatico: true }, { merge: true });
    await liberarAulasDe(uid, papel);
  }
  async function desbanirConta(uid, papel) {
    await auth.definirPapel(uid, papel, { banido: false });
    await admin.auth().revokeRefreshTokens(uid);
    if (papel === "personal") { const p = (await db.collection("personais").doc(uid).get()).data(); if (p?.banidoAutomatico) await db.collection("personais").doc(uid).set({ status: "ativo", statusMotivo: "", statusPor: "admin", statusEm: ts(), banidoAutomatico: false }, { merge: true }); }
  }

  /**
   * Aplica advertência + multa + registro. Idempotente por (tipo, aula, conta, chave).
   * Na 3ª advertência bane a conta. Devolve { aplicada | jaAplicada, id, advertencias, vidas, banido, multaCentavos }.
   */
  async function aplicarInfracao({ uid, papel, tipo, aulaId = null, detalhe = "", origem = "sistema", chave = "" }) {
    if (C.INFRACAO_PAPEL[tipo] !== papel) throw new Error(`infração ${tipo} não se aplica a ${papel}`);
    if (C.CONTAS_TESTE.includes(uid)) return { ignorada: true, tipo, multaCentavos: 0, vidas: C.VIDAS_MAX, advertencias: 0, banido: false };   // sandbox
    await garantir(uid, papel);
    const multa = C.MULTAS_CENTAVOS[tipo], rotulo = C.INFRACAO_ROTULO[tipo];
    const id = `inf_${tipo}_${aulaId || "x"}_${uid}${chave ? "_" + chave : ""}`.slice(0, 200), infRef = db.collection("infracoes").doc(id);
    const r = await db.runTransaction(async (tx) => {
      const [infS, repS] = await Promise.all([tx.get(infRef), tx.get(refRep(uid))]);
      if (infS.exists) { const i = infS.data(); return { jaAplicada: true, id, multaCentavos: i.multaCentavos, advertencias: i.advertenciaNum }; }
      const rep = repS.data(), n = (rep.advertencias || 0) + 1, banir = n >= C.VIDAS_MAX && !rep.banido;
      const estado = papel === "personal" ? await carteira.ler(tx, { uids: [uid, C.PLATAFORMA_UID], ids: [`multa_${id}_prof`, `multa_${id}_plat`] }) : null;
      tx.set(infRef, { uid, papel, tipo, rotulo, aulaId, detalhe: String(detalhe).slice(0, 300), origem, multaCentavos: multa, multaStatus: papel === "personal" ? "debitada" : "pendente", status: "ativa", advertenciaNum: n, causouBanimento: banir, em: ts() });
      tx.set(refRep(uid), { advertencias: n, ultimaInfracaoEm: ts(), ultimaInfracaoRotulo: rotulo, ...(banir ? { banido: true, banidoEm: ts(), banidoMotivo: textoBanimento(rotulo, n) } : {}) }, { merge: true });
      if (estado) carteira.escrever(tx, estado, [
        { id: `multa_${id}_prof`, uid, tipo: "multa", dDisponivel: -multa, aulaId, ref: id, descricao: `Multa: ${rotulo}`.slice(0, 160) },
        { id: `multa_${id}_plat`, uid: C.PLATAFORMA_UID, tipo: "multa_receita", dDisponivel: multa, aulaId, ref: id, descricao: `Multa aplicada: ${rotulo}`.slice(0, 160) }
      ], "sistema");
      return { aplicada: true, id, advertencias: n, banir, multaCentavos: multa };
    });
    if (r.banir) await banirConta(uid, papel);
    return { ...r, tipo, rotulo, vidas: Math.max(0, C.VIDAS_MAX - (r.advertencias || 0)), banido: !!r.banir };
  }

  /** Admin: contesta uma infração (devolve a multa, devolve a vida, desfaz o banimento causado por ela). */
  async function revogarInfracao({ id, ator, motivo }) {
    const infRef = db.collection("infracoes").doc(id);
    const r = await db.runTransaction(async (tx) => {
      const infS = await tx.get(infRef), inf = infS.data();
      if (!inf) throw new Falha(404, "Infração não encontrada.", "nao-encontrado");
      if (inf.status !== "ativa") throw new Falha(409, "Esta infração já foi revogada.", "infracao-revogada");
      const repS = await tx.get(refRep(inf.uid)), rep = repS.data() || {};
      const estado = inf.papel === "personal" && inf.multaStatus === "debitada" ? await carteira.ler(tx, { uids: [inf.uid, C.PLATAFORMA_UID], ids: [`multarev_${id}_prof`, `multarev_${id}_plat`] }) : null;
      const n = Math.max(0, (rep.advertencias || 0) - 1), desbanir = !!rep.banido && !!inf.causouBanimento && n < C.VIDAS_MAX;
      tx.update(infRef, { status: "revogada", revogadaPor: ator, revogadaMotivo: String(motivo).slice(0, 200), revogadaEm: ts(), multaStatus: inf.multaStatus === "debitada" ? "devolvida" : "cancelada" });
      tx.set(refRep(inf.uid), { advertencias: n, ...(desbanir ? { banido: false, banidoMotivo: FieldValue.delete(), desbanidoEm: ts() } : {}) }, { merge: true });
      if (estado) carteira.escrever(tx, estado, [
        { id: `multarev_${id}_prof`, uid: inf.uid, tipo: "multa_devolvida", dDisponivel: inf.multaCentavos, aulaId: inf.aulaId, ref: id, descricao: `Multa devolvida: ${inf.rotulo}`.slice(0, 160) },
        { id: `multarev_${id}_plat`, uid: C.PLATAFORMA_UID, tipo: "multa_estorno", dDisponivel: -inf.multaCentavos, aulaId: inf.aulaId, ref: id, descricao: `Multa revogada: ${inf.rotulo}`.slice(0, 160) }
      ], ator);
      return { uid: inf.uid, papel: inf.papel, desbanir, advertencias: n };
    });
    if (r.desbanir) await desbanirConta(r.uid, r.papel);
    return { ok: true, ...r, vidas: Math.max(0, C.VIDAS_MAX - r.advertencias) };
  }
  /** Admin: remove o banimento manualmente (zera ou deixa a conta na última vida). */
  async function desbanir({ uid, ator, motivo, zerar = false }) {
    const rep = (await refRep(uid).get()).data();
    if (!rep || !rep.banido) throw new Falha(409, "Esta conta não está banida.", "nao-banida");
    await refRep(uid).set({ banido: false, banidoMotivo: FieldValue.delete(), desbanidoEm: ts(), desbanidoPor: ator, desbanidoMotivo: String(motivo).slice(0, 200), advertencias: zerar ? 0 : C.VIDAS_MAX - 1 }, { merge: true });
    await desbanirConta(uid, rep.papel);
    return { ok: true, advertencias: zerar ? 0 : C.VIDAS_MAX - 1 };
  }
  async function marcarMultaCobrada({ id, ator }) {
    const ref = db.collection("infracoes").doc(id), inf = (await ref.get()).data();
    if (!inf) throw new Falha(404, "Infração não encontrada.", "nao-encontrado");
    if (inf.papel !== "aluno" || inf.multaStatus !== "pendente") throw new Falha(409, "Não há multa pendente de cobrança nesta infração.", "estado-invalido");
    await ref.update({ multaStatus: "cobrada", cobradaPor: ator, cobradaEm: ts() });
    return { ok: true };
  }

  // ---------- faltas (varredura) ----------
  /** Aulas aceitas cujo check-in não ocorreu até o fim da janela = falta do personal. Idempotente; chamada pelo cron e sob demanda. */
  async function varrerFaltas({ uid = null, agora = Date.now() } = {}) {
    let q = db.collection("aulas").where("status", "==", "aceita");
    if (uid) q = q.where("personalUid", "==", uid);
    let faltas = 0;
    for (const d of (await q.get()).docs) {
      const o = d.data();
      if (!o.exigeExecucao || o.fase || !o.personalUid || !o.data || !o.entrada) continue;
      if (agora <= V.instanteSP(o.data, o.entrada) + C.GEO.CHECKIN_ATE_MIN * 60_000) continue;
      await aplicarInfracao({ uid: o.personalUid, papel: "personal", tipo: "falta_personal", aulaId: d.id, chave: String(ms(o.aceitoEm)), detalhe: `${o.aluno} · ${o.data} ${o.horario || ""}`.trim() });
      await db.runTransaction(async (tx) => {
        const cur = (await tx.get(d.ref)).data();
        if (cur?.status === "aceita" && !cur.fase) tx.update(d.ref, { status: "cancelada", motivoCancelamento: "falta_personal", canceladoPor: "sistema", canceladoEm: ts() });
      });
      faltas++;
    }
    return { faltas };
  }

  // ---------- consulta ----------
  const regrasPublicas = () => ({
    vidasMax: C.VIDAS_MAX, cancelamentoTardioHoras: C.CANCELAMENTO_TARDIO_HORAS, multasCentavos: C.MULTAS_CENTAVOS, rotulos: C.INFRACAO_ROTULO,
    raioMetros: C.GEO.RAIO_METROS, checkinAntesMin: C.GEO.CHECKIN_ANTES_MIN, checkinAteMin: C.GEO.CHECKIN_ATE_MIN, inatividadeDias: C.INATIVIDADE_DIAS, inatividadeModo: C.INATIVIDADE_MODO
  });
  async function resumo(uid, papel) {
    let rep = await garantir(uid, papel);
    if (papel === "personal") rep = await avaliarInatividade(uid);
    const infrs = (await db.collection("infracoes").where("uid", "==", uid).orderBy("em", "desc").limit(20).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const iso = (t) => (t?.toDate ? t.toDate().toISOString() : null);
    const adv = rep.advertencias || 0;
    const out = {
      papel, advertencias: adv, vidas: Math.max(0, C.VIDAS_MAX - adv), vidasMax: C.VIDAS_MAX, banido: !!rep.banido, banidoMotivo: rep.banido ? rep.banidoMotivo || "" : "", banidoEm: iso(rep.banidoEm),
      infracoes: infrs.map((i) => ({ id: i.id, tipo: i.tipo, rotulo: i.rotulo, detalhe: i.detalhe || "", multaCentavos: i.multaCentavos, multaStatus: i.multaStatus, status: i.status, advertenciaNum: i.advertenciaNum, em: iso(i.em) })),
      regras: regrasPublicas()
    };
    if (papel === "personal") {
      const n = S.nivelPorId(rep.nivel), idx = S.indiceNivel(n.id), prox = S.NIVEIS[idx + 1] || null, c = rep.concluidos || 0;
      const ina = calcularInatividade(rep), cfg = taxas ? await taxas.obter() : S.PADRAO;
      Object.assign(out, {
        nivel: { id: n.id, nome: n.nome, comissaoPct: n.comissaoPct, minConcluidos: n.minConcluidos }, concluidos: c, niveis: S.NIVEIS,
        proximo: prox ? { id: prox.id, nome: prox.nome, minConcluidos: prox.minConcluidos, faltam: Math.max(0, prox.minConcluidos - c), comissaoPct: prox.comissaoPct } : null,
        progressoPct: prox ? Math.min(100, Math.round(((c - n.minConcluidos) / (prox.minConcluidos - n.minConcluidos)) * 100)) : 100,
        repasseCentavos: S.calcularPreco(cfg, n.id).personal, comissaoCentavos: S.calcularPreco(cfg, n.id).comissao,
        inatividade: { dias: C.INATIVIDADE_DIAS, expiraEm: idx > 0 && ina.rebaixaEmMs ? new Date(ina.rebaixaEmMs).toISOString() : null, ultimaConclusaoEm: iso(rep.ultimaConclusaoEm) }
      });
    }
    return out;
  }

  return { garantir, avaliarInatividade, nivelParaAceite, concluirChamadoTx, aplicarInfracao, revogarInfracao, desbanir, marcarMultaCobrada, varrerFaltas, banirConta, desbanirConta, liberarAulasDe, resumo, regrasPublicas, calcularInatividade };
}
module.exports = { criarReputacao, calcularInatividade };
