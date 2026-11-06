// Mapa de personais ONLINE na tela inicial do aluno (substitui o card "Solicitar personal", que agora vive na sheet "Agendar aula").
//
//  • Posição do aluno = perfil.localizacao (branco com halo azul). Um marcador azul com anel branco por personal online.
//  • Os dados vêm do SERVIDOR (GET /personais/online): só personais aprovados com sinal de presença nos últimos ~75 s, dentro de RAIO_KM_AULAS,
//    com posição JÁ ARREDONDADA (~300 m). Aqui nunca existe a posição exata de ninguém.
//  • Atualiza a cada 20 s enquanto a aba do navegador está visível e a tela inicial está aberta (igual ao padrão de presenca.js).
//  • Leaflet 1.9.4 (versão fixa, cdnjs) + tiles do OpenStreetMap, sem chave de API. Se a biblioteca não carregar, mostra uma lista simples.
import { consultar } from "./firebase.js";
import { RAIO_KM_AULAS } from "./config.js";
import { CIDADES, acharCidade, distanciaKm, fmtKm } from "./geo.js";
import { esc } from "./core.js";
import { $, toast } from "./ui.js";

const LEAFLET = "1.9.4";
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET}`;
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const INTERVALO_MS = 20_000;                         // 15–30 s: consulta nova enquanto a aba está visível
const reduzMovimento = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

let leafletPromessa = null;
/** Carrega o Leaflet sob demanda (só quando o aluno chega na tela inicial). Rejeita se o CDN estiver fora do ar ou bloqueado. */
function carregarLeaflet() {
    if (window.L?.map) return Promise.resolve(window.L);
    if (leafletPromessa) return leafletPromessa;
    leafletPromessa = new Promise((ok, falha) => {
        const css = document.createElement("link");
        css.rel = "stylesheet"; css.href = `${CDN}/leaflet.css`; css.crossOrigin = "anonymous";
        document.head.appendChild(css);
        const js = document.createElement("script");
        js.src = `${CDN}/leaflet.js`; js.crossOrigin = "anonymous"; js.async = true;
        const timer = setTimeout(() => { leafletPromessa = null; falha(new Error("tempo esgotado")); }, 15_000);
        js.onload = () => { clearTimeout(timer); window.L?.map ? ok(window.L) : (leafletPromessa = null, falha(new Error("leaflet ausente"))); };
        js.onerror = () => { clearTimeout(timer); leafletPromessa = null; js.remove(); falha(new Error("falha ao carregar")); };
        document.head.appendChild(js);
    });
    return leafletPromessa;
}

const rotuloNota = (p) => (p.ratingQtd ? `<span class="stars">★ ${String(p.ratingMedia).replace(".", ",")}</span> <span class="muted small">(${p.ratingQtd})</span>` : '<span class="muted small">Novo na plataforma</span>');
const fotoOuInicial = (p) => (p.foto ? `<img src="${esc(p.foto)}" alt="" referrerpolicy="no-referrer">` : esc((p.nome || "P")[0].toUpperCase()));

/**
 * ctx: { perfil(): perfil do aluno, abrirLocal(): abre a sheet de localização, chamar(id, nome): fluxo de aula direta com personal preferido }
 * Devolve { ligar, desligar, aoMudarLocal, aoMudarAba }.
 */
export function iniciarMapa(ctx) {
    let L = null, mapa = null, marcaAluno = null, areaAluno = null;
    const marcas = new Map();                         // id do personal → marcador Leaflet
    let dados = [], selecionado = null, timer = null, emVoo = false, ligado = false, enquadrou = false, erroRede = false, semLeaflet = false, semLocalizacao = false;

    const raiz = () => $("card-mapa");
    const temLocal = () => Number.isFinite(ctx.perfil()?.localizacao?.lat) && Number.isFinite(ctx.perfil()?.localizacao?.lng);
    const origem = () => (temLocal() ? { lat: ctx.perfil().localizacao.lat, lng: ctx.perfil().localizacao.lng } : null);
    /** Sem localização do aluno: centraliza na cidade dele (se conhecida) ou na primeira da lista do app. */
    const centroPadrao = () => { const c = acharCidade(ctx.perfil()?.localizacao?.cidade) || CIDADES[0]; return { lat: c.lat, lng: c.lng }; };
    const abaInicioAberta = () => $("tab-home")?.classList.contains("active");

    // ---------- esqueleto (uma vez) ----------
    function montar() {
        const el = raiz(); if (!el || el.dataset.pronto) return;
        el.dataset.pronto = "1";
        el.innerHTML = `
        <div class="pm-topo">
            <div class="grow"><h3>Personais ativos agora</h3><p class="pm-contador" id="mapa-contador" role="status" aria-live="polite">Buscando personais…</p></div>
            <span class="badge green">Pague só depois</span>
        </div>
        <div class="pm-wrap">
            <div id="mapa-personais" class="pm-mapa" role="region" aria-label="Mapa com os personais online perto de você"></div>
            <div class="pm-aviso" id="mapa-aviso" hidden>
                <div><strong>Defina sua localização</strong><br><span class="muted small">Assim mostramos só os personais perto de você.</span></div>
                <button class="btn btn-primary" id="mapa-definir-local" type="button">📍 Definir minha localização</button>
            </div>
            <div class="pm-vazio" id="mapa-vazio" hidden><strong>Nenhum personal online agora</strong><br><span class="muted small">Use o <b>Chamado relâmpago</b> abaixo: avisamos quem estiver por perto.</span></div>
            <button class="pm-centro" id="mapa-centrar" type="button" aria-label="Centralizar o mapa em mim" title="Centralizar em mim">◎</button>
            <article class="pm-cartao" id="mapa-cartao" hidden aria-live="polite"></article>
        </div>
        <p class="pm-status muted small" id="mapa-status" hidden></p>
        <div id="mapa-lista" class="stack" hidden></div>`;
        $("mapa-definir-local").addEventListener("click", () => ctx.abrirLocal());
        $("mapa-centrar").addEventListener("click", () => centralizar());
        $("mapa-cartao").addEventListener("click", (e) => {
            if (e.target.closest("[data-pm-fechar]")) return fecharCartao();
            const b = e.target.closest("[data-pm-chamar]"); if (!b) return;
            const p = dados.find((x) => x.id === b.dataset.pmChamar); if (!p) return toast("Esse personal ficou offline. Escolha outro.", "erro");
            fecharCartao(); ctx.chamar(p.id, p.nome);
        });
        $("mapa-lista").addEventListener("click", (e) => { const b = e.target.closest("[data-pm-chamar]"); const p = b && dados.find((x) => x.id === b.dataset.pmChamar); if (p) ctx.chamar(p.id, p.nome); });
    }

    async function criarMapa() {
        if (mapa || semLeaflet) return;
        try { L = await carregarLeaflet(); } catch (e) { semLeaflet = true; console.warn("mapa:", e.message); pintarTudo(); return; }
        const el = $("mapa-personais"); if (!el || mapa) return;
        const anima = !reduzMovimento(), c = origem() || centroPadrao();
        mapa = L.map(el, { zoomControl: false, attributionControl: false, minZoom: 9, maxZoom: 18, zoomSnap: 0.5, zoomAnimation: anima, fadeAnimation: anima, markerZoomAnimation: anima, worldCopyJump: false }).setView([c.lat, c.lng], 13);
        L.tileLayer(TILES, { maxZoom: 19, className: "pm-tile", attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(mapa);
        L.control.attribution({ prefix: false, position: "bottomleft" }).addTo(mapa);
        L.control.zoom({ position: "bottomright", zoomInTitle: "Aproximar", zoomOutTitle: "Afastar" }).addTo(mapa);
        mapa.on("click", fecharCartao);
        pintarTudo();
        setTimeout(() => mapa?.invalidateSize(), 150);
    }

    // ---------- marcadores ----------
    const iconePersonal = (nome) => L.divIcon({ className: "pm-pin", html: `<span class="sr-only">${esc(nome)}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] });
    const iconeAluno = () => L.divIcon({ className: "pm-eu", html: '<span class="sr-only">Você está aqui</span>', iconSize: [44, 44], iconAnchor: [22, 22] });

    function pintarAluno() {
        if (!mapa) return;
        const o = origem();
        if (!o) { marcaAluno?.remove(); marcaAluno = null; areaAluno?.remove(); areaAluno = null; return; }
        if (marcaAluno) marcaAluno.setLatLng([o.lat, o.lng]);
        else marcaAluno = L.marker([o.lat, o.lng], { icon: iconeAluno(), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(mapa);
        // raio de busca (discreto): mostra até onde a lista alcança
        if (areaAluno) areaAluno.setLatLng([o.lat, o.lng]);
        else areaAluno = L.circle([o.lat, o.lng], { radius: RAIO_KM_AULAS * 1000, color: "#3B82F6", weight: 1, opacity: 0.35, fillColor: "#3B82F6", fillOpacity: 0.04, interactive: false, dashArray: "4 6" }).addTo(mapa);
    }

    function pintarPersonais() {
        if (!mapa) return;
        const vivos = new Set(dados.map((p) => p.id));
        for (const [id, m] of marcas) if (!vivos.has(id)) { m.remove(); marcas.delete(id); }
        for (const p of dados) {
            const ll = [p.lat, p.lng], m = marcas.get(p.id);
            if (m) m.setLatLng(ll);
            else {
                const novo = L.marker(ll, { icon: iconePersonal(p.nome), title: p.nome, alt: `Personal ${p.nome}`, keyboard: true, riseOnHover: true }).addTo(mapa);
                novo.on("click", (ev) => { L.DomEvent.stopPropagation(ev); abrirCartao(p.id); });
                marcas.set(p.id, novo);
            }
            marcas.get(p.id)._icon?.classList.toggle("sel", p.id === selecionado);
        }
    }

    // ---------- cartão do personal ----------
    function abrirCartao(id) {
        const p = dados.find((x) => x.id === id), el = $("mapa-cartao"); if (!p || !el) return;
        selecionado = id; pintarCartao(p); el.hidden = false;
        for (const [pid, m] of marcas) m._icon?.classList.toggle("sel", pid === id);
        if (mapa) {   // se o marcador ficaria escondido atrás do cartão, empurra o mapa
            const h = mapa.getSize().y, pt = mapa.latLngToContainerPoint([p.lat, p.lng]), livre = h - el.offsetHeight - 40;
            if (pt.y > livre) mapa.panBy([0, pt.y - livre], { animate: !reduzMovimento() });
        }
    }
    function pintarCartao(p) {
        const o = origem(), km = o ? distanciaKm(o, p) : p.distanciaKm, dist = Number.isFinite(km) ? `≈ ${fmtKm(km)}` : "";
        const mods = (p.modalidades || []).filter(Boolean).join(", ") || "Treino geral";
        $("mapa-cartao").innerHTML = `<div class="pm-cartao-topo"><div class="avatar">${fotoOuInicial(p)}</div>
            <div class="grow"><h4>${esc(p.nome)}</h4><div class="small">${rotuloNota(p)}</div><div class="muted small">${esc(mods)}${dist ? ` · ${esc(dist)}` : ""}</div><div class="muted small">Posição aproximada · online agora</div></div>
            <button class="pm-fechar" type="button" data-pm-fechar aria-label="Fechar cartão">✕</button></div>
            <button class="btn btn-primary pm-chamar" type="button" data-pm-chamar="${esc(p.id)}">Chamar este personal</button>`;
    }
    function fecharCartao() {
        selecionado = null; const el = $("mapa-cartao"); if (el) el.hidden = true;
        for (const [, m] of marcas) m._icon?.classList.remove("sel");
    }

    // ---------- textos e estados ----------
    function pintarTudo() {
        montar();
        const n = dados.length;
        $("mapa-contador").textContent = semLocalizacao ? "Defina sua localização para ver quem está perto" : `${n} ${n === 1 ? "personal ativo" : "personais ativos"} agora`;
        $("mapa-aviso").hidden = !semLocalizacao;
        $("mapa-vazio").hidden = semLocalizacao || n > 0 || erroRede && !enquadrou;
        const st = $("mapa-status"); st.hidden = !erroRede; st.textContent = erroRede ? "Sem conexão com o servidor. Tentando de novo em instantes…" : "";
        // plano B: sem mapa (CDN bloqueado/offline), lista os personais online
        const lista = $("mapa-lista"), mapaEl = $("mapa-personais");
        mapaEl.hidden = semLeaflet; $("mapa-centrar").hidden = semLeaflet; lista.hidden = !semLeaflet || !n; mapaEl.parentElement.classList.toggle("pm-sem-mapa", semLeaflet);
        if (semLeaflet) {
            st.hidden = false; st.textContent = "Não foi possível carregar o mapa agora. Mostrando a lista de quem está online.";
            lista.innerHTML = dados.map((p) => `<article class="card conversa"><div class="avatar">${fotoOuInicial(p)}</div><div class="grow"><h4>${esc(p.nome)}</h4><div class="small">${rotuloNota(p)}</div><div class="muted small">${esc((p.modalidades || []).join(", ") || "Treino geral")} · ≈ ${esc(fmtKm(p.distanciaKm))}</div></div><button class="btn btn-ghost btn-sm" type="button" data-pm-chamar="${esc(p.id)}">Chamar</button></article>`).join("");
            return;
        }
        pintarAluno(); pintarPersonais();
        if (selecionado) { const p = dados.find((x) => x.id === selecionado); if (p) pintarCartao(p); else { fecharCartao(); toast("Esse personal ficou offline.", "info"); } }
    }

    /** Enquadra o aluno + personais (primeira carga, mudança de localização e botão "centralizar"). */
    function centralizar() {
        if (!mapa) return;
        const pts = [], o = origem(); if (o) pts.push([o.lat, o.lng]); for (const p of dados) pts.push([p.lat, p.lng]);
        const anima = !reduzMovimento();
        if (pts.length > 1) mapa.fitBounds(pts, { padding: [48, 48], maxZoom: 15, animate: anima });
        else if (pts.length === 1) mapa.setView(pts[0], 14, { animate: anima });
        else { const c = centroPadrao(); mapa.setView([c.lat, c.lng], 13, { animate: anima }); }
        enquadrou = true;
    }

    // ---------- consulta ao servidor ----------
    async function atualizar() {
        if (!ligado || emVoo || document.hidden || !abaInicioAberta()) return;
        montar();
        if (!temLocal()) { semLocalizacao = true; dados = []; erroRede = false; await criarMapa(); pintarTudo(); if (mapa && !enquadrou) centralizar(); return; }
        emVoo = true;
        try {
            const r = await consultar("personais/online");
            semLocalizacao = !!r.semLocalizacao; erroRede = false;
            dados = (Array.isArray(r.personais) ? r.personais : []).filter((p) => p && typeof p.id === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lng));
        } catch (e) {
            erroRede = true;                           // mantém o último resultado na tela; o próximo ciclo tenta de novo
            if (e?.code === "conta-banida") desligar();
        } finally { emVoo = false; }
        await criarMapa(); pintarTudo();
        if (mapa && !enquadrou && !erroRede) centralizar();
    }

    function iniciarRelogio() { clearInterval(timer); timer = setInterval(atualizar, INTERVALO_MS); }

    // ---------- API ----------
    function ligar() { if (ligado) return; ligado = true; montar(); atualizar(); iniciarRelogio(); }
    function desligar() { ligado = false; clearInterval(timer); timer = null; emVoo = false; dados = []; enquadrou = false; erroRede = false; selecionado = null; if (mapa) { for (const [, m] of marcas) m.remove(); marcas.clear(); marcaAluno?.remove(); marcaAluno = null; areaAluno?.remove(); areaAluno = null; } fecharCartao(); }
    /** O aluno salvou/alterou a localização: reenquadra e consulta de novo na hora. */
    function aoMudarLocal() { enquadrou = false; if (ligado) atualizar(); }
    /** Troca de aba do app: o Leaflet precisa recalcular o tamanho quando o mapa volta a ficar visível, e a consulta só roda com a tela inicial aberta. */
    function aoMudarAba() { if (!ligado) return; if (abaInicioAberta()) { setTimeout(() => mapa?.invalidateSize(), 60); atualizar(); } }
    document.addEventListener("visibilitychange", () => { if (!document.hidden && ligado) { atualizar(); iniciarRelogio(); } });   // volta a aba: consulta já e reinicia o ciclo

    return { ligar, desligar, aoMudarLocal, aoMudarAba };
}
