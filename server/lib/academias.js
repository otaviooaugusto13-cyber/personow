// Academias parceiras: casamento do local da aula com a academia e agregação SOMENTE de números (sem dado pessoal).
// Função pura: recebe aulas já lidas do banco e devolve métricas. Nunca devolve nome/uid/e-mail de aluno ou personal.
const semAcento = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const ALIAS_MIN = 4;   // apelido curto demais ("sp", "fit") casaria com endereços alheios

/** Apelidos normalizados e únicos (o nome da academia sempre entra). */
function apelidos(academia) {
  const todos = [academia.nome, ...(Array.isArray(academia.aliases) ? academia.aliases : [])].map(semAcento).filter((a) => a.length >= ALIAS_MIN);
  return [...new Set(todos)];
}
/** A aula é desta academia? Se o pedido já traz academiaId vale ele; senão, o texto livre `local` contém algum apelido. */
function aulaDaAcademia(aula, academia) {
  if (aula.academiaId) return aula.academiaId === academia.id;
  const l = semAcento(aula.local);
  return !!l && apelidos(academia).some((a) => l.includes(a));
}
const diaSemana = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); return Number.isNaN(d.getTime()) ? null : d.getUTCDay(); };
const hora = (hhmm) => { const m = /^(\d{2}):\d{2}$/.exec(String(hhmm || "")); return m && +m[1] < 24 ? +m[1] : null; };
const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/**
 * @param aulas [{id, status, data, entrada, foco, personalUid, local, academiaId?}]
 * @param academia {id, nome, aliases}
 * @param opts { desde: "YYYY-MM-DD" }
 * Realizadas = status "concluida". "paga" = paga e ainda por acontecer/confirmar (aparece à parte).
 */
function agregar(aulas, academia, { desde = "" } = {}) {
  const minhas = aulas.filter((a) => (a.status === "concluida" || a.status === "paga") && (!desde || String(a.data || "") >= desde) && aulaDaAcademia(a, academia));
  const realizadas = minhas.filter((a) => a.status === "concluida");
  const porHora = Array(24).fill(0), porDiaSemana = Array(7).fill(0), porFoco = {}, porData = {}, personais = new Set();
  for (const a of realizadas) {
    const h = hora(a.entrada), d = diaSemana(a.data);
    if (h !== null) porHora[h]++;
    if (d !== null) porDiaSemana[d]++;
    if (a.foco) porFoco[a.foco] = (porFoco[a.foco] || 0) + 1;
    if (a.data) porData[a.data] = (porData[a.data] || 0) + 1;
    if (a.personalUid) personais.add(a.personalUid);   // só conta: o identificador não sai daqui
  }
  const picos = porHora.map((n, h) => ({ hora: h, aulas: n })).filter((x) => x.aulas > 0).sort((a, b) => b.aulas - a.aulas || a.hora - b.hora).slice(0, 3)
    .map((x) => ({ faixa: `${String(x.hora).padStart(2, "0")}h–${String((x.hora + 1) % 24).padStart(2, "0")}h`, hora: x.hora, aulas: x.aulas }));
  const diaPico = realizadas.length ? porDiaSemana.indexOf(Math.max(...porDiaSemana)) : null;
  return {
    kpis: { aulasRealizadas: realizadas.length, aulasPagasAgendadas: minhas.length - realizadas.length, personaisAtivos: personais.size },
    porHora, porDiaSemana: porDiaSemana.map((n, i) => ({ dia: NOMES_DIA[i], aulas: n })), diaPico: diaPico === null ? null : NOMES_DIA[diaPico], picos,
    porFoco: Object.entries(porFoco).map(([foco, n]) => ({ foco, aulas: n })).sort((a, b) => b.aulas - a.aulas),
    porData: Object.entries(porData).sort(([a], [b]) => a.localeCompare(b)).map(([data, n]) => ({ data, aulas: n }))
  };
}
module.exports = { agregar, aulaDaAcademia, apelidos, semAcento, ALIAS_MIN };
