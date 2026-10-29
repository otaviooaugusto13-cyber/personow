// Funções puras do front: geolocalização, bio/palavras-chave e ranking. Rodar: node test/perfil.test.js
import assert from "node:assert/strict";
import { distanciaKm, acharCidade, fmtKm, pontoDaAula, filtrarPorRaio, cidadeMaisProxima, RAIO_KM } from "../geo.js";
import { gerarBio, gerarPalavrasChave, normalizarExperiencias, afinidadeExperiencia, afinidadeValor, pontuarOferta, ranquearOfertas, pontuarPersonal, MAX_BIO, FOCOS_V } from "../perfil-inteligente.js";
import { FOCOS } from "../config.js";

// ---- geo ----
assert.equal(RAIO_KM, 20);
const itapira = acharCidade("itapira - sp"), mogi = acharCidade("Mogi Guaçu/SP");
assert.ok(itapira && mogi && acharCidade("Mogi Guacu")?.n === "Mogi Guaçu", "acha com/sem acento e UF");
const d = distanciaKm(itapira, mogi); assert.ok(d > 10 && d < 20, `Itapira–Mogi Guaçu ~15 km (veio ${d})`);
assert.equal(distanciaKm(null, mogi), Infinity); assert.equal(distanciaKm({ lat: 1, lng: 1 }, { lat: NaN, lng: 1 }), Infinity);
assert.equal(fmtKm(0.43), "450 m"); assert.equal(fmtKm(2.34), "2,3 km"); assert.equal(fmtKm(Infinity), "");
assert.deepEqual(pontoDaAula({ lat: -22.4, lng: -46.8 }), { lat: -22.4, lng: -46.8 });
assert.ok(pontoDaAula({ local: "Smart Fit — Itapira" }), "cidade no fim do local"); assert.equal(pontoDaAula({ local: "Rua X, 10" }), null);
const aulas = [{ id: "longe", lat: -23.5505, lng: -46.6333 }, { id: "perto", lat: -22.44, lng: -46.83 }, { id: "semLoc", local: "Rua X" }, { id: "meio", local: "Academia — Mogi Guaçu" }];
const f = filtrarPorRaio(aulas, itapira, 20); assert.deepEqual(f.map((x) => x.id), ["perto", "meio"], "raio de 20 km: ordena por distância e descarta sem localização/longe");
assert.equal(cidadeMaisProxima({ lat: -22.44, lng: -46.82 }).n, "Itapira");

// ---- espelho do servidor (focos) ----
assert.deepEqual(FOCOS_V, FOCOS.map((x) => x.v));

// ---- bio / palavras-chave ----
const exps = [{ foco: "Corrida", anos: 2 }, { foco: "Hipertrofia", anos: 6 }, { foco: "Reposição", anos: 3 }, { foco: "Hipertrofia", anos: 1 }];
const n = normalizarExperiencias(exps); assert.deepEqual(n, [{ foco: "Hipertrofia", anos: 6 }, { foco: "Corrida", anos: 2 }], "descarta foco inexistente e repetido; mais experiente primeiro");
assert.equal(normalizarExperiencias([{ foco: "Corrida", anos: 999 }])[0].anos, 50);
const bio = gerarBio({ experiencias: exps, cref: true });
assert.match(bio, /6 anos em hipertrofia/); assert.match(bio, /2 anos em corrida/); assert.match(bio, /CREF/); assert.ok(bio.length <= MAX_BIO);
assert.ok(!/CREF/.test(gerarBio({ experiencias: exps, cref: false })), "não afirma CREF que o personal não informou");
assert.match(gerarBio({}), /Personal trainer/); assert.ok(gerarBio({ experiencias: FOCOS_V.map((v) => ({ foco: v, anos: 9 })), cref: true }).length <= MAX_BIO);
const kw = gerarPalavrasChave({ experiencias: exps, cref: true }); assert.ok(kw.includes("hipertrofia") && kw.includes("6+ anos de experiência") && kw.includes("CREF")); assert.ok(kw.length <= 12 && new Set(kw.map((k) => k.toLowerCase())).size === kw.length);
assert.deepEqual(gerarPalavrasChave({}), []);

// ---- afinidade / ranking ----
assert.equal(afinidadeExperiencia([], "Corrida"), null, "sem experiência informada: não penaliza");
const direta = afinidadeExperiencia([{ foco: "Corrida", anos: 5 }], "Corrida"), vizinha = afinidadeExperiencia([{ foco: "Hipertrofia", anos: 5 }], "Musculação"), longeFoco = afinidadeExperiencia([{ foco: "Corrida", anos: 5 }], "Hipertrofia");
assert.ok(direta.direta && direta.v === 1 && vizinha.v >= .85 && longeFoco.v < .2);
assert.equal(afinidadeValor(5000, 0), null); assert.equal(afinidadeValor(4000, 5000), 0); assert.equal(afinidadeValor(5000, 5000), .6); assert.equal(afinidadeValor(7000, 5000), 1);
const perto = pontuarOferta({ foco: "Hipertrofia" }, { distKm: 2, experiencias: [{ foco: "Hipertrofia", anos: 5 }], valorMinCentavos: 5000, valorPersonalCentavos: 8000 });
const longe = pontuarOferta({ foco: "Corrida" }, { distKm: 18, experiencias: [{ foco: "Hipertrofia", anos: 5 }], valorMinCentavos: 5000, valorPersonalCentavos: 5000 });
assert.ok(perto.score > 85 && perto.nivel === "alto" && perto.razoes.length >= 2); assert.ok(longe.score < 40 && longe.nivel === "baixo");
assert.equal(pontuarOferta({ foco: "Corrida" }, {}).score, null, "sem nenhum dado: score null (não inventa)");
const so = pontuarOferta({ foco: "Corrida" }, { distKm: 0 }); assert.equal(so.score, 100, "só a distância é conhecida: pesos redistribuídos");
const rank = ranquearOfertas([
    { id: "a", foco: "Corrida", distKm: 15, data: "2030-01-01", entrada: "08:00", valorPersonalCentavos: 5000 },
    { id: "b", foco: "Hipertrofia", distKm: 3, data: "2030-01-02", entrada: "08:00", valorPersonalCentavos: 6000 },
    { id: "c", foco: "Hipertrofia", distKm: 3, data: "2030-01-01", entrada: "07:00", valorPersonalCentavos: 6000 }
], { experiencias: [{ foco: "Hipertrofia", anos: 4 }], valorMinCentavos: 5000 });
assert.deepEqual(rank.map((x) => x.id), ["c", "b", "a"], "melhor score primeiro; empate resolve pela data");
// ---- aluno escolhendo personal ----
const pA = { experiencias: [{ foco: "Corrida", anos: 4 }], ratingMedia: 4.9, ratingQtd: 12 }, pB = { experiencias: [{ foco: "Hipertrofia", anos: 8 }], ratingMedia: 4.2, ratingQtd: 3 }, pNovo = {};
assert.ok(pontuarPersonal(pA, { foco: "Corrida", distKm: 5 }).score > pontuarPersonal(pB, { foco: "Corrida", distKm: 5 }).score);
assert.equal(pontuarPersonal(pNovo, {}).score, null); assert.ok(pontuarPersonal(pNovo, { distKm: 1 }).score > 90, "personal novo (sem nota/experiência) não é punido");
assert.match(pontuarPersonal(pA, { foco: "Corrida", distKm: 1 }).razoes.join(" "), /★ 4,9/);
console.log("✅ geolocalização e perfil inteligente: todos os testes passaram");
