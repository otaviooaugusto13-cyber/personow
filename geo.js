// Geolocalização do Personow — funções puras (testáveis em node) + captura da posição pelo navegador.
// Sem chamadas externas: as cidades vêm de uma tabela local (centros municipais aproximados, precisão ~1–2 km).
// Para precisão de rua, o aluno usa "Usar minha localização" no cadastro (GPS) e a coordenada exata vai para a aula.
import { RAIO_KM_AULAS, LOCAL_MAX_IDADE_MS, GEO_RAIO_METROS } from "./config.js";

export const RAIO_KM = RAIO_KM_AULAS;

/** Cidades atendidas/prováveis (interior de SP e capitais próximas). Adicione linhas livremente: { n: nome, uf, lat, lng }. */
export const CIDADES = [
    { n: "Itapira", uf: "SP", lat: -22.4358, lng: -46.8231 },
    { n: "Mogi Guaçu", uf: "SP", lat: -22.3689, lng: -46.9428 },
    { n: "Mogi Mirim", uf: "SP", lat: -22.4325, lng: -46.9583 },
    { n: "Estiva Gerbi", uf: "SP", lat: -22.2644, lng: -46.9453 },
    { n: "Conchal", uf: "SP", lat: -22.3361, lng: -47.1733 },
    { n: "Espírito Santo do Pinhal", uf: "SP", lat: -22.1911, lng: -46.7469 },
    { n: "Santo Antônio de Posse", uf: "SP", lat: -22.6039, lng: -46.9190 },
    { n: "Jaguariúna", uf: "SP", lat: -22.7058, lng: -46.9853 },
    { n: "Pedreira", uf: "SP", lat: -22.7420, lng: -46.8932 },
    { n: "Amparo", uf: "SP", lat: -22.7083, lng: -46.7714 },
    { n: "Serra Negra", uf: "SP", lat: -22.6122, lng: -46.7006 },
    { n: "Lindóia", uf: "SP", lat: -22.5222, lng: -46.6528 },
    { n: "Águas de Lindóia", uf: "SP", lat: -22.4733, lng: -46.6314 },
    { n: "Socorro", uf: "SP", lat: -22.5906, lng: -46.5258 },
    { n: "São João da Boa Vista", uf: "SP", lat: -21.9697, lng: -46.7978 },
    { n: "Campinas", uf: "SP", lat: -22.9099, lng: -47.0626 },
    { n: "Holambra", uf: "SP", lat: -22.6328, lng: -47.0486 },
    { n: "Paulínia", uf: "SP", lat: -22.7611, lng: -47.1542 },
    { n: "Sumaré", uf: "SP", lat: -22.8219, lng: -47.2669 },
    { n: "Hortolândia", uf: "SP", lat: -22.8583, lng: -47.2200 },
    { n: "Valinhos", uf: "SP", lat: -22.9706, lng: -46.9958 },
    { n: "Vinhedo", uf: "SP", lat: -23.0300, lng: -46.9753 },
    { n: "Jundiaí", uf: "SP", lat: -23.1857, lng: -46.8978 },
    { n: "Bragança Paulista", uf: "SP", lat: -22.9527, lng: -46.5419 },
    { n: "Atibaia", uf: "SP", lat: -23.1171, lng: -46.5506 },
    { n: "Limeira", uf: "SP", lat: -22.5647, lng: -47.4017 },
    { n: "Araras", uf: "SP", lat: -22.3572, lng: -47.3842 },
    { n: "Leme", uf: "SP", lat: -22.1856, lng: -47.3844 },
    { n: "Rio Claro", uf: "SP", lat: -22.4114, lng: -47.5614 },
    { n: "Piracicaba", uf: "SP", lat: -22.7253, lng: -47.6492 },
    { n: "Ribeirão Preto", uf: "SP", lat: -21.1775, lng: -47.8103 },
    { n: "Sorocaba", uf: "SP", lat: -23.5015, lng: -47.4526 },
    { n: "São José dos Campos", uf: "SP", lat: -23.2237, lng: -45.9009 },
    { n: "Santos", uf: "SP", lat: -23.9608, lng: -46.3336 },
    { n: "Guarulhos", uf: "SP", lat: -23.4543, lng: -46.5333 },
    { n: "Osasco", uf: "SP", lat: -23.5329, lng: -46.7917 },
    { n: "Santo André", uf: "SP", lat: -23.6639, lng: -46.5383 },
    { n: "São Bernardo do Campo", uf: "SP", lat: -23.6914, lng: -46.5646 },
    { n: "São Paulo", uf: "SP", lat: -23.5505, lng: -46.6333 },
    { n: "Belo Horizonte", uf: "MG", lat: -19.9167, lng: -43.9345 },
    { n: "Rio de Janeiro", uf: "RJ", lat: -22.9068, lng: -43.1729 }
];

export const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export const rotuloCidade = (c) => (c ? (c.uf ? `${c.n} - ${c.uf}` : c.n) : "");

const POR_NOME = new Map(CIDADES.map((c) => [normalizar(c.n), c]));
/** "Itapira", "itapira - sp", "Itapira/SP", "Itapira, SP" → cidade da tabela (ou null). */
export function acharCidade(texto) {
    const t = normalizar(texto);
    if (!t) return null;
    if (POR_NOME.has(t)) return POR_NOME.get(t);
    const semUF = t.replace(/ (sp|mg|rj)$/, "");
    return POR_NOME.get(semUF) || null;
}

const rad = (g) => (g * Math.PI) / 180;
/** Distância em linha reta (haversine), em km. */
export function distanciaKm(a, b) {
    if (!a || !b || ![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return Infinity;
    const R = 6371, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Cidade da tabela mais próxima do ponto, dentro de maxKm (padrão 30 km). */
export function cidadeMaisProxima(p, maxKm = 30) {
    let melhor = null, d0 = Infinity;
    for (const c of CIDADES) { const d = distanciaKm(p, c); if (d < d0) { d0 = d; melhor = c; } }
    return melhor && d0 <= maxKm ? { ...melhor, distKm: d0 } : null;
}
export const fmtKm = (km) => (!Number.isFinite(km) ? "" : km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1).replace(".", ",")} km`);

/** Coordenadas de uma aula: `local` (gravado pelo servidor a partir do GPS do aluno), ou lat/lng soltos, ou o centro da cidade informada. */
export function pontoDaAula(v) {
    const l = v?.local, lat = Number.isFinite(l?.lat) ? l.lat : v?.lat, lng = Number.isFinite(l?.lng) ? l.lng : v?.lng;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    const c = acharCidade(v?.regiao?.cidade || v?.cidade); return c ? { lat: c.lat, lng: c.lng } : null;
}
/** Nome da cidade da aula normalizado para o contador ("Itapira - SP"); "" se a aula não tem localização. */
export function cidadeDaAula(v) {
    const nome = v?.regiao?.cidade || v?.cidade, c = acharCidade(nome); if (c) return rotuloCidade(c);
    const p = pontoDaAula(v); const prox = p && cidadeMaisProxima(p, 15); return prox ? rotuloCidade(prox) : (nome ? (v?.regiao?.uf ? `${nome} - ${v.regiao.uf}` : String(nome)) : "");
}
/** Contadores por localidade, do maior para o menor: [{ cidade, aulas }]. Aulas sem localização ficam fora. */
export function contarPorCidade(aulas) {
    const m = new Map();
    for (const v of aulas) { const c = cidadeDaAula(v); if (c) m.set(c, (m.get(c) || 0) + 1); }
    return [...m].map(([cidade, aulas]) => ({ cidade, aulas })).sort((a, b) => b.aulas - a.aulas || a.cidade.localeCompare(b.cidade, "pt-BR"));
}
/** Aulas dentro do raio, com `distKm` anexado e ordenadas da mais perto para a mais longe. Aulas sem localização ficam de fora. */
export function filtrarPorRaio(aulas, origem, raioKm = RAIO_KM) {
    return aulas.map((v) => ({ v, d: distanciaKm(origem, pontoDaAula(v)) })).filter((x) => x.d <= raioKm).sort((a, b) => a.d - b.d).map((x) => ({ ...x.v, distKm: x.d }));
}

// ---------- captura da posição (navegador) ----------
const MSG = { negado: "Permissão de localização negada.", indisponivel: "Não foi possível obter sua localização.", tempo: "A localização demorou demais para responder.", "sem-suporte": "Este aparelho não oferece geolocalização.", insegura: "A localização exige conexão segura (https)." };
const erroGeo = (e) => { const code = e?.code === 1 ? "negado" : e?.code === 3 ? "tempo" : e?.code === 2 ? "indisponivel" : e; return Object.assign(new Error(MSG[code] || MSG.indisponivel), { code: MSG[code] ? code : "indisponivel" }); };
const suporte = () => { if (typeof navigator === "undefined" || !navigator.geolocation) throw erroGeo("sem-suporte"); if (typeof isSecureContext !== "undefined" && !isSecureContext) throw erroGeo("insegura"); };

/** Pede a posição uma vez (precisa de gesto do usuário na primeira vez, por causa do aviso de permissão). */
export const capturarPosicao = ({ timeout = 10_000, maxAge = LOCAL_MAX_IDADE_MS } = {}) => new Promise((res, rej) => {
    try { suporte(); } catch (e) { return rej(e); }
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, precisaoM: p.coords.accuracy, em: Date.now() }), (e) => rej(erroGeo(e)), { enableHighAccuracy: false, timeout, maximumAge: maxAge });
});
/** Acompanha a posição em tempo real. Devolve a função que para o acompanhamento (chame ao sair da tela: poupa bateria). */
export function observarPosicao(aoMudar, aoErrar = () => {}) {
    try { suporte(); } catch (e) { aoErrar(e); return () => {}; }
    const id = navigator.geolocation.watchPosition((p) => aoMudar({ lat: p.coords.latitude, lng: p.coords.longitude, precisaoM: p.coords.accuracy, em: Date.now() }), (e) => aoErrar(erroGeo(e)), { enableHighAccuracy: false, timeout: 20_000, maximumAge: LOCAL_MAX_IDADE_MS });
    return () => navigator.geolocation.clearWatch(id);
}
/** Consulta o estado da permissão sem disparar o aviso: "granted" | "prompt" | "denied" | "desconhecido". */
export async function estadoPermissao() { try { return (await navigator.permissions.query({ name: "geolocation" })).state; } catch (e) { return "desconhecido"; } }

/** Rumo de a → b em radianos (0 = norte, π/2 = leste). Usado só para desenhar o radar da aula. */
export function rumoRad(a, b) { const dy = b.lat - a.lat, dx = (b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2)); return Math.atan2(dx, dy); }

// ============================================================
// Check-in / check-out e radar da aula (GPS de alta precisão; o SERVIDOR refaz toda a validação)
// ============================================================
/** Distância em metros (haversine) — só para o "radar" da interface; quem decide é o servidor. */
export function distanciaM(a, b) {
    const R = 6371008.8, rad = (g) => (g * Math.PI) / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const MSG_GPS = { 1: "Permissão de localização negada. Libere o GPS para este site nas configurações do navegador.", 2: "Não foi possível obter sua posição. Vá para um local aberto e tente de novo.", 3: "O GPS demorou demais para responder. Tente de novo." };

/** Lê o GPS (alta precisão). Devolve { lat, lng, precisao, idadeFixMs } — idade medida agora, no aparelho. */
export function lerGPS({ timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
        if (!("geolocation" in navigator)) return reject(Object.assign(new Error("Este aparelho não tem GPS disponível no navegador."), { code: "sem-gps" }));
        navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: Math.round(p.coords.accuracy), idadeFixMs: Math.max(0, Date.now() - p.timestamp) }),
            (e) => reject(Object.assign(new Error(MSG_GPS[e.code] || "Falha ao ler o GPS."), { code: e.code === 1 ? "gps-negado" : "gps-falhou" })),
            { enableHighAccuracy: true, timeout, maximumAge: 0 });
    });
}

/** Acompanha o GPS enquanto o "radar" está aberto. Devolve a função que para o acompanhamento. */
export function vigiarGPS(aoLer, aoErrar) {
    if (!("geolocation" in navigator)) { aoErrar?.(Object.assign(new Error("Sem GPS neste aparelho."), { code: "sem-gps" })); return () => {}; }
    const id = navigator.geolocation.watchPosition(
        (p) => aoLer({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: Math.round(p.coords.accuracy), idadeFixMs: Math.max(0, Date.now() - p.timestamp) }),
        (e) => aoErrar?.(Object.assign(new Error(MSG_GPS[e.code] || "Falha ao ler o GPS."), { code: e.code === 1 ? "gps-negado" : "gps-falhou" })),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
}
export { GEO_RAIO_METROS };
