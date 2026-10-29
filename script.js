// ============================================================
// PERSONOW — app do ALUNO
// Dinheiro, criação/aceite de aula e chat passam SEMPRE pelo servidor (chamarFuncao).
// O navegador só lê (onSnapshot) e faz ações simples permitidas pelo firestore.rules.
// ============================================================
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, googleProvider, chamarFuncao, mensagemErroAuth } from "./firebase.js";
import { FOCOS, WHATSAPP_SUPORTE } from "./config.js";
import {
    esc, brl, fmtData, hojeLocal, ymdLocal, reaisParaCentavos, calcularSplit, validarAula, mensagemSuspeita, estaPaga, valorCentavos,
    ROTULO_STATUS, iconeFoco, urlImagemSegura, mascaraTelefone, mascaraCPF, cpfValido
} from "./core.js";
import { $, toast, iniciarTema, alternarTema, registrarSW, notificar, pedirPermissaoNotificacao, baixarCSV, vazio, carregarAviso } from "./ui.js";
import { pintarRecado } from "./recado.js";
import { pontuarPersonal } from "./perfil-inteligente.js";

iniciarTema();
registrarSW();
carregarAviso();

// ---------- estado ----------
let usuarioAtual = null;
let aulas = [];                    // aulas do aluno (tempo real)
let primeiraCargaAulas = true;
let statusAnterior = new Map();
let desligarAulas = null;
let dataCalendario = new Date();
let diaSelecionado = "";
let mapRadar, userMarker;
let personaisAtivos = [];
let posicaoAluno = null;
let pedidoPreferido = null;        // { uid, nome } quando o aluno usa "Chamar agora"
let precisaPadroes = true;
let mapaFalhou = false;
let marcadoresPersonais = [];
let enviandoPedido = false;
let preferenciaFoco = "";
const chat = { aulaId: null, desligar: null, enviando: false };
const avaliacao = { aulaId: null, estrelas: 0, enviando: false };

// Se a chave do Google Maps for recusada, o mapa some e o radar animado continua visível
window.gm_authFailure = () => { mapaFalhou = true; const el = $("mapa-quadrado"); if (el) { el.classList.remove("on"); el.innerHTML = ""; } };

const textoErro = (e, padrao) => (e?.message && e.code !== "backend-nao-configurado" ? e.message : padrao);

// ==========================================
// LOGIN / LOGOUT
// ==========================================
function setLoginLoading(loading) {
    const btn = $("btn-login-aluno");
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle("loading", loading);
    btn.dataset.label = btn.dataset.label || btn.innerHTML;
    btn.innerHTML = loading ? '<span class="spinner"></span> Entrando...' : btn.dataset.label;
}

async function loginGoogleAluno() {
    const termos = $("check-termos-aluno");
    if (termos && !termos.checked) { toast("Aceite os Termos de Uso para continuar."); return; }
    setLoginLoading(true);
    try {
        await signInWithPopup(auth, googleProvider);   // onAuthStateChanged cuida do resto
    } catch (error) {
        let falha = error;
        if (error.code === "auth/popup-blocked") {
            try { await signInWithRedirect(auth, googleProvider); return; } catch (e) { falha = e; }
        }
        console.error("Erro no login Google:", falha);
        const msg = mensagemErroAuth(falha);
        if (msg) toast(msg);
        setLoginLoading(false);
    }
}

async function logoutAluno() {
    pararTudo();
    try { await signOut(auth); } catch (e) { console.error(e); }
}

function pararTudo() {
    desligarAulas?.(); desligarAulas = null;
    fecharChatAula();
    aulas = []; primeiraCargaAulas = true; statusAnterior = new Map();
}

function mostrarApp(user) {
    usuarioAtual = user;
    const nome = user.displayName || user.email.split("@")[0];
    $("display-name-home").textContent = nome.split(" ")[0];
    $("display-name-profile").textContent = nome;

    const inicial = nome.charAt(0).toUpperCase();
    const av = $("main-user-avatar");
    av.textContent = inicial;
    const foto = urlImagemSegura(user.photoURL);
    if (foto) { av.textContent = ""; av.style.backgroundImage = `url("${foto}")`; av.style.backgroundSize = "cover"; av.style.backgroundPosition = "center"; }
    $("display-avatar-profile").textContent = inicial;
    if (foto) {
        const img = $("img-aluno-perfil-preview");
        img.src = foto; img.referrerPolicy = "no-referrer"; img.style.display = "block";
        $("display-avatar-profile").style.display = "none";
    }

    navTo("screen-main");
    const lk = $("input-link-indicacao");
    if (lk) lk.value = location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html";
    const inpData = $("solicitacao-data");
    if (inpData) { inpData.min = hojeLocal(); if (!inpData.value) inpData.value = hojeLocal(); }

    preencherSelectFocos();
    garantirPerfilAluno().then(carregarPerfilAluno);
    renderPersonais();
    pedirLocalizacao();
    escutarAulas();
    if (window.google && !mapRadar) initMap();
}

function mostrarLogin() {
    usuarioAtual = null;
    pararTudo();
    setLoginLoading(false);
    navTo("screen-login");
}

onAuthStateChanged(auth, (user) => { if (user) mostrarApp(user); else mostrarLogin(); });
getRedirectResult(auth).catch((error) => { const msg = mensagemErroAuth(error); if (msg) toast(msg); });

// ==========================================
// NAVEGAÇÃO / TEMA
// ==========================================
function navTo(screenId) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(screenId).classList.add("active");
    window.scrollTo(0, 0);
}

function switchTab(tabId, navElement) {
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
    $(tabId).classList.add("active");
    document.querySelectorAll(".nav-item").forEach((i) => i.classList.remove("active"));
    if (navElement) navElement.classList.add("active");
    window.scrollTo(0, 0);
    if (usuarioAtual && tabId === "tab-home") renderPersonais();
}
const toggleTheme = alternarTema;

// ==========================================
// PERFIL DO ALUNO  (coleção alunos/{uid})
// ==========================================
function preencherSelectFocos() {
    const sel = $("pref-foco");
    if (sel && !sel.dataset.pronto) { sel.innerHTML = FOCOS.map((f) => `<option>${esc(f.v)}</option>`).join(""); sel.dataset.pronto = "1"; }
    const tel = $("aluno-input-telefone");
    if (tel && !tel.dataset.mask) { tel.dataset.mask = "1"; tel.addEventListener("input", () => { tel.value = mascaraTelefone(tel.value); }); }
    const cpf = $("pg-doc");
    if (cpf && !cpf.dataset.mask) { cpf.dataset.mask = "1"; cpf.addEventListener("input", () => { cpf.value = mascaraCPF(cpf.value); }); }
}

/** Garante o documento do aluno (o recibo da aula lê nome e e-mail daqui). */
async function garantirPerfilAluno() {
    try { await setDoc(doc(db, "alunos", usuarioAtual.uid), { uid: usuarioAtual.uid, nome: usuarioAtual.displayName || "", email: usuarioAtual.email || "", atualizadoEm: serverTimestamp() }, { merge: true }); }
    catch (e) { console.warn("Perfil do aluno não gravado:", e.code); }
}

async function carregarPerfilAluno() {
    try {
        const snap = await getDoc(doc(db, "alunos", usuarioAtual.uid));
        if (!snap.exists()) return;
        const d = snap.data();
        pintarRecado($("screen-main"), d.recado, "aluno");
        if (d.objetivo) $("aluno-select-objetivo").value = d.objetivo;
        if (d.telefone) $("aluno-input-telefone").value = d.telefone;
        if (d.pagamento?.metodo) $("pg-metodo").value = d.pagamento.metodo;
        if (d.pagamento?.documento) $("pg-doc").value = d.pagamento.documento;
        if (d.preferencias?.foco) { $("pref-foco").value = d.preferencias.foco; preferenciaFoco = d.preferencias.foco; }
        if (d.preferencias?.turno) $("pref-turno").value = d.preferencias.turno;
    } catch (e) { console.warn("Perfil não carregado:", e.code); }
}

async function salvarCampos(dados, msg, subId) {
    if (!usuarioAtual) return;
    try {
        await setDoc(doc(db, "alunos", usuarioAtual.uid), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true });
        toast(msg);
        if (subId) fecharSubtela(subId);
    } catch (e) { console.error(e); toast("Não foi possível salvar. Tente novamente."); }
}

function salvarPerfilAluno() {
    const tel = $("aluno-input-telefone").value.trim();
    if (tel && tel.replace(/\D/g, "").length < 10) { toast("Telefone incompleto. Use DDD + número."); return; }
    salvarCampos({ nome: usuarioAtual?.displayName || "", email: usuarioAtual?.email || "", objetivo: $("aluno-select-objetivo").value, telefone: tel }, "✅ Perfil salvo!");
}
function salvarPagamento() {
    const docVal = $("pg-doc").value.trim();
    if (docVal && !cpfValido(docVal)) { toast("CPF inválido. Confira os 11 dígitos."); return; }
    salvarCampos({ pagamento: { metodo: $("pg-metodo").value, documento: docVal } }, "✅ Forma de pagamento salva!", "subscreen-pagamento");
}
function salvarPreferencias() {
    preferenciaFoco = $("pref-foco").value;
    aplicarDistancias();   // reordena a lista de personais pelo foco preferido
    salvarCampos({ preferencias: { foco: preferenciaFoco, turno: $("pref-turno").value } }, "✅ Preferências salvas!", "subscreen-preferencias");
}
async function salvarNotificacoes() {
    const ok = await pedirPermissaoNotificacao();
    fecharSubtela("subscreen-notificacoes");
    toast(ok ? "✅ Avisos ativados neste aparelho!" : "Ative as notificações do navegador para receber avisos fora do app.");
}

function atualizarFotoPerfilAluno(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = $("img-aluno-perfil-preview");
        img.src = e.target.result; img.style.display = "block";
        $("display-avatar-profile").style.display = "none";
    };
    reader.readAsDataURL(file);   // só pré-visualização: a foto ainda não é enviada (precisa do Firebase Storage)
}

// ==========================================
// PERSONAIS (cards, perfil, radar, mapa)
// ==========================================
async function renderPersonais() {
    if (!$("lista-personais-reais")) return;
    try {
        const snap = await getDocs(query(collection(db, "personais"), where("status", "==", "ativo")));
        personaisAtivos = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((p) => p.uid !== usuarioAtual?.uid);
    } catch (e) { console.warn("Personais não carregados:", e.code); personaisAtivos = []; }
    aplicarDistancias();
}

const fmtKm = (km) => (km < 1 ? `${Math.max(50, Math.round(km * 10) * 100)} m` : `${km.toFixed(1).replace(".", ",")} km`);
function kmEntre(a, b) {
    const R = 6371, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
const temCoord = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
const fotoPersonal = (p, nome) => { const u = urlImagemSegura(p.fotoGoogle); return u ? `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer">` : esc(nome.charAt(0).toUpperCase()); };
const estrelasTxt = (p) => (p.ratingQtd > 0 ? `<span class="rating-line">★ ${Number(p.ratingMedia).toFixed(1).replace(".", ",")} (${p.ratingQtd})</span>` : `<span class="muted-line" style="margin:0">Novo na plataforma</span>`);

function cartaoPersonal(p, i) {
    const nome = p.nome || "Personal";
    const cref = (p.cref || "").trim() ? `<span class="pc-verif" title="CREF informado: ${esc(p.cref)}">CREF</span>` : "";
    const esp = p.especialidade || "Personal trainer";
    const preco = Number(p.valorMin) > 0 ? `💰 A partir de ${brl(Math.round(p.valorMin * 100))}/aula` : "💰 Valor definido no pedido";
    const dist = p._km != null ? `📍 ${fmtKm(p._km)} de você` : "📍 Na sua região";
    return `<article class="pc">
        <div class="pc-top">
            <div class="pc-ring"><div class="pc-photo">${fotoPersonal(p, nome)}</div><span class="pc-dot"></span></div>
            <div class="pc-info">
                <div class="pc-name"><strong>${esc(nome)}</strong>${cref}</div>
                <span class="pc-pill">${iconeFoco(esp)} ${esc(esp)}</span> ${estrelasTxt(p)}
            </div>
        </div>
        <div class="pc-meta"><span>${dist}</span><span>${preco}</span></div>
        ${p._match?.score != null && preferenciaFoco ? `<div class="razoes-match"><span class="chip-match ${p._match.nivel}">${p._match.score}% combina</span> ${p._match.razoes.map(esc).join(" · ")}</div>` : ""}
        <div class="pc-actions">
            <button type="button" class="pc-btn ghost" onclick="verPerfil(${i})">Ver perfil</button>
            <button type="button" class="pc-btn" onclick="chamarPersonal(${i})">⚡ Chamar agora</button>
        </div>
    </article>`;
}

function renderListaPersonais() {
    const lista = $("lista-personais-reais");
    if (!lista) return;
    lista.innerHTML = personaisAtivos.length
        ? personaisAtivos.map(cartaoPersonal).join("")
        : vazio("🏋️", "Nenhum personal ativo ainda", "Faça seu pedido acima: os personais da região recebem a sua proposta.");
}

function chamarPersonal(i) { const p = personaisAtivos[i]; if (p) abrirSheetPedido(null, { uid: p.uid, nome: p.nome || "Personal" }); }
function fecharSheetPerfil() { $("sheet-perfil").classList.remove("open"); document.body.classList.remove("no-scroll"); }
function verPerfil(i) {
    const p = personaisAtivos[i]; if (!p) return;
    const nome = p.nome || "Personal", esp = p.especialidade || "Personal trainer";
    $("sheet-perfil-corpo").innerHTML = `
        <div class="pf-head"><div class="pc-ring big"><div class="pc-photo">${fotoPersonal(p, nome)}</div><span class="pc-dot"></span></div>
        <h3>${esc(nome)}</h3><span class="pc-pill">${iconeFoco(esp)} ${esc(esp)}</span> ${estrelasTxt(p)}</div>
        <div class="pc-meta pf-meta"><span>${p._km != null ? "📍 " + fmtKm(p._km) + " de você" : "📍 Na sua região"}</span><span>${Number(p.valorMin) > 0 ? "💰 A partir de " + brl(Math.round(p.valorMin * 100)) + "/aula" : "💰 Valor definido no pedido"}</span></div>
        ${(p.cref || "").trim() ? `<p class="pf-line">🛡️ CREF informado: <strong>${esc(p.cref)}</strong></p>` : ""}
        ${p.cidade ? `<p class="pf-line">🏙️ Atua em ${esc(p.cidade)}</p>` : ""}
        ${Array.isArray(p.experiencias) && p.experiencias.length ? `<p class="pf-line">💼 ${p.experiencias.map((e) => `${esc(e.foco)}${e.anos >= 1 ? " (" + e.anos + (e.anos === 1 ? " ano" : " anos") + ")" : ""}`).join(" · ")}</p>` : ""}
        <p class="pf-bio">${p.bio ? esc(p.bio) : "Este personal ainda não escreveu uma apresentação."}</p>
        ${Array.isArray(p.palavrasChave) && p.palavrasChave.length ? `<div class="tags-perfil">${p.palavrasChave.map((k) => `<span>${esc(k)}</span>`).join("")}</div>` : ""}
        <button type="button" class="btn btn-primary" onclick="fecharSheetPerfil();chamarPersonal(${i})">⚡ Chamar ${esc(nome.split(" ")[0])}</button>
        <button type="button" class="btn btn-outline" style="margin-top:8px" onclick="fecharSheetPerfil()">Fechar</button>`;
    $("sheet-perfil").classList.add("open");
    document.body.classList.add("no-scroll");
}

function aplicarDistancias() {
    personaisAtivos.forEach((p) => { p._km = posicaoAluno && temCoord(p) ? kmEntre(posicaoAluno, p) : null; });
    const foco = preferenciaFoco || "";   // só a preferência salva do aluno reordena (o select do pedido sempre tem um valor padrão)
    personaisAtivos.forEach((p) => { p._match = pontuarPersonal(p, { foco, distKm: p._km, fmtKm }); });
    // com foco escolhido: melhor afinidade primeiro (distância desempata); sem foco: mais perto primeiro, como antes
    personaisAtivos.sort((a, b) => foco && a._match.score !== b._match.score ? (b._match.score ?? -1) - (a._match.score ?? -1) : (a._km ?? 1e9) - (b._km ?? 1e9));
    renderListaPersonais();
    atualizarRadar();
    marcarPersonaisNoMapa();
}

function hashStr(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

function atualizarRadar() {
    const blips = $("radar-blips"), cnt = $("radar-count");
    if (!blips || !cnt) return;
    const n = personaisAtivos.length;
    cnt.textContent = n === 0 ? "Nenhum personal online agora" : n === 1 ? "1 personal disponível na região" : `${n} personais disponíveis na região`;
    blips.innerHTML = personaisAtivos.slice(0, 12).map((p, i) => {
        let x, y;
        if (p._km != null && posicaoAluno) {
            const ang = Math.atan2((p.lng - posicaoAluno.lng) * Math.cos((posicaoAluno.lat * Math.PI) / 180), p.lat - posicaoAluno.lat);
            const r = 0.18 + Math.min(p._km / 5, 1) * 0.72;
            x = 50 + r * 46 * Math.sin(ang); y = 50 - r * 40 * Math.cos(ang);
        } else {
            const h = hashStr(p.uid || p.nome || i), ang = (h % 360) * (Math.PI / 180), r = 0.3 + ((h >> 4) % 60) / 100;
            x = 50 + r * 46 * Math.sin(ang); y = 50 - r * 40 * Math.cos(ang);
        }
        return `<button type="button" class="radar-blip" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;animation-delay:${(i * 0.35).toFixed(2)}s" title="${esc(p.nome)}" onclick="verPerfil(${i})">${esc((p.nome || "P").charAt(0).toUpperCase())}</button>`;
    }).join("");
}

function initMap() {
    const el = $("mapa-quadrado");
    if (!el || mapRadar || !window.google || mapaFalhou) return;
    if (!$("screen-main").classList.contains("active")) return;   // container oculto tem tamanho 0
    mapRadar = new google.maps.Map(el, {
        zoom: 14, center: posicaoAluno || { lat: -22.4389, lng: -46.8258 }, disableDefaultUI: true,
        styles: [
            { elementType: "geometry", stylers: [{ color: "#1a1a24" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a24" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#8a93a6" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c38" }] },
            { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212123" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] }
        ]
    });
    google.maps.event.addListenerOnce(mapRadar, "tilesloaded", () => { setTimeout(() => { if (!mapaFalhou) el.classList.add("on"); }, 700); });
    atualizarMapaPosicao();
    marcarPersonaisNoMapa();
}

function marcarPersonaisNoMapa() {
    if (!mapRadar || !window.google || mapaFalhou) return;
    marcadoresPersonais.forEach((m) => m.setMap(null));
    marcadoresPersonais = [];
    personaisAtivos.forEach((p, i) => {
        if (!temCoord(p)) return;
        const m = new google.maps.Marker({ position: { lat: p.lat, lng: p.lng }, map: mapRadar, title: p.nome, label: { text: (p.nome || "P").charAt(0).toUpperCase(), color: "#fff", fontWeight: "700" } });
        m.addListener("click", () => verPerfil(i));   // índice por closure (antes buscava pelo nome e errava com nomes repetidos)
        marcadoresPersonais.push(m);
    });
}

function atualizarMapaPosicao() {
    if (!mapRadar || !posicaoAluno || !window.google) return;
    mapRadar.setCenter(posicaoAluno);
    if (userMarker) userMarker.setPosition(posicaoAluno);
    else userMarker = new google.maps.Marker({ position: posicaoAluno, map: mapRadar, title: "Você", icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: "#3B82F6", fillOpacity: 1, strokeWeight: 2, strokeColor: "#ffffff" } });
}

function pedirLocalizacao() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
        posicaoAluno = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        $("loc-text").textContent = "Localização ativa";
        aplicarDistancias();
        atualizarMapaPosicao();
        if (window.google && google.maps && google.maps.Geocoder && !mapaFalhou) {
            new google.maps.Geocoder().geocode({ location: posicaoAluno }, (res, status) => {
                if (status !== "OK" || !res || !res[0]) return;
                const comp = (t) => (res[0].address_components.find((c) => c.types.includes(t)) || {});
                const cidade = comp("administrative_area_level_2").long_name || comp("locality").long_name, uf = comp("administrative_area_level_1").short_name;
                if (cidade) $("loc-text").textContent = uf ? `${cidade}, ${uf}` : cidade;
            });
        }
    }, () => {}, { maximumAge: 300000, timeout: 10000 });
}

// ==========================================
// PEDIR PERSONAL (bottom sheet) → servidor
// ==========================================
function preencherPadroes() {
    const agora = new Date();
    let ini = new Date(agora);
    ini.setMinutes(Math.ceil(agora.getMinutes() / 30) * 30, 0, 0);
    let dia = new Date(agora);
    if (ini.getHours() >= 22 || ini.getDate() !== agora.getDate()) { dia.setDate(dia.getDate() + 1); ini = new Date(dia); ini.setHours(8, 0, 0, 0); }
    const fim = new Date(ini.getTime() + 3600000);
    const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    $("solicitacao-data").value = ymdLocal(dia);
    $("solicitacao-entrada").value = hhmm(ini);
    $("solicitacao-saida").value = hhmm(fim);
}

function atualizarResumoValor() {
    const c = reaisParaCentavos($("solicitacao-valor").value);
    let s = { personal: 0, comissao: 0 };
    try { if (c > 0) s = calcularSplit(c); } catch (e) {}
    $("rv-prom").textContent = brl(s.personal);
    $("rv-taxa").textContent = brl(s.comissao);
}
function definirValor(v) { $("solicitacao-valor").value = v; atualizarResumoValor(); }

function selecionarFoco(v) {
    $("solicitacao-foco").value = v;
    document.querySelectorAll(".chip[data-v]").forEach((c) => {
        const on = c.dataset.v === v;
        c.classList.toggle("sel", on);
        c.setAttribute("aria-checked", on ? "true" : "false");
    });
    const t = $("sheet-titulo"); if (t) t.textContent = "Pedir personal · " + v;
}

function abrirSheetPedido(foco, preferido) {
    pedidoPreferido = preferido && typeof preferido === "object" ? preferido : null;
    if (typeof foco === "string" && foco) selecionarFoco(foco);
    else selecionarFoco(preferenciaFoco && FOCOS.some((f) => f.v === preferenciaFoco) && precisaPadroes ? preferenciaFoco : $("solicitacao-foco").value);
    if (precisaPadroes) { preencherPadroes(); precisaPadroes = false; }
    if (!$("solicitacao-valor").value) $("solicitacao-valor").value = 80;
    if (!$("solicitacao-local").value) { try { $("solicitacao-local").value = localStorage.getItem("personow_local") || ""; } catch (e) {} }
    atualizarResumoValor();
    $("sheet-sub").textContent = pedidoPreferido ? `Pedido reservado para ${pedidoPreferido.nome} por alguns minutos.` : "Os personais da região recebem o seu pedido.";
    $("sheet-pedido").classList.add("open");
    document.body.classList.add("no-scroll");
}
function fecharSheetPedido() { $("sheet-pedido").classList.remove("open"); document.body.classList.remove("no-scroll"); }

async function confirmarPedido() {
    if (!usuarioAtual) { toast("Faça login primeiro."); return; }
    if (enviandoPedido) return;
    const local = $("solicitacao-local").value.trim();
    const data = $("solicitacao-data").value, entrada = $("solicitacao-entrada").value, saida = $("solicitacao-saida").value;
    const valorCent = reaisParaCentavos($("solicitacao-valor").value);
    if (local.length < 3) { toast("Informe a academia ou o endereço do treino."); $("solicitacao-local").focus(); return; }
    if (!data) { toast("Escolha o dia do treino."); return; }
    if (data < hojeLocal()) { toast("O dia não pode ser anterior a hoje."); return; }
    const erro = validarAula(entrada, saida, valorCent);
    if (erro) { toast(erro); return; }

    enviandoPedido = true;
    const btn = document.querySelector("#sheet-pedido .btn-primary");
    const rotulo = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Enviando…'; }
    try {
        await chamarFuncao("criarAula", {
            local, data, entrada, saida, foco: $("solicitacao-foco").value, valorCentavos: valorCent,
            ...(posicaoAluno ? { lat: posicaoAluno.lat, lng: posicaoAluno.lng } : {}),   // o servidor arredonda (~110 m) e valida
            ...(pedidoPreferido?.uid ? { personalPreferidoUid: pedidoPreferido.uid } : {})
        });
        toast("✅ Pedido enviado! Os personais da região serão avisados.");
        try { localStorage.setItem("personow_local", local); } catch (e) {}
        precisaPadroes = true; pedidoPreferido = null;
        fecharSheetPedido();
        switchTab("tab-pedidos", document.querySelectorAll("#bottom-nav .nav-item")[1]);
        pedirPermissaoNotificacao();   // momento certo para pedir: o aluno está esperando uma resposta
    } catch (e) {
        console.error(e);
        toast(textoErro(e, "Não foi possível enviar o pedido. O servidor não respondeu."));
    } finally {
        enviandoPedido = false;
        if (btn) { btn.disabled = false; btn.innerHTML = rotulo; }
    }
}

document.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip[data-v]");
    if (!chip) return;
    selecionarFoco(chip.dataset.v);
    if (chip.closest("#hero-chips")) abrirSheetPedido();
});

// ==========================================
// AULAS EM TEMPO REAL (pedidos / agenda / carteira / conversas)
// ==========================================
function escutarAulas() {
    desligarAulas?.();
    primeiraCargaAulas = true;
    statusAnterior = new Map();
    desligarAulas = onSnapshot(query(collection(db, "aulas"), where("alunoUid", "==", usuarioAtual.uid)), (snap) => {
        aulas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => `${b.data}${b.entrada}`.localeCompare(`${a.data}${a.entrada}`));
        if (!primeiraCargaAulas) avisarMudancas();
        statusAnterior = new Map(aulas.map((a) => [a.id, a.status]));
        primeiraCargaAulas = false;
        renderTudo();
    }, (e) => { console.warn("Aulas:", e.code); renderTudo(); });
}

function avisarMudancas() {
    for (const a of aulas) {
        const antes = statusAnterior.get(a.id);
        if (antes === a.status) continue;
        if (antes === "aberta" && a.status === "aceita") notificar("Personal a caminho! 🎉", `${a.personalNome || "Um personal"} aceitou sua aula de ${fmtData(a.data)}.`);
        else if (antes === "aceita" && a.status === "aberta") notificar("O personal desistiu", "Seu pedido voltou para a fila e outros personais vão receber.");
        else if (a.status === "paga" && antes !== "paga") notificar("Pagamento confirmado ✅", "Seu recibo já está disponível em Meus Pedidos.");
    }
}

function renderTudo() {
    renderPedidos(); renderCarteira(); renderConversas(); renderCalendario(); renderProximoTreino();
    if (diaSelecionado) renderAgendaDia();
}

function cartaoAula(a) {
    const st = a.status || "aberta";
    const etapa = estaPaga(a) ? 3 : st === "aceita" ? 2 : st === "aberta" ? 1 : 0;
    const barra = st === "cancelada" ? "" : `<div class="steps-line"><span class="${etapa >= 1 ? "on" : ""}"></span><span class="${etapa >= 2 ? "on" : ""}"></span><span class="${etapa >= 3 ? "on" : ""}"></span></div>`;
    const id = esc(a.id);
    const acoes = [];
    if (st === "aceita") acoes.push(`<a class="btn-mini primario" href="pagar.html?id=${encodeURIComponent(a.id)}">💳 Pagar a aula</a>`);
    if (["aceita", "paga", "concluida"].includes(st)) acoes.push(`<button type="button" class="btn-mini" data-acao="chat" data-id="${id}">💬 Conversar</button>`);
    if (estaPaga(a) && a.reciboId) acoes.push(`<a class="btn-mini" href="recibo.html?id=${encodeURIComponent(a.reciboId)}">🧾 Recibo</a>`);
    if (estaPaga(a) && !a.avaliacao) acoes.push(`<button type="button" class="btn-mini" data-acao="avaliar" data-id="${id}">⭐ Avaliar</button>`);
    if (a.avaliacao) acoes.push(`<span class="rating-line">Você deu ${"★".repeat(a.avaliacao.estrelas)}</span>`);
    if (st === "aberta" || st === "aceita") acoes.push(`<button type="button" class="btn-mini perigo" data-acao="cancelar" data-id="${id}">Cancelar</button>`);
    const quem = a.personalNome ? ` · ${esc(a.personalNome)}` : "";
    const reservado = st === "aberta" && a.personalPreferidoNome ? ` · reservado p/ ${esc(a.personalPreferidoNome)}` : "";
    const classe = st === "aberta" ? "livre" : st === "aceita" ? "ocupado" : st === "cancelada" ? "cancelada" : "concluida";
    return `<div class="glass agenda-slot slot-${classe}">
        <div class="pedido-linha"><div class="slot-info-name">${iconeFoco(a.foco)} ${esc(a.local ?? a.loja)}</div>
        <div class="slot-info-desc">${fmtData(a.data)} · ${esc(a.horario)} · ${esc(a.foco)} · ${brl(valorCentavos(a))}${quem}${reservado}</div></div>
        <span class="badge ${estaPaga(a) ? "badge-ok" : st === "cancelada" ? "badge-off" : "badge-gold"}">${ROTULO_STATUS[st] || esc(st)}</span>
        ${barra}${acoes.length ? `<div class="aula-acoes">${acoes.join("")}</div>` : ""}</div>`;
}

function renderPedidos() {
    const el = $("lista-pedidos");
    el.innerHTML = aulas.length ? aulas.map(cartaoAula).join("") : vazio("🏋️", "Nenhum pedido ainda", "Solicite um personal na aba Início e acompanhe o andamento aqui.");
    el.style.cssText = "display:flex;flex-direction:column;gap:10px";
}

function renderCarteira() {
    $("cart-abertos").textContent = aulas.filter((a) => a.status === "aberta" || a.status === "aceita").length;
    const pagas = aulas.filter(estaPaga);
    $("cart-total").textContent = brl(pagas.reduce((s, a) => s + valorCentavos(a), 0));
    const ext = $("lista-extrato");
    if (ext) ext.innerHTML = pagas.length
        ? pagas.map((a) => `<div class="glass agenda-slot slot-concluida"><div class="pedido-linha"><div class="slot-info-name">${esc(a.personalNome || "Personal")} · ${esc(a.foco)}</div><div class="slot-info-desc">${fmtData(a.data)} · ${esc(a.horario)}</div></div><strong>${brl(valorCentavos(a))}</strong></div>`).join("")
        : vazio("🧾", "Nenhum pagamento ainda", "As aulas pagas e seus recibos aparecem aqui.");
}
function exportarExtrato() {
    const pagas = aulas.filter(estaPaga);
    if (!pagas.length) { toast("Ainda não há pagamentos para exportar."); return; }
    baixarCSV("personow-extrato.csv", [["Data", "Horário", "Personal", "Foco", "Local", "Valor", "Recibo"],
        ...pagas.map((a) => [fmtData(a.data), a.horario, a.personalNome || "", a.foco, a.local || "", (valorCentavos(a) / 100).toFixed(2).replace(".", ","), a.reciboNumero ? String(a.reciboNumero).padStart(6, "0") : ""])]);
}

function renderProximoTreino() {
    const el = $("card-proximo-treino-conteudo");
    if (!el) return;
    const hoje = hojeLocal();
    const prox = aulas.filter((a) => (a.status === "aberta" || a.status === "aceita") && a.data >= hoje).sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`))[0];
    el.innerHTML = prox
        ? `<p style="font-size:14px;font-weight:600">${esc(prox.local ?? prox.loja)}</p><p class="muted-line">${fmtData(prox.data)} · ${esc(prox.horario)} · ${prox.status === "aceita" ? "com " + esc(prox.personalNome || "personal") : "aguardando personal"}</p>`
        : '<p class="muted-line">Nenhum treino agendado.</p>';
}

// ---------- calendário ----------
function renderCalendario() {
    const grid = $("calendar-days-grid");
    if (!grid) return;
    const ano = dataCalendario.getFullYear(), mes = dataCalendario.getMonth();
    $("calendar-month-year").textContent = dataCalendario.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const primeiro = (new Date(ano, mes, 1).getDay() + 6) % 7, total = new Date(ano, mes + 1, 0).getDate(), hoje = new Date();
    const diasComAula = new Set(aulas.filter((a) => a.status !== "cancelada").map((a) => a.data));
    let html = "<div></div>".repeat(primeiro);
    for (let d = 1; d <= total; d++) {
        const iso = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const cls = ["cal-day", d === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear() ? "today" : "", diasComAula.has(iso) ? "has-treino" : "", iso === diaSelecionado ? "sel" : ""].filter(Boolean).join(" ");
        html += `<div class="${cls}" onclick="selecionarDia(${d})">${d}</div>`;
    }
    grid.innerHTML = html;
}
function mudarMesCalendario(n) { dataCalendario = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth() + n, 1); renderCalendario(); }
function selecionarDia(d) {
    diaSelecionado = `${dataCalendario.getFullYear()}-${String(dataCalendario.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    renderCalendario();
    renderAgendaDia();
}
function renderAgendaDia() {
    const [a, m, d] = diaSelecionado.split("-").map(Number);
    $("selected-date-label").textContent = "Treinos de " + new Date(a, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    const doDia = aulas.filter((x) => x.data === diaSelecionado && x.status !== "cancelada");
    $("lista-agenda").innerHTML = doDia.length ? doDia.map(cartaoAula).join("") : vazio("📅", "Nenhum treino neste dia", "Pedidos para esta data aparecem aqui.");
}

// ---------- ações dos cartões (delegação: sem ids dentro de onclick) ----------
document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-acao]");
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.acao === "cancelar") cancelarAula(id, b);
    else if (b.dataset.acao === "chat") abrirChatAula(id);
    else if (b.dataset.acao === "avaliar") abrirAvaliacao(id);
});

async function cancelarAula(id, btn) {
    const a = aulas.find((x) => x.id === id);
    if (!a || !confirm(a.status === "aceita" ? `Cancelar a aula já aceita por ${a.personalNome || "o personal"}?` : "Cancelar este pedido?")) return;
    btn.disabled = true;
    try { await updateDoc(doc(db, "aulas", id), { status: "cancelada", canceladoEm: serverTimestamp() }); toast("Pedido cancelado."); }
    catch (e) { console.error(e); toast("Não foi possível cancelar. Se a aula acabou de ser paga, atualize a tela."); btn.disabled = false; }
}

// ==========================================
// CHAT DA AULA (leitura em tempo real; envio pelo servidor, que filtra contatos externos)
// ==========================================
function renderConversas() {
    const el = $("lista-conversas");
    if (!el) return;
    const com = aulas.filter((a) => ["aceita", "paga", "concluida"].includes(a.status) && a.personalUid);
    el.innerHTML = com.length
        ? com.map((a) => `<div class="glass conversa-item" data-acao="chat" data-id="${esc(a.id)}"><div><div class="slot-info-name">${esc(a.personalNome || "Personal")}</div><div class="slot-info-desc">${fmtData(a.data)} · ${esc(a.horario)} · ${esc(a.foco)}</div></div><span class="badge badge-gold">Abrir 💬</span></div>`).join("")
        : vazio("💬", "Nenhuma conversa ainda", "Quando um personal aceitar sua solicitação, o chat aparecerá aqui.");
}

function abrirChatAula(id) {
    const a = aulas.find((x) => x.id === id);
    if (!a) return;
    if (!["aceita", "paga", "concluida"].includes(a.status)) { toast("O chat abre quando um personal aceitar sua aula."); return; }
    fecharChatAula();
    chat.aulaId = id;
    $("chat-aluno-titulo").textContent = a.personalNome || "Personal";
    const box = $("chat-aluno-box");
    box.innerHTML = '<p class="muted-line" style="text-align:center">Carregando…</p>';
    chat.desligar = onSnapshot(query(collection(db, "aulas", id, "mensagens"), orderBy("criadoEm")), (snap) => {
        box.innerHTML = snap.empty ? '<p class="muted-line" style="text-align:center">Diga olá! Combine tudo por aqui.</p>' : snap.docs.map((d) => {
            const m = d.data(), meu = m.de === usuarioAtual.uid;
            const hora = m.criadoEm?.toDate ? m.criadoEm.toDate().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
            return `<div class="msg ${meu ? "msg-sent" : "msg-received"}">${esc(m.texto)}<small>${hora}</small></div>`;
        }).join("");
        box.scrollTop = box.scrollHeight;
    }, (e) => { console.warn("Chat:", e.code); box.innerHTML = '<p class="muted-line" style="text-align:center">Não foi possível carregar a conversa.</p>'; });
    $("modal-chat-aluno").classList.add("active");
    document.body.classList.add("no-scroll");
}
function fecharChatAula() {
    chat.desligar?.(); chat.desligar = null; chat.aulaId = null;
    $("modal-chat-aluno")?.classList.remove("active");
    document.body.classList.remove("no-scroll");
}
async function enviarMensagemAluno() {
    const input = $("chat-aluno-input");
    const texto = input.value.trim();
    if (!texto || !chat.aulaId || chat.enviando) return;
    if (mensagemSuspeita(texto)) { toast("⚠️ Telefone, e-mail, links e Pix não podem ser enviados pelo chat. Combine tudo pelo app."); return; }
    chat.enviando = true;
    try { await chamarFuncao("enviarMensagem", { aulaId: chat.aulaId, texto }); input.value = ""; }
    catch (e) { toast(textoErro(e, "Não foi possível enviar a mensagem.")); }
    finally { chat.enviando = false; input.focus(); }
}

// ==========================================
// AVALIAÇÃO DO PERSONAL
// ==========================================
function renderEstrelas() {
    $("avaliar-estrelas").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="star ${n <= avaliacao.estrelas ? "on" : ""}" onclick="escolherEstrela(${n})" aria-label="${n} estrela${n > 1 ? "s" : ""}">★</button>`).join("");
}
function abrirAvaliacao(id) {
    const a = aulas.find((x) => x.id === id);
    if (!a) return;
    avaliacao.aulaId = id; avaliacao.estrelas = 0;
    $("avaliar-sub").textContent = `Como foi a aula com ${a.personalNome || "o personal"}?`;
    $("avaliar-comentario").value = "";
    renderEstrelas();
    $("sheet-avaliar").classList.add("open");
    document.body.classList.add("no-scroll");
}
function fecharAvaliacao() { $("sheet-avaliar").classList.remove("open"); document.body.classList.remove("no-scroll"); }
function escolherEstrela(n) { avaliacao.estrelas = n; renderEstrelas(); }
async function enviarAvaliacao() {
    if (!avaliacao.estrelas) { toast("Escolha de 1 a 5 estrelas."); return; }
    if (avaliacao.enviando) return;
    avaliacao.enviando = true;
    try {
        await chamarFuncao("avaliarAula", { aulaId: avaliacao.aulaId, estrelas: avaliacao.estrelas, comentario: $("avaliar-comentario").value.trim() });
        toast("⭐ Obrigado pela avaliação!");
        fecharAvaliacao();
    } catch (e) { toast(textoErro(e, "Não foi possível enviar a avaliação.")); }
    finally { avaliacao.enviando = false; }
}

// ==========================================
// MENU / INDICAÇÃO
// ==========================================
const SUB = { pagamento: "pagamento", preferencias: "preferencias", indicar: "indicar", notificacoes: "notificacoes", ajuda: "ajuda" };
function abrirOpcaoMenu(n) { const e = $("subscreen-" + SUB[n]); if (e) e.style.display = "block"; }
function fecharSubtela(id) { $(id).style.display = "none"; }
function copiarLinkIndicacao() { const i = $("input-link-indicacao"); i.select(); navigator.clipboard?.writeText(i.value); toast("📋 Link copiado!"); }
function compartilharWhatsApp() {
    const t = encodeURIComponent("Conheça o PERSONOW: personal trainers sob demanda para a sua academia. " + $("input-link-indicacao").value);
    window.open("https://api.whatsapp.com/send?text=" + t, "_blank", "noopener");
}
const suporte = $("btn-whatsapp-suporte");
if (suporte && WHATSAPP_SUPORTE) suporte.href = `https://wa.me/${WHATSAPP_SUPORTE}`;

// Teclado: Enter envia no chat; Esc fecha folhas e chat
document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target?.id === "chat-aluno-input") { e.preventDefault(); enviarMensagemAluno(); }
    if (e.key === "Escape") { fecharSheetPedido(); fecharSheetPerfil(); fecharAvaliacao(); fecharChatAula(); }
});

// ==========================================
// EXPORTS PARA O HTML (onclick="...") — módulos ES não expõem funções ao escopo global
// ==========================================
Object.assign(window, {
    toast, initMap, loginGoogleAluno, logoutAluno, navTo, switchTab, toggleTheme,
    salvarPerfilAluno, salvarPagamento, salvarPreferencias, salvarNotificacoes, atualizarFotoPerfilAluno,
    mudarMesCalendario, selecionarDia, abrirOpcaoMenu, fecharSubtela, copiarLinkIndicacao, compartilharWhatsApp,
    abrirSheetPedido, fecharSheetPedido, confirmarPedido, chamarPersonal, verPerfil, fecharSheetPerfil, definirValor, atualizarResumoValor,
    fecharChatAula, enviarMensagemAluno, fecharAvaliacao, escolherEstrela, enviarAvaliacao, exportarExtrato
});

// Se o Maps carregou antes do módulo, inicia agora
if (window.google && window.google.maps) initMap();
