// ============================================================
// PERSONOW — app do PERSONAL TRAINER
// Identidade = conta Google (uid). Antes o acesso era por CPF digitado, o que deixava qualquer pessoa
// se passar por outro personal. CPF, telefone, Pix e banco ficam em personais_privado (só o dono lê).
// Aceitar aula e chat passam pelo servidor; o navegador só lê em tempo real.
// ============================================================
import { collection, doc, setDoc, getDoc, addDoc, updateDoc, deleteDoc, deleteField, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, onDisconnect, onValue, serverTimestamp as rtdbServerTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { app, auth, db, googleProvider, chamarFuncao, mensagemErroAuth } from "./firebase.js";
import { FOCOS, RAIO_KM_AULAS } from "./config.js";
import { pintarRecado } from "./recado.js";
import { filtrarPorRaio, distanciaKm, pontoDaAula, fmtKm } from "./geo.js";
import { gerarPerfil, ranquearOfertas, normalizarExperiencias } from "./perfil-inteligente.js";
import {
    esc, brl, fmtData, hojeLocal, estaPaga, valorPersonal, valorCentavos, conflitoNaAgenda, mensagemSuspeita, ROTULO_STATUS, iconeFoco,
    cpfValido, mascaraCPF, mascaraTelefone, urlImagemSegura, textoTermos
} from "./core.js";
import { $, toast, iniciarTema, alternarTema, registrarSW, notificar, pedirPermissaoNotificacao, vazio, carregarAviso } from "./ui.js";

iniciarTema();
registrarSW();
carregarAviso();

// ---------- estado ----------
let usuario = null;
let perfil = { nome: "Personal", status: "pendente", cref: "", mpConectado: false, valorMin: 0, fotoUrl: "" };
let aulas = [];                    // aulas aceitas por este personal
let ofertas = [];                  // pedidos em aberto
let meusAlunos = [];
let loginInterativo = false;
let dataCalendario = new Date();
let diaSelecionado = "";
let mapaOfertas = null;
let qrAulaId = null;
let primeiraCargaAulas = true, primeiraCargaOfertas = true;
let statusAnterior = new Map();
let idsOfertasVistas = new Set();
const unsub = [];
let desligarOfertas = null;
let timerOfertas = null;
let posicaoPersonal = null;        // { lat, lng } para distância/ranking dos pedidos
let ordemOfertas = "sugeridas";    // "sugeridas" | "cedo"
let soPerto = false;               // true = só pedidos até RAIO_KM_AULAS
const chat = { aulaId: null, desligar: null, enviando: false };

const textoErro = (e, padrao) => (e?.message && e.code !== "backend-nao-configurado" ? e.message : padrao);
const ativo = () => perfil.status === "ativo";
const novoCodigo = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
const baseSite = () => location.origin + location.pathname.replace(/[^/]*$/, "");

// Indicação: guarda ?ref= do link que o amigo abriu
try { const r = new URLSearchParams(location.search).get("ref"); if (r) localStorage.setItem("personow_ref", r.replace(/[^\w-]/g, "").slice(0, 40)); } catch (e) {}
const refRecebido = () => { try { return localStorage.getItem("personow_ref") || ""; } catch (e) { return ""; } };

// ==========================================
// TERMOS
// ==========================================
function validarCheckTermos() {
    const ok = !!$("check-termos")?.checked;
    const btn = $("btn-google");
    if (btn) { btn.disabled = !ok; btn.style.opacity = ok ? "1" : "0.5"; btn.style.cursor = ok ? "pointer" : "not-allowed"; }
}
function abrirModalTermos() { const c = $("termos-personal-corpo"); if (c) c.innerHTML = textoTermos("personal"); $("modal-termos")?.classList.add("active"); }
function aceitarTermosModal() { if ($("check-termos")) $("check-termos").checked = true; validarCheckTermos(); $("modal-termos")?.classList.remove("active"); }

// ==========================================
// LOGIN (somente Google)
// ==========================================
function setLoading(on) {
    if ($("login-loader")) $("login-loader").style.display = on ? "block" : "none";
    if ($("btn-google")) $("btn-google").style.display = on ? "none" : "";
}

async function loginComGoogle() {
    if (!$("check-termos")?.checked) { toast("Aceite os Termos de Uso para continuar."); return; }
    loginInterativo = true;
    setLoading(true);
    try {
        await signInWithPopup(auth, googleProvider);   // onAuthStateChanged cuida do resto
    } catch (error) {
        let falha = error;
        if (error.code === "auth/popup-blocked") {
            try { await signInWithRedirect(auth, googleProvider); return; } catch (e) { falha = e; }
        }
        console.error(falha);
        const msg = mensagemErroAuth(falha);
        if (msg) toast(msg);
        setLoading(false);
    }
}

getRedirectResult(auth).then((r) => { if (r?.user) loginInterativo = true; }).catch((e) => { const msg = mensagemErroAuth(e); if (msg) toast(msg); });

onAuthStateChanged(auth, async (user) => {
    if (!user) { usuario = null; pararTudo(); mostrarLogin(); return; }
    try { await processarUsuario(user); }
    catch (e) { console.error(e); toast("Não foi possível carregar seu cadastro. Tente novamente."); setLoading(false); }
});

async function processarUsuario(user) {
    const pRef = doc(db, "personais", user.uid);
    let snap = await getDoc(pRef);
    if (!snap.exists()) {
        if (!loginInterativo) { setLoading(false); return; }       // alguém logado só como aluno: não cria cadastro de personal sem pedir
        await setDoc(pRef, {
            nome: user.displayName || "", uid: user.uid, status: "pendente", indicadoPor: refRecebido(),
            fotoGoogle: urlImagemSegura(user.photoURL), criadoEm: serverTimestamp()
        });
        snap = await getDoc(pRef);
    }
    if (snap.data().status === "bloqueado") { toast("❌ Acesso não liberado para esta conta." + (snap.data().recado?.texto ? " Motivo: " + snap.data().recado.texto : "")); await signOut(auth); setLoading(false); return; }
    usuario = user;   // o e-mail e os dados sensíveis são gravados pelo servidor (personais_privado é fechado ao navegador)
    entrarNoPainel(snap.data());
}

function mostrarLogin() {
    setLoading(false);
    $("screen-dashboard")?.classList.remove("active");
    $("screen-login-personal")?.classList.add("active");
}

async function sairModoPessoal() {
    if (!confirm("Deseja realmente sair do portal?")) return;
    pararTudo();
    try { await signOut(auth); } catch (e) {}
}

function pararTudo() {
    unsub.splice(0).forEach((f) => { try { f(); } catch (e) {} });
    try { desligarOfertas?.(); } catch (e) {} desligarOfertas = null;
    fecharConversaModal();
    clearInterval(timerOfertas); timerOfertas = null;
    aulas = []; ofertas = []; meusAlunos = [];
    primeiraCargaAulas = primeiraCargaOfertas = true; statusAnterior = new Map(); idsOfertasVistas = new Set();
    loginInterativo = false; posicaoPersonal = null; soPerto = false; ordemOfertas = "sugeridas";
}

window.addEventListener("DOMContentLoaded", () => {
    if (refRecebido() && $("login-sub")) $("login-sub").textContent = "🎁 Você foi convidado. Cadastre-se e faça sua primeira aula!";
    const tel = $("perfil-input-telefone"), tel2 = $("personal-input-telefone"), cpf = $("perfil-input-cpf");
    [tel, tel2].forEach((el) => el?.addEventListener("input", () => { el.value = mascaraTelefone(el.value); }));
    cpf?.addEventListener("input", () => { cpf.value = mascaraCPF(cpf.value); });
    const c = $("lista-conversas-personal"); if (c) c.innerHTML = vazio("💬", "Nenhuma conversa ainda", "Quando você aceitar uma aula, o chat com o aluno aparece aqui.");
    validarCheckTermos();
});

// ==========================================
// PAINEL
// ==========================================
function entrarNoPainel(dados) {
    $("screen-login-personal")?.classList.remove("active");
    $("screen-dashboard")?.classList.add("active");
    unsub.splice(0).forEach((f) => f());
    desligarOfertas?.(); desligarOfertas = null;
    aplicarPerfilPublico(dados);

    monitorarPresencaOnline(usuario.uid);
    garantirLinkIndicacao(dados);
    registrarLocalizacao();
    carregarPrivado();
    mpRetorno();

    // o próprio cadastro em tempo real: aprovação do admin e conexão com o Mercado Pago aparecem sem recarregar
    unsub.push(onSnapshot(doc(db, "personais", usuario.uid), (s) => { if (s.exists()) { aplicarPerfilPublico(s.data()); sincronizarOfertas(); renderOfertas(); } }));
    unsub.push(onSnapshot(query(collection(db, "aulas"), where("personalUid", "==", usuario.uid)), (snap) => {
        aulas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
        if (!primeiraCargaAulas) avisarMudancasAulas();
        statusAnterior = new Map(aulas.map((a) => [a.id, a.status]));
        primeiraCargaAulas = false;
        renderAgenda(); renderCarteira(); renderConversas(); renderCalendario(); renderOfertas();
        if (qrAulaId) { const a = aulas.find((x) => x.id === qrAulaId); if (!a || a.status !== "aceita") fecharQR(); }
    }, (e) => console.warn("Agenda:", e.code)));
    unsub.push(onSnapshot(query(collection(db, "personais", usuario.uid, "meus_alunos")), (snap) => {
        meusAlunos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
        renderMeusAlunos();
    }, (e) => console.warn("Meus alunos:", e.code)));
    renderCalendario();
    pedirPermissaoNotificacao();
}

/** Preenche um campo sem atropelar o que a pessoa está digitando agora. */
function preencher(id, valor) { const el = $(id); if (el && valor !== undefined && valor !== null && valor !== "" && document.activeElement !== el) el.value = valor; }

function aplicarPerfilPublico(d) {
    perfil = { ...perfil, nome: d.nome || usuario?.displayName || "Personal", status: d.status || "pendente", cref: d.cref || "", mpConectado: !!d.mpConectado, valorMin: Number(d.valorMin) || 0, fotoUrl: urlImagemSegura(d.fotoGoogle) || urlImagemSegura(usuario?.photoURL), ratingMedia: d.ratingMedia, ratingQtd: d.ratingQtd };
    const inicial = (perfil.nome || "P").charAt(0).toUpperCase();
    if ($("perfil-nome-display")) $("perfil-nome-display").textContent = perfil.nome;
    if ($("perfil-cref-display")) $("perfil-cref-display").textContent = (ativo() ? "Status: Ativo ✓" : "Status: Em análise") + (perfil.ratingQtd > 0 ? ` · ★ ${Number(perfil.ratingMedia).toFixed(1).replace(".", ",")} (${perfil.ratingQtd})` : "");
    if ($("initials-perfil")) $("initials-perfil").textContent = inicial;
    if (perfil.fotoUrl && $("img-perfil-preview")) { const img = $("img-perfil-preview"); img.src = perfil.fotoUrl; img.referrerPolicy = "no-referrer"; img.style.display = "block"; if ($("initials-perfil")) $("initials-perfil").style.display = "none"; }
    preencher("perfil-input-nome", perfil.nome); preencher("perfil-input-cref", perfil.cref);
    preencher("perfil-input-naturalidade", d.cidade); preencher("personal-input-bio", d.bio); preencher("pref-valor-min", perfil.valorMin || "");
    if (d.disponibilidade) {
        preencher("pref-hora-inicio", d.disponibilidade.inicio); preencher("pref-hora-fim", d.disponibilidade.fim);
        if (Array.isArray(d.disponibilidade.dias)) document.querySelectorAll(".btn-dia").forEach((b, i) => { if (b.classList.contains("active") !== d.disponibilidade.dias.includes(i)) window.toggleDiaTrabalho?.(b); });
    }
    if (d.especialidade && $("pref-estilo")) { const o = [...$("pref-estilo").options].find((x) => x.text === d.especialidade); if (o) $("pref-estilo").value = o.value; }
    perfil.experiencias = normalizarExperiencias(d.experiencias); perfil.palavrasChave = Array.isArray(d.palavrasChave) ? d.palavrasChave : [];
    renderExperiencias();
    pintarRecado($("tab-inicio"), d.recado, "personal");
    const analise = $("card-status-analise"); if (analise) analise.style.display = ativo() ? "none" : "block";
    const avisoAg = $("aviso-analise-agenda"); if (avisoAg) avisoAg.style.display = ativo() ? "none" : "flex";
    renderMP();
}

async function carregarPrivado() {
    try {
        const d = await chamarFuncao("perfil/personal/privado", null);   // servidor decifra só para o próprio dono
        if ($("perfil-input-cpf") && d.cpf) $("perfil-input-cpf").value = mascaraCPF(d.cpf);
        if ($("perfil-input-nascimento") && d.nascimento) $("perfil-input-nascimento").value = d.nascimento;
        if ($("perfil-input-telefone") && d.telefone) $("perfil-input-telefone").value = d.telefone;
        if ($("personal-input-telefone") && d.telefone) $("personal-input-telefone").value = d.telefone;
        if (d.banco) { const m = { "bank-select-banco": d.banco.banco, "bank-select-tipo-conta": d.banco.tipo, "bank-input-agencia": d.banco.agencia, "bank-input-conta": d.banco.conta, "bank-input-digito": d.banco.digito }; for (const [id, v] of Object.entries(m)) if ($(id) && v) $(id).value = v; }
        if (d.pix) { if ($("bank-select-tipo-pix") && d.pix.tipo) $("bank-select-tipo-pix").value = d.pix.tipo; if ($("bank-input-chave-pix") && d.pix.chave) $("bank-input-chave-pix").value = d.pix.chave; }
    } catch (e) { console.warn("Dados privados:", e.code || e.message); }
}

// ---------- presença "online de verdade" (Realtime Database) ----------
function monitorarPresencaOnline(uid) {
    try {
        const rtdb = getDatabase(app);
        const statusRef = ref(rtdb, `presenca/${uid}`);
        unsub.push(onValue(ref(rtdb, ".info/connected"), (snapshot) => {
            if (snapshot.val() === false) return;
            onDisconnect(statusRef).set({ online: false, ultimaVez: rtdbServerTimestamp() });
            set(statusRef, { online: true, ultimaVez: rtdbServerTimestamp() });
        }));
    } catch (e) { console.warn("Presença indisponível:", e.message); }
}

// Posição aproximada (~100 m) para o aluno ver distância e radar
function registrarLocalizacao() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
        posicaoPersonal = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        renderOfertas();
        try { await updateDoc(doc(db, "personais", usuario.uid), { lat: Number(pos.coords.latitude.toFixed(3)), lng: Number(pos.coords.longitude.toFixed(3)), atualizadoEm: serverTimestamp() }); } catch (e) {}
    }, () => {}, { maximumAge: 600000, timeout: 8000 });
}

async function garantirLinkIndicacao(dados) {
    const input = $("input-link-indicacao");
    if (!input) return;
    let codigo = dados.refCode;
    try { if (!codigo) { codigo = novoCodigo(); await updateDoc(doc(db, "personais", usuario.uid), { refCode: codigo }); } } catch (e) { codigo = ""; }
    input.value = codigo ? `${baseSite()}personal.html?ref=${codigo}` : `${baseSite()}personal.html`;
}

// ==========================================
// NAVEGAÇÃO / MENU
// ==========================================
function switchTabPersonal(tabId, navElement) {
    document.querySelectorAll("#screen-dashboard .tab-content").forEach((t) => t.classList.remove("active"));
    $(tabId)?.classList.add("active");
    document.querySelectorAll("#nav-personal .nav-item").forEach((i) => i.classList.remove("active"));
    navElement?.classList.add("active");
    window.scrollTo(0, 0);
    if (tabId === "tab-ofertas") { initMapAlunos(); renderOfertas(); }
}

const SUBTELAS = {
    "Perfil": "subscreen-perfil-detalhes", "Dados bancários": "subscreen-dados-bancarios", "Preferências de Atendimento": "subscreen-preferencias-atendimento",
    "Convidar Amigos": "subscreen-indicar-amigo", "Notificações": "subscreen-notificacoes", "Ajuda": "subscreen-ajuda"
};
function abrirOpcaoMenu(nome) { const id = SUBTELAS[nome]; if (id && $(id)) $(id).style.display = "block"; }
function fecharSubtela(id) { if ($(id)) $(id).style.display = "none"; }

// ==========================================
// PERFIL / BANCO / PREFERÊNCIAS
// ==========================================
async function salvarPublico(dados) { await updateDoc(doc(db, "personais", usuario.uid), { ...dados, atualizadoEm: serverTimestamp() }); }
/** Dados sensíveis (CPF, telefone, nascimento, banco, Pix) vão ao servidor: ele valida, cifra e impede CPF duplicado. */
async function salvarPrivado(dados) { await chamarFuncao("perfil/personal/privado", dados, "PUT"); }

async function salvarPerfilProfissionalCompleto() {
    const nome = $("perfil-input-nome").value.trim();
    const cpf = $("perfil-input-cpf").value.replace(/\D/g, "");
    const cref = $("perfil-input-cref").value.trim();
    if (nome.length < 3) { toast("Informe seu nome completo."); return; }
    if (cpf && !cpfValido(cpf)) { toast("CPF inválido. Confira os 11 dígitos."); return; }
    const tel = $("perfil-input-telefone").value.trim();
    if (tel && tel.replace(/\D/g, "").length < 10) { toast("Telefone incompleto. Use DDD + número."); return; }
    try {
        await salvarPublico({ nome, cref, cidade: $("perfil-input-naturalidade").value.trim() });
        await salvarPrivado({ cpf, telefone: tel, nascimento: $("perfil-input-nascimento").value });
        await salvarInteligente({ bio: $("personal-input-bio").value.trim() });
        toast("✅ Perfil salvo! Se ainda estiver em análise, a equipe avalia CPF e CREF.");
        fecharSubtela("subscreen-perfil-detalhes");
    } catch (e) { console.error(e); toast(textoErro(e, "Não foi possível salvar o perfil.")); }
}

// ---------- perfil inteligente: experiência por foco → bio e palavras-chave ----------
const ANOS_OPCOES = [0, 1, 2, 3, 4, 5, 7, 10, 15, 20];
function renderExperiencias() {
    const box = $("lista-experiencias"); if (!box || box.contains(document.activeElement)) return;
    const atuais = Object.fromEntries((perfil.experiencias || []).map((e) => [e.foco, e.anos]));
    box.innerHTML = FOCOS.map((f) => `<div class="exp-linha"><span>${f.ico} ${esc(f.v)}</span><select data-exp="${esc(f.v)}" aria-label="Anos de experiência em ${esc(f.v)}"><option value="">Nenhuma</option>${ANOS_OPCOES.map((a) => `<option value="${a}" ${atuais[f.v] === a ? "selected" : ""}>${a === 0 ? "Menos de 1 ano" : a + (a === 1 ? " ano" : " anos")}</option>`).join("")}</select></div>`).join("");
    const t = $("tags-perfil"); if (t) t.innerHTML = (perfil.palavrasChave || []).map((k) => `<span>${esc(k)}</span>`).join("");
}
function lerExperiencias() {
    return normalizarExperiencias([...document.querySelectorAll("#lista-experiencias select[data-exp]")].filter((s) => s.value !== "").map((s) => ({ foco: s.dataset.exp, anos: Number(s.value) })));
}
/** Botão "Gerar bio": preenche a apresentação com base nas experiências (você revisa antes de salvar). */
function gerarSugestaoPerfil() {
    const g = gerarPerfil({ experiencias: lerExperiencias(), cref: !!$("perfil-input-cref")?.value.trim() });
    if ($("personal-input-bio")) $("personal-input-bio").value = g.bio;
    const t = $("tags-perfil"); if (t) t.innerHTML = g.palavrasChave.map((k) => `<span>${esc(k)}</span>`).join("");
    toast("✨ Sugestão gerada. Revise o texto e toque em Salvar.");
}
async function salvarInteligente({ bio }) {
    const experiencias = lerExperiencias();
    const g = gerarPerfil({ experiencias, cref: !!$("perfil-input-cref")?.value.trim() });
    await chamarFuncao("perfil/personal/inteligente", { experiencias, bio, palavrasChave: g.palavrasChave }, "PUT");
}

async function salvarDadosBancarios() {
    const agencia = $("bank-input-agencia").value.trim(), conta = $("bank-input-conta").value.trim(), pix = $("bank-input-chave-pix").value.trim();
    if (!pix && !(agencia && conta)) { toast("Informe a chave PIX ou agência e conta."); return; }
    try {
        await salvarPrivado({
            banco: { banco: $("bank-select-banco").value, tipo: $("bank-select-tipo-conta").value, agencia, conta, digito: $("bank-input-digito").value.trim() },
            pix: { tipo: $("bank-select-tipo-pix").value, chave: pix }
        });
        toast("✅ Dados salvos!");
        fecharSubtela("subscreen-dados-bancarios");
    } catch (e) { toast(textoErro(e, "Não foi possível salvar os dados.")); }
}

async function salvarContato() {
    const tel = $("personal-input-telefone").value.trim();
    if (tel.replace(/\D/g, "").length < 10) { toast("Informe telefone com DDD."); return; }
    try { await salvarPrivado({ telefone: tel }); toast("✅ Contato salvo!"); } catch (e) { toast(textoErro(e, "Não foi possível salvar o contato.")); }
}

async function salvarPrefs() {
    const v = parseFloat($("pref-valor-min").value) || 0;
    if (v < 0 || v > 1000) { toast("Informe um valor mínimo entre R$ 0 e R$ 1.000."); return; }
    const dias = [...document.querySelectorAll(".btn-dia")].map((b, i) => (b.classList.contains("active") ? i : -1)).filter((i) => i >= 0);
    try {
        await salvarPublico({ valorMin: v, especialidade: $("pref-estilo").selectedOptions[0].text, disponibilidade: { inicio: $("pref-hora-inicio").value, fim: $("pref-hora-fim").value, dias } });
        toast("✅ Preferências salvas!");
        fecharSubtela("subscreen-preferencias-atendimento");
    } catch (e) { toast("Erro ao salvar preferências."); }
}

function atualizarFotoPerfil(event) {
    const file = event.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (e) => { const img = $("img-perfil-preview"); img.src = e.target.result; img.style.display = "block"; if ($("initials-perfil")) $("initials-perfil").style.display = "none"; };
    r.readAsDataURL(file);   // só pré-visualização: ainda não é enviada (precisa do Firebase Storage)
}

// ==========================================
// MERCADO PAGO (receber o repasse)
// ==========================================
function renderMP() {
    const card = $("card-mp"); if (!card) return;
    $("mp-titulo").textContent = perfil.mpConectado ? "Mercado Pago conectado ✓" : "Conecte o Mercado Pago para receber";
    $("mp-texto").textContent = perfil.mpConectado ? "O repasse de cada aula cai direto na sua conta no momento do pagamento do aluno." : "O repasse das aulas cai direto na sua conta, na hora do pagamento do aluno. Sem conectar, você não consegue aceitar aulas.";
    $("btn-mp").textContent = perfil.mpConectado ? "Reconectar conta" : "Conectar Mercado Pago";
    card.style.borderLeftColor = perfil.mpConectado ? "#22c55e" : "#ff3b30";
}
async function conectarMercadoPago() {
    const b = $("btn-mp"); b.disabled = true;
    try { const { url } = await chamarFuncao("mpConectarUrl"); location.href = url; }
    catch (e) { toast(textoErro(e, "Não foi possível abrir o Mercado Pago agora.")); b.disabled = false; }
}
function mpRetorno() {
    const mp = new URLSearchParams(location.search).get("mp");
    if (!mp) return;
    toast(mp === "ok" ? "✅ Mercado Pago conectado!" : "Não foi possível conectar o Mercado Pago. Tente de novo.");
    history.replaceState(null, "", location.pathname);
    switchTabPersonal("tab-carteira", document.querySelectorAll("#nav-personal .nav-item")[3]);
}

// ==========================================
// AGENDA / CALENDÁRIO / GANHOS
// ==========================================
function avisarMudancasAulas() {
    for (const a of aulas) {
        const antes = statusAnterior.get(a.id);
        if (antes === a.status) continue;
        if (a.status === "paga" && antes !== "paga") notificar("Pagamento recebido 💸", `${brl(valorPersonal(a))} da aula de ${fmtData(a.data)} foi repassado.`);
        else if (a.status === "cancelada") notificar("Aula cancelada", `O aluno cancelou a aula de ${fmtData(a.data)} às ${a.entrada}.`);
    }
}

function cartaoAula(a) {
    const st = a.status;
    const acoes = [];
    if (st === "aceita") acoes.push(`<button type="button" class="btn-mini primario" data-acao="qr" data-id="${esc(a.id)}">Cobrar (QR)</button>`);
    if (["aceita", "paga", "concluida"].includes(st)) acoes.push(`<button type="button" class="btn-mini" data-acao="chat" data-id="${esc(a.id)}">💬 Conversar</button>`);
    if (st === "aceita") acoes.push(`<button type="button" class="btn-mini perigo" data-acao="desistir" data-id="${esc(a.id)}">Desistir</button>`);
    const classe = st === "aceita" ? "ocupado" : st === "cancelada" ? "cancelada" : "concluida";
    return `<div class="glass agenda-slot slot-${classe}">
        <div class="pedido-linha"><div class="slot-info-name">${iconeFoco(a.foco)} ${esc(a.alunoNome || "Aluno")} · ${esc(a.foco)}</div>
        <div class="slot-info-desc">${fmtData(a.data)} · ${esc(a.entrada)}–${esc(a.saida)} · ${esc(a.local ?? a.loja)}<br>Você recebe ${brl(valorPersonal(a))}</div></div>
        <span class="badge ${estaPaga(a) ? "badge-ok" : st === "cancelada" ? "badge-off" : "badge-gold"}">${ROTULO_STATUS[st] || esc(st)}</span>
        ${acoes.length ? `<div class="aula-acoes">${acoes.join("")}</div>` : ""}</div>`;
}

function renderAgenda() {
    const lista = $("lista-agenda"), resumo = $("lista-agenda-resumo");
    const vis = aulas.filter((a) => a.status !== "cancelada");
    const doDia = diaSelecionado ? vis.filter((a) => a.data === diaSelecionado) : vis;
    const vazioHtml = vazio("📅", diaSelecionado ? "Nenhuma aula neste dia" : "Nenhuma aula por aqui", "As aulas que você aceitar em Pedidos aparecem neste espaço.");
    if (lista) lista.innerHTML = doDia.length ? doDia.map(cartaoAula).join("") : vazioHtml;
    const hoje = hojeLocal();
    const proximas = vis.filter((a) => a.data >= hoje && a.status === "aceita").slice(0, 3);
    if (resumo) resumo.innerHTML = proximas.length ? proximas.map(cartaoAula).join("") : vazio("📅", "Nenhuma aula por aqui", "As aulas que você aceitar em Pedidos aparecem neste espaço.");
    const prox = proximas[0];
    if ($("proxima-aula")) $("proxima-aula").textContent = prox ? `${fmtData(prox.data)} · ${prox.entrada}–${prox.saida} · ${prox.alunoNome || "Aluno"}` : "Nenhuma aula agendada.";
}

function renderCarteira() {
    const recebido = aulas.filter(estaPaga).reduce((t, a) => t + valorPersonal(a), 0);
    const aReceber = aulas.filter((a) => a.status === "aceita").reduce((t, a) => t + valorPersonal(a), 0);
    if ($("valor-avulso")) $("valor-avulso").textContent = brl(recebido);
    if ($("valor-total")) $("valor-total").textContent = brl(recebido);
    if ($("carteira-total-pago")) $("carteira-total-pago").textContent = brl(recebido);
    if ($("carteira-a-receber")) $("carteira-a-receber").textContent = brl(aReceber);
    const ext = $("lista-extrato-personal");
    const pagas = aulas.filter(estaPaga).sort((a, b) => `${b.data}${b.entrada}`.localeCompare(`${a.data}${a.entrada}`));
    if (ext) ext.innerHTML = pagas.length
        ? pagas.map((a) => `<div class="glass agenda-slot slot-concluida"><div class="pedido-linha"><div class="slot-info-name">${esc(a.alunoNome || "Aluno")} · ${esc(a.foco)}</div><div class="slot-info-desc">${fmtData(a.data)} · ${esc(a.entrada)}–${esc(a.saida)}</div></div><strong>${brl(valorPersonal(a))}</strong></div>`).join("")
        : vazio("💸", "Nenhum repasse ainda", "Aulas pagas pelos alunos aparecem aqui.");
}

function renderCalendario() {
    const grid = $("calendar-days-grid");
    if (!grid) return;
    const ano = dataCalendario.getFullYear(), mes = dataCalendario.getMonth();
    if ($("calendar-month-year")) $("calendar-month-year").textContent = dataCalendario.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const primeiro = (new Date(ano, mes, 1).getDay() + 6) % 7, total = new Date(ano, mes + 1, 0).getDate(), hoje = new Date();
    const dias = new Set(aulas.filter((a) => a.status !== "cancelada").map((a) => a.data));
    let html = "<div></div>".repeat(primeiro);
    for (let d = 1; d <= total; d++) {
        const iso = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const cls = ["cal-day", d === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear() ? "today" : "", dias.has(iso) ? "has-treino" : "", iso === diaSelecionado ? "sel" : ""].filter(Boolean).join(" ");
        html += `<div class="${cls}" onclick="selecionarDia(${d})">${d}</div>`;
    }
    grid.innerHTML = html;
}
function mudarMesCalendario(delta) { dataCalendario = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth() + delta, 1); renderCalendario(); }
function selecionarDia(d) {
    const iso = `${dataCalendario.getFullYear()}-${String(dataCalendario.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    diaSelecionado = diaSelecionado === iso ? "" : iso;   // tocar de novo no mesmo dia volta a mostrar tudo
    const label = $("selected-date-label");
    if (label) label.textContent = diaSelecionado ? "Aulas de " + new Date(dataCalendario.getFullYear(), dataCalendario.getMonth(), d).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) : "Todas as aulas. Toque num dia para filtrar.";
    renderCalendario(); renderAgenda();
}

// ---------- ações dos cartões (delegação) ----------
document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-acao]");
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.acao) {
        case "aceitar": aceitarOferta(id, b); break;
        case "qr": mostrarQR(id); break;
        case "chat": abrirChat(id); break;
        case "desistir": desistirAula(id, b); break;
        case "remover-aluno": removerAluno(id); break;
        case "ordem": ordemOfertas = id; renderOfertas(); break;
        case "perto": soPerto = !soPerto; renderOfertas(); break;
    }
});

async function desistirAula(id, btn) {
    if (!confirm("Desistir desta aula? Ela volta para a fila e outros personais poderão aceitar. Desistências frequentes prejudicam sua reputação.")) return;
    btn.disabled = true;
    try {
        await updateDoc(doc(db, "aulas", id), { status: "aberta", personalUid: deleteField(), personalNome: deleteField(), aceitoEm: deleteField() });
        toast("Você desistiu da aula. Ela voltou para a fila.");
    } catch (e) { console.error(e); toast("Não foi possível desistir agora."); btn.disabled = false; }
}

// ---------- QR de cobrança ----------
function mostrarQR(id) {
    const a = aulas.find((x) => x.id === id);
    if (!a || a.status !== "aceita") { toast("Só dá para cobrar aulas aceitas e ainda não pagas."); return; }
    qrAulaId = id;
    if ($("qr-box")) { $("qr-box").innerHTML = ""; if (window.QRCode) new QRCode($("qr-box"), { text: `${baseSite()}pagar.html?id=${encodeURIComponent(id)}`, width: 200, height: 200 }); }
    if ($("qr-valor")) $("qr-valor").textContent = `Valor: ${brl(valorCentavos(a))}`;
    if ($("qr-liquido")) $("qr-liquido").textContent = `Você recebe ${brl(valorPersonal(a))} (após a comissão da plataforma)`;
    $("modal-qr")?.classList.add("active");
}
function fecharQR() { qrAulaId = null; $("modal-qr")?.classList.remove("active"); }

// ==========================================
// PEDIDOS DE TREINO (OFERTAS) EM TEMPO REAL
// ==========================================
/** As regras só deixam personal ATIVO ler pedidos abertos. Liga/desliga a escuta conforme a aprovação. */
function sincronizarOfertas() {
    if (ativo() && !desligarOfertas) escutarOfertas();
    else if (!ativo() && desligarOfertas) { desligarOfertas(); desligarOfertas = null; ofertas = []; }
}
function escutarOfertas() {
    primeiraCargaOfertas = true; idsOfertasVistas = new Set();
    desligarOfertas = onSnapshot(query(collection(db, "aulas"), where("status", "==", "aberta")), (snap) => {
        ofertas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!primeiraCargaOfertas && ativo()) {
            const novas = ofertas.filter((o) => !idsOfertasVistas.has(o.id) && visivelParaMim(o) && o.alunoUid !== usuario.uid);
            if (novas.length) notificar("Novo pedido de treino 🏋️", `${novas[0].foco} em ${fmtData(novas[0].data)} · você recebe ${brl(valorPersonal(novas[0]))}`);
        }
        idsOfertasVistas = new Set(ofertas.map((o) => o.id));
        primeiraCargaOfertas = false;
        renderOfertas();
    }, (e) => { console.warn("Ofertas:", e.code); ofertas = []; desligarOfertas = null; renderOfertas(); });
    clearInterval(timerOfertas); timerOfertas = setInterval(renderOfertas, 30000);   // exclusividade expira sem evento no banco
}

/** Reservado para outro personal? (janela do "Chamar agora"). */
function visivelParaMim(o) {
    const ate = o.exclusivoAte?.toMillis ? o.exclusivoAte.toMillis() : 0;
    return !(ate > Date.now() && o.personalPreferidoUid && o.personalPreferidoUid !== usuario.uid);
}

function renderOfertas() {
    const el = $("lista-demandas-cards");
    if (!el || !usuario) return;
    if (!ativo()) { el.innerHTML = vazio("🔒", "Pedidos liberados após aprovação", "Estamos analisando seu cadastro de personal. Complete CPF e CREF em Menu → Perfil."); return; }
    const hoje = hojeLocal();
    let base = ofertas
        .filter((o) => o.alunoUid !== usuario.uid && o.data >= hoje && visivelParaMim(o) && valorPersonal(o) >= Math.round(perfil.valorMin * 100))
        .map((o) => ({ ...o, valorPersonalCentavos: valorPersonal(o), distKm: posicaoPersonal ? distanciaKm(posicaoPersonal, pontoDaAula(o)) : null }))
        .map((o) => ({ ...o, distKm: Number.isFinite(o.distKm) ? o.distKm : null }));
    if (soPerto && posicaoPersonal) base = filtrarPorRaio(base, posicaoPersonal, RAIO_KM_AULAS);
    const lista = ordemOfertas === "cedo"
        ? base.map((o) => ({ ...o, match: null })).sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`))
        : ranquearOfertas(base, { experiencias: perfil.experiencias || [], valorMinCentavos: Math.round(perfil.valorMin * 100), fmtKm });
    const aviso = perfil.mpConectado ? "" : `<div class="aviso-box">⚠️ Conecte o Mercado Pago na aba <strong>Carteira</strong> para poder aceitar aulas.</div>`;
    const filtros = `<div class="filtros-ofertas">
        <button type="button" class="btn-mini ${ordemOfertas === "sugeridas" ? "ativo" : ""}" data-acao="ordem" data-id="sugeridas">✨ Sugeridas</button>
        <button type="button" class="btn-mini ${ordemOfertas === "cedo" ? "ativo" : ""}" data-acao="ordem" data-id="cedo">🕒 Mais cedo</button>
        ${posicaoPersonal ? `<button type="button" class="btn-mini ${soPerto ? "ativo" : ""}" data-acao="perto" data-id="x">📍 Perto de mim (${RAIO_KM_AULAS} km)</button>` : ""}</div>`;
    el.innerHTML = aviso + (base.length || soPerto ? filtros : "") + (lista.length ? lista.map((o) => {
        const choque = conflitoNaAgenda(aulas, o);
        const paraMim = o.personalPreferidoUid === usuario.uid;
        const botao = choque ? `<span class="muted-line" style="margin:0;color:#f59e0b">Choque com sua aula das ${esc(choque.entrada)}</span>`
            : `<button type="button" class="btn-mini primario" data-acao="aceitar" data-id="${esc(o.id)}" ${perfil.mpConectado ? "" : "disabled"}>Aceitar</button>`;
        const m = o.match, chip = m && m.score !== null ? `<span class="chip-match ${m.nivel}" title="Afinidade com seu perfil">${m.score}% match</span>` : "";
        const dist = o.distKm !== null ? ` · 📍 ${fmtKm(o.distKm)}` : "";
        return `<div class="glass agenda-slot slot-livre">
            <div class="pedido-linha"><div class="slot-info-name">${iconeFoco(o.foco)} ${esc(o.local ?? o.loja)} ${chip}</div>
            <div class="slot-info-desc">${fmtData(o.data)} · ${esc(o.entrada)}–${esc(o.saida)} · ${esc(o.foco)}${o.alunoNome ? " · " + esc(o.alunoNome) : ""}${dist}</div>
            <div style="font-size:13px;color:var(--accent);font-weight:bold;margin-top:4px">Você recebe: ${brl(valorPersonal(o))}</div>
            ${m?.razoes?.length ? `<div class="razoes-match">${m.razoes.map(esc).join(" · ")}</div>` : ""}</div>
            ${paraMim ? '<span class="badge badge-ok">Reservado p/ você</span>' : ""}
            <div class="aula-acoes">${botao}</div></div>`;
    }).join("") : vazio("🏋️", soPerto ? "Nenhum pedido por perto" : "Sem pedidos no momento", soPerto ? `Nenhum pedido a até ${RAIO_KM_AULAS} km. Toque em “Perto de mim” para ver todos.` : perfil.valorMin ? "Há pedidos abaixo do seu valor mínimo? Ajuste em Preferências." : "Novos pedidos de treino aparecerão aqui."));
}

async function aceitarOferta(id, btn) {
    if (!perfil.mpConectado) { toast("Conecte o Mercado Pago na aba Carteira para aceitar aulas."); return; }
    btn.disabled = true;
    try { await chamarFuncao("aceitarAula", { aulaId: id }); toast("✅ Aula aceita! O aluno foi avisado."); }
    catch (e) { toast(textoErro(e, "Não foi possível aceitar. Outro personal pode ter pego.")); btn.disabled = false; }
}

function initMapAlunos() {
    const el = $("mapa-alunos");
    if (!el || !window.google || !window.google.maps) return;
    if (!mapaOfertas) {
        mapaOfertas = new google.maps.Map(el, {
            zoom: 14, center: { lat: -22.4389, lng: -46.8258 }, disableDefaultUI: true,
            styles: [
                { elementType: "geometry", stylers: [{ color: "#1a1a24" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c38" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] }
            ]
        });
    } else google.maps.event.trigger(mapaOfertas, "resize");
}

// ==========================================
// MEUS ALUNOS (agenda de alunos que o personal já atende; dado privado do personal)
// ==========================================
function abrirModalCadastrarAluno() { $("modal-cadastrar-aluno")?.classList.add("active"); }
function fecharModalCadastrarAluno() {
    $("modal-cadastrar-aluno")?.classList.remove("active");
    ["nome", "objetivo", "preco", "dias", "horario", "frequencia"].forEach((k) => { const e = $("cad-aluno-" + k); if (e) e.value = ""; });
}
async function confirmarCadastroAluno() {
    const nome = $("cad-aluno-nome").value.trim();
    if (nome.length < 2) { toast("Informe o nome do aluno."); return; }
    const preco = parseFloat($("cad-aluno-preco").value);
    try {
        await addDoc(collection(db, "personais", usuario.uid, "meus_alunos"), {
            nome: nome.slice(0, 80), objetivo: $("cad-aluno-objetivo").value.trim().slice(0, 60), valorAula: preco > 0 ? preco : null,
            dias: $("cad-aluno-dias").value.trim().slice(0, 60), horario: $("cad-aluno-horario").value.trim().slice(0, 30), frequencia: $("cad-aluno-frequencia").value.trim().slice(0, 30), criadoEm: serverTimestamp()
        });
        fecharModalCadastrarAluno();
        toast("✅ Aluno adicionado à sua lista!");
    } catch (e) { console.error(e); toast("Não foi possível salvar o aluno."); }
}
async function removerAluno(id) {
    if (!confirm("Remover este aluno da sua lista?")) return;
    try { await deleteDoc(doc(db, "personais", usuario.uid, "meus_alunos", id)); } catch (e) { toast("Não foi possível remover."); }
}
function renderMeusAlunos() {
    const el = $("lista-meus-alunos");
    if (!el) return;
    el.innerHTML = meusAlunos.length ? meusAlunos.map((a) => `<div class="glass agenda-slot slot-ocupado">
        <div class="pedido-linha"><div class="slot-info-name">${esc(a.nome)}</div>
        <div class="slot-info-desc">${[a.objetivo, a.dias, a.horario, a.frequencia, a.valorAula ? brl(Math.round(a.valorAula * 100)) + "/aula" : ""].filter(Boolean).map(esc).join(" · ") || "Sem detalhes"}</div></div>
        <div class="aula-acoes"><button type="button" class="btn-mini perigo" data-acao="remover-aluno" data-id="${esc(a.id)}">Remover</button></div></div>`).join("")
        : vazio("🧑‍🤝‍🧑", "Nenhum aluno na lista", "Adicione quem você já atende para organizar dias, horários e valores.");
}

// ==========================================
// CHAT DA AULA
// ==========================================
function renderConversas() {
    const el = $("lista-conversas-personal");
    if (!el) return;
    const com = aulas.filter((a) => ["aceita", "paga", "concluida"].includes(a.status));
    el.innerHTML = com.length
        ? com.map((a) => `<div class="glass conversa-item" data-acao="chat" data-id="${esc(a.id)}"><div><div class="slot-info-name">${esc(a.alunoNome || "Aluno")}</div><div class="slot-info-desc">${fmtData(a.data)} · ${esc(a.entrada)}–${esc(a.saida)} · ${esc(a.foco)}</div></div><span class="badge badge-gold">Abrir 💬</span></div>`).join("")
        : vazio("💬", "Nenhuma conversa ainda", "Quando você aceitar uma aula, o chat com o aluno aparece aqui.");
}

function abrirChat(id) {
    const a = aulas.find((x) => x.id === id);
    if (!a) return;
    fecharConversaModal();
    chat.aulaId = id;
    if ($("chat-active-name")) $("chat-active-name").textContent = a.alunoNome || "Aluno";
    const box = $("chat-box");
    box.innerHTML = '<p class="muted-line" style="text-align:center">Carregando…</p>';
    chat.desligar = onSnapshot(query(collection(db, "aulas", id, "mensagens"), orderBy("criadoEm")), (snap) => {
        box.innerHTML = snap.empty ? '<p class="muted-line" style="text-align:center">Diga olá! Combine tudo por aqui.</p>' : snap.docs.map((d) => {
            const m = d.data(), meu = m.de === usuario.uid;
            const hora = m.criadoEm?.toDate ? m.criadoEm.toDate().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
            return `<div class="msg ${meu ? "msg-sent" : "msg-received"}">${esc(m.texto)}<small>${hora}</small></div>`;
        }).join("");
        box.scrollTop = box.scrollHeight;
    }, (e) => { console.warn("Chat:", e.code); });
    $("modal-chat-flutuante")?.classList.add("active");
}
function fecharConversaModal() {
    chat.desligar?.(); chat.desligar = null; chat.aulaId = null;
    $("modal-chat-flutuante")?.classList.remove("active");
}
async function enviarMensagemChat() {
    const input = $("input-chat-msg");
    const texto = input?.value.trim();
    if (!texto || !chat.aulaId || chat.enviando) return;
    if (mensagemSuspeita(texto)) { toast("⚠️ Telefone, e-mail, links e Pix não podem ser enviados pelo chat. Combine tudo pelo app: reincidência pode bloquear a conta."); return; }
    chat.enviando = true;
    try { await chamarFuncao("enviarMensagem", { aulaId: chat.aulaId, texto }); input.value = ""; }
    catch (e) { toast(textoErro(e, "Não foi possível enviar a mensagem.")); }
    finally { chat.enviando = false; input.focus(); }
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target?.id === "input-chat-msg") { e.preventDefault(); enviarMensagemChat(); }
    if (e.key === "Escape") { fecharConversaModal(); fecharQR(); }
});

// ==========================================
// TEMA + EXPORTS PARA O HTML
// ==========================================
const toggleTheme = alternarTema;

Object.assign(window, {
    loginComGoogle, validarCheckTermos, abrirModalTermos, aceitarTermosModal,
    abrirOpcaoMenu, fecharSubtela, salvarPerfilProfissionalCompleto, salvarDadosBancarios, salvarPrefs, salvarContato,
    atualizarFotoPerfil, sairModoPessoal, switchTabPersonal, mudarMesCalendario, selecionarDia,
    abrirModalCadastrarAluno, fecharModalCadastrarAluno, confirmarCadastroAluno,
    gerarSugestaoPerfil, fecharConversaModal, enviarMensagemChat, initMapAlunos, toggleTheme, toast, fecharQR, conectarMercadoPago
});

// Se o Maps carregou antes do módulo, inicia agora
if (window.google && window.google.maps) initMapAlunos();
