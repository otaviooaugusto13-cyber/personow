// Agregação do painel B2B (parceiros/indústrias). Função PURA: recebe aulas já filtrados por parceiro e devolve as métricas.
const PONTUAL_TOL_MIN = 10;
const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : 0);
const nomeCurto = (n) => { const p = String(n || "Personal").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0]; };
const regiaoDe = (o) => (o.regiao?.cidade ? `${o.regiao.cidade}/${o.regiao.uf || ""}`.replace(/\/$/, "") : "Não informada");
const arred = (n, c = 1) => Math.round(n * 10 ** c) / 10 ** c;

/** @param aulas [{id, ...aula}]  @param opts { desdeMs, regiao, instanteSP(data,hhmm), agora } */
function agregar(aulas, { desdeMs = 0, regiao = "", instanteSP, agora = Date.now() } = {}) {
  const todos = aulas.filter((o) => (ms(o.criadoEm) || 0) >= desdeMs && (!regiao || regiaoDe(o) === regiao));
  const exec = todos.filter((o) => o.fase === "executada" && o.checkin?.em && o.checkout?.em);
  const andamento = todos.filter((o) => o.fase === "em_andamento");
  const horas = (o) => (o.checkout?.minutosNoLocal ?? Math.round((ms(o.checkout.em) - ms(o.checkin.em)) / 60000)) / 60;
  const cheia = exec.filter((o) => o.checkout.conclusao === "completa").length;
  const porRegiao = new Map(), porProm = new Map();
  for (const o of exec) {
    const r = regiaoDe(o), a = porRegiao.get(r) || { regiao: r, horas: 0, chamados: 0, completa: 0 };
    a.horas += horas(o); a.chamados++; if (o.checkout.conclusao === "completa") a.completa++; porRegiao.set(r, a);
    const pid = o.personalUid, p = porProm.get(pid) || { nome: nomeCurto(o.personalNome), nivel: o.personalNivel || "bronze", chamados: 0, horas: 0, completa: 0, pontuais: 0, comHorario: 0, notas: [] };
    p.chamados++; p.horas += horas(o); if (o.checkout.conclusao === "completa") p.completa++;
    if (instanteSP && o.data && o.entrada) { p.comHorario++; if (ms(o.checkin.em) <= instanteSP(o.data, o.entrada) + PONTUAL_TOL_MIN * 60000) p.pontuais++; }
    if (o.avaliacao?.estrelas) p.notas.push(o.avaliacao.estrelas);
    porProm.set(pid, p);
  }
  const ranking = [...porProm.values()].map((p) => {
    const comp = [[0.4, p.completa / p.chamados]]; if (p.comHorario) comp.push([0.3, p.pontuais / p.comHorario]); if (p.notas.length) comp.push([0.3, p.notas.reduce((a, b) => a + b, 0) / p.notas.length / 5]);
    const score = Math.round((100 * comp.reduce((a, [w, v]) => a + w * v, 0)) / comp.reduce((a, [w]) => a + w, 0));
    return { nome: p.nome, nivel: p.nivel, chamados: p.chamados, horas: arred(p.horas), taxaCompleta: Math.round((100 * p.completa) / p.chamados), pontualidade: p.comHorario ? Math.round((100 * p.pontuais) / p.comHorario) : null, nota: p.notas.length ? arred(p.notas.reduce((a, b) => a + b, 0) / p.notas.length) : null, score };
  }).sort((a, b) => b.score - a.score || b.chamados - a.chamados).slice(0, 10);
  const recentes = [...exec].sort((a, b) => ms(b.checkout.em) - ms(a.checkout.em));
  return {
    kpis: { chamados: todos.length, executados: exec.length, emAndamento: andamento.length, horasTotal: arred(exec.reduce((a, o) => a + horas(o), 0)), taxaAulaCompleta: exec.length ? Math.round((100 * cheia) / exec.length) : null,
      fotosAuditoria: exec.length, personais: porProm.size, checkinsNegados: todos.reduce((a, o) => a + (o.checkinNegados || 0), 0), auditoriaContestada: exec.filter((o) => o.auditoriaAluno?.resultado === "contestada").length },
    porRegiao: [...porRegiao.values()].map((a) => ({ regiao: a.regiao, horas: arred(a.horas), chamados: a.chamados, taxaCompleta: Math.round((100 * a.completa) / a.chamados) })).sort((a, b) => b.horas - a.horas),
    regioes: [...new Set(aulas.map(regiaoDe))].sort(),
    ranking,
    aoVivo: andamento.map((o) => ({ aluno: o.aluno, regiao: regiaoDe(o), personal: nomeCurto(o.personalNome), desde: ms(o.checkin?.em) })),
    presencas: recentes.slice(0, 40).map((o) => ({ id: o.id, aluno: o.aluno, regiao: regiaoDe(o), personal: nomeCurto(o.personalNome), entrada: ms(o.checkin.em), saida: ms(o.checkout.em), minutos: o.checkout.minutosNoLocal ?? null,
      distanciaM: o.checkin.distanciaM ?? null, precisaoM: o.checkin.precisaoM ?? null, noRaio: o.checkin.noRaio === true, simulado: !!o.checkin.simulado, saidaNoRaio: o.checkout.noRaio ?? null })),
    fotosIds: recentes.slice(0, 24).map((o) => ({ id: o.id, aluno: o.aluno, personal: nomeCurto(o.personalNome), em: ms(o.checkout.em), conclusao: o.checkout.conclusao, auditoria: o.auditoriaAluno?.resultado || null }))
  };
}
module.exports = { agregar, nomeCurto, regiaoDe };
