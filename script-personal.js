// ============================================================
// PERSONOW — portal do PERSONAL / FREELANCER (a partir dos 16 anos)
// Dados sensíveis, dinheiro, treinamento e status só trafegam pela API do servidor; o Firestore é lido, quase nunca escrito.
// ============================================================
import { chave } from "./portal.js";
import { collection, addDoc, doc, setDoc, getDoc, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getRedirectResult, onAuthStateChanged, reauthenticateWithPopup } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, googleProvider, chamarFuncao, consultar, baixarCSVProtegido, renovarToken, testeAtivo, loginDeTeste, contaDeTeste, entrarComGoogle, mensagemErroAuth, navegadorEmbutido, sairDaConta, aquecerServidor } from "./firebase.js";
import { guardarEmailPendente, resolverAcesso, telaOutroPerfil, telaFalhaTemporaria, telaBloqueado, irParaPainel, limparGuarda } from "./acesso.js";
import { ligarLoginEmail } from "./login-email.js";
import { ligarSeletorDeModo, modoSalvo, gravarModo } from "./entrada.js";
import { pintarRecado } from "./recado.js";
import { iniciarSuporte, pararSuporte } from "./suporte.js";
import { compartilharPosicao } from "./presenca.js";   // contador de usuários online (painel de TI) + posição aproximada para o mapa do aluno
import { ativarPush, desativarPush } from "./push.js";
import { RAIO_KM_AULAS, LOCAL_MOVIMENTO_MIN_KM, ENEAGRAMA_TESTE_URL, ENEAGRAMA_TESTE_ORIGEM, WHATSAPP_SUPORTE, IDADE_MINIMA, NIVEIS } from "./config.js";
import { iniciarTaxas } from "./taxas.js";
import { brl, reaisParaCentavos, TAXAS, esc, fmtData, fmtDataHora, hojeLocal, mascaraCPF, mascaraTelefone, cpfValido, soDigitos, estaPago, valorPersonal, validarNascimento, limitesNascimento, crefValido, normalizarCref, MODALIDADES, CATEGORIAS, categoriaDaModalidade, textoTermos, calcularPreco } from "./core.js";
import { CIDADES, RAIO_KM, acharCidade, rotuloCidade, distanciaKm, cidadeMaisProxima, cidadeDaAula, pontoDaAula, contarPorCidade, filtrarPorRaio, fmtKm, rumoRad, observarPosicao } from "./geo.js";
import { AREAS, AREA, ENEAGRAMA, INSTINTOS, MAX_EXPERIENCIAS, asasDoTipo, codigoEneagrama, lerCodigoEneagrama, eneagramaValido, normalizarExperiencias, gerarPerfil, pontuarOferta, ranquearOfertas } from "./perfil-inteligente.js";
import { agruparCursos, statusCurso } from "./cursos.js";
import { $, dialogo, toast, ok, erro, iniciarTema, alternarTema, ligarMascaras, abrir, fechar, skeleton, vazio, registrarSW, instalarApp, pedirPermissaoNotificacao, notificar } from "./ui.js";
import { iniciar as iniciarJogo, abrirCheckin, abrirCheckout, abrirFaltaAluno, alertaRelampago, manterPosicao, pararPosicao } from "./personal-jogo.js";
import { coracoes, cartaoNivel, listaInfracoes, telaBanido, esconderBanido, animarPerdaVida, chipNivel, medalha, abrirFoto } from "./gamificacao-ui.js";
let usuario = null, pub = {}, priv = {}, hab = { habilitado: false, pendencias: [], treinamento: { concluidos: 0, total: 0, completo: false } }, treino = null, carteiraDados = null;
let ofertas = [], aulas = [], filtroModalidade = "", ordem = "match";
let perfilIA = { experiencias: [], eneagrama: null, palavrasChave: [], bioAuto: true };
let rep = null, repTimer = null;                 // reputação/gamificação
let offUn = null, aulasUn = null, chatUn = null, chatAula = null, qrAtual = null;
let dataCal = new Date(), diaSel = "", prim = { o: true, t: true };
const vistos = new Set(), statusAnt = new Map();

iniciarTema(); registrarSW();
iniciarJogo({ recarregar: () => { carregarRep(); carregarCarteira(); }, subiuNivel: (n) => { ok(`Você subiu para ${NIVEIS.find((x) => x.id === n.para)?.nome || n.para}! 🏆`); } });
ligarMascaras({ cpf: mascaraCPF, tel: mascaraTelefone });
const baseSite = () => location.origin + location.pathname.replace(/[^/]*$/, "");
$("btn-whatsapp").href = `https://wa.me/${WHATSAPP_SUPORTE}`;
$("ajuda-zap").href = `https://api.whatsapp.com/send?phone=${WHATSAPP_SUPORTE}&text=${encodeURIComponent("Olá! Preciso de ajuda no Personow (personal).")}`;
/** Redesenha tudo que depende das taxas. Roda ao abrir e sempre que o admin muda algo (taxas.js). */
function textosTaxas() {
    const pct = (id) => String(Math.round(calcularPreco(id).pct * 10) / 10).replace(".", ",");   // comissão do nível sobre a aula vigente
    $("benef-split").textContent = `Taxa de ${pct("bronze")}% no Bronze, caindo até ${pct("platina")}% no Platina — quanto mais chamados, mais você ganha. Aula de ${brl(TAXAS.precoCentavos)} (aulas de ${TAXAS.horasMin} a ${TAXAS.horasMax} horas), sem mensalidade`;
    $("ajuda-split").textContent = `A aula é de ${brl(TAXAS.precoCentavos)} e a taxa da plataforma depende do seu nível: ${NIVEIS.map((n) => `${n.nome} ${pct(n.id)}% (a partir de ${n.minConcluidos} chamados)`).join(", ")}. O valor entra na carteira depois do pagamento do aluno, fica alguns dias em carência e depois você saca por Pix. Cada aula tem de ${TAXAS.horasMin} a ${TAXAS.horasMax} horas, com até ${TAXAS.maxSemana} aulas por semana na mesmo aluno. Faça check-in a até 100 m do aluno e finalize com a foto do local da aula. Desistir ou faltar em cima da hora gera advertência e multa; com 3 advertências a conta é bloqueada. Sem concluir chamados por 2 meses, o nível cai. Para aceitar aulas é preciso concluir o capacitação Personow.`;
$("nota-taxa-mp").textContent = "Pagamentos estornados ou contestados pelo aluno são descontados da carteira.";
$("termos-texto").innerHTML = textoTermos("personal");
}
iniciarTaxas(textosTaxas);

// ---------- indicação (?ref=) ----------
try { const r = new URLSearchParams(location.search).get("ref"); if (r) localStorage.setItem(chave("ref"), r.replace(/[^\w-]/g, "").slice(0, 40)); } catch (e) {}
try { const et = new URLSearchParams(location.search).get("et"); if (et) localStorage.setItem(chave("et"), et.replace(/[^\w.-]/g, "").slice(0, 600)); } catch (e) {}   // link assinado do teste (Eneagrama automático)
const refRecebido = () => { try { return localStorage.getItem(chave("ref")) || ""; } catch (e) { return ""; } };

// ---------- login ----------
const msgAuth = mensagemErroAuth;   // firebase.js: mensagens em português para todos os erros de login
const TXT_LOGIN = {
    entrar: { titulo: "Entrar na minha conta", sub: "Entre com a sua conta Google ou com e-mail e senha.", botao: "Entrar com Google" },
    criar: { titulo: "Comece a pegar aulas", sub: refRecebido() ? "🎁 Você foi convidado por um personal. Cadastre-se e faça seu primeira aula!" : "Cadastro rápido com Google ou e-mail. Depois de aprovado (com conferência do CREF), você vê as aulas da região.", botao: "Criar conta com Google" }
};
let emailUI = null;
const seletor = ligarSeletorDeModo({ textos: TXT_LOGIN, aoMudar: (m) => emailUI?.atualizarModo(m) });
const resetarLogin = () => { const b = $("btn-login"); delete b.dataset.ocupado; $("btn-login-txt").textContent = TXT_LOGIN[seletor.atual()].botao; seletor.atualizarBotao(); };
const abrirTermos = (e) => { e.preventDefault(); abrir("sheet-termos"); };
$("link-termos").addEventListener("click", abrirTermos); $("link-termos2").addEventListener("click", abrirTermos);
let aguardandoTermos = false, vigiaLogin = null;                                          // clicou em "Criar conta" sem aceitar: abrimos os Termos e, ao aceitar, seguimos para o Google
emailUI = ligarLoginEmail({ modo: () => seletor.atual(), termosAceitos: () => $("check-termos").checked, pedirTermos: () => { aguardandoTermos = "email"; abrir("sheet-termos"); } });
$("btn-aceitar-termos").addEventListener("click", () => { $("check-termos").checked = true; $("c-termos").checked = true; seletor.atualizarBotao(); fechar("sheet-termos"); if (aguardandoTermos) { const via = aguardandoTermos; aguardandoTermos = false; if (via === "email") $("form-email").requestSubmit(); else $("btn-login").click(); } });
$("btn-login").addEventListener("click", async () => {
    const b = $("btn-login");
    if (seletor.atual() === "criar" && !$("check-termos").checked) { aguardandoTermos = true; abrir("sheet-termos"); return; }
    gravarModo(seletor.atual());                                           // lembra a intenção (entrar × criar) até o fim do login
    b.dataset.ocupado = "1"; b.disabled = true; $("btn-login-txt").textContent = "Abrindo o Google…";
    // Vigia: se nada acontecer (popup travado, navegador embutido do Instagram/WhatsApp, servidor acordando), o botão volta a funcionar.
    clearTimeout(vigiaLogin); vigiaLogin = setTimeout(() => { if (b.dataset.ocupado && !usuario) { resetarLogin(); erro("Não conseguimos concluir o login. Tente de novo — se continuar, abra o site no Chrome ou Safari."); } }, 90_000);
    try { const cred = await entrarComGoogle(); if (cred) $("btn-login-txt").textContent = "Verificando sua conta…"; else { clearTimeout(vigiaLogin); resetarLogin(); } }
    catch (e) { clearTimeout(vigiaLogin); const m = msgAuth(e); if (m) erro(m); resetarLogin(); }
});
aquecerServidor();
if (navegadorEmbutido()) { try { toast("Dica: o Google não deixa entrar por este navegador. Abra o site no Chrome ou Safari."); } catch (e) {} }
testeAtivo().then((a) => { $("bloco-teste").hidden = !a; });
$("btn-login-teste").addEventListener("click", async () => {
    const b = $("btn-login-teste"); b.disabled = true;
    try { await loginDeTeste("personal"); } catch (e) { console.error(e); erro("Não foi possível entrar no modo de teste."); b.disabled = false; }
});
getRedirectResult(auth).catch((e) => { const m = msgAuth(e); if (m) erro(m); });
const sair = async () => { compartilharPosicao(false); clearInterval(repTimer); pararPosicao(); esconderBanido(); rep = null; offUn?.(); aulasUn?.(); chatUn?.(); pararPings(); pararHab(); pararDeAcompanhar(); pos = null; posFonte = ""; await desativarPush(); pararSuporte(); await sairDaConta(); };
$("btn-sair").addEventListener("click", async () => { if (confirm("Deseja sair do portal?")) await sair(); });
$("btn-cadastro-sair").addEventListener("click", sair);

const tela = (id) => document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
onAuthStateChanged(auth, async (u) => {
    usuario = u;
    if (!u) { compartilharPosicao(false); clearInterval(repTimer); pararPosicao(); pub = {}; priv = {}; hab = { habilitado: false, pendencias: [], treinamento: { concluidos: 0, total: 0, completo: false } }; offUn?.(); aulasUn?.(); pararPings(); pararHab(); habCats = null; pararDeAcompanhar(); pararSuporte(); tela("screen-login"); resetarLogin(); prim = { o: true, t: true }; return; }
    if (guardarEmailPendente(u, trocarConta)) return;                          // e-mail/senha ainda sem confirmação
    try { await entrar(u); } catch (e) { console.error(e); resetarLogin(); erro("Não foi possível carregar seu cadastro. Tente novamente."); }
});

/**
 * O perfil ativo é decidido pelo SERVIDOR (/sessao) para o portal aberto — nunca pelo navegador.
 * Perfil errado ou conta com vários perfis NÃO derruba a sessão: mostra a tela de escolha (painel certo / outra conta).
 */
const trocarConta = async () => { await sair(); };
const mostrarOutroPerfil = (r) => telaOutroPerfil({ portal: "personal", perfis: r?.perfis, email: usuario?.email, trocarConta });
async function entrar(u) {
    pub = {}; priv = {};                                                // nunca herdar dados (CPF/nascimento) de outra conta usada antes neste navegador
    let r;
    try { r = await resolverAcesso("personal"); }
    catch (e) { console.warn(e); return telaFalhaTemporaria({ tentarDeNovo: () => entrar(u), trocarConta }); }
    if (r.estado === "outro-perfil" || r.estado === "escolher") {
        if (r.sugerido && irParaPainel(r.sugerido, "personal")) return;      // conta de aluno: vai DIRETO ao painel do aluno (com trava anti-loop)
        return mostrarOutroPerfil(r);
    }
    if (r.estado !== "cadastro" && await carregarRep() && rep.banido) return;                // conta banida: só a tela vermelha com o motivo
    const s = r.estado === "cadastro" ? null : await getDoc(doc(db, "personais", u.uid));
    if (!s?.exists()) { if (!(await confirmarNovaConta(u))) return; return abrirCadastro(false); }
    pub = s.data();
    if (pub.status === "bloqueado") return telaBloqueado({ texto: pub.recado?.texto, trocarConta });   // tela fixa; antes derrubava a sessão e a pessoa voltava ao login em loop
    await Promise.all([carregarPrivado(), carregarHabilitacao()]);
    if (!priv.nascimento || !priv.temCpf) return abrirCadastro(true);   // conta antiga ou dados faltando
    tela("screen-dashboard"); limparGuarda(); iniciarSuporte(u);
    $("btn-teste-reset").hidden = !(await contaDeTeste());
    montarModalidadesPrefs(); montarFormIA(); pintarPerfil(); escutar(); carregarCarteira(); carregarTreino(); carregarPerfilIA(); carregarHabCats();
    clearInterval(repTimer); repTimer = setInterval(() => { if (!document.hidden) carregarRep(); }, 90_000); manterPosicao();
    compartilharPosicao(() => pub.status === "ativo");          // aparece no mapa dos alunos (posição aproximada) enquanto o painel está aberto; só aprovado
    if (abaOfertasAtiva()) iniciarGeo();
    window.scrollTo(0, 0);
}

/** Conta Google SEM cadastro de personal. Nunca cria sozinho: em "Criar" segue para o formulário; em "Entrar" pergunta o que a pessoa quer. */
async function confirmarNovaConta(u) {
    if (modoSalvo() === "criar") return true;
    const quer = await dialogo({
        icone: "👷", titulo: "Ainda não existe cadastro de personal", texto: `A conta ${u.email || "Google"} não tem cadastro. Quer criar uma conta de personal com ela ou entrar com outra conta Google?`,
        acoes: [{ rotulo: "Criar conta de personal", valor: "criar" }, { rotulo: "Entrar com outra conta", tipo: "ghost", valor: "outra" }]
    });
    if (quer === "criar") { gravarModo("criar"); return true; }
    await trocarConta(); return false;
}

/** CPF do cadastro já pertence a outra conta: em vez de só travar com mensagem de erro, oferece entrar na conta existente. */
async function aoCpfDuplicado(err) {
    const email = err.detalhe?.emailMascarado, dica = email ? ` O cadastro foi feito com a conta ${email}.` : "";
    const escolha = await dialogo({
        icone: "🔐", titulo: "Este CPF já possui uma conta", texto: `Deseja fazer login com ela?${dica}`,
        acoes: [{ rotulo: "Sim, entrar com a conta existente", valor: "entrar" }, { rotulo: "Corrigir o CPF", tipo: "ghost", valor: "corrigir" }, { rotulo: "Falar com o suporte", tipo: "ghost", valor: "suporte" }]
    });
    if (escolha === "entrar") {
        gravarModo("entrar"); await sair();                                  // encerra ESTA sessão e volta à tela de entrada (o seletor do Google abre no clique)
        seletor.definir("entrar");
        $("login-sub").textContent = email ? `Escolha a conta Google do seu cadastro anterior (${email}).` : "Escolha a conta Google do seu cadastro anterior.";
        toast("Toque em “Entrar com Google” e escolha a conta que você já usou.", "info");
    } else if (escolha === "corrigir") { $("c-cpf").focus(); $("c-cpf").select?.(); }
    else if (escolha === "suporte") window.open("https://api.whatsapp.com/send?phone=" + WHATSAPP_SUPORTE + "&text=" + encodeURIComponent("Olá! Meu CPF aparece como já cadastrado no Personow e preciso de ajuda para acessar minha conta."), "_blank", "noopener");
}
/** Reputação: nível, vidas, advertências. Detecta perda de vida/subida de nível e mostra a animação. */
async function carregarRep() {
    const antes = rep;
    try { rep = await consultar("reputacao"); } catch (e) {
        if (e.code === "conta-banida" || e.status === 403) { rep = { banido: true, vidas: 0, infracoes: [], banidoMotivo: "Conta bloqueada." }; } else { console.warn(e); return false; }
    }
    if (rep.banido) { pararPosicao(); clearInterval(repTimer); telaBanido(rep, sair); return true; }
    if (antes && !antes.banido) {
        if (rep.vidas < antes.vidas) { const i = (rep.infracoes || []).find((x) => x.status !== "revogada"); animarPerdaVida({ ...(i || {}), vidas: rep.vidas }); }
        if (antes.nivel && rep.nivel && rep.nivel.id !== antes.nivel.id && NIVEIS.findIndex((n) => n.id === rep.nivel.id) > NIVEIS.findIndex((n) => n.id === antes.nivel.id)) ok(`Você subiu para ${rep.nivel.nome}! 🏆`);
    }
    pintarRep(); return true;
}
function pintarRep() {
    if (!rep || rep.banido) return;
    const n = rep.nivel;
    $("rep-home").innerHTML = `<div class="vidas-linha"><div>${chipNivel(n.id, n.nome)}<div class="vidas-txt" style="margin-top:6px">Taxa ${n.comissaoPct}% · <b>${rep.concluidos}</b> chamados</div></div><div style="text-align:right">${coracoes(rep.vidas, rep.vidasMax)}<div class="vidas-txt"><b>${rep.vidas}</b> de ${rep.vidasMax} vidas</div></div></div>`;
    $("rep-corpo").innerHTML = cartaoNivel(rep) + `<div class="glass-card mt"><div class="vidas-linha"><h4>Suas vidas</h4>${coracoes(rep.vidas, rep.vidasMax)}</div><p class="muted small mt">Cada advertência apaga um coração e gera multa. Na ${rep.vidasMax}ª, a conta é bloqueada. Desistir ou faltar com menos de ${rep.regras.cancelamentoTardioHoras} h de antecedência conta como infração.</p><div class="mt">${listaInfracoes(rep.infracoes)}</div></div>`;
    $("menu-rep-sub").textContent = `${n.nome} · ${rep.vidas}/${rep.vidasMax} vidas`;
}
const carregarPrivado = async () => { try { priv = await consultar("perfil/privado"); } catch (e) { priv = {}; } };
const carregarHabilitacao = async () => { try { hab = await consultar("habilitacao"); } catch (e) { console.warn(e); } };

// ---------- cadastro (primeiro acesso) e conclusão de dados ----------
let modoCompletar = false;
function abrirCadastro(completar) {
    modoCompletar = completar; tela("screen-cadastro");
    const lim = limitesNascimento(); $("c-nasc").min = lim.min; $("c-nasc").max = lim.max;
    $("c-nasc-dica").textContent = `Cadastro permitido a partir dos ${IDADE_MINIMA} anos.`;
    // Cadastro novo: tudo editável e vazio. Só em "completar dados" (conta antiga) o que já está gravado aparece travado — e nunca em conta nova.
    const d = completar ? priv : {};
    $("c-nasc").value = d.nascimento || ""; $("c-nasc").readOnly = !!d.nascimento;
    $("c-cpf").value = d.cpfMascarado || ""; $("c-cpf").readOnly = !!d.temCpf;
    $("c-cref").value = d.cref || pub.cref || ""; $("c-cref").readOnly = !!(completar && pub.cref);
    $("c-tel").value = d.telefone ? mascaraTelefone(d.telefone) : "";
    $("c-termos").checked = $("check-termos").checked; $("c-termos").closest(".check-line").hidden = completar;
    $("btn-cadastrar").textContent = completar ? "Salvar e continuar" : "Concluir cadastro";
}
const dadosGravados = () => (modoCompletar ? priv : {});                // em cadastro novo não existe dado gravado
$("btn-cadastrar").addEventListener("click", async () => {
    document.querySelectorAll("#screen-cadastro .msg-erro").forEach((x) => (x.textContent = ""));
    let falhou = false; const e = (id, m) => { $(id).textContent = m; falhou = true; };
    const g = dadosGravados(), nasc = $("c-nasc").value, cpf = soDigitos($("c-cpf").value), tel = soDigitos($("c-tel").value), vn = validarNascimento(nasc);
    if (vn.erro) e("e-c-nasc", vn.erro);
    if (!g.temCpf && !cpfValido(cpf)) e("e-c-cpf", cpf ? "CPF inválido. Confira os 11 dígitos." : "Informe seu CPF.");
    if (tel.length < 10 || tel.length > 11) e("e-c-tel", "Informe DDD + número.");
    const cref = normalizarCref($("c-cref").value), ec = crefValido(cref);
    if (ec && !(modoCompletar && pub.cref)) e("e-c-cref", ec);
    if (!modoCompletar && !$("c-termos").checked) { erro("Aceite os Termos de Uso para continuar."); falhou = true; }
    if (falhou) return;
    const b = $("btn-cadastrar"), html = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
        const corpo = { ...(g.nascimento ? {} : { nascimento: nasc }), ...(g.temCpf ? {} : { cpf }), telefone: tel };
        const comCref = { ...corpo, ...(pub.cref ? {} : { cref }) };
        if (modoCompletar) { await chamarFuncao("perfil/personal/privado", corpo, "PUT"); if (!pub.cref) await chamarFuncao("perfil/personal/cref", { cref }, "PUT"); }
        else await chamarFuncao("cadastro/personal", { ...comCref, termos: true, nome: usuario.displayName || "", indicadoPor: refRecebido(), eneagramaToken: (() => { try { return localStorage.getItem(chave("et")) || undefined; } catch (e) { return undefined; } })() });
        await renovarToken(); await entrar(usuario);
    } catch (err) {
        console.error(err);
        if (err.code === "papel-conflito") return mostrarOutroPerfil({ perfis: [err.detalhe?.tem || err.detalhe?.sugerido].filter(Boolean) });   // corrida: a conta já tem o outro perfil
        if (err.code === "cpf-duplicado") { $("e-c-cpf").textContent = "Este CPF já possui uma conta."; return aoCpfDuplicado(err); }
        const m = { "cref-duplicado": "Este CREF já está cadastrado em outra conta.", "cref-invalido": err.message, "idade-minima": `É preciso ter pelo menos ${IDADE_MINIMA} anos para se cadastrar.`, "dado-travado": err.message, "limite-requisicoes": err.message }[err.code];
        erro(m || err.message || "Não foi possível concluir o cadastro.");
    } finally { b.disabled = false; b.innerHTML = html; }
});

// ---------- estado derivado ----------
const ativo = () => pub.status === "ativo";
const habilitado = () => hab.habilitado === true;
const nomeProm = () => pub.nome || usuario.displayName || "Personal";
const PENDENCIA = { aprovacao: "aguardar a aprovação do cadastro", nascimento: "informar a data de nascimento", "idade-minima": `ter ${IDADE_MINIMA} anos ou mais`, cref: "informar o número do CREF", treinamento: "concluir o capacitação Personow" };
const textoPendencias = () => (hab.pendencias || []).map((p) => PENDENCIA[p] || p).join(", ");

// ---------- perfil + onboarding ----------
function pintarPerfil() {
    pintarRecado($("sub-home").closest(".page-head"), pub.recado);
    const nome = nomeProm(), ini = nome[0].toUpperCase();
    $("nome-home").textContent = nome.split(" ")[0]; $("nome-menu").textContent = nome;
    for (const id of ["avatar-home", "avatar-menu"]) { const a = $(id); a.textContent = ini; if (pub.fotoGoogle) a.innerHTML = `<img src="${esc(pub.fotoGoogle)}" alt="" referrerpolicy="no-referrer">`; }
    if ($("d-cref")) $("d-cref").value = pub.cref || "";
    const b = $("badge-status"); b.textContent = ativo() ? "Ativo ✓" : "Em análise"; b.className = "badge " + (ativo() ? "green" : "");
    $("sub-home").textContent = habilitado() ? "Tudo pronto para pegar aulas." : `Para liberar as aulas: ${textoPendencias() || "aguarde"}.`;
    $("i-rating").innerHTML = pub.ratingQtd ? `<span class="stars" style="font-size:20px">★</span> ${pub.ratingMedia.toFixed(1)} <small class="muted" style="font-size:12px">(${pub.ratingQtd})</small>` : "—";
    $("link-indicar").value = `${baseSite()}personal.html?ref=${pub.refCode || ""}`;
    $("indicar-txt").textContent = `Mande seu link para um amigo personal. Quando ele concluir o primeira aula, você ganha um bônus de indicação. Depois disso, tudo segue o padrão normal.`;
    const t = hab.treinamento || { concluidos: 0, total: 0, completo: false };
    const itens = [
        { ok: true, t: "Cadastro criado" },
        { ok: !!priv.nascimento && !!priv.temCpf, t: "Dados pessoais (nascimento e CPF)", abrir: "sheet-perfil" },
        { ok: !!pub.cref, t: "Registro no CREF", abrir: "sheet-perfil" },
        { ok: !!priv.pix, t: "Cadastrar chave Pix (para sacar)", abrir: "sheet-pix" },
        { ok: t.completo, t: t.total ? `Capacitação Personow (${t.concluidos}/${t.total})` : "Capacitação Personow", ir: "tab-treino" },
        { ok: catsOk().size > 0, t: "Habilitar-se em uma categoria (vídeo + avaliação)", ir: "tab-treino" },
        { ok: ativo(), t: ativo() ? "Cadastro aprovado" : "Aguardar aprovação da equipe" }
    ];
    const feitos = itens.filter((i) => i.ok).length, pct = Math.round((feitos / itens.length) * 100);
    $("card-onboarding").hidden = feitos === itens.length;
    $("ob-pct").textContent = pct + "%"; $("ob-bar").style.width = pct + "%";
    $("ob-lista").innerHTML = itens.map((i) => `<div class="todo ${i.ok ? "feito" : ""}" ${i.abrir ? `data-abrir="${i.abrir}"` : ""} ${i.ir ? `data-ir="${i.ir}"` : ""} role="${i.ok || (!i.abrir && !i.ir) ? "listitem" : "button"}" ${!i.ok && (i.abrir || i.ir) ? 'tabindex="0"' : ""}><span class="c">${i.ok ? "✓" : ""}</span><span>${esc(i.t)}</span>${!i.ok && (i.abrir || i.ir) ? '<span class="go">›</span>' : ""}</div>`).join("");
    // "Meus dados": CPF e nascimento, uma vez gravados, só o suporte altera
    $("d-nome").value = pub.nome || ""; $("d-nome").readOnly = pub.status !== "pendente";
    $("d-cpf").value = priv.cpfMascarado || ""; $("d-cpf").readOnly = true; $("d-cpf-dica").textContent = priv.temCpf ? "Para alterar o CPF, fale com o suporte." : "";
    const lim = limitesNascimento(); $("d-nasc").min = lim.min; $("d-nasc").max = lim.max; $("d-nasc").value = priv.nascimento || ""; $("d-nasc").readOnly = true; $("d-nasc-dica").textContent = priv.nascimento ? "Para alterar, fale com o suporte." : "";
    $("d-tel").value = priv.telefone ? mascaraTelefone(priv.telefone) : ""; $("d-cidade").value = pub.cidade || ""; $("d-bio").value = pub.bio || "";
    pintarSelos();
    $("x-atual").textContent = priv.pix ? `Chave atual: ${priv.pix.tipo} ${priv.pix.chaveMascarada}` : "Nenhuma chave cadastrada.";
    if (pub.especialidade) { const o = MODALIDADES.find((s) => s.label === pub.especialidade || s.v === pub.especialidade); if (o) $("pf-esp").value = o.v; }
    $("pf-ini").value = pub.disponibilidade?.inicio || "06:00"; $("pf-fim").value = pub.disponibilidade?.fim || "22:00";
    $("pf-min").value = pub.valorMin ? (pub.valorMin / 100).toFixed(2).replace(".", ",") : "";
}
function montarModalidadesPrefs() {
    $("pf-esp").innerHTML = MODALIDADES.map((s) => `<option value="${esc(s.v)}">${esc(s.label)}</option>`).join("");
    $("filtro-modalidade").innerHTML = `<button class="pill sel" data-s="">Todos</button>` + MODALIDADES.map((s) => `<button class="pill" data-s="${esc(s.v)}">${s.ico} ${esc(s.label)}</button>`).join("");
}

// ---------- dados em tempo real ----------
function escutar() {
    offUn?.(); aulasUn?.(); prim = { o: true, t: true };
    $("lista-ofertas").innerHTML = skeleton(3); $("lista-proximos").innerHTML = skeleton(2);
    // Ofertas abertas só são legíveis para quem concluiu o treinamento (regra do Firestore + claim "treinado")
    if (hab.treinamento?.completo) {
        offUn = onSnapshot(query(collection(db, "aulas"), where("status", "==", "aberta")), (snap) => {
            if (habilitado()) snap.docChanges().forEach((c) => { if (c.type === "added" && !prim.o && !vistos.has(c.doc.id)) { const x = c.doc.data(); if (valorFiltro(x)) { if (x.tipo === "relampago") alertaRelampago(x, () => irPara("tab-ofertas")); else notificar("Nova oferta 🔔", `${x.aluno} · ${brl(valorOferta(x))} para você`); } } vistos.add(c.doc.id); });
            prim.o = false;
            ofertas = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderOfertas();
        }, (e) => { ofertas = []; renderOfertas(); if (e.code !== "permission-denied") console.warn(e.code); });
    } else { ofertas = []; renderOfertas(); }
    aulasUn = onSnapshot(query(collection(db, "aulas"), where("personalUid", "==", usuario.uid)), (snap) => {
        aulas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
        if (!prim.t) aulas.forEach((t) => { const a = statusAnt.get(t.id); if (a === "aceita" && estaPago(t)) { notificar("Pagamento recebido 💸", `${t.aluno} · ${brl(valorPersonal(t))} entram na sua carteira.`); carregarCarteira(); } if (a && a !== "cancelada" && t.status === "cancelada") notificar("Aula cancelada", `${t.aluno} cancelou a aula.`); if (a && estaPago({ status: a }) && t.status === "estornada") carregarCarteira(); });
        aulas.forEach((t) => statusAnt.set(t.id, t.status)); prim.t = false;
        renderTudo();
    }, (e) => { aulas = []; renderTudo(); if (e.code === "permission-denied") erro("Sem permissão para ler aulas."); });
}
const valorFiltro = (x) => valorOferta(x) >= (pub.valorMin || 0);
const valorOferta = (x) => rep?.nivel ? calcularPreco(rep.nivel.id, x.bonusCentavos || 0).personal : valorPersonal(x);   // oferta aberta: pelo nível de quem vai aceitar
const meu = (t) => valorPersonal(t);   // líquido do personal: único valor exibido neste portal
function renderTudo() { renderProximos(); renderAgenda(); renderCarteira(); renderCalendario(); renderConversas(); if (diaSel) renderDia(); }

// ---------- ofertas: geolocalização em tempo real, contadores por cidade, raio de 20 km e ranking ----------
const CHAVE_CIDADE = chave("cidade_manual");
let pos = null, posFonte = "", geoEstado = "idle", geoErro = "", pararGeo = null, modo = "perto", filtroCidade = "", ofertasVistas = new Map();
const ORDENS = ["match", "perto", "valor", "data"], ROT_ORDEM = { match: "Melhor match ✨", perto: "Mais perto 📍", valor: "Maior valor ↓", data: "Mais cedo ↑" };
const cidadeManual = () => { try { return localStorage.getItem(CHAVE_CIDADE) || ""; } catch (e) { return ""; } };
const cidadeFallback = () => acharCidade(cidadeManual()) || acharCidade(pub.cidade);
const abaOfertasAtiva = () => $("tab-ofertas").classList.contains("active");

function definirPosicao(p, fonte) {
    const mudou = !pos || fonte !== posFonte || distanciaKm(pos, p) >= LOCAL_MOVIMENTO_MIN_KM;   // não redesenha a cada microvariação do GPS
    pos = p; posFonte = fonte;
    if (mudou) renderOfertas(); else desenharGeo();
}
/** Chamado ao abrir "Ofertas": pede a posição (o navegador mostra o aviso de permissão) e acompanha em tempo real. */
function iniciarGeo() {
    if (pararGeo || !habilitado()) return;
    if (!pos) geoEstado = "buscando"; desenharGeo();
    pararGeo = observarPosicao(
        (p) => { geoEstado = "gps"; geoErro = ""; definirPosicao(p, "gps"); },
        (e) => {
            if (e.code === "tempo" && pos) return;                      // falha momentânea com posição já conhecida: ignora
            pararGeo?.(); pararGeo = null; geoErro = e.message; geoEstado = e.code === "negado" ? "negado" : "indisponivel";
            const c = posFonte === "gps" ? null : cidadeFallback();
            if (c) definirPosicao({ lat: c.lat, lng: c.lng }, "cidade");
            else if (!pos) { modo = "cidades"; atualizarSeg(); renderOfertas(); }
            else desenharGeo();
        });
}
function pararDeAcompanhar() { pararGeo?.(); pararGeo = null; if (geoEstado === "buscando") geoEstado = "idle"; }
const reiniciarGeo = () => { pararDeAcompanhar(); geoEstado = "buscando"; if (posFonte === "cidade") { pos = null; posFonte = ""; } iniciarGeo(); };

function desenharGeo() {
    const el = $("geo-status"); if (!el) return;
    const perto = pos ? cidadeMaisProxima(pos, 25) : null, nomePerto = perto ? rotuloCidade(perto) : "";
    const seletor = `<select id="geo-cidade" aria-label="Escolher cidade manualmente"><option value="">Escolher outra cidade…</option>${CIDADES.map((c) => `<option value="${esc(rotuloCidade(c))}">${esc(rotuloCidade(c))}</option>`).join("")}</select>`;
    let h;
    if (geoEstado === "buscando" && !pos) h = `<div class="linha"><span class="geo-pulso warn"></span><div class="grow"><strong>Buscando sua localização…</strong><br><span class="muted">Permita o acesso quando o navegador perguntar.</span></div></div>`;
    else if (posFonte === "gps") h = `<div class="linha"><span class="geo-pulso"></span><div class="grow"><strong>Localização em tempo real</strong>${nomePerto ? ` · ${esc(nomePerto)}` : ""}<br><span class="muted">Mostrando aulas em até ${RAIO_KM} km de você.</span></div><button class="btn btn-ghost btn-sm" data-geo="atualizar">Atualizar</button></div>`;
    else if (posFonte === "cidade") h = `<div class="linha"><span class="geo-pulso warn"></span><div class="grow"><strong>Usando ${esc(nomePerto || "sua cidade")}</strong><br><span class="muted">${esc(geoErro || "Sem GPS.")} Ative o GPS para ver as aulas ao seu redor.</span></div><button class="btn btn-ghost btn-sm" data-geo="atualizar">Ativar GPS</button></div>${seletor}`;
    else h = `<div class="linha"><span class="geo-pulso off"></span><div class="grow"><strong>Localização desligada</strong><br><span class="muted">${esc(geoErro || "Ative para ver aulas perto de você.")}${geoEstado === "negado" ? " Libere em Configurações do navegador → Localização (cadeado ao lado do endereço)." : ""}</span></div><button class="btn btn-ghost btn-sm" data-geo="atualizar">Tentar de novo</button></div>${seletor}`;
    el.innerHTML = h;
}
function atualizarSeg() { document.querySelectorAll("#seg-modo button").forEach((b) => { const on = b.dataset.modo === modo; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); }); }

const ofertasBase = () => ofertas.filter((x) => (x.tipo !== "relampago" || (x.expiraEm?.toMillis?.() || 0) > Date.now()) && x.data >= hojeLocal() && valorFiltro(x));   // relâmpago vencido some
function desenharChips(base) {
    const c = contarPorCidade(base), todas = modo === "cidades" && !filtroCidade;
    $("chips-cidades").innerHTML = `<button class="pill city${todas ? " sel" : ""}" data-cidade="">Todas<b>${base.length}</b></button>` + c.map((x) => `<button class="pill city${modo === "cidades" && filtroCidade === x.cidade ? " sel" : ""}" data-cidade="${esc(x.cidade)}">${esc(x.cidade.replace(/ - [A-Z]{2}$/, ""))}<b>${x.aulas}</b><small>${x.aulas === 1 ? "aula" : "aulas"}</small></button>`).join("");
}
function cartaoOferta(x, compacto = false) {
    const m = x.match, paraMim = x.personalPreferido && x.personalPreferido === usuario.uid, cid = cidadeDaAula(x), rel = x.tipo === "relampago";
    const resta = rel && x.expiraEm?.toMillis ? Math.max(0, x.expiraEm.toMillis() - Date.now()) : 0;
    const local = cid || x.distKm != null ? `<span class="dist-tag">📍 ${esc(cid)}${x.distKm != null && Number.isFinite(x.distKm) ? `${cid ? " · " : ""}${fmtKm(x.distKm)}` : ""}</span>` : "";
    const anel = m?.score != null ? `<div class="match ${m.nivel}" style="--p:${m.score}" title="Compatibilidade com você"><b>${m.score}%</b><span>match</span></div>` : "";
    if (compacto) return `<article class="card sug-card" data-det="${esc(x.id)}" role="button" tabindex="0"><div class="sug-top">${anel || "<span></span>"}<strong style="color:var(--green)">${brl(valorOferta(x))}</strong></div><h4>${esc(x.aluno)}</h4><div class="meta">${fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)}</div>${local}</article>`;
    const cat = categoriaDaModalidade(x.foco), trav = !catsOk().has(cat), nomeCat = CATEGORIAS[cat]?.titulo || x.foco;
    const rodape = trav ? `<div class="trava"><span aria-hidden="true">🔒</span><span>Exige habilitação em ${esc(nomeCat)}</span></div><div class="acoes"><button class="btn btn-ghost btn-sm" data-det="${esc(x.id)}">Detalhes</button><button class="btn btn-ghost btn-sm" data-hab-iniciar="${esc(cat || "")}">Habilitar-me em ${esc(nomeCat)}</button></div>`
        : `<div class="acoes"><button class="btn btn-ghost btn-sm" data-det="${esc(x.id)}">Detalhes</button><button class="btn btn-primary btn-sm" data-aceitar="${esc(x.id)}">Aceitar aula</button></div>`;
    return `<article class="card aula oferta${trav ? " travada" : ""}${rel ? " relampago" : ""}"><div class="topo"><div class="grow"><h4>${esc(x.aluno)}</h4><div class="meta">${rel ? "Hoje" : fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)}</div>${local}${rel ? ' <span class="badge badge-raio">⚡ Relâmpago</span>' : ""}${paraMim ? ' <span class="badge green">Aula para você</span>' : ""}</div>${anel}</div>
        ${rel && x.observacao ? `<p class="small muted">${esc(x.observacao)}</p>` : ""}
        ${m?.razoes?.length ? `<div class="razoes">${m.razoes.map((r) => `<span>${esc(r)}</span>`).join("")}</div>` : ""}
        <div class="ganho"><span>Você recebe<br><small class="muted">aula${x.minutos ? ` · ${String(Math.round(x.minutos / 6) / 10).replace(".", ",")} h` : ""}${x.bonusCentavos ? ` · <span class="bonus-tag">inclui bônus ${brl(x.bonusCentavos)}</span>` : ""}${rel ? ` · expira em <span class="contagem" data-expira="${x.expiraEm?.toMillis?.() || 0}">${Math.ceil(resta / 60000)} min</span>` : ""}</small></span><strong>${brl(valorOferta(x))}</strong></div>
        ${rodape}</article>`;
}
function renderOfertas() {
    const el = $("lista-ofertas");
    if (!usuario) return;
    if (!habilitado()) {
        $("dot-ofertas").hidden = true; $("sugestoes").hidden = true; $("chips-cidades").innerHTML = ""; $("geo-status").hidden = true; $("seg-modo").hidden = true;
        el.innerHTML = vazio("🔒", "Ofertas liberadas após os requisitos", `Falta: ${textoPendencias() || "concluir seu cadastro"}.`, !hab.treinamento?.completo ? '<button class="btn btn-primary mt" data-ir="tab-treino">Ir para o treinamento</button>' : "");
        return;
    }
    $("geo-status").hidden = false; $("seg-modo").hidden = false; atualizarSeg();
    const base = ofertasBase(); desenharChips(base); desenharGeo();
    let l = base.filter((x) => !filtroModalidade || x.foco === filtroModalidade);
    if (modo === "perto") l = pos ? filtrarPorRaio(l, pos) : [];
    else {
        if (filtroCidade) l = l.filter((x) => cidadeDaAula(x) === filtroCidade);
        l = l.map((x) => { const d = pos ? distanciaKm(pos, pontoDaAula(x)) : Infinity; return Number.isFinite(d) ? { ...x, distKm: d } : x; });
    }
    let rk = ranquearOfertas(l, { experiencias: perfilIA.experiencias, eneagrama: perfilIA.eneagrama, fmtKm });
    if (ordem === "perto") rk.sort((a, b) => (a.distKm ?? 1e9) - (b.distKm ?? 1e9));
    else if (ordem === "valor") rk.sort((a, b) => valorPersonal(b) - valorPersonal(a) || (b.match.score ?? -1) - (a.match.score ?? -1));
    else if (ordem === "data") rk.sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
    rk.sort((a, b) => (b.tipo === "relampago") - (a.tipo === "relampago"));          // chamados relâmpago sempre no topo (ordenação estável mantém o resto)
    // Só pode ACEITAR oferta de categoria em que está habilitado (o servidor confere de novo). As demais ficam no fim, travadas.
    const habOk = catsOk(), liberada = (x) => habOk.has(categoriaDaModalidade(x.foco));
    rk = [...rk.filter(liberada), ...rk.filter((x) => !liberada(x))];
    const nLib = rk.filter(liberada).length;
    ofertasVistas = new Map(rk.map((o) => [o.id, o]));
    $("dot-ofertas").hidden = !nLib; $("dot-ofertas").textContent = nLib;
    // "Sugeridas para você": as melhores do ranking (só com pelo menos 2 sinais conhecidos, senão o score não diz nada)
    const top = ordem === "match" ? rk.filter((o) => liberada(o) && o.match.nivel === "alto" && o.match.conhecidos >= 2).slice(0, 3) : [];
    $("sugestoes").hidden = !top.length || rk.length < 2;
    if (top.length) $("sugestoes").innerHTML = `<div class="section-title" style="margin-top:0">✨ Sugeridas para você</div><div class="sug-row">${top.map((o) => cartaoOferta(o, true)).join("")}</div>`;
    const semPerfil = !perfilIA.experiencias.length && !perfilIA.eneagrama;
    const aviso = (semPerfil ? `<div class="banner mb"><span class="ico">🧠</span><div class="grow small"><strong>Receba aulas com a sua cara.</strong><br>Informe sua experiência e seu Eneagrama para ver a compatibilidade de cada aula.<br><button class="btn btn-ghost btn-sm mt" data-abrir="sheet-perfil">Completar perfil</button></div></div>` : "");
    let vz = "";
    if (!rk.length) {
        if (modo === "perto" && !pos) vz = vazio("📍", "Precisamos da sua localização", geoErro || "Ative a localização para ver as aulas em até 20 km.", '<button class="btn btn-primary mt" data-geo="atualizar">Ativar localização</button>');
        else if (modo === "perto") vz = vazio("📍", `Nenhuma aula em ${RAIO_KM} km`, "Veja as aulas das outras cidades.", '<button class="btn btn-primary mt" data-modo="cidades">Ver por cidade</button>');
        else vz = vazio("🛒", "Sem ofertas por enquanto", pub.valorMin ? `Nenhuma proposta de ${brl(pub.valorMin)} ou mais agora. Ajuste o mínimo em Menu → Preferências.` : "Novas demandas da região aparecem aqui na hora.");
    }
    el.innerHTML = aviso + (rk.length ? rk.map((x) => cartaoOferta(x)).join("") : vz);
}
$("filtro-modalidade").addEventListener("click", (e) => { const b = e.target.closest(".pill"); if (!b) return; filtroModalidade = b.dataset.s; document.querySelectorAll("#filtro-modalidade .pill").forEach((x) => x.classList.toggle("sel", x === b)); renderOfertas(); });
$("btn-ordenar").addEventListener("click", () => { ordem = ORDENS[(ORDENS.indexOf(ordem) + 1) % ORDENS.length]; $("btn-ordenar").textContent = ROT_ORDEM[ordem]; renderOfertas(); });
$("seg-modo").addEventListener("click", (e) => { const b = e.target.closest("[data-modo]"); if (!b) return; modo = b.dataset.modo; if (modo === "perto") filtroCidade = ""; renderOfertas(); });
$("chips-cidades").addEventListener("click", (e) => { const b = e.target.closest("[data-cidade]"); if (!b) return; modo = "cidades"; filtroCidade = b.dataset.cidade; renderOfertas(); });
$("geo-status").addEventListener("change", (e) => {
    if (e.target.id !== "geo-cidade" || !e.target.value) return;
    const c = acharCidade(e.target.value); if (!c) return;
    try { localStorage.setItem(CHAVE_CIDADE, rotuloCidade(c)); } catch (err) {}
    pararDeAcompanhar(); geoErro = "Cidade escolhida por você."; geoEstado = "idle"; modo = "perto"; definirPosicao({ lat: c.lat, lng: c.lng }, "cidade");
});
// economiza bateria: para de acompanhar quando o app vai para segundo plano e retoma ao voltar
document.addEventListener("visibilitychange", () => { if (document.hidden) pararDeAcompanhar(); else if (usuario && abaOfertasAtiva()) iniciarGeo(); });

// ---------- detalhe da aula (modal interno — nada abre fora do app) ----------
function radarSVG(x) {
    const p = pos && pontoDaAula(x); if (!p) return "";
    const d = distanciaKm(pos, p), r = Math.min(88, (d / RAIO_KM) * 88), a = rumoRad(pos, p), cx = 100 + r * Math.sin(a), cy = 100 - r * Math.cos(a), fora = d > RAIO_KM;
    return `<svg class="radar" viewBox="0 0 200 200" role="img" aria-label="Aula a ${fmtKm(d)} de você"><circle cx="100" cy="100" r="88" fill="none" stroke="var(--line-strong)"/><circle cx="100" cy="100" r="44" fill="none" stroke="var(--line)" stroke-dasharray="3 4"/><line x1="100" y1="12" x2="100" y2="188" stroke="var(--line)"/><line x1="12" y1="100" x2="188" y2="100" stroke="var(--line)"/><text x="100" y="9" text-anchor="middle" font-size="9" fill="var(--muted)">N</text><text x="${100 + 88 - 2}" y="${100 - 4}" text-anchor="end" font-size="8" fill="var(--muted)">${RAIO_KM} km</text><circle cx="100" cy="100" r="5" fill="var(--blue)"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="${fora ? "var(--muted)" : "var(--green)"}" stroke="var(--bg)" stroke-width="2"/></svg>`;
}
function abrirDetalhe(id) {
    const x = ofertasVistas.get(id) || ofertas.find((o) => o.id === id); if (!x) return;
    const m = x.match || pontuarOferta(x, { distKm: pos ? distanciaKm(pos, pontoDaAula(x)) : null, experiencias: perfilIA.experiencias, eneagrama: perfilIA.eneagrama, fmtKm });
    const d = x.distKm ?? (pos ? distanciaKm(pos, pontoDaAula(x)) : Infinity), cid = cidadeDaAula(x);
    const barra = (rot, v) => `<div class="bar3"><div class="row"><span>${rot}</span><span>${v === null ? "—" : Math.round(v * 100) + "%"}</span></div><div class="progress"><i style="width:${v === null ? 0 : Math.round(v * 100)}%"></i></div></div>`;
    $("of-titulo").textContent = x.aluno;
    $("of-corpo").innerHTML = `<div class="row between"><div class="muted small">📍 ${esc(cid || "Localização não informada")}${Number.isFinite(d) ? ` · ${fmtKm(d)} de você` : ""}</div>${m.score != null ? `<span class="badge ${m.nivel === "alto" ? "green" : m.nivel === "medio" ? "" : "blue"}">${m.score}% de match</span>` : ""}</div>
        ${radarSVG(x)}
        <div class="of-info"><div><small>Data</small><strong>${fmtData(x.data)}</strong></div><div><small>Horário</small><strong>${esc(x.entrada)}–${esc(x.saida)}</strong></div><div><small>Modalidade</small><strong>${esc(x.foco)}</strong></div><div><small>Você recebe</small><strong style="color:var(--green)">${brl(valorOferta(x))}</strong></div></div>
        <div class="card flat mb"><h4 class="highlight mb">Por que combina com você</h4>${barra("Proximidade", m.partes.dist)}${barra("Experiência", m.partes.exp)}${barra("Perfil (Eneagrama)", m.partes.enea)}
        ${m.razoes.length ? `<div class="razoes">${m.razoes.map((r) => `<span>${esc(r)}</span>`).join("")}</div>` : '<p class="muted small">Complete sua experiência e seu perfil para ver os motivos.</p>'}
        ${m.conhecidos < 3 ? '<button class="btn btn-ghost btn-sm mt" data-fechar="sheet-oferta" data-abrir="sheet-perfil">Completar perfil</button>' : ""}</div>
        ${(() => { const cat = categoriaDaModalidade(x.foco); return catsOk().has(cat) ? `<button class="btn btn-primary" data-aceitar="${esc(x.id)}">Aceitar aula</button>` : `<div class="trava"><span aria-hidden="true">🔒</span><span>Exige habilitação em ${esc(CATEGORIAS[cat]?.titulo || x.foco)}</span></div><button class="btn btn-primary mt" data-fechar="sheet-oferta" data-hab-iniciar="${esc(cat || "")}">Habilitar-me agora</button>`; })()}`;
    abrir("sheet-oferta");
}

async function aceitar(id, b) {
    b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try { await chamarFuncao("aceitarAula", { aulaId: id }); ok("Aula aceita! Ele já está na sua escala."); fechar("sheet-oferta"); irPara("tab-agenda"); carregarRep(); }
    catch (e) {
        console.error(e);
        const m = { "limite-semanal": e.message, "aula-indisponivel": e.message, "conflito-horario": e.message, exclusivo: e.message, "personal-inativo": "Seu cadastro ainda não foi aprovado.", "treinamento-pendente": "Conclua o capacitação Personow para aceitar aulas.", "idade-nao-verificada": "Informe sua data de nascimento para continuar.", "cref-pendente": "Informe o número do seu CREF para continuar.", "categoria-pendente": e.message, "aula-expirado": "Este chamado relâmpago expirou.", "conta-banida": "Sua conta está bloqueada." }[e.code];
        erro(m || "Não foi possível aceitar a aula. Tente de novo.");
        if (["treinamento-pendente", "personal-inativo", "idade-nao-verificada", "cref-pendente"].includes(e.code)) { await carregarHabilitacao(); pintarPerfil(); renderOfertas(); }
        if (e.code === "categoria-pendente") await carregarHabCats();
        b.disabled = false; b.textContent = "Aceitar aula";
    }
}

// ---------- aulas / agenda ----------
const tardio = (t) => { const [h, m] = (t.entrada || "00:00").split(":").map(Number), ini = new Date(`${t.data}T00:00:00-03:00`).getTime() + (h * 60 + m) * 60_000; return ini - Date.now() < (rep?.regras?.cancelamentoTardioHoras || 12) * 3_600_000; };
function cartaoAula(t) {
    const st = t.status, pago = estaPago(t), cancel = st === "cancelada";
    const acoes = [];
    const exec = t.exigeExecucao !== false && t.exigeExecucao !== undefined, fase = t.fase || "";
    if (st === "aceita" && exec && !fase) acoes.push(`<button class="btn btn-primary btn-sm" data-checkin="${t.id}">📍 Check-in</button>`, `<button class="btn btn-danger btn-sm" data-desistir="${t.id}">Desistir</button>`);
    else if (st === "aceita" && fase === "em_andamento") acoes.push(`<button class="btn btn-primary btn-sm" data-checkout="${t.id}">📸 Finalizar (foto)</button>`, `<button class="btn btn-ghost btn-sm" data-faltaaluno="${t.id}">Aluno ausente?</button>`);
    else if (st === "aceita") acoes.push(`<button class="btn btn-primary btn-sm" data-qr="${t.id}">💳 Cobrar (QR)</button>`, ...(exec ? [] : [`<button class="btn btn-danger btn-sm" data-desistir="${t.id}">Desistir</button>`]));
    const pill = fase === "em_andamento" ? '<span class="fase-pill andamento">Em andamento</span>' : fase === "executada" && !pago ? '<span class="fase-pill executada">Executado ✓</span>' : "";
    if (!cancel) acoes.push(`<button class="btn btn-ghost btn-sm" data-chat="${t.id}">💬 Chat</button>`);
    const rot = cancel ? ["Cancelado", "red"] : pago ? ["Recebido", "green"] : ["Aguardando pagamento", "blue"];
    return `<article class="card aula ${cancel ? "cancelada" : ""}"><div class="topo"><div class="grow"><h4>${esc(t.aluno)}</h4><div class="meta">${t.tipo === "relampago" ? "⚡ " : ""}${fmtData(t.data)} · ${esc(t.entrada)}–${esc(t.saida)} · ${esc(t.foco)}</div>${pill}</div>
        <div class="center"><div class="valor">${brl(meu(t))}</div><span class="badge ${rot[1]}" style="margin-top:4px">${rot[0]}</span></div></div>
        ${fase === "executada" ? `<div class="row" style="gap:10px;margin-top:10px"><button class="btn btn-ghost btn-sm" data-foto="${t.id}" data-legenda="${esc(t.aluno)}">🖼 Ver foto enviada</button>${t.auditoriaAluno ? `<span class="badge ${t.auditoriaAluno.resultado === "aprovada" ? "green" : "red"}">Aluno: ${t.auditoriaAluno.resultado}</span>` : ""}</div>` : ""}
        ${acoes.length ? `<div class="acoes">${acoes.join("")}</div>` : ""}</article>`;
}
function renderProximos() {
    const l = aulas.filter((t) => t.status === "aceita" && t.data >= hojeLocal()).slice(0, 4);
    $("lista-proximos").innerHTML = l.length ? l.map(cartaoAula).join("") : vazio("📅", "Nenhum aula agendada", "Aceite aulas em Ofertas e eles aparecem aqui.");
}
function renderAgenda() { $("lista-agenda").innerHTML = diaSel ? "" : aulas.filter((t) => t.status !== "cancelada" && !estaPago(t)).map(cartaoAula).join("") || vazio("📅", "Nenhum aula por aqui", "As aulas aceitas aparecem neste espaço."); }
function renderCalendario() {
    const ano = dataCal.getFullYear(), mes = dataCal.getMonth(), hoje = hojeLocal();
    $("cal-titulo").textContent = dataCal.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const ini = (new Date(ano, mes, 1).getDay() + 6) % 7, total = new Date(ano, mes + 1, 0).getDate(), com = new Set(aulas.filter((t) => t.status !== "cancelada").map((t) => t.data));
    let h = "<div></div>".repeat(ini);
    for (let d = 1; d <= total; d++) { const iso = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; h += `<button class="cal-day${iso === hoje ? " today" : ""}${iso === diaSel ? " selected" : ""}${com.has(iso) ? " tem" : ""}" data-dia="${iso}" aria-label="${d}">${d}</button>`; }
    $("cal-grid").innerHTML = h;
}
function renderDia() {
    const l = aulas.filter((t) => t.data === diaSel && t.status !== "cancelada");
    $("cal-label").textContent = "Aulas de " + new Date(diaSel + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    $("lista-agenda").innerHTML = l.length ? l.map(cartaoAula).join("") : vazio("📅", "Nenhum aula neste dia", "Escolha outra data ou veja as ofertas.");
}
$("cal-grid").addEventListener("click", (e) => { const b = e.target.closest("[data-dia]"); if (!b) return; diaSel = diaSel === b.dataset.dia ? "" : b.dataset.dia; renderCalendario(); if (diaSel) renderDia(); else { $("cal-label").textContent = "Escolha uma data para ver suas aulas."; renderAgenda(); } });
$("cal-prev").addEventListener("click", () => { dataCal = new Date(dataCal.getFullYear(), dataCal.getMonth() - 1, 1); renderCalendario(); });
$("cal-next").addEventListener("click", () => { dataCal = new Date(dataCal.getFullYear(), dataCal.getMonth() + 1, 1); renderCalendario(); });

// ---------- QR de cobrança ----------
function abrirQR(t) {
    const link = `${baseSite()}pagar.html?id=${encodeURIComponent(t.id)}`; qrAtual = { link, t };
    $("qr-box").innerHTML = ""; if (window.QRCode) new QRCode($("qr-box"), { text: link, width: 200, height: 200 }); else $("qr-box").textContent = "QR indisponível — use o link.";
    $("qr-total").textContent = `Serviço em ${t.aluno}`; $("qr-liquido").textContent = `Você recebe ${brl(valorPersonal(t))}`;
    abrir("sheet-qr");
}
$("qr-copiar").addEventListener("click", () => { navigator.clipboard?.writeText(qrAtual.link); ok("Link de pagamento copiado!"); });
$("qr-zap").addEventListener("click", () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(`Aula concluída em ${qrAtual.t.aluno}. Pague aqui: ${qrAtual.link}`), "_blank", "noopener"));

// ---------- carteira digital ----------
async function carregarCarteira() { try { carteiraDados = await consultar("carteira"); } catch (e) { console.warn(e); carteiraDados = null; } renderCarteira(); }
function renderCarteira() {
    const d = carteiraDados || { pendenteCentavos: 0, disponivelCentavos: 0, extrato: [], saques: [], liberacaoDias: 2 };
    const pagos = aulas.filter(estaPago), aceitos = aulas.filter((t) => t.status === "aceita");
    $("c-disponivel").textContent = brl(d.disponivelCentavos); $("c-pendente").textContent = brl(d.pendenteCentavos);
    $("c-receber").textContent = $("i-receber").textContent = brl(aceitos.reduce((a, t) => a + meu(t), 0));
    $("i-recebido").textContent = brl(pagos.reduce((a, t) => a + meu(t), 0));
    $("c-carencia").textContent = `Cada pagamento fica ${d.liberacaoDias} dia(s) em carência antes de ficar disponível para saque.`;
    $("btn-sacar").disabled = d.disponivelCentavos < (d.saqueMinimoCentavos || 1);
    const ico = { credito_aula: "💸", liberacao: "🔓", saque: "🏦", saque_devolvido: "↩️", estorno: "⚠️" };
    $("c-extrato").innerHTML = d.extrato.length ? d.extrato.map((l) => { const net = l.dPendente + l.dDisponivel, v = net || Math.abs(l.dDisponivel);
        return `<div class="item"><div class="ico">${ico[l.tipo] || "•"}</div><div class="grow"><strong>${esc(l.rotulo)}</strong><div class="muted small">${esc(l.descricao || "")} · ${fmtDataHora(l.em)}</div></div><div class="val" style="color:${net > 0 ? "var(--green)" : net < 0 ? "var(--red)" : "var(--muted)"}">${net > 0 ? "+ " : net < 0 ? "− " : "↔ "}${brl(Math.abs(v))}</div></div>`; }).join("") : '<p class="muted small center">Seus ganhos aparecem aqui depois do primeiro pagamento.</p>';
    const rot = { solicitado: "Em análise", pago: "Pago", rejeitado: "Devolvido" };
    $("c-saques").innerHTML = d.saques.length ? d.saques.map((s) => `<div class="item"><div class="ico">🏦</div><div class="grow"><strong>Saque ${esc(rot[s.status] || s.status)}</strong><div class="muted small">${fmtDataHora(s.em)}</div></div><div class="val">${brl(s.valorCentavos)}</div></div>`).join("") : '<p class="muted small center">Nenhum saque ainda.</p>';
}
$("btn-csv").addEventListener("click", async () => { try { await baixarCSVProtegido("carteira/exportar.csv", "personow-carteira.csv"); } catch (e) { erro(e.code === "limite-requisicoes" ? "Aguarde um instante e tente de novo." : "Não foi possível exportar agora."); } });

/** Ações sensíveis exigem login recente: se o servidor pedir, confirma com o Google e repete uma vez. */
async function comReautenticacao(fn) {
    try { return await fn(); }
    catch (e) {
        if (e.code !== "reautenticar") throw e;
        try { await reauthenticateWithPopup(auth.currentUser, googleProvider); } catch (e2) { throw Object.assign(new Error("Não foi possível confirmar sua identidade."), { code: "reauth-falhou" }); }
        await renovarToken(); return fn();
    }
}
$("btn-sacar").addEventListener("click", () => {
    const d = carteiraDados; if (!d) return;
    if (!priv.pix) { toast("Cadastre sua chave Pix primeiro."); return abrir("sheet-pix"); }
    $("sq-info").textContent = `Disponível: ${brl(d.disponivelCentavos)} · mínimo ${brl(d.saqueMinimoCentavos)} · Pix: ${priv.pix.tipo} ${priv.pix.chaveMascarada}`;
    $("sq-valor").value = ""; $("e-sq-valor").textContent = ""; abrir("sheet-saque");
});
$("sq-tudo").addEventListener("click", () => { $("sq-valor").value = ((carteiraDados?.disponivelCentavos || 0) / 100).toFixed(2).replace(".", ","); });
$("sq-confirmar").addEventListener("click", async () => {
    const v = reaisParaCentavos($("sq-valor").value); $("e-sq-valor").textContent = "";
    if (!(v > 0)) return ($("e-sq-valor").textContent = "Informe o valor.");
    const b = $("sq-confirmar"); b.disabled = true;
    try { await comReautenticacao(() => chamarFuncao("carteira/saque", { valorCentavos: v })); ok("Saque solicitado! Você receberá por Pix após a análise."); fechar("sheet-saque"); await carregarCarteira(); }
    catch (e) { $("e-sq-valor").textContent = e.message || "Não foi possível solicitar o saque."; }
    finally { b.disabled = false; }
});

// ---------- capacitação Personow ----------
async function carregarTreino() {
    const tinhaCompleto = !!hab.treinamento?.completo;
    try { treino = await consultar("treinamento"); if (treino.atualizarToken) await renovarToken(); } catch (e) { console.warn(e); treino = null; }
    await carregarHabilitacao(); renderTreino(); pintarPerfil();
    if (!tinhaCompleto && hab.treinamento?.completo) escutar(); else renderOfertas();   // passa a ler as ofertas assim que o claim "treinado" chega
}
function renderTreino() {
    const t = treino; if (!t) { $("lista-treino").innerHTML = vazio("🎓", "Treinamento indisponível", "Tente novamente em instantes."); return; }
    $("tr-pct").textContent = `${t.concluidos}/${t.total}`; $("tr-bar").style.width = (t.total ? (t.concluidos / t.total) * 100 : 0) + "%";
    $("tr-aviso").textContent = t.completo ? "Treinamento concluído ✓ Você já pode aceitar aulas assim que seu cadastro for aprovado." : t.total ? "Assista cada vídeo do começo ao fim, na ordem. O avanço só conta quando o vídeo está tocando." : "O treinamento ainda não foi publicado pela equipe. Assim que estiver disponível, ele aparece aqui.";
    renderCursos();
    const cartao = (m) => {
        const pct = m.videoOk ? 100 : Math.min(99, Math.round((m.validoSeg / m.limiarSeg) * 100)), faltaProva = m.videoOk && m.temProva && !m.provaOk;
        const rot = m.concluido ? [m.nota != null && m.temProva ? `Concluído ✓ ${m.nota}%` : "Concluído ✓", "green"] : faltaProva ? ["Falta a prova", "blue"] : m.bloqueado ? ["Bloqueado 🔒", ""] : m.validoSeg ? ["Em andamento", "blue"] : ["Não iniciado", ""];
        const botoes = m.bloqueado ? '<span class="muted small">Conclua o módulo anterior.</span>'
            : faltaProva ? `<button class="btn btn-primary btn-sm" data-prova="${esc(m.id)}">📝 Fazer prova</button><button class="btn btn-ghost btn-sm" data-video="${esc(m.id)}">Rever vídeo</button>`
            : `<button class="btn ${m.concluido ? "btn-ghost" : "btn-primary"} btn-sm" data-video="${esc(m.id)}">${m.concluido ? "Rever" : m.validoSeg ? "Continuar" : "Assistir"}</button>`;
        return `<article class="card aula"><div class="topo"><div class="grow"><h4>${m.ordem}. ${esc(m.titulo)}</h4><div class="meta">${esc(m.descricao || "")} · ${Math.round(m.duracaoSeg / 60)} min${m.temProva ? ` · prova com ${m.totalPerguntas} pergunta(s), mínimo ${m.notaMinima}%` : ""}</div></div><span class="badge ${rot[1]}">${rot[0]}</span></div>
            <div class="progress mt"><i style="width:${pct}%"></i></div><div class="acoes">${botoes}</div></article>`;
    };
    const obrig = t.modulos.filter((m) => m.obrigatorio !== false);
    $("lista-treino").innerHTML = obrig.length ? obrig.map((m) => {
        return cartao(m);
    }).join("") : vazio("🎓", "Nenhum vídeo publicado", "A equipe ainda vai publicar os vídeos do Personow.");
}

let leitor = null, pingTimer = null, moduloAtual = null, ytPronto = null;
const carregarYT = () => (ytPronto ||= new Promise((res) => { if (window.YT?.Player) return res(); const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; window.onYouTubeIframeAPIReady = res; document.head.appendChild(s); }));
async function montarPlayer(m) {
    const box = $("vd-player"); box.innerHTML = ""; leitor = null;
    if (m.provedor === "mp4") {
        const v = document.createElement("video"); v.src = m.videoRef; v.controls = true; v.playsInline = true; v.setAttribute("controlsList", "nodownload noplaybackrate"); v.style.cssText = "width:100%;height:100%";
        v.addEventListener("loadedmetadata", () => { v.currentTime = m.validoSeg || 0; }); v.addEventListener("ratechange", () => { if (v.playbackRate !== 1) v.playbackRate = 1; });   // sem acelerar
        box.appendChild(v); leitor = { pos: () => v.currentTime, tocando: () => !v.paused && !v.ended, ir: (s) => { v.currentTime = s; }, parar: () => { v.pause(); v.removeAttribute("src"); v.load(); } };
        return;
    }
    await carregarYT(); const alvo = document.createElement("div"); box.appendChild(alvo);
    const p = new window.YT.Player(alvo, { videoId: m.videoRef, width: "100%", height: "100%", playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin, start: Math.floor(m.validoSeg || 0) }, events: { onPlaybackRateChange: () => { if (p.getPlaybackRate() !== 1) p.setPlaybackRate(1); } } });
    leitor = { pos: () => p.getCurrentTime?.() || 0, tocando: () => p.getPlayerState?.() === 1, ir: (s) => p.seekTo(s, true), parar: () => p.destroy?.() };
}
function pararPings() { clearInterval(pingTimer); pingTimer = null; try { leitor?.parar?.(); } catch (e) {} leitor = null; moduloAtual = null; }
async function abrirVideo(id) {
    const m = treino?.modulos.find((x) => x.id === id); if (!m || m.bloqueado || !m.videoRef) return;
    pararPings(); moduloAtual = m; $("vd-titulo").textContent = m.titulo; $("vd-bar").style.width = Math.min(100, (m.validoSeg / m.limiarSeg) * 100) + "%"; abrir("sheet-video");
    await montarPlayer(m); pingTimer = setInterval(enviarPing, 10_000);
}
async function enviarPing() {
    if (!leitor || !moduloAtual) return;
    const m = moduloAtual, pos = Math.floor(leitor.pos()), tocando = leitor.tocando();
    try {
        const r = await chamarFuncao("treinamento/ping", { moduloId: m.id, posicaoSeg: pos, tocando });
        if (moduloAtual !== m) return;
        $("vd-bar").style.width = Math.min(100, (r.validoSeg / r.limiarSeg) * 100) + "%";
        if (r.provaPendente) { fechar("sheet-video"); pararPings(); ok("Vídeo concluído! Agora faça a prova."); await carregarTreino(); abrirProva(m.id); return; }
        if (!r.concluido && !r.videoOk && pos > r.validoSeg + 3) leitor.ir(r.validoSeg);   // não deixa pular: volta ao ponto já validado
        if (r.concluido) { fechar("sheet-video"); pararPings(); ok(r.obrigatorio !== false && r.treinamentoCompleto ? "Capacitação Personow concluído! 🎓" : r.obrigatorio === false ? "Curso concluído ✓" : "Módulo concluído ✓"); await carregarTreino(); }
    } catch (e) { if (e.code !== "ping-rapido") console.warn(e); }
}
$("vd-fechar").addEventListener("click", () => { pararPings(); carregarTreino(); });

// ============================================================
// HABILITAÇÃO POR CATEGORIA — player seguro + cronômetro + avaliação (100%)
// A decisão é SEMPRE do servidor (relógio, reprodução contínua, correção, gabarito). Os bloqueios do player abaixo
// (sem barra de progresso, sem avançar, sem acelerar, pausa ao sair da tela) são UX e camada extra; a segurança real
// está em server/lib/categorias.js: mesmo com o navegador adulterado, o questionário não abre sem relógio + vídeo.
// ============================================================
let habCats = null, hb = null, leitorHab = null, quiz = null;
const ANEL = 2 * Math.PI * 52;
const fmtTempo = (ms) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const catsOk = () => new Set(habCats ? habCats.categorias.filter((c) => c.habilitado).map((c) => c.id) : Object.keys(pub.habilitacoes || {}));
const selosAtuais = () => habCats ? habCats.selos : Object.entries(pub.habilitacoes || {}).filter(([id]) => CATEGORIAS[id]).map(([id, h]) => ({ categoria: id, titulo: CATEGORIAS[id].titulo, ico: CATEGORIAS[id].ico, elite: h?.elite === true }));
const seloHtml = (s) => `<span class="selo${s.elite ? " elite" : ""}"><span class="selo-ico">${s.elite ? "⭐" : s.ico || "✔"}</span><span>${s.elite ? "Selo de Elite" : "Habilitado"}: ${esc(s.titulo)}</span></span>`;

/** Selos na bio/perfil: vêm do campo gravado pelo SERVIDOR (nunca do texto da bio, que o próprio usuário edita). */
function pintarSelos() {
    const l = selosAtuais(), html = l.map(seloHtml).join("");
    $("selos-menu").innerHTML = html;
    $("bio-preview").innerHTML = `<p>${esc($("d-bio").value || pub.bio || "Você ainda não escreveu sua bio.")}</p>` + (html ? `<div class="selos mt">${html}</div>` : '<p class="muted small mt">Sem selos ainda: conclua um treinamento para ganhar o primeiro.</p>');
}
$("d-bio").addEventListener("input", pintarSelos);

async function carregarHabCats() {
    try { habCats = await consultar("habilitacoes"); } catch (e) { console.warn(e); }
    renderHabCats(); pintarSelos(); pintarPerfil(); renderOfertas();
}
function renderHabCats() {
    const el = $("hab-grid");
    if (!habCats) { el.innerHTML = vazio("🎓", "Habilitações indisponíveis", "Tente novamente em instantes."); return; }
    const l = habCats.categorias, n = l.filter((c) => c.habilitado).length;
    $("hab-qtd").textContent = `${n}/${l.length}`; $("hab-bar").style.width = (n / l.length) * 100 + "%";
    el.innerHTML = l.map((c) => {
        const st = c.habilitado ? (c.elite ? ["Elite ⭐", ""] : ["Habilitado ✓", "green"]) : !c.disponivel ? ["Em breve", "gray"] : c.sessao ? ["Em andamento", "blue"] : c.reprovacoes ? ["Refazer", "red"] : ["Não iniciado", "gray"];
        const min = c.duracaoSeg ? `${Math.max(1, Math.round(c.duracaoSeg / 60))} min de vídeo + avaliação` : "Vídeo ainda não publicado";
        return `<article class="hab-card${c.habilitado ? " ok" : ""}${c.elite ? " elite" : ""}${!c.disponivel && !c.habilitado ? " off" : ""}"><div class="hab-ico" aria-hidden="true">${c.ico}</div><h4>${esc(c.titulo)}</h4><span class="badge ${st[1]}">${st[0]}</span>
            <div class="hab-meta">${c.habilitado ? "Você pode aceitar aulas desta categoria." : esc(min)}</div>
            ${c.habilitado ? "" : `<button class="btn ${c.disponivel ? "btn-primary" : "btn-ghost"} btn-sm" data-hab-iniciar="${esc(c.id)}" ${c.disponivel ? "" : "disabled"}>${c.sessao ? "Continuar" : c.reprovacoes ? "Refazer treinamento" : "Iniciar treinamento"}</button>`}</article>`;
    }).join("");
}

// ---------- player seguro ----------
function pararHab() {
    if (!hb) return;
    clearInterval(hb.tick); clearInterval(hb.ping); clearInterval(hb.guarda);
    try { leitorHab?.parar?.(); } catch (e) {}
    leitorHab = null; hb = null; $("hb-video").innerHTML = "";
}
async function iniciarHab(cat) {
    const c = habCats?.categorias.find((x) => x.id === cat);
    if (!c?.disponivel) return erro("Este treinamento ainda não foi publicado pela equipe.");
    let s;
    try { s = await chamarFuncao("habilitacoes/iniciar", { categoria: cat }); }
    catch (e) { erro(e.code === "ja-habilitado" ? "Você já está habilitado nesta categoria." : e.message || "Não foi possível iniciar o treinamento."); if (e.code === "ja-habilitado") carregarHabCats(); return; }
    if (s.status === "liberado") return abrirAvaliacao(cat);            // retomando: o vídeo já foi cumprido, a avaliação continua aberta
    pararHab();
    const h = hb = { cat, s, titulo: c.titulo, ico: c.ico, total: (s.duracaoSeg + s.margemSeg) * 1000, fimTimer: performance.now() + s.restanteMs, valido: s.validoSeg, videoOk: s.videoOk, ended: s.videoOk, pingando: false };
    $("hb-kicker").textContent = `${c.ico} Habilitação · ${c.titulo}`;
    $("hb-avaliar").hidden = true; $("hb-avaliar").disabled = true; $("hb-pausa").hidden = true; $("hb-play").hidden = false;
    $("hb-anel").style.strokeDasharray = String(ANEL);
    abrir("sheet-hab");
    await montarPlayerHab(h);
    if (hb !== h) return;
    h.tick = setInterval(tickHab, 250); h.ping = setInterval(() => pingHab(), 5000); tickHab();
}
async function montarPlayerHab(h) {
    const box = $("hb-video"); box.innerHTML = ""; let ultimo = h.s.validoSeg || 0;      // ultimo = maior ponto já reproduzido sem salto
    const jogar = (tocando) => { $("hb-play").hidden = tocando; if (tocando) $("hb-pausa").hidden = true; };
    if (h.s.provedor === "mp4") {
        const v = document.createElement("video");
        v.src = h.s.videoRef; v.playsInline = true; v.preload = "auto"; v.controls = false; v.disablePictureInPicture = true; v.disableRemotePlayback = true;
        v.setAttribute("controlsList", "nodownload noplaybackrate noremoteplayback"); v.addEventListener("contextmenu", (e) => e.preventDefault());
        v.addEventListener("loadedmetadata", () => { v.currentTime = ultimo; });
        v.addEventListener("timeupdate", () => { if (!v.seeking && v.currentTime >= ultimo - .5 && v.currentTime <= ultimo + 2) ultimo = Math.max(ultimo, v.currentTime); });
        v.addEventListener("seeking", () => { if (Math.abs(v.currentTime - ultimo) > 1.5) v.currentTime = ultimo; });          // nem avançar nem voltar
        v.addEventListener("ratechange", () => { if (v.playbackRate !== 1) v.playbackRate = 1; });                              // sem acelerar
        v.addEventListener("play", () => { jogar(true); pingHab(true); }); v.addEventListener("pause", () => { jogar(false); if (!v.ended) pingHab(true); });
        v.addEventListener("ended", () => { h.ended = true; jogar(false); pingHab(true); });
        box.appendChild(v);
        leitorHab = { pos: () => v.currentTime, tocando: () => !v.paused && !v.ended, play: () => v.play().catch(() => {}), pause: () => v.pause(), parar: () => { v.pause(); v.removeAttribute("src"); v.load(); } };
    } else {
        await carregarYT(); const alvo = document.createElement("div"); box.appendChild(alvo);
        const p = new window.YT.Player(alvo, { videoId: h.s.videoRef, width: "100%", height: "100%",
            playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, origin: location.origin, start: Math.floor(ultimo) },
            events: { onStateChange: (e) => { jogar(e.data === 1); if (e.data === 1 || e.data === 2) pingHab(true); if (e.data === 0) { h.ended = true; pingHab(true); } }, onPlaybackRateChange: () => { if (p.getPlaybackRate() !== 1) p.setPlaybackRate(1); } } });
        h.guarda = setInterval(() => { const t = p.getCurrentTime?.() || 0; if (Math.abs(t - ultimo) > 2.5 && p.getPlayerState?.() !== 3) p.seekTo(ultimo, true); else if (t >= ultimo) ultimo = t; }, 400);   // salto → volta ao ponto validado
        leitorHab = { pos: () => p.getCurrentTime?.() || 0, tocando: () => p.getPlayerState?.() === 1, play: () => p.playVideo?.(), pause: () => p.pauseVideo?.(), parar: () => p.destroy?.() };
    }
}
/** Um único controle: tocar/pausar (sem barra de progresso). Tocar na tela do vídeo também alterna. */
$("hb-shield").addEventListener("click", () => { if (!leitorHab) return; leitorHab.tocando() ? leitorHab.pause() : leitorHab.play(); });
$("hb-player").addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("visibilitychange", () => { if (document.hidden && hb && leitorHab) { leitorHab.pause(); $("hb-pausa").hidden = false; } });   // saiu da tela: pausa

/** `evento` = ping imediato de play/pause/fim: ancora a posição no servidor. Se já há um em voo, repete assim que terminar. */
async function pingHab(evento = false) {
    const h = hb; if (!h || !leitorHab) return;
    if (h.pingando) { if (evento) h.repetir = true; return; }
    h.pingando = true;
    const pos = Math.floor(Math.min(leitorHab.pos() || 0, h.s.duracaoSeg)), tocando = leitorHab.tocando() || (h.ended && evento);
    try {
        const r = await chamarFuncao("habilitacoes/ping", { categoria: h.cat, posicaoSeg: pos, tocando, evento: evento === true });
        if (hb !== h) return;
        h.valido = r.validoSeg; h.videoOk = r.videoOk; h.fimTimer = performance.now() + r.restanteMs;      // reajusta ao relógio do servidor
    } catch (e) {
        if (hb === h && e.code === "sessao-inexistente") { erro("Sessão de treinamento encerrada. Inicie novamente."); pararHab(); fechar("sheet-hab"); } else console.warn(e);
    } finally { if (hb === h) { h.pingando = false; if (h.repetir) { h.repetir = false; setTimeout(() => pingHab(true), 1100); } } }
}
/** Cronômetro interno: usa performance.now() (relógio monotônico), então mudar a hora do aparelho não adianta nada. */
function tickHab() {
    const h = hb; if (!h) return;
    if (!$("sheet-hab").classList.contains("active")) return pararHab();             // fechado por Esc / toque fora
    const rest = Math.max(0, h.fimTimer - performance.now()), zerou = rest === 0, pronto = zerou && h.ended && h.videoOk;
    $("hb-anel").style.strokeDashoffset = String(ANEL * (1 - Math.min(1, rest / h.total)));
    $("hb-tempo").textContent = zerou ? "00:00" : fmtTempo(rest);
    $("hb-bar").style.width = Math.min(100, (h.valido / Math.max(1, h.s.duracaoSeg - 4)) * 100) + "%";
    // O botão só existe quando o cronômetro zerou E o vídeo chegou ao fim (e o servidor confirmou a reprodução).
    $("hb-avaliar").hidden = !pronto; $("hb-avaliar").disabled = !pronto;
    [...$("hb-steps").children].forEach((li, i) => { li.className = i === 0 ? (pronto ? "done" : "on") : i === 1 ? (pronto ? "on" : "") : ""; });
    $("hb-aviso").textContent = pronto ? "Tudo certo! Você já pode iniciar a avaliação."
        : zerou && !h.ended ? "Cronômetro concluído. Termine de assistir ao vídeo para liberar a avaliação."
        : h.ended && !zerou ? "Vídeo concluído. Aguarde o cronômetro zerar para liberar a avaliação."
        : h.ended ? "Validando a sua reprodução…" : "Assista do começo ao fim. Não é possível avançar, voltar nem acelerar.";
}
$("hb-avaliar").addEventListener("click", () => hb && abrirAvaliacao(hb.cat));
$("hb-fechar").addEventListener("click", () => { if (!hb || confirm("Sair do treinamento? Você poderá retomar de onde parou, mas o cronômetro continua correndo.")) { pararHab(); fechar("sheet-hab"); carregarHabCats(); } });

// ---------- avaliação ----------
async function abrirAvaliacao(cat) {
    const h = hb, b = $("hb-avaliar"), c = habCats?.categorias.find((x) => x.id === cat);
    if (h) { b.disabled = true; b.innerHTML = '<span class="spinner"></span> Preparando…'; }
    try {
        const q = await chamarFuncao("habilitacoes/questionario", { categoria: cat });
        quiz = { cat, titulo: c?.titulo || cat, ico: c?.ico || "", perguntas: q.perguntas, i: 0, resp: [], expira: performance.now() + q.validadeMs };
        pararHab(); fechar("sheet-hab"); renderQuiz(); abrir("sheet-quiz");
        quiz.tick = setInterval(() => { const r = quiz ? quiz.expira - performance.now() : 0; $("qz-validade").textContent = r > 0 ? `Esta avaliação fica aberta por mais ${fmtTempo(r)}.` : "Tempo esgotado: refaça o treinamento."; }, 1000);
    } catch (e) {
        if (h && hb === h) { if (e.code === "timer-pendente" && e.detalhe) h.fimTimer = performance.now() + e.detalhe.restanteMs; if (e.code === "video-incompleto") h.videoOk = false; }
        erro(e.message || "Não foi possível abrir a avaliação.");
    } finally { b.innerHTML = "📝 Iniciar Avaliação"; if (hb) tickHab(); }
}
function renderQuiz() {
    const z = quiz, q = z.perguntas[z.i], n = z.perguntas.length, sel = z.resp[z.i];
    $("qz-kicker").textContent = `${z.ico} Avaliação · ${z.titulo}`; $("qz-count").textContent = `Pergunta ${z.i + 1} de ${n}`;
    $("qz-prog").style.width = (z.i / n) * 100 + "%"; $("qz-texto").textContent = q.texto;
    $("qz-opcoes").innerHTML = q.opcoes.map((o, k) => `<button type="button" class="opt${sel === k ? " sel" : ""}" role="radio" aria-checked="${sel === k}" data-opt="${k}"><span class="opt-l">${"ABCDE"[k]}</span><span>${esc(o)}</span></button>`).join("");
    const card = $("qz-card"); card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";            // reinicia a animação de entrada
    $("qz-prox").textContent = z.i === n - 1 ? "Finalizar avaliação" : "Próxima"; $("qz-prox").disabled = sel === undefined; $("qz-voltar").hidden = z.i === 0;
}
$("qz-opcoes").addEventListener("click", (e) => { const b = e.target.closest("[data-opt]"); if (!b || !quiz) return; quiz.resp[quiz.i] = Number(b.dataset.opt); renderQuiz(); });
$("qz-voltar").addEventListener("click", () => { if (quiz && quiz.i > 0) { quiz.i--; renderQuiz(); } });
$("qz-prox").addEventListener("click", () => { if (!quiz || quiz.resp[quiz.i] === undefined) return; if (quiz.i < quiz.perguntas.length - 1) { quiz.i++; renderQuiz(); } else enviarQuiz(); });
function encerrarQuiz() { if (quiz) clearInterval(quiz.tick); quiz = null; fechar("sheet-quiz"); }
$("qz-fechar").addEventListener("click", () => { if (confirm("Pausar a avaliação? Ela continua aberta por alguns minutos e você pode retomá-la em Treinamento.")) { encerrarQuiz(); carregarHabCats(); } });
async function enviarQuiz() {
    const z = quiz; if (!z || z.resp.length !== z.perguntas.length || z.resp.includes(undefined)) return;
    const b = $("qz-prox"); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Corrigindo…';
    try {
        const r = await chamarFuncao("habilitacoes/responder", { categoria: z.cat, respostas: z.resp });
        encerrarQuiz(); await carregarHabCats(); mostrarResultado(r, z);
    } catch (e) {
        if (["quiz-expirado", "sem-avaliacao", "conteudo-alterado"].includes(e.code)) { encerrarQuiz(); erro(e.message); carregarHabCats(); }
        else { erro(e.message || "Não foi possível enviar. Tente de novo."); b.disabled = false; }
    } finally { b.textContent = "Finalizar avaliação"; }
}

// ---------- resultado ----------
function confete(box) {
    const cores = ["#3B82F6", "#FFFFFF", "#6EA3F8", "#A1A9B5"], f = document.createElement("div");
    f.className = "confete"; f.setAttribute("aria-hidden", "true");
    f.innerHTML = Array.from({ length: 22 }, (_, i) => `<i style="--x:${Math.round(Math.random() * 100)}%;--d:${(Math.random() * .6).toFixed(2)}s;--c:${cores[i % 4]};--r:${Math.round(Math.random() * 360)}deg"></i>`).join("");
    box.appendChild(f); setTimeout(() => f.remove(), 2800);
}
function mostrarResultado(r, z) {
    const box = $("hab-res");
    if (r.aprovado) {
        box.className = "modal-box hab-res ok";
        box.innerHTML = `<div class="res-burst" aria-hidden="true">🎉</div><h2>Parabéns!</h2><p class="muted">Você acertou ${r.acertos} de ${r.total} (100%) e agora está habilitado em <strong>${esc(r.selo.titulo)}</strong>.</p>
            <div class="selos center mt">${seloHtml(r.selo)}</div>${r.selo.elite ? '<p class="small muted mt">Aprovado de primeira: você ganhou o Selo de Elite.</p>' : ""}
            <button class="btn btn-primary mt" data-hab-ver="${esc(r.selo.categoria)}">Ver ofertas de ${esc(r.selo.titulo)}</button><button class="btn btn-ghost mt" data-fechar="modal-hab">Continuar</button>`;
        confete(box);
    } else {
        box.className = "modal-box hab-res no";
        box.innerHTML = `<div class="res-burst" aria-hidden="true">📚</div><h2>Ainda não foi dessa vez</h2><p class="muted">Você acertou ${r.acertos} de ${r.total}. Para se habilitar é preciso acertar <strong>100%</strong>.</p>
            <p class="small muted mt">Para tentar de novo você precisa assistir ao vídeo outra vez e esperar o cronômetro inteiro, do zero.</p>
            <button class="btn btn-primary mt" data-hab-iniciar="${esc(z.cat)}">Refazer treinamento</button><button class="btn btn-ghost mt" data-fechar="modal-hab">Agora não</button>`;
    }
    abrir("modal-hab");
}
/** Atalho do resultado: abre as ofertas já filtradas na modalidade principal da categoria. */
function verOfertasDe(cat) {
    const modalidade = MODALIDADES.find((s) => categoriaDaModalidade(s.v) === cat);
    filtroModalidade = modalidade ? modalidade.v : ""; document.querySelectorAll("#filtro-modalidade .pill").forEach((x) => x.classList.toggle("sel", x.dataset.s === filtroModalidade));
    renderOfertas(); irPara("tab-ofertas");
}

// ---------- prova do módulo (a correção é feita no servidor) ----------
let provaAtual = null;
async function abrirProva(id) {
    try {
        const r = await consultar(`treinamento/modulos/${encodeURIComponent(id)}/prova`), m = treino?.modulos.find((x) => x.id === id);
        provaAtual = r; $("pv-titulo").textContent = `Prova · ${m?.titulo || ""}`; $("pv-info").textContent = `Acerte pelo menos ${r.notaMinima}% para concluir este módulo. Marque uma alternativa em cada pergunta.`; $("pv-resultado").textContent = "";
        $("pv-lista").innerHTML = r.perguntas.map((q, i) => `<fieldset class="card" style="margin-bottom:12px"><legend><strong>${i + 1}. ${esc(q.enunciado)}</strong></legend>${q.alternativas.map((a, j) => `<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;min-height:44px"><input type="radio" name="pv${i}" value="${j}" style="margin-top:3px"><span>${esc(a)}</span></label>`).join("")}</fieldset>`).join("");
        abrir("sheet-prova");
    } catch (e) { erro(e.message || "Não foi possível abrir a prova."); }
}
$("pv-enviar").addEventListener("click", async () => {
    if (!provaAtual) return;
    const respostas = provaAtual.perguntas.map((q, i) => { const x = document.querySelector(`input[name="pv${i}"]:checked`); return x ? Number(x.value) : null; });
    if (respostas.includes(null)) return erro("Responda todas as perguntas antes de enviar.");
    const b = $("pv-enviar"); b.disabled = true;
    try {
        const r = await chamarFuncao(`treinamento/modulos/${encodeURIComponent(provaAtual.moduloId)}/prova`, { respostas });
        if (r.atualizarToken) await renovarToken();
        if (r.aprovado) { fechar("sheet-prova"); ok(r.treinamentoCompleto ? "Capacitação Personow concluído! 🎓" : `Aprovado com ${r.nota}%! ✓`); provaAtual = null; await carregarTreino(); }
        else $("pv-resultado").textContent = `Você acertou ${r.nota}%. O mínimo é ${r.notaMinima}%. Reveja o vídeo e tente de novo.`;
    } catch (e) { erro(e.message || "Não foi possível enviar a prova."); } finally { b.disabled = false; }
});

// ---------- chat ----------
function renderConversas() {
    const l = aulas.filter((t) => t.status !== "cancelada");
    $("lista-conversas").innerHTML = l.length ? l.map((t) => `<div class="card conversa" data-chat="${t.id}" role="button" tabindex="0"><div class="avatar">${esc((t.aluno || "L")[0])}</div><div class="grow"><h4>${esc(t.aluno)}</h4><div class="muted small">${fmtData(t.data)} · ${esc(t.entrada)}–${esc(t.saida)}</div></div><span class="seta muted">›</span></div>`).join("") : vazio("💬", "Nenhuma conversa ainda", "Quando você aceitar uma aula, o chat com o aluno aparece aqui.");
}
function abrirChat(t) {
    chatAula = t; $("chat-titulo").textContent = t.aluno; $("chat-box").innerHTML = skeleton(1); chatUn?.();
    chatUn = onSnapshot(query(collection(db, "aulas", t.id, "mensagens"), orderBy("criadoEm")), (s) => {
        const box = $("chat-box");
        box.innerHTML = s.docs.length ? s.docs.map((d) => { const m = d.data(), eu = m.de === usuario.uid; return `<div class="msg ${eu ? "msg-me" : "msg-other"}">${esc(m.texto)}<small>${fmtDataHora(m.criadoEm)}</small></div>`; }).join("") : '<p class="muted small center" style="margin:auto">Diga olá 👋 e combine os detalhes.</p>';
        box.scrollTop = box.scrollHeight;
    }, () => { $("chat-box").innerHTML = '<p class="muted small center">Não foi possível carregar a conversa.</p>'; });
    abrir("sheet-chat");
}
$("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const t = $("chat-input").value.trim(); if (!t || !chatAula) return; $("chat-input").value = "";
    try { await addDoc(collection(db, "aulas", chatAula.id, "mensagens"), { de: usuario.uid, texto: t, criadoEm: serverTimestamp() }); } catch (err) { erro("Mensagem não enviada."); $("chat-input").value = t; }
});

// ---------- formulários do menu ----------
/** Só campos públicos (bio, cidade, preferências) vão direto ao Firestore; as regras impedem qualquer outro campo. */
async function salvarPublico(dados, msg, sheet) {
    try { await setDoc(doc(db, "personais", usuario.uid), dados, { merge: true }); Object.assign(pub, dados); ok(msg); if (sheet) fechar(sheet); return true; }
    catch (e) { console.error(e); erro("Não foi possível salvar."); return false; }
}
$("btn-salvar-perfil").addEventListener("click", async () => {
    const tel = soDigitos($("d-tel").value), nome = $("d-nome").value.trim(); $("e-cpf").textContent = "";
    if (nome.length < 3) return erro("Informe seu nome completo.");
    if (tel && (tel.length < 10 || tel.length > 11)) return erro("Telefone inválido.");
    const dados = { cidade: $("d-cidade").value.trim(), ...(pub.status === "pendente" && nome !== pub.nome ? { nome } : {}) };
    if (!(await salvarPublico(dados, "Dados salvos ✓"))) return;
    if (!(await salvarIA())) return;               // experiência, Eneagrama, palavras-chave e bio (o servidor revalida)
    if (tel && tel !== soDigitos(priv.telefone || "")) { try { await chamarFuncao("perfil/personal/privado", { telefone: tel }, "PUT"); await carregarPrivado(); } catch (e) { return erro(e.message || "Não foi possível salvar o telefone."); } }
    fechar("sheet-perfil"); pintarPerfil();
});
$("btn-salvar-pix").addEventListener("click", async () => {
    const chave = $("x-chave").value.trim(), tipo = $("x-tipo").value; if (!chave) return erro("Informe a chave Pix.");
    const b = $("btn-salvar-pix"); b.disabled = true;
    try { await comReautenticacao(() => chamarFuncao("perfil/personal/pix", { tipo, chave }, "PUT")); ok("Chave Pix salva ✓ (saques ficam bloqueados por 24 h por segurança)"); $("x-chave").value = ""; fechar("sheet-pix"); await carregarPrivado(); pintarPerfil(); }
    catch (e) { erro(e.message || "Não foi possível salvar a chave Pix."); }
    finally { b.disabled = false; }
});
$("btn-salvar-prefs").addEventListener("click", async () => {
    const min = reaisParaCentavos($("pf-min").value), esp = MODALIDADES.find((s) => s.v === $("pf-esp").value);
    if (await salvarPublico({ valorMin: Math.max(0, Math.min(100000, min)), especialidade: esp?.label || "", disponibilidade: { inicio: $("pf-ini").value, fim: $("pf-fim").value } }, "Preferências salvas ✓", "sheet-prefs")) renderOfertas();
});
$("btn-copiar").addEventListener("click", () => { navigator.clipboard?.writeText($("link-indicar").value); ok("Link copiado!"); });
$("btn-zap").addEventListener("click", () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent("Quer pegar aulas de treino e receber por Pix? Cadastre-se no Personow: " + $("link-indicar").value), "_blank", "noopener"));
$("btn-ativar-notif").addEventListener("click", async () => (await pedirPermissaoNotificacao()) ? (ativarPush(), ok("Avisos ativados neste aparelho.")) : toast("Permissão não concedida. Libere nas configurações do navegador."));
$("btn-teste-reset").addEventListener("click", async () => {
    if (!confirm("Apagar as aulas, notas e o cartão das contas de teste?")) return;
    try { const r = await chamarFuncao("teste/resetar"); ok(`Dados de teste zerados (${r.aulasRemovidos} aula(s)).`); } catch (e) { erro("Não foi possível zerar os dados de teste."); }
});
$("theme-toggle").addEventListener("change", alternarTema);
$("btn-instalar").addEventListener("click", instalarApp);

// ---------- perfil inteligente: experiência + Eneagrama → palavras-chave e bio ----------
const CHAVE_ENEA = chave("eneagrama");
const ANOS_ROT = (n) => (n < 1 ? "menos de 1 ano" : n === 1 ? "1 ano" : n >= 12 ? "mais de 10 anos" : n >= 8 ? "6 a 10 anos" : `${n} anos`);
let formIA = { experiencias: [], eneagrama: null, bioAuto: true }, kwAtual = [];

async function carregarPerfilIA() {
    try { const r = await consultar("perfil/personal/inteligente"); perfilIA = { experiencias: normalizarExperiencias(r.experiencias), eneagrama: eneagramaValido(r.eneagrama) ? r.eneagrama : null, palavrasChave: r.palavrasChave || [], bioAuto: r.bioAuto !== false, eneagramaTravado: !!r.eneagramaTravado, eneagramaOrigem: r.eneagramaOrigem || "" }; }
    catch (e) { console.warn(e); }
    pintarFormIA(); renderOfertas();
    // resultado do teste recebido por link (?eneagrama=PW-3w2-SO) e ainda não salvo no perfil
    let salvo = null; try { salvo = lerCodigoEneagrama(localStorage.getItem(CHAVE_ENEA) || ""); } catch (e) {}
    if (salvo && eneagramaValido(salvo) && !perfilIA.eneagrama) aplicarEneagrama(salvo, true);
}
function montarFormIA() {
    $("exp-area").innerHTML = AREAS.map((a) => `<option value="${esc(a.v)}">${a.ico} ${esc(a.v)}</option>`).join("");
    $("en-tipo").innerHTML = `<option value="">—</option>` + Object.entries(ENEAGRAMA).map(([t, d]) => `<option value="${t}">${t} · ${esc(d.nome.replace(/^O /, ""))}</option>`).join("");
    $("btn-teste-enea").hidden = !ENEAGRAMA_TESTE_URL;
}
function desenharExp() {
    $("exp-lista").innerHTML = formIA.experiencias.map((e) => `<div class="exp-item"><span>${AREA[e.area].ico}</span><div class="grow"><strong>${esc(e.area)}</strong><small>${ANOS_ROT(e.anos)}</small></div><button type="button" data-exp-rm="${esc(e.area)}" aria-label="Remover ${esc(e.area)}">✕</button></div>`).join("");
}
function desenharEnea() {
    const e = formIA.eneagrama;
    $("en-tipo").value = e ? String(e.tipo) : "";
    $("en-asa").innerHTML = `<option value="">—</option>` + (e ? asasDoTipo(e.tipo).map((a) => `<option value="${a}">${a}</option>`).join("") : "");
    $("en-asa").value = e?.asa ? String(e.asa) : ""; $("en-asa").disabled = !e;
    $("en-inst").value = e?.instinto || ""; $("en-inst").disabled = !e;
    const r = $("en-resumo"); r.hidden = !e;
    if (e) { const d = ENEAGRAMA[e.tipo]; r.innerHTML = `<strong>Tipo ${e.tipo} — ${esc(d.nome)}</strong>${e.asa ? ` · asa ${e.asa}` : ""}${e.instinto ? ` · ${INSTINTOS[e.instinto]}` : ""}<br><span class="muted">Pontos fortes no trabalho: ${esc(d.tracos.join(", "))}.</span><br><span class="muted small">Código: ${esc(codigoEneagrama(e))}</span>`; }
    if (perfilIA.eneagramaTravado && e) {                               // resultado vindo do teste: sem digitação nem edição
        for (const id of ["en-tipo", "en-asa", "en-inst", "en-codigo", "en-aplicar"]) { const el = $(id); if (el) el.disabled = true; }
        $("btn-teste-enea").hidden = true;
        r.innerHTML += `<br><span class="muted small">✔ Resultado do teste de perfil comportamental, vinculado automaticamente ao seu cadastro.</span>`;
    }
}
function pintarKw(l) { kwAtual = l; $("kw-chips").innerHTML = l.map((k) => `<span>${esc(k)}</span>`).join(""); }
const contarBio = () => { $("bio-cont").textContent = `(${$("d-bio").value.length}/300)`; };
function regenerar({ forcarBio = false } = {}) {
    const g = gerarPerfil(formIA); pintarKw(g.palavrasChave);
    if (formIA.bioAuto || forcarBio) { $("d-bio").value = g.bio; contarBio(); }
}
function pintarFormIA() {
    if ($("sheet-perfil").classList.contains("active")) return;      // não sobrescreve o que a pessoa está editando
    formIA = { experiencias: [...perfilIA.experiencias], eneagrama: perfilIA.eneagrama, bioAuto: perfilIA.bioAuto };
    $("bio-auto").checked = formIA.bioAuto; desenharExp(); desenharEnea();
    if (perfilIA.palavrasChave.length) pintarKw(perfilIA.palavrasChave); else regenerar();
    if (!$("d-bio").value && (formIA.experiencias.length || formIA.eneagrama)) regenerar({ forcarBio: true });
    contarBio();
}
function aplicarEneagrama(en, salvarAgora = false) {
    formIA.eneagrama = en; perfilIA.eneagrama = salvarAgora ? en : perfilIA.eneagrama; desenharEnea(); regenerar();
    try { localStorage.setItem(CHAVE_ENEA, codigoEneagrama(en)); } catch (e) {}
    if (salvarAgora) salvarIA({ silencioso: true }).then((okk) => okk && toast("Resultado do teste aplicado ao seu perfil ✓"));
}
/** Envia ao servidor (que revalida e atualiza o perfil público: bio, palavras-chave e áreas). */
async function salvarIA({ silencioso = false } = {}) {
    const corpo = { experiencias: formIA.experiencias, eneagrama: formIA.eneagrama ? { tipo: formIA.eneagrama.tipo, asa: formIA.eneagrama.asa || 0, instinto: formIA.eneagrama.instinto || "" } : null, palavrasChave: kwAtual, bio: $("d-bio").value.trim(), bioAuto: formIA.bioAuto };
    try {
        const r = await chamarFuncao("perfil/personal/inteligente", corpo, "PUT");
        perfilIA = { experiencias: r.experiencias, eneagrama: r.eneagrama, palavrasChave: r.palavrasChave, bioAuto: r.bioAuto, eneagramaTravado: !!r.eneagramaTravado, eneagramaOrigem: perfilIA.eneagramaOrigem }; Object.assign(pub, { bio: r.bio, palavrasChave: r.palavrasChave });
        renderOfertas(); return true;
    } catch (e) { console.error(e); if (!silencioso) erro(e.message || "Não foi possível salvar seu perfil."); return false; }
}
$("exp-add").addEventListener("click", () => {
    const area = $("exp-area").value, anos = Number($("exp-anos").value);
    if (formIA.experiencias.length >= MAX_EXPERIENCIAS) return erro(`Máximo de ${MAX_EXPERIENCIAS} experiências.`);
    if (formIA.experiencias.some((e) => e.area === area)) return toast("Essa área já está na lista. Remova para trocar o tempo.");
    formIA.experiencias = normalizarExperiencias([...formIA.experiencias, { area, anos }]); desenharExp(); regenerar();
});
$("exp-lista").addEventListener("click", (e) => { const b = e.target.closest("[data-exp-rm]"); if (!b) return; formIA.experiencias = formIA.experiencias.filter((x) => x.area !== b.dataset.expRm); desenharExp(); regenerar(); });
const lerEneaForm = () => {
    const t = Number($("en-tipo").value); if (!t) return null;
    const asa = Number($("en-asa").value) || 0;
    return { tipo: t, asa: asasDoTipo(t).includes(asa) ? asa : 0, instinto: $("en-inst").value };
};
$("en-tipo").addEventListener("change", () => { const t = Number($("en-tipo").value); formIA.eneagrama = t ? { tipo: t, asa: 0, instinto: $("en-inst").value } : null; desenharEnea(); regenerar(); });
$("en-asa").addEventListener("change", () => { formIA.eneagrama = lerEneaForm(); desenharEnea(); regenerar(); });
$("en-inst").addEventListener("change", () => { formIA.eneagrama = lerEneaForm(); desenharEnea(); regenerar(); });
$("en-aplicar").addEventListener("click", () => {
    const en = lerCodigoEneagrama($("en-codigo").value); $("e-en-codigo").textContent = "";
    if (!en || !eneagramaValido(en)) return ($("e-en-codigo").textContent = "Código inválido. Exemplo: PW-3w2-SO");
    $("en-codigo").value = ""; aplicarEneagrama(en);
});
$("bio-auto").addEventListener("change", (e) => { formIA.bioAuto = e.target.checked; if (formIA.bioAuto) regenerar({ forcarBio: true }); });
$("d-bio").addEventListener("input", () => { if (formIA.bioAuto) { formIA.bioAuto = false; $("bio-auto").checked = false; } contarBio(); });   // editou à mão: para de sobrescrever
$("btn-regerar").addEventListener("click", () => { formIA.bioAuto = true; $("bio-auto").checked = true; regenerar({ forcarBio: true }); });
// teste do Eneagrama dentro do app (iframe) — o teste avisa o resultado por postMessage
$("btn-teste-enea").addEventListener("click", () => { $("enea-frame").src = ENEAGRAMA_TESTE_URL; abrir("sheet-teste-enea"); });
$("enea-fechar").addEventListener("click", () => { $("enea-frame").src = "about:blank"; });
window.addEventListener("message", (ev) => {
    if (!ENEAGRAMA_TESTE_ORIGEM || ev.origin !== ENEAGRAMA_TESTE_ORIGEM) return;         // só a origem configurada
    const d = ev.data; if (!d || d.evento !== "eneagrama") return;
    const en = { tipo: Number(d.tipo), asa: Number(d.asa) || 0, instinto: String(d.instinto || "") };
    if (!eneagramaValido(en)) return;
    fechar("sheet-teste-enea"); $("enea-frame").src = "about:blank"; aplicarEneagrama(en, true);
});
try { const q = new URLSearchParams(location.search).get("eneagrama"); const en = q && lerCodigoEneagrama(q); if (en && eneagramaValido(en)) localStorage.setItem(CHAVE_ENEA, codigoEneagrama(en)); } catch (e) {}

// ---------- cursos por categoria (modal interno) ----------
function renderCursos() {
    const t = treino, box = $("cursos-lista");
    if (!t) { $("cursos-resumo").innerHTML = ""; box.innerHTML = vazio("📚", "Cursos indisponíveis", "Tente novamente em instantes."); return; }
    const abertos = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.cat)), primeira = !box.children.length;
    const grupos = agruparCursos(t.modulos), opc = t.opcionais || { concluidos: 0, total: 0 };
    $("cursos-resumo").innerHTML = `<div class="linha"><span style="font-size:24px">📚</span><div class="grow"><strong>${t.concluidos}/${t.total} da habilitação</strong>${opc.total ? ` · ${opc.concluidos}/${opc.total} opcionais` : ""}<br><span class="muted">${t.completo ? "Habilitação concluída ✓" : "Conclua a habilitação para liberar as aulas."}</span></div></div>`;
    $("menu-cursos-badge").hidden = !t.modulos.length; $("menu-cursos-badge").textContent = t.modulos.length;
    box.innerHTML = grupos.length ? grupos.map((g, i) => `<details class="cat" data-cat="${g.id}" ${(primeira ? i === 0 : abertos.has(g.id)) ? "open" : ""}><summary><span class="ico">${g.ico}</span><div class="grow"><h4>${esc(g.titulo)}</h4><p>${esc(g.desc)}</p></div><span class="badge ${g.concluidos === g.total ? "green" : "gray"}">${g.concluidos}/${g.total}</span><span class="seta">›</span></summary>
        <div class="cat-corpo">${g.itens.map((m) => {
            const st = statusCurso(m), pct = m.videoOk || m.concluido ? 100 : Math.min(99, Math.round((m.validoSeg / m.limiarSeg) * 100)), faltaProva = m.videoOk && m.temProva && !m.provaOk;
            return `<div class="curso"><div class="topo"><div class="grow"><h5>${m.obrigatorio ? m.ordem + ". " : ""}${esc(m.titulo)}</h5><div class="meta">${esc(m.descricao || "")}${m.descricao ? " · " : ""}${Math.round(m.duracaoSeg / 60)} min</div></div><span class="badge ${st.cor}">${st.t}</span></div><div class="progress"><i style="width:${pct}%"></i></div>${m.bloqueado ? '<span class="muted small">Conclua o módulo anterior da habilitação.</span>' : faltaProva ? `<div class="acoes"><button class="btn btn-primary btn-sm" data-prova="${esc(m.id)}">📝 Fazer prova</button><button class="btn btn-ghost btn-sm" data-video="${esc(m.id)}">Rever vídeo</button></div>` : `<button class="btn ${m.concluido ? "btn-ghost" : "btn-primary"} btn-sm" data-video="${esc(m.id)}">${m.concluido ? "Rever" : m.validoSeg ? "Continuar" : "Assistir"}</button>`}${m.temProva && !faltaProva && !m.concluido ? `<span class="muted small"> · tem prova (mín. ${m.notaMinima}%)</span>` : ""}</div>`;
        }).join("")}</div></details>`).join("") : vazio("📚", "Nenhum curso publicado", "A equipe ainda vai publicar os cursos. Volte em breve.");
}

// ---------- cliques globais (delegação) ----------
document.addEventListener("click", async (e) => {
    const g = (a) => e.target.closest(`[${a}]`);
    let el;
    if ((el = g("data-aceitar"))) aceitar(el.dataset.aceitar, el);
    else if ((el = g("data-qr"))) { const t = aulas.find((x) => x.id === el.dataset.qr); if (t) abrirQR(t); }
    else if ((el = g("data-chat"))) { const t = aulas.find((x) => x.id === el.dataset.chat); if (t) abrirChat(t); }
    else if ((el = g("data-desistir"))) {
        const t = aulas.find((x) => x.id === el.dataset.desistir); if (!t || !confirm(`Desistir da aula em ${t.aluno}? Ele volta para a fila de ofertas.${tardio(t) ? `\n\n⚠️ Faltam menos de ${rep?.regras?.cancelamentoTardioHoras || 12} h para o início: você receberá uma ADVERTÊNCIA (perde 1 vida) e uma multa.` : ""}`)) return;
        try { const r = await chamarFuncao("desistirAula", { aulaId: t.id }); ok("Você saiu da aula. Ele voltou para a fila."); if (r.infracao) { await carregarRep(); if (!rep.banido) animarPerdaVida(r.infracao); } } catch (err) { erro(err.code === "servico-em-andamento" ? "Você já fez check-in. Finalize o serviço ou reporte o aluno." : "Não foi possível desistir agora."); }
    }
    if ((el = g("data-checkin"))) { const t = aulas.find((x) => x.id === el.dataset.checkin); if (t) abrirCheckin(t); }
    if ((el = g("data-checkout"))) { const t = aulas.find((x) => x.id === el.dataset.checkout); if (t) abrirCheckout(t); }
    if ((el = g("data-faltaaluno"))) { const t = aulas.find((x) => x.id === el.dataset.faltaaluno); if (t) abrirFaltaAluno(t); }
    if ((el = g("data-foto"))) abrirFoto(`execucao/foto/${encodeURIComponent(el.dataset.foto)}`, el.dataset.legenda);
    if ((el = g("data-video"))) abrirVideo(el.dataset.video);
    if ((el = g("data-det")) && !e.target.closest("[data-aceitar]")) abrirDetalhe(el.dataset.det);
    if ((el = g("data-prova"))) abrirProva(el.dataset.prova);
    if ((el = g("data-geo"))) reiniciarGeo();
    if ((el = g("data-modo")) && !el.closest("#seg-modo")) { modo = el.dataset.modo; renderOfertas(); }
    if ((el = g("data-abrir")) && el.dataset.abrir === "sheet-cursos") carregarTreino();
    if ((el = g("data-ir"))) { e.preventDefault(); irPara(el.dataset.ir); if (el.dataset.ir === "tab-treino") { carregarTreino(); carregarHabCats(); } }
    if ((el = g("data-hab-iniciar"))) { fechar("modal-hab"); if (!el.dataset.habIniciar) return; irPara("tab-treino"); iniciarHab(el.dataset.habIniciar); }
    if ((el = g("data-hab-ver"))) { fechar("modal-hab"); verOfertasDe(el.dataset.habVer); }
    if ((el = g("data-abrir"))) { e.preventDefault(); abrir(el.dataset.abrir); }
    if ((el = g("data-fechar"))) fechar(el.dataset.fechar);
    if (e.target.classList?.contains("app-overlay")) fechar(e.target.id);
});
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[role=button]")) { e.preventDefault(); e.target.click(); } });

function irPara(id) {
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.toggle("active", t.id === id));
    document.querySelectorAll(".nav-item").forEach((i) => i.classList.toggle("active", i.dataset.tab === id)); window.scrollTo(0, 0);
    if (id === "tab-ofertas") iniciarGeo(); else pararDeAcompanhar();          // GPS só liga enquanto a pessoa está vendo as ofertas
}
$("nav-personal").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) irPara(b.dataset.tab); });

setInterval(() => { document.querySelectorAll("[data-expira]").forEach((e) => { const r = Number(e.dataset.expira) - Date.now(); if (r <= 0) { renderOfertas(); return; } e.textContent = r >= 60000 ? `${Math.ceil(r / 60000)} min` : `${Math.ceil(r / 1000)} s`; }); }, 1000);
