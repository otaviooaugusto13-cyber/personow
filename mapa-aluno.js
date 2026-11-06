// Mapa de personais ONLINE — tela inicial do aluno (a home é o mapa, em tela cheia).
//
//  • Provedor principal: Google Maps JavaScript API com estilo próprio "clean" (sem pontos de interesse, sem ícones, só ruas e água), nos temas
//    escuro e claro. Precisa de GOOGLE_MAPS_KEY em config.js. Sem chave, ou se o Google recusar a chave/falhar ao carregar, cai sozinho no
//    Leaflet 1.9.4 + OpenStreetMap (sem chave). Se nenhum dos dois carregar, mostra uma lista simples.
//  • Posição do aluno = perfil.localizacao (branco com halo azul). Um marcador azul com anel branco por personal online.
//  • Os dados vêm do SERVIDOR (GET /personais/online): só personais aprovados com sinal de presença nos últimos ~75 s, dentro de RAIO_KM_AULAS,
//    com posição JÁ ARREDONDADA (~300 m). Aqui nunca existe a posição exata de ninguém.
//  • Atualiza a cada 20 s enquanto a aba do navegador está visível e a tela inicial está aberta (igual ao padrão de presenca.js).
import { consultar } from "./firebase.js";
import { GOOGLE_MAPS_KEY } from "./config.js";
import { CIDADES, acharCidade, distanciaKm, fmtKm } from "./geo.js";
import { esc } from "./core.js";
import { $, toast, abrir } from "./ui.js";

const LEAFLET = "1.9.4";
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET}`;
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const INTERVALO_MS = 20_000;                         // 15–30 s: consulta nova enquanto a aba está visível
const reduzMovimento = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const temMouse = () => window.matchMedia?.("(pointer: fine)").matches === true;
const escuro = () => !document.body.classList.contains("light-theme");

// ---------- estilos "clean" do Google Maps (paleta do app: preto/grafite/branco; o azul fica só nos marcadores) ----------
const SEM = (featureType, elementType = "all") => ({ featureType, elementType, stylers: [{ visibility: "off" }] });
const BASE_LIMPA = [SEM("poi"), SEM("transit"), SEM("administrative.land_parcel"), SEM("administrative.neighborhood"), SEM("road", "labels.icon"), SEM("road.local", "labels"), SEM("water", "labels"), SEM("administrative", "geometry")];
const ESTILO_ESCURO = [
    { elementType: "geometry", stylers: [{ color: "#14171B" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#7B8492" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#0B0B0D" }] },
    { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#14171B" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#1F2329" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ visibility: "off" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2A3038" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0B0B0D" }] },
    ...BASE_LIMPA];
const ESTILO_CLARO = [
    { elementType: "geometry", stylers: [{ color: "#F4F5F7" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#6B7480" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#FFFFFF" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ visibility: "off" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#E3E7EC" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#E1E8F3" }] },
    ...BASE_LIMPA];

// ---------- carregadores (sob demanda: só quando o aluno chega na tela inicial) ----------
let leafletPromessa = null, googlePromessa = null, aoFalharGoogle = null, googleRecusado = false;
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
/** Google Maps JS API (carregamento assíncrono oficial). `gm_authFailure` é o aviso do Google de chave inválida/restrita/sem faturamento. */
function carregarGoogle(chave) {
    if (window.google?.maps?.importLibrary) return Promise.resolve(window.google);
    if (googlePromessa) return googlePromessa;
    googlePromessa = new Promise((ok, falha) => {
        const fim = (e) => { googlePromessa = null; falha(e); };
        window.gm_authFailure = () => { googleRecusado = true; fim(new Error("chave recusada pelo Google")); aoFalharGoogle?.(); };   // pode chegar antes OU depois do mapa existir
        window.__pmGoogleInit = () => ok(window.google);
        const js = document.createElement("script");
        js.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(chave)}&v=quarterly&loading=async&language=pt-BR&region=BR&callback=__pmGoogleInit`;
        js.async = true;
        const timer = setTimeout(() => fim(new Error("tempo esgotado")), 15_000);
        js.onload = () => clearTimeout(timer);
        js.onerror = () => { clearTimeout(timer); js.remove(); fim(new Error("falha ao carregar")); };
        document.head.appendChild(js);
    });
    return googlePromessa;
}

// ---------- provedores: mesma interface, o resto do módulo não sabe qual está em uso ----------
function provedorGoogle(google, Map, el, c, onFundo) {
    let tema = escuro();
    const mapa = new Map(el, { center: { lat: c.lat, lng: c.lng }, zoom: 14, minZoom: 9, maxZoom: 19, disableDefaultUI: true, zoomControl: temMouse(), clickableIcons: false, gestureHandling: "greedy", backgroundColor: tema ? "#14171B" : "#F4F5F7", styles: tema ? ESTILO_ESCURO : ESTILO_CLARO });
    mapa.addListener("click", onFundo);
    // marcador em HTML (OverlayView): reaproveita o CSS .pm-pin/.pm-eu e não exige Map ID do Google
    class Pino extends google.maps.OverlayView {
        constructor(p, classe, rotulo, aoClicar) {
            super(); this.ll = new google.maps.LatLng(p.lat, p.lng);
            this.el = document.createElement(aoClicar ? "button" : "div"); this.el.className = `pm-gpin ${classe}`;
            if (aoClicar) { this.el.type = "button"; this.el.setAttribute("aria-label", rotulo); this.el.addEventListener("click", (e) => { e.stopPropagation(); aoClicar(); }); }
            else this.el.setAttribute("aria-hidden", "true");
            this.setMap(mapa);
        }
        onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.el); }
        draw() { const pt = this.getProjection()?.fromLatLngToDivPixel(this.ll); if (pt) { this.el.style.left = pt.x + "px"; this.el.style.top = pt.y + "px"; } }
        onRemove() { this.el.remove(); }
        mover(p) { this.ll = new google.maps.LatLng(p.lat, p.lng); this.draw(); }
    }
    let aluno = null; const pinos = new window.Map();
    return {
        nome: "google",
        setAluno(o) { if (!o) { aluno?.setMap(null); aluno = null; } else if (aluno) aluno.mover(o); else aluno = new Pino(o, "pm-eu", "Você está aqui", null); },
        setPersonais(lista, aoClicar, sel) {
            const vivos = new Set(lista.map((p) => p.id));
            for (const [id, pino] of pinos) if (!vivos.has(id)) { pino.setMap(null); pinos.delete(id); }
            for (const p of lista) { const pino = pinos.get(p.id); if (pino) pino.mover(p); else pinos.set(p.id, new Pino(p, "pm-pin", `Personal ${p.nome}`, () => aoClicar(p.id))); pinos.get(p.id).el.classList.toggle("sel", p.id === sel); }
        },
        selecionar(id) { for (const [pid, pino] of pinos) pino.el.classList.toggle("sel", pid === id); },
        enquadrar(pts) {
            const b = new google.maps.LatLngBounds(); pts.forEach((p) => b.extend(p));
            mapa.fitBounds(b, { top: 96, bottom: 150, left: 40, right: 40 });
            google.maps.event.addListenerOnce(mapa, "idle", () => { if (mapa.getZoom() > 15) mapa.setZoom(15); });
        },
        centrar(p, z) { mapa.setCenter({ lat: p.lat, lng: p.lng }); mapa.setZoom(z); },
        garantirVisivel(id, alturaCartao) {   // o cartão cobre a parte de baixo: se o marcador ficaria escondido, empurra o mapa
            const pino = pinos.get(id), pt = pino?.getProjection()?.fromLatLngToContainerPixel(pino.ll); if (!pt) return;
            const livre = el.clientHeight - alturaCartao - 70; if (pt.y > livre) mapa.panBy(0, pt.y - livre);
        },
        atualizarTamanho() { google.maps.event.trigger(mapa, "resize"); },
        tema(esc) { if (esc !== tema) { tema = esc; mapa.setOptions({ styles: esc ? ESTILO_ESCURO : ESTILO_CLARO, backgroundColor: esc ? "#14171B" : "#F4F5F7" }); } },
        limpar() { aluno?.setMap(null); aluno = null; for (const [, pino] of pinos) pino.setMap(null); pinos.clear(); },
        destruir() { this.limpar(); el.innerHTML = ""; }
    };
}

function provedorLeaflet(L, el, c, onFundo) {
    const anima = !reduzMovimento();
    const mapa = L.map(el, { zoomControl: false, attributionControl: false, minZoom: 9, maxZoom: 18, zoomSnap: 0.5, zoomAnimation: anima, fadeAnimation: anima, markerZoomAnimation: anima }).setView([c.lat, c.lng], 14);
    L.tileLayer(TILES, { maxZoom: 19, className: "pm-tile", attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(mapa);
    L.control.attribution({ prefix: false, position: "bottomleft" }).addTo(mapa);
    if (temMouse()) L.control.zoom({ position: "bottomright", zoomInTitle: "Aproximar", zoomOutTitle: "Afastar" }).addTo(mapa);
    mapa.on("click", onFundo);
    const icone = (classe, texto) => L.divIcon({ className: classe, html: `<span class="sr-only">${esc(texto)}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] });
    let aluno = null; const marcas = new Map();
    return {
        nome: "leaflet",
        setAluno(o) { if (!o) { aluno?.remove(); aluno = null; } else if (aluno) aluno.setLatLng([o.lat, o.lng]); else aluno = L.marker([o.lat, o.lng], { icon: icone("pm-eu", "Você está aqui"), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(mapa); },
        setPersonais(lista, aoClicar, sel) {
            const vivos = new Set(lista.map((p) => p.id));
            for (const [id, m] of marcas) if (!vivos.has(id)) { m.remove(); marcas.delete(id); }
            for (const p of lista) {
                const m = marcas.get(p.id);
                if (m) m.setLatLng([p.lat, p.lng]);
                else { const novo = L.marker([p.lat, p.lng], { icon: icone("pm-pin", p.nome), title: p.nome, alt: `Personal ${p.nome}`, keyboard: true, riseOnHover: true }).addTo(mapa); novo.on("click", (ev) => { L.DomEvent.stopPropagation(ev); aoClicar(p.id); }); marcas.set(p.id, novo); }
                marcas.get(p.id)._icon?.classList.toggle("sel", p.id === sel);
            }
        },
        selecionar(id) { for (const [pid, m] of marcas) m._icon?.classList.toggle("sel", pid === id); },
        enquadrar(pts) { mapa.fitBounds(pts.map((p) => [p.lat, p.lng]), { paddingTopLeft: [40, 96], paddingBottomRight: [40, 150], maxZoom: 15, animate: !reduzMovimento() }); },
        centrar(p, z) { mapa.setView([p.lat, p.lng], z, { animate: !reduzMovimento() }); },
        garantirVisivel(id, alturaCartao) {
            const m = marcas.get(id); if (!m) return;
            const pt = mapa.latLngToContainerPoint(m.getLatLng()), livre = mapa.getSize().y - alturaCartao - 70; if (pt.y > livre) mapa.panBy([0, pt.y - livre], { animate: !reduzMovimento() });
        },
        atualizarTamanho() { mapa.invalidateSize(); },
        tema() { /* o filtro escuro/claro dos tiles é CSS (body.light-theme) */ },
        limpar() { aluno?.remove(); aluno = null; for (const [, m] of marcas) m.remove(); marcas.clear(); },
        destruir() { this.limpar(); mapa.remove(); }
    };
}

const rotuloNota = (p) => (p.ratingQtd ? `<span class="stars">★ ${String(p.ratingMedia).replace(".", ",")}</span> <span class="muted small">(${p.ratingQtd})</span>` : '<span class="muted small">Novo na plataforma</span>');
const fotoOuInicial = (p) => (p.foto ? `<img src="${esc(p.foto)}" alt="" referrerpolicy="no-referrer">` : esc((p.nome || "P")[0].toUpperCase()));

/**
 * ctx: { perfil(): perfil do aluno, abrirLocal(): abre a sheet de localização, chamar(id, nome): fluxo de aula direta com personal preferido }
 * Devolve { ligar, desligar, aoMudarLocal, aoMudarAba }.
 */
export function iniciarMapa(ctx) {
    let prov = null;
    let dados = [], selecionado = null, timer = null, emVoo = false, ligado = false, enquadrou = false, erroRede = false, semMapa = false, semLocalizacao = false, googleFalhou = !GOOGLE_MAPS_KEY, criando = null;

    const raiz = () => $("card-mapa");
    const temLocal = () => Number.isFinite(ctx.perfil()?.localizacao?.lat) && Number.isFinite(ctx.perfil()?.localizacao?.lng);
    const origem = () => (temLocal() ? { lat: ctx.perfil().localizacao.lat, lng: ctx.perfil().localizacao.lng } : null);
    /** Sem localização do aluno: centraliza na cidade dele (se conhecida) ou na primeira da lista do app. */
    const centroPadrao = () => { const c = acharCidade(ctx.perfil()?.localizacao?.cidade) || CIDADES[0]; return { lat: c.lat, lng: c.lng }; };
    const abaInicioAberta = () => $("tab-home")?.classList.contains("active");

    // ---------- esqueleto (uma vez): o mapa ocupa a tela toda; o resto flutua por cima ----------
    function montar() {
        const el = raiz(); if (!el || el.dataset.pronto) return;
        el.dataset.pronto = "1";
        el.innerHTML = `
        <div class="pm-wrap">
            <div id="mapa-personais" class="pm-mapa" role="region" aria-label="Mapa com os personais online perto de você"></div>
            <div class="pm-pilulas">
                <button class="pm-resumo" id="btn-resumo" type="button" aria-label="Abrir resumo e pendências" title="Resumo">☰<i class="pm-ponto" id="mapa-pendencias" hidden></i></button>
                <p class="pm-contador" id="mapa-contador" role="status" aria-live="polite">Buscando personais…</p>
            </div>
            <button class="pm-centro" id="mapa-centrar" type="button" aria-label="Centralizar o mapa em mim" title="Centralizar em mim">◎</button>
            <div class="pm-aviso" id="mapa-aviso" hidden>
                <div><strong>Defina sua localização</strong><br><span class="muted small">Assim mostramos só os personais perto de você.</span></div>
                <button class="btn btn-primary" id="mapa-definir-local" type="button">📍 Definir minha localização</button>
            </div>
            <div class="pm-vazio" id="mapa-vazio" hidden><strong>Nenhum personal online agora</strong><br><span class="muted small">Use o <b>Chamado relâmpago</b>: avisamos quem estiver por perto.</span></div>
            <p class="pm-status muted small" id="mapa-status" hidden></p>
            <div id="mapa-lista" class="stack" hidden></div>
            <article class="pm-cartao" id="mapa-cartao" hidden aria-live="polite"></article>
        </div>`;
        $("mapa-definir-local").addEventListener("click", () => ctx.abrirLocal());
        $("mapa-centrar").addEventListener("click", () => centralizar());
        $("btn-resumo").addEventListener("click", () => abrir("sheet-inicio"));
        $("mapa-cartao").addEventListener("click", (e) => {
            if (e.target.closest("[data-pm-fechar]")) return fecharCartao();
            const b = e.target.closest("[data-pm-chamar]"); if (!b) return;
            const p = dados.find((x) => x.id === b.dataset.pmChamar); if (!p) return toast("Esse personal ficou offline. Escolha outro.", "erro");
            fecharCartao(); ctx.chamar(p.id, p.nome);
        });
        $("mapa-lista").addEventListener("click", (e) => { const b = e.target.closest("[data-pm-chamar]"); const p = b && dados.find((x) => x.id === b.dataset.pmChamar); if (p) ctx.chamar(p.id, p.nome); });
        // bolinha no botão ☰ quando há pendência (avisos de cadastro/cartão/local ou próxima aula) dentro do Resumo
        const resumo = $("sheet-inicio"); if (resumo) new MutationObserver(pintarPendencias).observe(resumo, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
        pintarPendencias();
    }
    function pintarPendencias() {
        const n = document.querySelectorAll("#sheet-inicio .banner:not([hidden]), #sheet-inicio #card-proximo:not([hidden])").length, p = $("mapa-pendencias");
        if (p) p.hidden = n === 0;
    }

    /** Cria o mapa: Google se houver chave e ele carregar; senão Leaflet/OSM; senão lista. */
    async function criarMapa() {
        if (prov || semMapa) return;
        if (criando) return criando;
        criando = (async () => {
            const el = $("mapa-personais"); if (!el) return;
            const c = origem() || centroPadrao(), fundo = () => fecharCartao();
            if (!googleFalhou) {
                try {
                    const google = await carregarGoogle(GOOGLE_MAPS_KEY), { Map } = await google.maps.importLibrary("maps");
                    prov = provedorGoogle(google, Map, el, c, fundo);
                    if (googleRecusado) throw new Error("chave recusada pelo Google");
                    aoFalharGoogle = () => { if (prov?.nome === "google") { prov.destruir(); prov = null; googleFalhou = true; enquadrou = false; criarMapa().then(() => { pintarTudo(); centralizar(); }); } };
                } catch (e) { console.warn("mapa (Google):", e.message); googleFalhou = true; try { prov?.destruir(); } catch { /* já limpo */ } prov = null; el.innerHTML = ""; }
            }
            if (!prov) {
                try { prov = provedorLeaflet(await carregarLeaflet(), el, c, fundo); } catch (e) { semMapa = true; console.warn("mapa (Leaflet):", e.message); }
            }
        })();
        try { await criando; } finally { criando = null; }
        pintarTudo();
        setTimeout(() => prov?.atualizarTamanho(), 150);
    }

    // ---------- cartão do personal (abre ao tocar no marcador) ----------
    function abrirCartao(id) {
        const p = dados.find((x) => x.id === id), el = $("mapa-cartao"); if (!p || !el) return;
        selecionado = id; pintarCartao(p); el.hidden = false; $("tab-home")?.classList.add("pm-card-aberto");
        prov?.selecionar(id); prov?.garantirVisivel(id, el.offsetHeight);
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
        selecionado = null; const el = $("mapa-cartao"); if (el) el.hidden = true; $("tab-home")?.classList.remove("pm-card-aberto"); prov?.selecionar(null);
    }

    // ---------- textos e estados ----------
    function pintarTudo() {
        montar();
        const n = dados.length;
        $("mapa-contador").textContent = semLocalizacao ? "Defina sua localização" : `${n} ${n === 1 ? "personal ativo" : "personais ativos"} agora`;
        $("mapa-aviso").hidden = !semLocalizacao;
        $("mapa-vazio").hidden = semLocalizacao || n > 0 || (erroRede && !enquadrou);
        const st = $("mapa-status"); st.hidden = !erroRede; st.textContent = erroRede ? "Sem conexão com o servidor. Tentando de novo em instantes…" : "";
        // plano C: nem Google nem Leaflet carregaram → lista de quem está online
        const lista = $("mapa-lista"), mapaEl = $("mapa-personais");
        mapaEl.hidden = semMapa; $("mapa-centrar").hidden = semMapa; lista.hidden = !semMapa || !n; mapaEl.parentElement.classList.toggle("pm-sem-mapa", semMapa);
        if (semMapa) {
            st.hidden = false; st.textContent = "Não foi possível carregar o mapa agora. Mostrando a lista de quem está online.";
            lista.innerHTML = dados.map((p) => `<article class="card conversa"><div class="avatar">${fotoOuInicial(p)}</div><div class="grow"><h4>${esc(p.nome)}</h4><div class="small">${rotuloNota(p)}</div><div class="muted small">${esc((p.modalidades || []).join(", ") || "Treino geral")} · ≈ ${esc(fmtKm(p.distanciaKm))}</div></div><button class="btn btn-ghost btn-sm" type="button" data-pm-chamar="${esc(p.id)}">Chamar</button></article>`).join("");
            return;
        }
        if (!prov) return;
        prov.tema(escuro()); prov.setAluno(origem()); prov.setPersonais(dados, abrirCartao, selecionado);
        if (selecionado) { const p = dados.find((x) => x.id === selecionado); if (p) pintarCartao(p); else { fecharCartao(); toast("Esse personal ficou offline.", "info"); } }
    }

    /** Enquadra o aluno + personais (primeira carga, mudança de localização e botão "centralizar"). */
    function centralizar() {
        if (!prov) return;
        const pts = [], o = origem(); if (o) pts.push(o); for (const p of dados) pts.push({ lat: p.lat, lng: p.lng });
        if (pts.length > 1) prov.enquadrar(pts); else if (pts.length === 1) prov.centrar(pts[0], 15); else prov.centrar(centroPadrao(), 13);
        enquadrou = true;
    }

    // ---------- consulta ao servidor ----------
    async function atualizar() {
        if (!ligado || emVoo || document.hidden || !abaInicioAberta()) return;
        montar();
        if (!temLocal()) { semLocalizacao = true; dados = []; erroRede = false; await criarMapa(); pintarTudo(); if (prov && !enquadrou) centralizar(); return; }
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
        if (prov && !enquadrou && !erroRede) centralizar();
    }

    function iniciarRelogio() { clearInterval(timer); timer = setInterval(atualizar, INTERVALO_MS); }

    // ---------- API ----------
    function ligar() { if (ligado) return; ligado = true; montar(); atualizar(); iniciarRelogio(); }
    function desligar() { ligado = false; clearInterval(timer); timer = null; emVoo = false; dados = []; enquadrou = false; erroRede = false; selecionado = null; prov?.limpar(); fecharCartao(); }
    /** O aluno salvou/alterou a localização: reenquadra e consulta de novo na hora. */
    function aoMudarLocal() { enquadrou = false; if (ligado) atualizar(); }
    /** Troca de aba do app: o mapa precisa recalcular o tamanho quando volta a ficar visível, e a consulta só roda com a tela inicial aberta. */
    function aoMudarAba() { if (!ligado) return; if (abaInicioAberta()) { setTimeout(() => prov?.atualizarTamanho(), 60); atualizar(); } else fecharCartao(); }
    document.addEventListener("visibilitychange", () => { if (!document.hidden && ligado) { atualizar(); iniciarRelogio(); } });   // volta a aba: consulta já e reinicia o ciclo

    return { ligar, desligar, aoMudarLocal, aoMudarAba };
}
