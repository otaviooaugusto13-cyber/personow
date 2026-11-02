// Geofencing: distância entre coordenadas e prova de presença. Tudo é recalculado no SERVIDOR; o navegador só exibe.
// Limite honesto: o servidor não consegue provar que o GPS não foi falsificado (apps de "localização falsa"). As defesas aqui são
// precisão mínima, leitura recente, janela de horário, permanência mínima, foto única e trilha de auditoria (veja SEGURANCA.md).
const { Falha } = require("./erros");
const C = require("./config");

const RAIO_TERRA_M = 6_371_008.8;
const rad = (g) => (g * Math.PI) / 180;
/** Distância em metros entre dois pontos {lat,lng} (fórmula de haversine). */
function distanciaM(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
const numero = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
/** Valida {lat,lng} (números reais dentro do globo, não 0/0). */
function coordenadas(o, campo = "localização") {
  const lat = numero(o?.lat), lng = numero(o?.lng);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) throw new Falha(400, `Coordenadas inválidas (${campo}).`, "gps-invalido");
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}
/** Leitura de GPS enviada pelo aparelho: { lat, lng, precisao (m), idadeFixMs }. A idade é medida no aparelho (imune a relógio errado). */
function lerFix(b) {
  const c = coordenadas(b, "GPS");
  const precisaoM = numero(b?.precisao), idade = numero(b?.idadeFixMs);
  if (precisaoM === null || precisaoM < 0 || precisaoM > 100_000) throw new Falha(400, "Leitura de GPS sem precisão.", "gps-invalido");
  if (idade === null || idade < -5000) throw new Falha(400, "Leitura de GPS sem horário.", "gps-invalido");
  return { ...c, precisaoM: Math.round(precisaoM), idadeFixMs: Math.max(0, Math.round(idade)) };
}
/**
 * Decide se a leitura prova presença no local. Não lança: devolve { ok, codigo, mensagem, distanciaM }.
 * Regra: precisão ≤ PRECISAO_MAX_M, leitura recente e distância ≤ raio.
 */
function avaliarPresenca({ fix, local, raioM = C.GEO.RAIO_METROS }) {
  const d = Math.ceil(distanciaM(fix, local));   // arredonda para cima: o número mostrado nunca esconde uma recusa
  const base = { distanciaM: d, raioM, precisaoM: fix.precisaoM };
  if (fix.idadeFixMs > C.GEO.FIX_IDADE_MAX_MS) return { ok: false, codigo: "gps-antigo", mensagem: "A leitura do GPS está desatualizada. Toque em localizar de novo.", ...base };
  if (fix.precisaoM > C.GEO.PRECISAO_MAX_M) return { ok: false, codigo: "gps-impreciso", mensagem: `Sinal de GPS fraco (±${fix.precisaoM} m). Vá para perto da entrada ou de uma janela e tente de novo.`, ...base };
  if (d > raioM) return { ok: false, codigo: "fora-do-raio", mensagem: `Você está a ${d} m do aluno. Para iniciar é preciso estar a até ${raioM} m.`, ...base };
  return { ok: true, ...base };
}
module.exports = { distanciaM, coordenadas, lerFix, avaliarPresenca };
