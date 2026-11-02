// ============================================================
// PERSONOW — painel da ALUNO (aluno)
// Mesmo padrão do script-personal.js: firebase.js + core.js + ui.js + config.js
// ============================================================
import { collection, doc, addDoc, setDoc, getDoc, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getRedirectResult, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, chamarFuncao, consultar, baixarCSVProtegido, renovarToken, testeAtivo, loginDeTeste, contaDeTeste, entrarComGoogle, sairDaConta } from "./firebase.js";
import { guardarEmailPendente, resolverAcesso, telaOutroPerfil, telaFalhaTemporaria, irParaPainel, limparGuarda } from "./acesso.js";
import { ligarLoginEmail } from "./login-email.js";
import { ligarSeletorDeModo, modoSalvo, gravarModo, termosAceitos, gravarTermos } from "./entrada.js";
import { pintarRecado } from "./recado.js";
import { iniciarSuporte, pararSuporte } from "./suporte.js";
import "./presenca.js";                       // contador de usuários online (painel de TI)
import { ativarPush, desativarPush } from "./push.js";
import { WHATSAPP_SUPORTE, MP_PUBLIC_KEY } from "./config.js";
import { iniciarTaxas } from "./taxas.js";
import { brl, calcularPreco, calcularAula, visaoAluno, validarAula, minutosEntre, esc, TAXAS, fmtData, fmtDataHora, hojeLocal, mascaraDoc, mascaraTelefone, docValido, soDigitos, estaPago, valorCentavos, MODALIDADES, textoTermos } from "./core.js";
import { iniciar as iniciarJogo, pintarReputacao, abrirLocal, abrirRelampago, abrirAuditoria, temLocal, carregarParceiros } from "./aluno-jogo.js";
import { telaBanido, esconderBanido, animarPerdaVida } from "./gamificacao-ui.js";
import { $, dialogo, toast, ok, erro, iniciarTema, alternarTema, ligarMascaras, abrir, fechar, skeleton, vazio, registrarSW, instalarApp, pedirPermissaoNotificacao, notificar, baixarCSV } from "./ui.js";

// ---------- estado ----------
let rep = null, repTimer = null;
let usuario = null, perfil = {}, aulas = [], personais = [], cartaoAluno = null, ehTeste = false;
const fin = new Map();   // valores que a ALUNO enxerga (valor + taxa fixa + total), por aula
let filtro = "ativos", modalidadeSel = MODALIDADES[0].v, preferido = "", dataCal = new Date(), diaSel = "";
let aulasUn = null, promUn = null, cartaoUn = null, finUn = null, chatUn = null, chatAula = null, avAula = null, avEstrelas = 0, primeira = true;
const statusAnt = new Map();
const baseSite = () => location.origin + location.pathname.replace(/[^/]*$/, "");

iniciarTema(); registrarSW();
iniciarJogo({ perfil: () => perfil, setLocal: (l) => { perfil.localizacao = l; pintarLocal(); }, temCartao: () => !!cartaoAluno, modalidade: () => modalidadeSel, recarregar: () => carregarRep() });
ligarMascaras({ doc: mascaraDoc, tel: mascaraTelefone });

// ---------- textos que dependem da regra de taxas (nunca desatualizam) ----------
$("btn-whatsapp").href = `https://wa.me/${WHATSAPP_SUPORTE}`;
$("ajuda-zap").href = `https://api.whatsapp.com/send?phone=${WHATSAPP_SUPORTE}&text=${encodeURIComponent("Olá! Preciso de ajuda no Personow (aluno).")}`;
/** Redesenha tudo que depende das taxas. Roda ao abrir e sempre que o admin muda algo (taxas.js). */
function textosTaxas() {
    $("ajuda-split").textContent = `Cada aula custa ${brl(TAXAS.precoCentavos)} (aula padrão), pagos só depois do serviço, por Pix ou cartão. A aula tem de ${TAXAS.horasMin} a ${TAXAS.horasMax} horas. Os detalhes estão nos Termos de Uso.`;
    $("termos-texto").innerHTML = textoTermos("aluno");
    atualizarSplit();
}
iniciarTaxas(textosTaxas);

// ============================================================
// LOGIN / LOGOUT
// ============================================================
const msgAuth = (e) => ({
    "auth/unauthorized-domain": "Domínio não autorizado no Firebase (Authentication → Settings → Domínios autorizados).",
    "auth/operation-not-allowed": "Login com Google não está ativado no Firebase.",
    "auth/popup-blocked": "O navegador bloqueou a janela do Google. Libere pop-ups ou tente de novo.",
    "auth/network-request-failed": "Sem conexão com a internet.",
    "auth/popup-closed-by-user": null, "auth/cancelled-popup-request": null
})[e.code] ?? `Não foi possível entrar com o Google. (${e.code || "erro"})`;

const TXT_LOGIN = {
    entrar: { titulo: "Entrar na minha conta", sub: "Entre com a sua conta Google ou com e-mail e senha.", botao: "Entrar com Google" },
    criar: { titulo: "Crie sua conta de aluno", sub: "Chame um personal em minutos, acompanhe ao vivo e pague só depois da aula.", botao: "Criar conta com Google" }
};
let emailUI = null;
const seletor = ligarSeletorDeModo({ textos: TXT_LOGIN, aoMudar: (m) => emailUI?.atualizarModo(m) });
const resetarLogin = () => { const b = $("btn-login"); delete b.dataset.ocupado; $("btn-login-txt").textContent = TXT_LOGIN[seletor.atual()].botao; seletor.atualizarBotao(); };
$("link-termos").addEventListener("click", (e) => { e.preventDefault(); abrir("sheet-termos"); });
let aguardandoTermos = false;                                          // clicou em "Criar conta" sem aceitar: abrimos os Termos e, ao aceitar, seguimos para o Google
emailUI = ligarLoginEmail({ modo: () => seletor.atual(), termosAceitos: () => $("check-termos").checked, pedirTermos: () => { aguardandoTermos = "email"; abrir("sheet-termos"); } });
$("btn-aceitar-termos").addEventListener("click", () => { $("check-termos").checked = true; seletor.atualizarBotao(); fechar("sheet-termos"); if (aguardandoTermos) { const via = aguardandoTermos; aguardandoTermos = false; if (via === "email") $("form-email").requestSubmit(); else $("btn-login").click(); } });
$("btn-login").addEventListener("click", async () => {
    const b = $("btn-login"), criando = seletor.atual() === "criar";
    if (criando && !$("check-termos").checked) { aguardandoTermos = true; abrir("sheet-termos"); return; }
    gravarModo(seletor.atual()); gravarTermos(criando);                    // lembra a intenção (entrar × criar) até o fim do login
    b.dataset.ocupado = "1"; b.disabled = true; $("btn-login-txt").textContent = "Abrindo o Google…";
    try { await entrarComGoogle(); resetarLogin(); }
    catch (e) { const m = msgAuth(e); if (m) erro(m); resetarLogin(); }
});
testeAtivo().then((a) => { $("bloco-teste").hidden = !a; });
$("btn-login-teste").addEventListener("click", async () => {
    const b = $("btn-login-teste"); b.disabled = true;
    try { await loginDeTeste("aluno"); } catch (e) { console.error(e); erro("Não foi possível entrar no modo de teste."); b.disabled = false; }
});
getRedirectResult(auth).catch((e) => { const m = msgAuth(e); if (m) erro(m); resetarLogin(); });
$("btn-sair").addEventListener("click", async () => { if (confirm("Deseja sair da conta?")) { parar(); await desativarPush(); pararSuporte(); await sairDaConta(); } });

const tela = (id) => document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
function parar() { clearInterval(repTimer); esconderBanido(); rep = null; aulasUn?.(); promUn?.(); cartaoUn?.(); finUn?.(); chatUn?.(); aulasUn = promUn = cartaoUn = finUn = chatUn = null; primeira = true; statusAnt.clear(); fin.clear(); cartaoAluno = null; }

onAuthStateChanged(auth, async (u) => {
    usuario = u;
    if (!u) { parar(); pararSuporte(); perfil = {}; aulas = []; tela("screen-login"); resetarLogin(); return; }
    if (guardarEmailPendente(u, trocarConta)) return;                          // e-mail/senha ainda sem confirmação
    let seguiu = false;
    try { seguiu = await carregarPerfil(u); } catch (e) { console.error(e); resetarLogin(); erro(e.code === "limite-requisicoes" || e.code === "termos-obrigatorios" || e.code === "dados-invalidos" ? e.message : "Não foi possível carregar seu cadastro. Tente novamente."); return; }   // reabilita o botão: antes ficava em "Abrindo o Google…" para sempre
    if (!seguiu) { resetarLogin(); return; }                                    // tela de aviso/falha já está na tela; a sessão continua de pé
    ehTeste = await contaDeTeste(); $("btn-teste-reset").hidden = !ehTeste; $("cartao-teste-dica").hidden = !ehTeste;
    pintarPerfil(); iniciarFormulario(); tela("screen-main"); escutar(); limparGuarda(); iniciarSuporte(u);
    pintarLocal(); pintarRep(); clearInterval(repTimer); repTimer = setInterval(() => { if (!document.hidden) carregarRep(); }, 120_000);
    carregarParceiros().then((m) => { $("campo-parceiro").hidden = !m.length; $("p-parceiro").innerHTML = '<option value="">Nenhuma</option>' + m.map((x) => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join(""); });
});

const trocarConta = async () => { parar(); await desativarPush(); pararSuporte(); await sairDaConta(); };
const mostrarOutroPerfil = (r) => telaOutroPerfil({ portal: "aluno", perfis: r?.perfis, email: usuario?.email, trocarConta });

async function carregarRep() {
    const antes = rep;
    try { rep = await consultar("reputacao"); } catch (e) { if (e.code === "conta-banida" || e.status === 403) rep = { banido: true, vidas: 0, infracoes: [], banidoMotivo: "Conta bloqueada." }; else { console.warn(e); return false; } }
    if (rep.banido) { clearInterval(repTimer); telaBanido(rep, async () => { parar(); await sairDaConta(); location.reload(); }); return true; }
    if (antes && !antes.banido && rep.vidas < antes.vidas) { const i = (rep.infracoes || []).find((x) => x.status !== "revogada"); animarPerdaVida({ ...(i || {}), vidas: rep.vidas }); }
    pintarReputacao(rep); return true;
}
const pintarRep = () => rep && !rep.banido && pintarReputacao(rep);
function pintarLocal() {
    const l = perfil.localizacao; $("aviso-local").hidden = temLocal(perfil);
    $("loc-status").textContent = temLocal(perfil) ? `📍 ${l.cidade || "Local definido"}${l.uf ? "/" + l.uf : ""}` : "📍 Localização não definida";
}
/**
 * O perfil ativo vem do SERVIDOR (/sessao) para o portal aberto — nunca do navegador.
 * Devolve true se o aluno pode abrir o painel; false se uma tela de aviso/falha foi mostrada (sem derrubar a sessão).
 */
async function carregarPerfil(u) {
    let r;
    try { r = await resolverAcesso("aluno"); }
    catch (e) { console.warn(e); telaFalhaTemporaria({ tentarDeNovo: () => location.reload(), trocarConta }); return false; }
    if (r.estado === "outro-perfil" || r.estado === "escolher") {
        if (r.sugerido && irParaPainel(r.sugerido, "aluno")) return false;   // conta de personal: vai DIRETO ao painel dele (com trava anti-loop)
        mostrarOutroPerfil(r); return false;
    }
    if (r.estado === "cadastro") {
        if (!(await confirmarNovaConta(u))) return false;
        try { await chamarFuncao("cadastro/aluno", { termos: true }); await renovarToken(); gravarTermos(false); }
        catch (e) {
            if (e.code === "papel-conflito") { if (e.detalhe?.sugerido && irParaPainel(e.detalhe.sugerido, "aluno")) return false; mostrarOutroPerfil({ perfis: [e.detalhe?.tem].filter(Boolean) }); return false; }
            throw e;
        }
    } else if (termosAceitos()) { gravarTermos(false); toast("Você já tinha cadastro. Entramos na sua conta!", "ok"); }   // clicou em "Criar" mas a conta já existia
    if (await carregarRep() && rep.banido) return false;     // conta bloqueada: só a tela vermelha (a sessão não é derrubada)
    const ref = doc(db, "alunos", u.uid), s = await getDoc(ref);
    perfil = s.exists() ? s.data() : { uid: u.uid, email: u.email || "", nome: u.displayName || "" };
    return true;
}

/** Conta Google SEM cadastro de aluno. Nunca cria sozinho: em "Criar" os Termos já foram aceitos; em "Entrar" pergunta o que a pessoa quer. */
async function confirmarNovaConta(u) {
    if (modoSalvo() === "criar" && termosAceitos()) return true;
    const quer = await dialogo({
        icone: "🏪", titulo: "Ainda não existe cadastro de aluno", texto: `A conta ${u.email || "Google"} não tem cadastro. Quer criar uma conta de aluno com ela ou entrar com outra conta Google?`,
        acoes: [{ rotulo: "Criar conta de aluno", valor: "criar" }, { rotulo: "Entrar com outra conta", tipo: "ghost", valor: "outra" }]
    });
    if (quer === "criar") {
        const aceite = await dialogo({ icone: "📄", titulo: "Termos de Uso e Taxas", html: textoTermos("aluno"), marcar: "Li e concordo com os Termos de Uso e Taxas", acoes: [{ rotulo: "Concordar e criar conta", valor: "ok" }, { rotulo: "Cancelar", tipo: "ghost", valor: "nao" }] });
        if (aceite === "ok") return true;
    }
    await trocarConta(); return false;
}

function pintarPerfil() {
    pintarRecado($("nome-home").closest(".page-head"), perfil.recado);
    const nome = perfil.nomeCompleto || usuario.displayName || (usuario.email || "aluno").split("@")[0];
    $("nome-home").textContent = nome.split(" ")[0]; $("nome-menu").textContent = nome;
    for (const id of ["avatar-home", "avatar-menu"]) {
        const a = $(id); a.textContent = nome.charAt(0).toUpperCase();
        if (usuario.photoURL) a.innerHTML = `<img src="${esc(usuario.photoURL)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:inherit;object-fit:cover">`;
    }
    $("aviso-fiscal").hidden = !!(perfil.nomeCompleto && perfil.documento);
    $("f-razao").value = perfil.nomeCompleto || ""; $("f-doc").value = perfil.documento ? mascaraDoc(perfil.documento) : "";
    $("f-end").value = perfil.endereco || ""; $("f-email").value = perfil.email || usuario.email || "";
    $("f-tel").value = perfil.telefone ? mascaraTelefone(perfil.telefone) : ""; if (perfil.objetivo) $("f-objetivo").value = perfil.objetivo;
    $("pref-modalidade").innerHTML = MODALIDADES.map((s) => `<option value="${esc(s.v)}">${esc(s.label)}</option>`).join("");
    if (perfil.prefs?.modalidade) $("pref-modalidade").value = perfil.prefs.modalidade;
    $("pref-entrada").value = perfil.prefs?.entrada || "08:00"; $("pref-saida").value = perfil.prefs?.saida || "12:00";
    $("link-indicar").value = baseSite() + "landing.html";
}

// ============================================================
// DADOS EM TEMPO REAL
// ============================================================
function escutar() {
    parar();
    $("lista-aulas").innerHTML = skeleton(3); $("lista-personais").innerHTML = skeleton(2);
    aulasUn = onSnapshot(query(collection(db, "aulas"), where("uid", "==", usuario.uid)), (snap) => {
        aulas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!primeira) aulas.forEach((p) => {
            const a = statusAnt.get(p.id);
            if (a === "aberta" && p.status === "aceita") notificar("Personal confirmado 🎉", `${p.personalNome || "Um personal"} aceitou a aula em ${p.aluno}.`);
            if (a && !estaPago({ status: a }) && estaPago(p)) notificar("Pagamento confirmado ✓", `A nota da aula em ${p.aluno} já está disponível.`);
        });
        aulas.forEach((p) => statusAnt.set(p.id, p.status)); primeira = false;
        renderTudo();
    }, (e) => { aulas = []; renderTudo(); if (e.code === "permission-denied") erro("Sem permissão para ler as aulas. Publique as regras do Firestore."); else console.warn(e); });
    cartaoUn = onSnapshot(doc(db, "cartoes", usuario.uid), (d) => { cartaoAluno = d.exists() && d.data().status === "ativo" ? d.data() : null; renderCartao(); }, () => { cartaoAluno = null; renderCartao(); });
    finUn = onSnapshot(query(collection(db, "aulas_financeiro"), where("uid", "==", usuario.uid)), (snap) => { fin.clear(); snap.docs.forEach((d) => fin.set(d.id, d.data())); renderTudo(); }, () => {});
    promUn = onSnapshot(query(collection(db, "personais"), where("status", "==", "ativo")), (snap) => {
        personais = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderPersonais();
    }, () => { personais = []; renderPersonais(); });
}

// O que a ALUNO enxerga de uma aula: valor do serviço + taxa fixa + total. Nunca repasse nem royalty.
const sp = (p) => {
    const f = fin.get(p.id); if (f && Number.isInteger(f.total)) return visaoAluno(f);
    return visaoAluno(calcularPreco());
};
const ordemData = (a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`);
function renderTudo() { renderHome(); renderAulas(); renderCalendario(); diaSel ? renderDia() : renderAgenda(); renderCarteira(); renderConversas(); }

// ============================================================
// NOVO AULA
// ============================================================
function montarModalidades() {
    $("modalidade-grid").innerHTML = MODALIDADES.map((s) => `<button type="button" class="chip${s.v === modalidadeSel ? " sel" : ""}" role="radio" aria-checked="${s.v === modalidadeSel}" data-modalidade="${esc(s.v)}"><span class="ico">${s.ico}</span>${esc(s.label)}</button>`).join("");
}
function iniciarFormulario() {
    $("p-data").min = hojeLocal(); if (!$("p-data").value || $("p-data").value < hojeLocal()) $("p-data").value = hojeLocal();
    $("p-entrada").value = perfil.prefs?.entrada || "08:00"; $("p-saida").value = perfil.prefs?.saida || "12:00";
    if (perfil.prefs?.modalidade) modalidadeSel = perfil.prefs.modalidade;
    montarModalidades(); atualizarSplit();
}
$("modalidade-grid").addEventListener("click", (e) => { const b = e.target.closest("[data-modalidade]"); if (b) { modalidadeSel = b.dataset.modalidade; montarModalidades(); } });

const limparErros = () => document.querySelectorAll(".msg-erro").forEach((e) => (e.textContent = ""));
// function (hoisted): atualizarSplit() pode rodar durante a carga do módulo (iniciarTaxas) e, como `const`, isto derrubava o script inteiro.
function fmtHoras(m) { const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h} h ${String(mm).padStart(2, "0")} min` : `${h} h`; }
/** Resumo ao vivo: o valor sai do horário (nunca digitado). Mostra só valor do serviço + taxa fixa + total. */
function atualizarSplit() {
    const entrada = $("p-entrada").value, saida = $("p-saida").value, m = minutosEntre(entrada, saida), e = m ? validarAula(entrada, saida) : "";
    $("dica-valor").textContent = m ? `Aula de ${fmtHoras(m)} · aula de ${brl(TAXAS.precoCentavos)}` : `Aulas de ${TAXAS.horasMin} a ${TAXAS.horasMax} horas`;
    $("e-saida").textContent = m && e ? e : "";
    const valido = m > 0 && !e;
    $("split-card").hidden = !valido;
    if (!valido) return;
    const v = visaoAluno(calcularAula(m));
    $("sc-horas").textContent = fmtHoras(m); $("sc-valor").textContent = brl(v.valor); $("sc-total").textContent = brl(v.total);
}
["p-entrada", "p-saida"].forEach((id) => $(id).addEventListener("input", atualizarSplit));

function definirPreferido(id, nome) {
    preferido = id || ""; $("banner-preferido").hidden = !preferido; $("nome-preferido").textContent = nome || "";
    if (preferido) { irPara("tab-home"); $("form-aula").scrollIntoView({ behavior: "smooth", block: "start" }); }
}
$("rm-preferido").addEventListener("click", () => definirPreferido(""));

$("btn-enviar").addEventListener("click", async () => {
    limparErros();
    const aluno = $("p-local").value.trim(), data = $("p-data").value, entrada = $("p-entrada").value, saida = $("p-saida").value;
    let falhou = false; const e = (id, m) => { $(id).textContent = m; falhou = true; };
    if (!cartaoAluno) { abrir("sheet-cartao"); return toast("Cadastre um cartão de crédito para solicitar um personal.", "erro"); }
    if (!temLocal(perfil)) { abrirLocal(); return toast("Defina a localização do aluno primeiro.", "erro"); }
    if (aluno.length < 3) e("e-local", "Informe o nome e o endereço do aluno.");
    if (!data || data < hojeLocal()) e("e-data", "Escolha hoje ou uma data futura.");
    const et = validarAula(entrada, saida); if (et) e("e-saida", et);        // trava de 6 h também no navegador
    else if (data === hojeLocal() && saida <= new Date().toTimeString().slice(0, 5)) e("e-saida", "Esse horário já passou hoje.");
    if (falhou) return erro("Confira os campos destacados.");

    const b = $("btn-enviar"), html = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Enviando…';
    try {
        await chamarFuncao("criarAula", { aluno, data, entrada, saida, foco: modalidadeSel, personalPreferido: preferido || undefined, parceiroId: $("p-parceiro").value || undefined });   // o servidor valida tudo de novo
        ok("Aula enviado! Avisamos quando um personal aceitar.");
        $("p-local").value = ""; definirPreferido(""); atualizarSplit();
        filtro = "ativos"; marcarFiltro(); irPara("tab-aulas");
        if (!(perfil.nomeCompleto && perfil.documento)) setTimeout(() => toast("Dica: complete seus dados para o recibo sair no seu nome."), 1800);
    } catch (err) {
        console.error(err);
        if (err.code === "localizacao-obrigatoria") { abrirLocal(); erro(err.message); }
        else if (err.code === "cartao-obrigatorio") { abrir("sheet-cartao"); erro(err.message); }
        else if (err.code === "aula-invalido") { $("e-saida").textContent = err.message; erro(err.message); }
        else if (err.code === "backend-nao-configurado") erro("O servidor ainda não está configurado (FUNCTIONS_BASE em config.js).");
        else if (err.code === 404 || err.code === "rota-inexistente") erro("O servidor não respondeu (404). Confira o endereço do serviço no Render.");
        else erro(err.message && err.message !== "falha" ? err.message : "Não foi possível enviar a aula. Tente de novo.");
    }
    finally { b.disabled = false; b.innerHTML = html; }
});

function repetir(p) {
    modalidadeSel = p.foco || modalidadeSel; montarModalidades();
    $("p-local").value = p.aluno || ""; $("p-entrada").value = p.entrada || "08:00"; $("p-saida").value = p.saida || "12:00";
    $("p-data").value = hojeLocal(); atualizarSplit();
    irPara("tab-home"); $("form-aula").scrollIntoView({ behavior: "smooth" }); toast("Dados copiados. Escolha o dia e envie.", "ok");
}

// ============================================================
// PERSONAIS DISPONÍVEIS
// ============================================================
function renderPersonais() {
    const l = personais.slice().sort((a, b) => (b.ratingMedia || 0) - (a.ratingMedia || 0) || (b.ratingQtd || 0) - (a.ratingQtd || 0)).slice(0, 12);
    $("lista-personais").innerHTML = l.length ? l.map((p) => {
        const nome = p.nome || "Personal", foto = p.fotoGoogle ? `<img src="${esc(p.fotoGoogle)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:inherit;object-fit:cover">` : esc(nome[0].toUpperCase());
        const nota = p.ratingQtd ? `<span class="stars">★ ${String(p.ratingMedia).replace(".", ",")}</span> <span class="muted small">(${p.ratingQtd})</span>` : '<span class="muted small">Novo na plataforma</span>';
        return `<article class="card conversa"><div class="avatar">${foto}</div><div class="grow"><h4>${esc(nome)}</h4><div class="small">${nota}</div><div class="muted small">${esc(p.especialidade || "Treino geral")}${p.cidade ? " · " + esc(p.cidade) : ""}</div></div><button class="btn btn-ghost btn-sm" data-chamar="${esc(p.uid || p.id)}" data-nome="${esc(nome)}">Chamar</button></article>`;
    }).join("") : vazio("👷", "Nenhum personal cadastrado ainda", "Envie a aula mesmo assim: ele aparece para todos os personais aprovados da região.");
}

// ============================================================
// INÍCIO / AULAS
// ============================================================
function renderHome() {
    const aPagar = aulas.filter((p) => p.status === "aceita").length;
    $("dot-aulas").hidden = !aPagar; $("dot-aulas").textContent = aPagar;
    const prox = aulas.filter((p) => (p.status === "aceita" || p.status === "aberta") && p.data >= hojeLocal()).sort(ordemData)[0], el = $("card-proximo");
    el.hidden = !prox; if (!prox) return;
    el.innerHTML = `<div class="lbl">Próxima aula</div><div class="row between"><div><h4>${esc(prox.aluno)}</h4><div class="muted small">${fmtData(prox.data)} · ${esc(prox.horario || "")} · ${esc(prox.foco)}</div></div>${selo(prox)}</div>
        <div class="muted small mt">${prox.status === "aceita" ? `👷 ${esc(prox.personalNome || "Personal")} confirmado.` : "Aguardando um personal aceitar."}</div>`;
}
const selo = (p) => { if (p.status === "aceita" && p.exigeExecucao && p.fase !== "executada") return `<span class="badge blue">${p.fase === "em_andamento" ? "Em andamento" : "Aceito"}</span>`;
     const [t, c] = p.status === "cancelada" ? ["Cancelado", "red"] : estaPago(p) ? ["Pago ✓", "green"] : p.status === "aceita" ? ["Aceito · pagar", "blue"] : ["Aguardando personal", ""]; return `<span class="badge ${c}">${t}</span>`; };
function linhaTempo(p) {
    const idx = estaPago(p) ? 2 : p.status === "aceita" ? 1 : 0, nomes = ["Aula", "Aceito", "Pago"];
    return `<div class="timeline">${nomes.map((n, i) => `<div class="passo ${i < idx || (idx === 2 && i === 2) ? "ok" : i === idx ? "on" : ""}"><div class="bola"></div>${n}</div>${i < 2 ? `<div class="fio ${i < idx ? "on" : ""}"></div>` : ""}`).join("")}</div>`;
}
function cartao(p) {
    const s = sp(p), pago = estaPago(p), cancel = p.status === "cancelada", acoes = [];
    const exec = p.exigeExecucao === true, fase = p.fase || "", pillF = fase === "em_andamento" ? '<span class="fase-pill andamento">Em andamento no local</span>' : fase === "executada" && !pago ? '<span class="fase-pill executada">Executado ✓</span>' : "";
    if (p.status === "aceita" && (!exec || fase === "executada")) acoes.push(`<a class="btn btn-primary btn-sm" href="pagar.html?id=${encodeURIComponent(p.id)}">💳 Pagar agora</a>`);
    if (fase === "executada") acoes.push(`<button class="btn btn-ghost btn-sm" data-foto="${p.id}">🖼 ${p.auditoriaAluno ? "Ver foto" : "Ver foto e auditar"}</button>`);
    if (pago && p.notaId) acoes.push(`<a class="btn btn-primary btn-sm" href="nota.html?id=${encodeURIComponent(p.notaId)}">🧾 Ver nota</a>`);
    if (p.status === "paga" && !p.avaliacao) acoes.push(`<button class="btn btn-ghost btn-sm" data-avaliar="${p.id}">⭐ Avaliar</button>`);
    if (p.personalUid && !cancel) acoes.push(`<button class="btn btn-ghost btn-sm" data-chat="${p.id}">💬 Chat</button>`);
    if (pago || cancel) acoes.push(`<button class="btn btn-ghost btn-sm" data-repetir="${p.id}">🔁 Repetir</button>`);
    if ((p.status === "aberta" || p.status === "aceita") && !fase) acoes.push(`<button class="btn btn-danger btn-sm" data-cancelar="${p.id}">Cancelar</button>`);
    return `<article class="card aula ${cancel ? "cancelada" : ""}"><div class="topo"><div class="grow"><h4>${esc(p.aluno)}</h4><div class="meta">${p.tipo === "relampago" ? "⚡ " : ""}${fmtData(p.data)} · ${esc(p.horario || "")} · ${esc(p.foco)}${p.bonusCentavos ? ` · bônus ${brl(p.bonusCentavos)}` : ""}</div>${pillF}${p.personalNome ? `<div class="meta">👷 ${esc(p.personalNome)}${p.avaliacao ? ` · <span class="stars">${"★".repeat(p.avaliacao.estrelas)}</span>` : ""}</div>` : ""}</div>
        <div class="center"><div class="valor">${brl(s.total)}</div>${selo(p)}</div></div>${cancel ? "" : linhaTempo(p)}${acoes.length ? `<div class="acoes">${acoes.join("")}</div>` : ""}</article>`;
}
function marcarFiltro() { document.querySelectorAll("#filtro-aulas .pill").forEach((b) => b.classList.toggle("sel", b.dataset.f === filtro)); }
$("filtro-aulas").addEventListener("click", (e) => { const b = e.target.closest(".pill"); if (b) { filtro = b.dataset.f; marcarFiltro(); renderAulas(); } });
function renderAulas() {
    let l = aulas.slice();
    if (filtro === "ativos") l = l.filter((p) => p.status === "aberta" || p.status === "aceita").sort(ordemData);
    else { if (filtro === "pagos") l = l.filter(estaPago); l.sort((a, b) => ordemData(b, a)); }
    $("lista-aulas").innerHTML = l.length ? l.map(cartao).join("") : vazio("📋", filtro === "pagos" ? "Nenhum pagamento ainda" : "Nenhum aula por aqui", filtro === "pagos" ? "As aulas pagas e suas notas aparecem aqui." : "Faça seu primeira aula na aba Início.", filtro === "pagos" ? "" : '<button class="btn btn-primary" data-ir="tab-home">Solicitar personal</button>');
}

// ============================================================
// AGENDA
// ============================================================
function renderCalendario() {
    const ano = dataCal.getFullYear(), mes = dataCal.getMonth(), hoje = hojeLocal();
    $("cal-titulo").textContent = dataCal.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const ini = (new Date(ano, mes, 1).getDay() + 6) % 7, total = new Date(ano, mes + 1, 0).getDate(), com = new Set(aulas.filter((p) => p.status !== "cancelada").map((p) => p.data));
    let h = "<div></div>".repeat(ini);
    for (let d = 1; d <= total; d++) { const iso = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; h += `<button class="cal-day${iso === hoje ? " today" : ""}${iso === diaSel ? " selected" : ""}${com.has(iso) ? " tem" : ""}" data-dia="${iso}" aria-label="${d}">${d}</button>`; }
    $("cal-grid").innerHTML = h;
}
function renderAgenda() {
    $("cal-label").textContent = "Escolha uma data para ver as aulas.";
    const l = aulas.filter((p) => (p.status === "aberta" || p.status === "aceita") && p.data >= hojeLocal()).sort(ordemData);
    $("lista-agenda").innerHTML = l.length ? l.map(cartao).join("") : vazio("📅", "Agenda livre", "As aulas aulas aparecem aqui, em ordem de data.");
}
function renderDia() {
    const l = aulas.filter((p) => p.data === diaSel && p.status !== "cancelada").sort(ordemData);
    $("cal-label").textContent = "Aulas de " + new Date(diaSel + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    $("lista-agenda").innerHTML = l.length ? l.map(cartao).join("") : vazio("📅", "Nenhum aula neste dia", "Escolha outra data ou faça um nova aula.");
}
$("cal-grid").addEventListener("click", (e) => { const b = e.target.closest("[data-dia]"); if (!b) return; diaSel = diaSel === b.dataset.dia ? "" : b.dataset.dia; renderCalendario(); diaSel ? renderDia() : renderAgenda(); });
$("cal-prev").addEventListener("click", () => { dataCal = new Date(dataCal.getFullYear(), dataCal.getMonth() - 1, 1); renderCalendario(); });
$("cal-next").addEventListener("click", () => { dataCal = new Date(dataCal.getFullYear(), dataCal.getMonth() + 1, 1); renderCalendario(); });

// ============================================================
// CARTEIRA
// ============================================================
function renderCarteira() {
    const pagos = aulas.filter(estaPago).sort((a, b) => ordemData(b, a)), aceitos = aulas.filter((p) => p.status === "aceita");
    $("c-total").textContent = brl(pagos.reduce((a, p) => a + sp(p).total, 0));
    $("c-pendente").textContent = brl(aceitos.reduce((a, p) => a + sp(p).total, 0)); $("c-qtd").textContent = pagos.length;
    const meses = [], agora = new Date();
    for (let i = 5; i >= 0; i--) { const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1); meses.push({ k: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, rot: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), v: 0 }); }
    pagos.forEach((p) => { const m = meses.find((x) => x.k === (p.data || "").slice(0, 7)); if (m) m.v += sp(p).total; });
    const max = Math.max(...meses.map((m) => m.v), 1);
    $("c-barras").innerHTML = meses.map((m) => `<div class="b ${m.v ? "" : "zero"}" title="${brl(m.v)}"><span>${m.v ? brl(m.v).replace(/\s?R\$\s?/, "").replace(",00", "") : ""}</span><i style="height:${Math.max(3, (m.v / max) * 72)}px"></i>${m.rot}</div>`).join("");
    $("c-extrato").innerHTML = pagos.length ? pagos.map((p) => {
        const corpo = `<div class="ico">🧾</div><div class="grow"><strong>${esc(p.aluno)}</strong><div class="muted small">${fmtData(p.data)} · ${esc(p.foco)}${p.notaNumero ? ` · Nota ${String(p.notaNumero).padStart(6, "0")}` : ""}</div></div><div class="val">− ${brl(sp(p).total)}</div>`;
        return p.notaId ? `<a class="item" href="nota.html?id=${encodeURIComponent(p.notaId)}" style="color:inherit;text-decoration:none">${corpo}</a>` : `<div class="item">${corpo}</div>`;
    }).join("") : vazio("🧾", "Suas notas aparecem aqui", "Cada aula paga gera uma nota para a sua contabilidade.");
}
$("btn-csv").addEventListener("click", async () => {
    if (!aulas.some(estaPago)) return toast("Ainda não há pagamentos para exportar.");
    try { await baixarCSVProtegido("aluno/exportar.csv", "personow-pagamentos.csv"); } catch (e) { erro(e.code === "limite-requisicoes" ? "Aguarde um instante e tente de novo." : "Não foi possível exportar agora."); }
});

// ============================================================
// CHAT
// ============================================================
function renderConversas() {
    const l = aulas.filter((p) => p.personalUid && p.status !== "cancelada").sort((a, b) => ordemData(b, a));
    $("lista-conversas").innerHTML = l.length ? l.map((p) => `<div class="card conversa" data-chat="${p.id}" role="button" tabindex="0"><div class="avatar">${esc((p.personalNome || "P")[0].toUpperCase())}</div><div class="grow"><h4>${esc(p.personalNome || "Personal")}</h4><div class="muted small">${esc(p.aluno)} · ${fmtData(p.data)}</div></div><span class="seta muted">›</span></div>`).join("")
        : vazio("💬", "Nenhuma conversa ainda", "Quando um personal aceitar sua aula, o chat com ele aparece aqui.");
}
function pararChat() { chatUn?.(); chatUn = null; chatAula = null; }
function abrirChat(p) {
    pararChat(); chatAula = p; $("chat-titulo").textContent = p.personalNome || "Personal"; $("chat-box").innerHTML = skeleton(1);
    chatUn = onSnapshot(query(collection(db, "aulas", p.id, "mensagens"), orderBy("criadoEm")), (s) => {
        const box = $("chat-box");
        box.innerHTML = s.docs.length ? s.docs.map((d) => { const m = d.data(); return `<div class="msg ${m.de === usuario.uid ? "msg-me" : "msg-other"}">${esc(m.texto)}<small>${fmtDataHora(m.criadoEm)}</small></div>`; }).join("") : '<p class="muted small center" style="margin:auto">Diga olá 👋 e combine os detalhes da aula.</p>';
        box.scrollTop = box.scrollHeight;
    }, () => { $("chat-box").innerHTML = '<p class="muted small center">Não foi possível carregar a conversa.</p>'; });
    abrir("sheet-chat");
}
$("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const t = $("chat-input").value.trim(); if (!t || !chatAula) return; $("chat-input").value = "";
    try { await addDoc(collection(db, "aulas", chatAula.id, "mensagens"), { de: usuario.uid, texto: t, criadoEm: serverTimestamp() }); }
    catch (err) { console.error(err); erro("Mensagem não enviada."); $("chat-input").value = t; }
});

// ============================================================
// AVALIAÇÃO
// ============================================================
function pintarEstrelas() { $("av-stars").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= avEstrelas ? "on" : ""}" data-e="${n}" role="radio" aria-checked="${n === avEstrelas}" aria-label="${n} estrela${n > 1 ? "s" : ""}">★</button>`).join(""); }
function abrirAvaliacao(p) { avAula = p; avEstrelas = 0; $("av-texto").value = ""; $("av-sub").textContent = `Como foi o serviço com ${p.personalNome || "o personal"}?`; pintarEstrelas(); abrir("sheet-avaliar"); }
$("av-stars").addEventListener("click", (e) => { const b = e.target.closest("[data-e]"); if (b) { avEstrelas = Number(b.dataset.e); pintarEstrelas(); } });
$("btn-enviar-av").addEventListener("click", async () => {
    if (!avEstrelas) return erro("Escolha de 1 a 5 estrelas.");
    const b = $("btn-enviar-av"); b.disabled = true;
    try { await chamarFuncao("avaliarServico", { aulaId: avAula.id, estrelas: avEstrelas, comentario: $("av-texto").value.trim() }); ok("Obrigado pela avaliação!"); fechar("sheet-avaliar"); }
    catch (err) { console.error(err); erro("Não foi possível enviar a avaliação."); }
    finally { b.disabled = false; }
});

// ============================================================
// MENU: dados da empresa, preferências, indicação, notificações
// ============================================================
async function salvarPerfil(dados, msg, sheet) {
    try { await setDoc(doc(db, "alunos", usuario.uid), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true }); perfil = { ...perfil, ...dados }; ok(msg); if (sheet) fechar(sheet); pintarPerfil(); return true; }
    catch (e) { console.error(e); erro("Não foi possível salvar. Verifique as regras do Firestore."); return false; }
}
$("btn-salvar-fiscal").addEventListener("click", async () => {
    $("e-doc").textContent = ""; $("f-doc").classList.remove("invalido");
    const razao = $("f-razao").value.trim(), documento = soDigitos($("f-doc").value), email = $("f-email").value.trim();
    if (razao.length < 3) return erro("Informe o seu nome completo.");
    if (!docValido(documento)) { $("e-doc").textContent = "CNPJ ou CPF inválido. Confira os dígitos."; $("f-doc").classList.add("invalido"); return $("f-doc").focus(); }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return erro("E-mail inválido.");
    await salvarPerfil({ nomeCompleto: razao, documento, endereco: $("f-end").value.trim(), email, telefone: soDigitos($("f-tel").value), objetivo: $("f-objetivo").value }, "Dados salvos ✓", "sheet-fiscal");
});
$("btn-salvar-prefs").addEventListener("click", async () => {
    if (await salvarPerfil({ prefs: { modalidade: $("pref-modalidade").value, entrada: $("pref-entrada").value, saida: $("pref-saida").value } }, "Preferências salvas ✓", "sheet-prefs")) { modalidadeSel = $("pref-modalidade").value; iniciarFormulario(); }
});
$("btn-copiar").addEventListener("click", () => { navigator.clipboard?.writeText($("link-indicar").value); ok("Link copiado!"); });
$("btn-zap").addEventListener("click", () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent("Precisa de personal trainer? Peça pelo Personow e pague só depois do serviço: " + $("link-indicar").value), "_blank", "noopener"));
$("btn-ativar-notif").addEventListener("click", async () => ((await pedirPermissaoNotificacao()) ? (ativarPush(), ok("Avisos ativados neste aparelho.")) : toast("Permissão não concedida. Libere nas configurações do navegador.")));
$("theme-toggle").addEventListener("change", alternarTema);
$("btn-instalar").addEventListener("click", instalarApp);

// ============================================================
// CARTÃO DE CRÉDITO (obrigatório para solicitar/pagar)
// ============================================================
const luhn = (n) => { let soma = 0, alt = false; for (let i = n.length - 1; i >= 0; i--) { let d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } soma += d; alt = !alt; } return n.length >= 13 && soma % 10 === 0; };
const bandeira = (n) => /^4/.test(n) ? "Visa" : /^(5[1-5]|2[2-7])/.test(n) ? "Mastercard" : /^3[47]/.test(n) ? "Amex" : /^(636368|438935|504175|451416|636297|5067|4576|4011|506699)/.test(n) ? "Elo" : /^606282|^3841/.test(n) ? "Hipercard" : "Cartão";
function renderCartao() {
    $("aviso-cartao").hidden = !!cartaoAluno;
    $("menu-cartao").textContent = cartaoAluno ? `· ${cartaoAluno.bandeira} •••• ${cartaoAluno.ultimos4}` : "· não cadastrado";
    const box = $("cartao-atual"); box.hidden = !cartaoAluno; $("btn-remover-cartao").hidden = !cartaoAluno;
    if (cartaoAluno) box.innerHTML = `<div class="row"><div class="avatar" style="background:var(--green-soft);color:var(--green)">✓</div><div class="grow"><h4>${esc(cartaoAluno.bandeira)} •••• ${esc(cartaoAluno.ultimos4)}</h4><p class="muted small">Validade ${String(cartaoAluno.mes).padStart(2, "0")}/${String(cartaoAluno.ano).slice(-2)}${cartaoAluno.simulado ? " · cartão de teste" : ""}</p></div></div>`;
}
$("k-num").addEventListener("input", (e) => { e.target.value = soDigitos(e.target.value).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 "); });
$("k-val").addEventListener("input", (e) => { const d = soDigitos(e.target.value).slice(0, 4); e.target.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; });
$("k-cvv").addEventListener("input", (e) => { e.target.value = soDigitos(e.target.value).slice(0, 4); });
let mpSdk = null;
async function tokenDoCartao(c) {
    if (!MP_PUBLIC_KEY) throw Object.assign(new Error("O cadastro de cartão ainda não foi habilitado (falta MP_PUBLIC_KEY em config.js)."), { code: "sem-public-key" });
    if (!window.MercadoPago) await new Promise((ok2, err2) => { const sc = document.createElement("script"); sc.src = "https://sdk.mercadopago.com/js/v2"; sc.onload = ok2; sc.onerror = () => err2(Object.assign(new Error("Não foi possível carregar o Mercado Pago."), { code: "sdk" })); document.head.appendChild(sc); });
    mpSdk = mpSdk || new window.MercadoPago(MP_PUBLIC_KEY, { locale: "pt-BR" });
    const doc = soDigitos(perfil.documento || "");
    const t = await mpSdk.createCardToken({ cardNumber: c.numero, cardholderName: c.nome, cardExpirationMonth: String(c.mes).padStart(2, "0"), cardExpirationYear: String(c.ano), securityCode: c.cvv, identificationType: doc.length === 14 ? "CNPJ" : "CPF", identificationNumber: doc || undefined });
    return t.id;
}
$("btn-salvar-cartao").addEventListener("click", async () => {
    ["e-k-num", "e-k-val", "e-k-cvv"].forEach((i) => ($(i).textContent = ""));
    const numero = soDigitos($("k-num").value), nome = $("k-nome").value.trim(), cvv = $("k-cvv").value;
    const [mm, aa] = $("k-val").value.split("/"), mes = Number(mm), ano = 2000 + Number(aa), agora = new Date();
    let falhou = false; const e = (id, m) => { $(id).textContent = m; falhou = true; };
    if (!luhn(numero)) e("e-k-num", "Número de cartão inválido. Confira os dígitos.");
    if (!(mes >= 1 && mes <= 12) || !(ano >= 2000) || ano < agora.getFullYear() || (ano === agora.getFullYear() && mes < agora.getMonth() + 1)) e("e-k-val", "Validade inválida ou cartão vencido.");
    if (cvv.length < 3) e("e-k-cvv", "CVV inválido.");
    if (nome.length < 3) { falhou = true; erro("Informe o nome impresso no cartão."); }
    if (falhou) return;
    const b = $("btn-salvar-cartao"), html = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Validando…';
    try {
        // Sandbox: manda só bandeira/últimos 4/validade. Produção: manda um TOKEN gerado pelo Mercado Pago (o número nunca passa pelo nosso servidor).
        const corpo = ehTeste ? { simulado: true, bandeira: bandeira(numero), ultimos4: numero.slice(-4), mes, ano } : { cardToken: await tokenDoCartao({ numero, nome, mes, ano, cvv }) };
        await chamarFuncao("cartao/registrar", corpo);
        ["k-num", "k-val", "k-cvv", "k-nome"].forEach((i) => ($(i).value = ""));
        ok("Cartão validado e cadastrado ✓"); fechar("sheet-cartao");
    } catch (err) { console.error(err); erro(err.message && err.message !== "falha" ? err.message : "Não foi possível validar o cartão. Confira os dados."); }
    finally { b.disabled = false; b.innerHTML = html; }
});
$("btn-remover-cartao").addEventListener("click", async () => {
    if (!confirm("Remover o cartão? Sem cartão cadastrado não é possível solicitar nem pagar serviços.")) return;
    try { await chamarFuncao("cartao/remover"); toast("Cartão removido."); } catch (e) { erro("Não foi possível remover o cartão."); }
});
$("btn-teste-reset").addEventListener("click", async () => {
    if (!confirm("Apagar as aulas, notas e o cartão das contas de teste?")) return;
    try { const r = await chamarFuncao("teste/resetar"); ok(`Dados de teste zerados (${r.aulasRemovidos} aula(s)).`); } catch (e) { erro("Não foi possível zerar os dados de teste."); }
});

// ============================================================
// NAVEGAÇÃO E CLIQUES (delegação)
// ============================================================
function irPara(id) {
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.toggle("active", t.id === id));
    document.querySelectorAll(".nav-item").forEach((i) => i.classList.toggle("active", i.dataset.tab === id));
    window.scrollTo(0, 0);
}
$("bottom-nav").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) irPara(b.dataset.tab); });

document.addEventListener("click", async (e) => {
    const g = (a) => e.target.closest(`[${a}]`), achar = (id) => aulas.find((p) => p.id === id);
    let el;
    if ((el = g("data-abrir"))) { e.preventDefault(); abrir(el.dataset.abrir); }
    else if ((el = g("data-fechar"))) { fechar(el.dataset.fechar); if (el.dataset.fechar === "sheet-chat") pararChat(); }
    else if (e.target.classList?.contains("app-overlay")) { fechar(e.target.id); if (e.target.id === "sheet-chat") pararChat(); }
    else if ((el = g("data-ir"))) irPara(el.dataset.ir);
    else if ((el = g("data-chamar"))) definirPreferido(el.dataset.chamar, el.dataset.nome);
    else if ((el = g("data-chat"))) { const p = achar(el.dataset.chat); if (p) abrirChat(p); }
    else if ((el = g("data-avaliar"))) { const p = achar(el.dataset.avaliar); if (p) abrirAvaliacao(p); }
    else if ((el = g("data-repetir"))) { const p = achar(el.dataset.repetir); if (p) repetir(p); }
    else if ((el = g("data-cancelar"))) {
        const p = achar(el.dataset.cancelar); if (!p) return;
        const [hh, mm] = (p.entrada || "00:00").split(":").map(Number), faltaMs = new Date(`${p.data}T00:00:00-03:00`).getTime() + (hh * 60 + mm) * 60_000 - Date.now(), limiteH = rep?.regras?.cancelamentoTardioHoras || 12;
        const aviso = p.status === "aceita" && faltaMs < limiteH * 3_600_000 ? `\n\n⚠️ Faltam menos de ${limiteH} h para o início: o cancelamento gera ADVERTÊNCIA (perde 1 vida) e multa.` : "";
        if (!confirm((p.status === "aceita" ? `Cancelar a aula em ${p.aluno}? O personal que já aceitou será avisado.` : `Cancelar a aula em ${p.aluno}?`) + aviso)) return;
        el.disabled = true;
        try { const r = await chamarFuncao("cancelarAula", { aulaId: p.id }); ok("Aula cancelada."); if (r.infracao) { await carregarRep(); if (!rep.banido) animarPerdaVida(r.infracao); } }
        catch (err) { console.error(err); erro(err.code === "servico-em-andamento" ? "O personal já está no local. Não é possível cancelar." : "Não foi possível cancelar. Se já foi pago, fale com o suporte."); el.disabled = false; }
    }
    else if ((el = g("data-foto"))) { const p = achar(el.dataset.foto); if (p) abrirAuditoria(p); }
    else if (g("btn-relampago") || e.target.closest("#btn-relampago")) abrirRelampago();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") pararChat();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[role=button]")) { e.preventDefault(); e.target.click(); }
});
