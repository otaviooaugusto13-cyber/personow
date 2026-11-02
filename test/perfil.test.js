// Testes do perfil inteligente, geolocalização e cursos (puros, sem rede): node test/perfil.test.js
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as G from "../geo.js";
import * as P from "../perfil-inteligente.js";
import * as K from "../cursos.js";
import { MODALIDADES } from "../core.js";
const C = createRequire(import.meta.url)("../server/lib/config.js");
let n = 0; const t = (nome, fn) => { fn(); n++; console.log("  ✓ " + nome); };

t("paridade navegador×servidor: áreas, instintos, categorias de curso e limites", () => {
    assert.deepEqual(P.AREAS_VALIDAS, C.AREAS_EXPERIENCIA);
    assert.deepEqual(Object.keys(P.INSTINTOS), C.ENEAGRAMA_INSTINTOS);
    assert.equal(P.MAX_EXPERIENCIAS, C.PERFIL_MAX_EXPERIENCIAS); assert.equal(P.MAX_PALAVRAS, C.PERFIL_MAX_PALAVRAS);
    assert.deepEqual(K.CATEGORIAS.map((c) => c.id), C.CURSO_CATEGORIAS);
    const BASE = ["Musculação", "Treino funcional", "Corrida e endurance", "Pilates", "Lutas e artes marciais", "Consultoria de treino online"];
    for (const s of MODALIDADES) assert.ok(BASE.includes(s.v) || BASE.includes(P.MODALIDADE_PROXY[s.v]), "modalidade sem coluna nas matrizes e sem proxy: " + s.v);
    for (const a of P.AREAS) assert.equal(a.rel.length, 6);
    for (const [k, e] of Object.entries(P.ENEAGRAMA)) assert.equal(e.afin.length, 6, "tipo " + k);
});
t("distância: Itapira→Mogi Guaçu ≈ 14 km (dentro do raio) e Itapira→Campinas ≈ 58 km (fora)", () => {
    const it = G.acharCidade("itapira - sp"), mg = G.acharCidade("Mogi Guaçu"), ca = G.acharCidade("Campinas");
    assert.ok(Math.abs(G.distanciaKm(it, mg) - 14.4) < 1), assert.ok(G.distanciaKm(it, ca) > G.RAIO_KM);
    assert.equal(G.RAIO_KM, 20); assert.equal(G.distanciaKm(null, it), Infinity);
});
t("filtro de raio de 20 km usa coordenadas da aula e cai para a cidade; ordena do mais perto", () => {
    const it = G.acharCidade("Itapira"), eu = { lat: it.lat, lng: it.lng };
    const v = [{ id: "a", cidade: "Campinas" }, { id: "b", cidade: "Mogi Guaçu" }, { id: "c", lat: it.lat + .01, lng: it.lng }, { id: "d" }];
    const r = G.filtrarPorRaio(v, eu);
    assert.deepEqual(r.map((x) => x.id), ["c", "b"]); assert.ok(r[0].distKm < 2);
});
t("contadores por localidade somam por cidade normalizada e ignoram aulas sem localização", () => {
    const v = [...Array(3)].map(() => ({ cidade: "itapira/sp" })).concat([{ cidade: "Itapira" }, { cidade: "Campinas - SP" }, { cidade: "campinas" }, { cidade: "São Paulo" }, {}]);
    assert.deepEqual(G.contarPorCidade(v), [{ cidade: "Itapira - SP", aulas: 4 }, { cidade: "Campinas - SP", aulas: 2 }, { cidade: "São Paulo - SP", aulas: 1 }]);
});
t("cidade mais próxima e formatação de distância", () => {
    assert.equal(G.cidadeMaisProxima({ lat: -22.44, lng: -46.83 }).n, "Itapira"); assert.equal(G.cidadeMaisProxima({ lat: 0, lng: 0 }), null);
    assert.equal(G.fmtKm(0.43), "450 m"); assert.equal(G.fmtKm(3.24), "3,2 km");
});
t("código do Eneagrama: ida e volta, asa vizinha e entradas inválidas", () => {
    assert.equal(P.codigoEneagrama({ tipo: 3, asa: 2, instinto: "SO" }), "PW-3w2-SO");
    assert.deepEqual(P.lerCodigoEneagrama("PW-3w2-SO"), { tipo: 3, asa: 2, instinto: "SO" });
    assert.deepEqual(P.lerCodigoEneagrama("9-1-SP"), { tipo: 9, asa: 1, instinto: "SP" });
    assert.equal(P.lerCodigoEneagrama("PW-3w7-SO").asa, 0, "asa não vizinha é descartada");
    assert.equal(P.lerCodigoEneagrama("lixo"), null); assert.equal(P.lerCodigoEneagrama("PW-0"), null);
    assert.ok(P.eneagramaValido({ tipo: 1, asa: 9 })); assert.ok(!P.eneagramaValido({ tipo: 1, asa: 5 })); assert.ok(!P.eneagramaValido({ tipo: 10 }));
});
t("bio: ≤300 caracteres, em português, combina experiência + traços; sem dados não inventa", () => {
    const d = { experiencias: [{ area: "Musculação / Hipertrofia", anos: 3 }, { area: "Pilates", anos: 2 }, { area: "Yoga", anos: 1 }], eneagrama: { tipo: 1, asa: 2, instinto: "SP" } };
    const b = P.gerarBio(d); assert.ok(b.length <= 300 && b.length > 80, b); assert.match(b, /3 anos em musculação/); assert.match(b, /Organizado/);
    for (let tp = 1; tp <= 9; tp++) for (const inst of ["", "SP", "SO", "SX"]) { const x = P.gerarBio({ experiencias: P.AREAS.map((a) => ({ area: a.v, anos: 12 })), eneagrama: { tipo: tp, instinto: inst } }); assert.ok(x.length <= 300, `tipo ${tp}: ${x.length}`); }
    assert.doesNotMatch(P.gerarBio({}), /\d+ anos/); assert.match(P.gerarBio({ eneagrama: { tipo: 5 } }), /Analítico/);
});
t("palavras-chave: únicas, até 12, incluem áreas e traços; entrada suja é filtrada", () => {
    const k = P.gerarPalavrasChave({ experiencias: [{ area: "Pilates", anos: 4 }, { area: "Pilates", anos: 9 }, { area: "Inexistente", anos: 1 }, { area: "Yoga", anos: 2 }], eneagrama: { tipo: 6 } });
    assert.ok(k.length <= 12 && new Set(k.map((x) => x.toLowerCase())).size === k.length); assert.ok(k.includes("pilates") && k.includes("yoga") && k.includes("responsabilidade") && k.includes("4+ anos de experiência"));
    assert.deepEqual(P.gerarPalavrasChave({}), []);
});
t("ranking: perto + experiência + perfil vence; fatores desconhecidos não penalizam", () => {
    const ctx = { experiencias: [{ area: "Musculação / Hipertrofia", anos: 5 }], eneagrama: { tipo: 1, asa: 9 } };
    const bom = P.pontuarOferta({ foco: "Musculação" }, { ...ctx, distKm: 1 }), ruim = P.pontuarOferta({ foco: "Lutas e artes marciais" }, { ...ctx, distKm: 18 });
    assert.ok(bom.score >= 90 && bom.nivel === "alto" && bom.razoes.length === 3, JSON.stringify(bom)); assert.ok(ruim.score < 55, JSON.stringify(ruim));
    const so = P.pontuarOferta({ foco: "Musculação" }, { distKm: 0 }); assert.equal(so.score, 100); assert.equal(so.conhecidos, 1);
    assert.equal(P.pontuarOferta({ foco: "Pilates" }, {}).score, null);
    assert.equal(P.pontuarOferta({ foco: "Musculação" }, { distKm: 25 }).partes.dist, 0, "além do raio zera a proximidade");
});
t("ranquearOfertas ordena por score, depois distância", () => {
    const r = P.ranquearOfertas([{ id: "luta", foco: "Lutas e artes marciais", distKm: 2, data: "2026-11-01", entrada: "08:00" }, { id: "musc", foco: "Musculação", distKm: 2, data: "2026-11-01", entrada: "08:00" }], { experiencias: [{ area: "Musculação / Hipertrofia", anos: 3 }], eneagrama: { tipo: 1 } });
    assert.deepEqual(r.map((x) => x.id), ["musc", "luta"]);
});
t("cursos: agrupa por categoria na ordem, esconde vazias e trata módulos antigos como habilitação", () => {
    const g = K.agruparCursos([{ id: "1", ordem: 2, concluido: true }, { id: "2", ordem: 1, concluido: false, obrigatorio: true, categoria: "habilitacao" }, { id: "3", ordem: 1, categoria: "saude", obrigatorio: false }, { id: "4", ordem: 1, obrigatorio: false }]);
    assert.deepEqual(g.map((c) => c.id), ["habilitacao", "saude", "geral"]); assert.deepEqual(g[0].itens.map((m) => m.id), ["2", "1"]); assert.equal(g[0].concluidos, 1);
});
t("segurança: geolocalização liberada só para a própria origem e nada de links externos no personal", () => {
    const seg = fs.readFileSync(new URL("../server/lib/seguranca.js", import.meta.url), "utf8"); assert.match(seg, /geolocation=\(self\)/);
    const js = fs.readFileSync(new URL("../script-personal.js", import.meta.url), "utf8");
    assert.doesNotMatch(js, /window\.open\((?!"https:\/\/api\.whatsapp)/, "só o compartilhamento por WhatsApp (ação explícita) abre aba");
    assert.doesNotMatch(js, /maps\.google|google\.com\/maps/);
});
console.log(`\n${n}/${n} testes do perfil inteligente passaram`);
