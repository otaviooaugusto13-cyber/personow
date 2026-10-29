// Perfil inteligente do PERSONAL — funções puras (sem DOM, sem Firebase; testadas em node: test/perfil.test.js).
//   1) transforma "anos de experiência por foco" em palavras-chave e bio (revisável antes de salvar);
//   2) pontua cada PEDIDO de aula para o personal (0–100): distância + afinidade com os focos dele + valor;
//   3) pontua cada PERSONAL para o aluno: distância + afinidade com o foco pedido + avaliação.
//
// Transparência: gerador por REGRAS (determinístico, offline, sem custo e sem inventar fatos — só usa o que o personal informou).
// A matriz de afinidade entre focos é heurística de produto (ex.: quem treina hipertrofia costuma servir para musculação),
// serve só para ORDENAR sugestões e nunca aprova, reprova ou bloqueia ninguém.
import { FOCOS, RAIO_KM_AULAS, ANOS_EXPERIENCIA_MAX } from "./config.js";

export const FOCOS_V = FOCOS.map((f) => f.v);
export const MAX_EXPERIENCIAS = FOCOS_V.length, MAX_PALAVRAS = 12, MAX_BIO = 300;
export const PESOS_OFERTA = { dist: 40, exp: 40, valor: 20 };
export const PESOS_PERSONAL = { dist: 40, exp: 40, nota: 20 };

// Ordem = FOCOS: Musculação, Hipertrofia, Emagrecimento, Corrida, Funcional, Avaliação Física
const AFIN = {
    "Musculação":       [1, .9, .5, .2, .6, .4],
    "Hipertrofia":      [.9, 1, .4, .15, .5, .4],
    "Emagrecimento":    [.5, .4, 1, .7, .8, .5],
    "Corrida":          [.2, .15, .7, 1, .5, .3],
    "Funcional":        [.6, .5, .8, .5, 1, .4],
    "Avaliação Física": [.4, .4, .5, .3, .4, 1]
};
const TEXTO = {
    "Musculação":       { nome: "musculação", tags: ["musculação", "técnica de execução", "progressão de carga"], entrega: "treino seguro, com técnica correta e progressão de carga" },
    "Hipertrofia":      { nome: "hipertrofia", tags: ["hipertrofia", "ganho de massa", "periodização"], entrega: "ganho de massa com periodização e foco na execução" },
    "Emagrecimento":    { nome: "emagrecimento", tags: ["emagrecimento", "condicionamento", "treino sustentável"], entrega: "emagrecimento sustentável, com treino que cabe na sua rotina" },
    "Corrida":          { nome: "corrida", tags: ["corrida", "resistência", "treino de rua"], entrega: "evolução na corrida, do primeiro quilômetro às provas" },
    "Funcional":        { nome: "treino funcional", tags: ["funcional", "mobilidade", "força e condicionamento"], entrega: "mobilidade, força e condicionamento com treinos dinâmicos" },
    "Avaliação Física": { nome: "avaliação física", tags: ["avaliação física", "metas", "acompanhamento"], entrega: "avaliação completa para definir o ponto de partida e as metas" }
};

const unir = (l) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`);
const anosTxt = (n) => `${n} ${n === 1 ? "ano" : "anos"}`;

/** Normaliza: só focos oficiais, sem repetição, anos 0–50, mais experiente primeiro. */
export function normalizarExperiencias(lista) {
    const vistos = new Set(), out = [];
    for (const e of Array.isArray(lista) ? lista : []) {
        if (!e || !TEXTO[e.foco] || vistos.has(e.foco)) continue;
        vistos.add(e.foco);
        out.push({ foco: e.foco, anos: Math.max(0, Math.min(ANOS_EXPERIENCIA_MAX, Math.floor(Number(e.anos) || 0))) });
    }
    return out.slice(0, MAX_EXPERIENCIAS).sort((a, b) => b.anos - a.anos);
}

export function gerarPalavrasChave({ experiencias, cref = false } = {}) {
    const exps = normalizarExperiencias(experiencias), kw = [];
    exps.slice(0, 3).forEach((e, i) => TEXTO[e.foco].tags.slice(0, i === 0 ? 3 : 2).forEach((t) => kw.push(t)));
    if (exps[0]?.anos >= 1) kw.push(`${exps[0].anos}+ ${exps[0].anos === 1 ? "ano" : "anos"} de experiência`);
    if (cref) kw.push("CREF");
    const vistos = new Set();
    return kw.filter((k) => { const c = k.toLowerCase(); if (vistos.has(c)) return false; vistos.add(c); return true; }).slice(0, MAX_PALAVRAS);
}

/** Bio de até 300 caracteres, em primeira pessoa. Usa SÓ o que o personal informou (focos, anos, CREF). */
export function gerarBio({ experiencias, cref = false } = {}) {
    const exps = normalizarExperiencias(experiencias), principal = exps[0] ? TEXTO[exps[0].foco] : null;
    const partes = exps.slice(0, 2).map((e) => (e.anos >= 1 ? `${anosTxt(e.anos)} em ${TEXTO[e.foco].nome}` : `experiência em ${TEXTO[e.foco].nome}`));
    const s1 = partes.length ? `Personal trainer com ${unir(partes)}.` : "Personal trainer focado em acompanhar cada aluno de perto.";
    const s2 = principal ? `Entrego ${principal.entrega}.` : "";
    const s3 = cref ? "Profissional registrado no CREF." : "";
    const fecho = "Pontual e comprometido com cada treino.";
    const blocos = [s1, s2, s3, fecho].filter(Boolean);
    while (blocos.length > 1 && blocos.join(" ").length > MAX_BIO) blocos.splice(blocos.length - 1 - (blocos.length > 2 ? 1 : 0), 1);   // tira fecho, depois CREF
    let bio = blocos.join(" ");
    if (bio.length > MAX_BIO) bio = bio.slice(0, MAX_BIO - 1).replace(/[\s,;:.]+\S*$/, "") + "…";
    return bio;
}
export const gerarPerfil = (dados) => ({ palavrasChave: gerarPalavrasChave(dados), bio: gerarBio(dados), experiencias: normalizarExperiencias(dados?.experiencias) });

// ---------- afinidades (0–1, ou null quando não há dado: fator desconhecido NÃO penaliza) ----------
const fatorAnos = (a) => (a >= 5 ? 1 : a >= 3 ? .95 : a >= 2 ? .85 : a >= 1 ? .75 : .6);
export function afinidadeExperiencia(experiencias, foco) {
    const exps = normalizarExperiencias(experiencias), i = FOCOS_V.indexOf(foco);
    if (!exps.length || i < 0) return null;
    let melhor = { v: 0, e: null };
    for (const e of exps) { const v = AFIN[e.foco][i] * fatorAnos(e.anos); if (v > melhor.v) melhor = { v, e }; }
    return { v: Math.max(.1, melhor.v), foco: melhor.e?.foco, anos: melhor.e?.anos || 0, direta: melhor.e?.foco === foco };
}
export const afinidadeDistancia = (km, raio = RAIO_KM_AULAS) => (Number.isFinite(km) ? Math.max(0, 1 - km / raio) : null);
/** Quanto o pedido paga em relação ao mínimo do personal: no mínimo = 0,6; 20% acima ou mais = 1. null sem mínimo definido. */
export function afinidadeValor(valorPersonalCentavos, valorMinCentavos) {
    if (!(valorMinCentavos > 0) || !(valorPersonalCentavos > 0)) return null;
    const r = valorPersonalCentavos / valorMinCentavos;
    return r < 1 ? 0 : Math.min(1, .6 + (r - 1) * 2);
}
const nivel = (s) => (s >= 80 ? "alto" : s >= 60 ? "medio" : "baixo");
function combinar(fatores) {
    const f = fatores.filter(([, v]) => v !== null);
    if (!f.length) return { score: null, nivel: "nenhum", conhecidos: 0 };
    const total = f.reduce((a, [, , p]) => a + p, 0), score = Math.round((f.reduce((a, [, v, p]) => a + v * p, 0) / total) * 100);
    return { score, nivel: nivel(score), conhecidos: f.length };
}

/** Pontua um PEDIDO para o personal. Devolve { score, nivel, razoes[] }. */
export function pontuarOferta(oferta, { distKm = null, experiencias = [], valorMinCentavos = 0, valorPersonalCentavos = 0, raio = RAIO_KM_AULAS, fmtKm = (k) => `${k.toFixed(1)} km` } = {}) {
    const dist = afinidadeDistancia(distKm, raio), exp = afinidadeExperiencia(experiencias, oferta?.foco), val = afinidadeValor(valorPersonalCentavos, valorMinCentavos);
    const razoes = [];
    if (dist !== null && dist >= .5) razoes.push(`📍 A ${fmtKm(distKm)} de você`);
    if (exp && exp.v >= .6) razoes.push(exp.direta ? `💼 ${exp.anos >= 1 ? anosTxt(exp.anos) + " de" : "Sua"} experiência em ${TEXTO[oferta.foco].nome}` : `💼 Experiência próxima: ${TEXTO[exp.foco].nome}`);
    if (val !== null && val >= .8) razoes.push("💰 Acima do seu valor mínimo");
    return { ...combinar([["dist", dist, PESOS_OFERTA.dist], ["exp", exp?.v ?? null, PESOS_OFERTA.exp], ["valor", val, PESOS_OFERTA.valor]]), razoes };
}
/** Maior score primeiro; empate: mais perto, depois mais cedo. Cada item ganha `match`. */
export function ranquearOfertas(ofertas, ctx) {
    return ofertas.map((o) => ({ ...o, match: pontuarOferta(o, { ...ctx, distKm: o.distKm ?? null, valorPersonalCentavos: o.valorPersonalCentavos ?? 0 }) }))
        .sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1) || (a.distKm ?? 1e9) - (b.distKm ?? 1e9) || `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
}

/** Pontua um PERSONAL para o aluno que quer `foco`. Nota: sem avaliações = null (não penaliza quem é novo). */
export function pontuarPersonal(p, { foco = "", distKm = null, raio = RAIO_KM_AULAS, fmtKm = (k) => `${k.toFixed(1)} km` } = {}) {
    const dist = afinidadeDistancia(distKm, raio), exp = foco ? afinidadeExperiencia(p?.experiencias, foco) : null;
    const nota = p?.ratingQtd > 0 ? Math.max(0, Math.min(1, (Number(p.ratingMedia) - 3) / 2)) : null;   // 3★ = 0, 5★ = 1
    const razoes = [];
    if (exp && exp.v >= .6) razoes.push(exp.direta ? `💼 ${exp.anos >= 1 ? anosTxt(exp.anos) + " de" : "Experiência em"} ${TEXTO[foco].nome}` : `💼 Experiência próxima: ${TEXTO[exp.foco].nome}`);
    if (dist !== null && dist >= .5) razoes.push(`📍 A ${fmtKm(distKm)} de você`);
    if (nota !== null && nota >= .7) razoes.push(`★ ${Number(p.ratingMedia).toFixed(1).replace(".", ",")} de nota`);
    return { ...combinar([["dist", dist, PESOS_PERSONAL.dist], ["exp", exp?.v ?? null, PESOS_PERSONAL.exp], ["nota", nota, PESOS_PERSONAL.nota]]), razoes };
}
