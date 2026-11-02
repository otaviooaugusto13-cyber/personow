// ============================================================
// PERSONOW — acesso por portal (aluno | personal | admin) e tratamento amigável de multi-perfil
//
// Uma conta Google = um uid no Firebase Auth, e a sessão é COMPARTILHADA entre index.html, personal.html e admin.html
// (mesma origem). Por isso abrir o portal "errado" não é erro de login: é só a conta estar com outro perfil.
// Antes, o front fazia signOut() + toast ("Esta conta não tem acesso…" / "Conta com dois perfis. Fale com o suporte.").
// Agora: o servidor (/sessao) diz o que a conta tem, e esta tela oferece o caminho certo — sem derrubar a sessão.
// ============================================================
import { chamarFuncao, renovarToken, emailPendente, conferirVerificacao, reenviarVerificacao } from "./firebase.js";
import { toast, erro } from "./ui.js";
import { msgAuthEmail } from "./login-email.js";
import { esc } from "./core.js";
import { ROTAS, WHATSAPP_SUPORTE } from "./config.js";

const PAINEL = {
    aluno:     { nome: "aluno",          rotulo: "Abrir painel do aluno",             href: ROTAS.aluno },
    personal: { nome: "personal",      rotulo: "Abrir portal do personal",         href: ROTAS.personal },
    admin:    { nome: "administrador", rotulo: "Abrir painel administrativo",      href: ROTAS.admin }
};

// ---------- Redirecionamento DIRETO para o painel do perfil (com trava anti-loop) ----------
const GUARDA = "personow_redir";   // marcador de navegação ENTRE portais (anti-loop): de propósito não é isolado por portal
const lerGuarda = () => { try { return JSON.parse(sessionStorage.getItem(GUARDA) || "null"); } catch (e) { return null; } };
/** Chamar quando o painel abriu de verdade: zera a trava anti-loop. */
export const limparGuarda = () => { try { sessionStorage.removeItem(GUARDA); } catch (e) {} };
/**
 * Leva a pessoa direto ao painel do perfil que a conta TEM (decidido pelo servidor em /sessao), sem tela intermeaula.
 *   papel — perfil de destino ("aluno" | "personal"); de — portal em que estamos agora.
 * Devolve true se navegou. Devolve false (e quem chamou mostra a tela de escolha) se isso fecharia um ciclo:
 * acabamos de chegar aqui vindos do próprio destino (< 15 s) ou já houve 3 saltos seguidos.
 */
export function irParaPainel(papel, de) {
    const destino = PAINEL[papel]?.href; if (!destino || papel === de || papel === "admin") return false;
    const g = lerGuarda(), agora = Date.now(), recente = g && agora - g.t < 15000;
    if (recente && ((g.para === de && g.de === papel) || g.n >= 3)) return false;
    try { sessionStorage.setItem(GUARDA, JSON.stringify({ de, para: papel, t: agora, n: recente ? (g.n || 1) + 1 : 1 })); } catch (e) {}
    location.replace(destino);
    return true;
}
const ID_TELA = "screen-acesso";

/**
 * Pede ao servidor para ativar o perfil do portal aberto.
 * Resolve com { estado: "ok" | "cadastro" | "outro-perfil" | "escolher", role, perfis, sugerido }.
 * Se o perfil ativo mudou, o token é renovado aqui (para as claims novas valerem nas regras do Firestore e na API).
 * Lança em falha de rede/servidor — quem chama decide (ver `telaFalhaTemporaria`).
 */
export async function resolverAcesso(portal) {
    const r = await chamarFuncao("sessao", { portal });
    if (r.atualizarToken) await renovarToken();
    // Compatibilidade: servidor antigo (sem `estado`) só devolvia { role, atualizarToken }.
    if (!r.estado) r.estado = !r.role ? "cadastro" : r.role === portal ? "ok" : "outro-perfil";
    if (r.estado === "outro-perfil" && !r.sugerido && r.role) r.sugerido = r.role;
    r.perfis = Array.isArray(r.perfis) ? r.perfis : (r.role ? [r.role] : []);
    return r;
}

/** Garante o contêiner da tela (usa as mesmas classes das telas de login, então herda tema claro/escuro). */
function garantirTela() {
    let t = document.getElementById(ID_TELA);
    if (!t) {
        t = document.createElement("div"); t.id = ID_TELA; t.className = "screen login-screen";
        t.innerHTML = '<div class="auth-card" role="alertdialog" aria-labelledby="acesso-titulo" aria-describedby="acesso-texto"></div>';
        document.body.appendChild(t);
    }
    return t;
}

/** Mostra a tela de aviso e esconde as demais. `acoes`: [{ rotulo, href?, aoClicar?, tipo?: "primary"|"ghost" }]. */
function mostrar({ titulo, texto, acoes }) {
    const t = garantirTela(), card = t.firstElementChild;
    card.innerHTML = `
        <div class="auth-brand"><h1>PERSON<span class="highlight">OW</span></h1></div>
        <h2 class="auth-title" id="acesso-titulo">${esc(titulo)}</h2>
        <p class="auth-sub" id="acesso-texto">${esc(texto)}</p>
        <div class="acesso-acoes"></div>`;
    const box = card.querySelector(".acesso-acoes");
    acoes.forEach((a, i) => {
        const el = document.createElement(a.href ? "a" : "button");
        el.className = `btn ${a.tipo === "ghost" ? "btn-ghost" : "btn-primary"} ${i ? "btn-block-gap" : ""}`; el.textContent = a.rotulo;
        if (a.href) { el.href = a.href; el.style.textDecoration = "none"; el.style.display = "flex"; el.style.justifyContent = "center"; } else { el.type = "button"; el.addEventListener("click", a.aoClicar); }
        box.appendChild(el);
    });
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s === t));
    box.querySelector("a,button")?.focus?.({ preventScroll: true });
}

/**
 * Perfil errado para este portal (ou conta com mais de um perfil).
 * Não derruba a sessão: oferece abrir o painel que a conta realmente tem, ou trocar de conta Google.
 *   portal  — onde o usuário está agora ("aluno" | "personal" | "admin")
 *   perfis  — perfis que o servidor confirmou para a conta
 *   email   — só para o texto
 *   trocarConta — async: encerra a sessão e volta para a tela de login do portal atual
 */
export function telaOutroPerfil({ portal, perfis, email, trocarConta }) {
    const tem = (perfis || []).filter((p) => PAINEL[p] && p !== portal);
    const lista = tem.map((p) => PAINEL[p].nome);
    const quem = email ? `A conta ${email}` : "Esta conta Google";
    const so = lista.length ? lista.join(" e ") : "outro tipo de acesso";
    const titulo = lista.length > 1 ? "Esta conta tem mais de um perfil" : `Esta conta é de ${so}`;
    const texto = portal === "admin"
        ? `${quem} não tem permissão de administrador. Você pode abrir o painel que ela já possui ou entrar com outra conta.`
        : `${quem} não tem cadastro de ${PAINEL[portal].nome}; ela é de ${so}. Escolha como quer continuar. Para atuar também como ${PAINEL[portal].nome}, entre com outra conta Google.`;
    mostrar({
        titulo, texto,
        acoes: [
            ...tem.map((p, i) => ({ rotulo: PAINEL[p].rotulo, href: PAINEL[p].href, tipo: i ? "ghost" : "primary" })),
            { rotulo: "Entrar com outra conta Google", aoClicar: trocarConta, tipo: tem.length ? "ghost" : "primary" }
        ]
    });
}

/** Conta bloqueada pela equipe: tela fixa (não derruba a sessão em loop) com o recado do suporte e o caminho para falar com a gente. */
export function telaBloqueado({ texto, trocarConta }) {
    mostrar({
        titulo: "Acesso não liberado para esta conta",
        texto: texto || "A equipe do Personow suspendeu o acesso desta conta. Fale com o suporte para entender o motivo e liberar.",
        acoes: [
            { rotulo: "Falar com o suporte no WhatsApp", href: `https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent("Olá! Minha conta no Personow está bloqueada. Pode me ajudar?")}` },
            { rotulo: "Entrar com outra conta Google", aoClicar: trocarConta, tipo: "ghost" }
        ]
    });
}

/** Não foi possível confirmar o perfil (rede/servidor fora). Não desloga: deixa tentar de novo. */
export function telaFalhaTemporaria({ tentarDeNovo, trocarConta }) {
    mostrar({
        titulo: "Não conseguimos verificar sua conta",
        texto: "Pode ser a conexão ou uma instabilidade momentânea. Sua conta não foi alterada — tente novamente.",
        acoes: [{ rotulo: "Tentar de novo", aoClicar: tentarDeNovo }, { rotulo: "Sair e usar outra conta", aoClicar: trocarConta, tipo: "ghost" }]
    });
}

/** Conta por e-mail/senha ainda sem o e-mail confirmado: o servidor só aceita sessões verificadas. Não derruba a sessão. */
export function telaVerificarEmail({ email, jaConfirmei, reenviar, trocarConta }) {
    mostrar({
        titulo: "Confirme seu e-mail",
        texto: `Enviamos um link de confirmação para ${email || "o seu e-mail"}. Abra a mensagem (olhe também o spam), toque no link e volte aqui.`,
        acoes: [
            { rotulo: "Já confirmei", aoClicar: jaConfirmei },
            { rotulo: "Reenviar e-mail de confirmação", aoClicar: reenviar, tipo: "ghost" },
            { rotulo: "Sair e usar outra conta", aoClicar: trocarConta, tipo: "ghost" }
        ]
    });
}

/** Se a conta é de e-mail/senha e ainda não confirmou o e-mail, mostra a tela de espera e devolve true (quem chamou não deve seguir). */
export function guardarEmailPendente(u, trocarConta) {
    if (!emailPendente(u)) return false;
    telaVerificarEmail({
        email: u.email, trocarConta,
        jaConfirmei: async () => { try { if (await conferirVerificacao()) location.reload(); else toast("Ainda não confirmado. Abra o link do e-mail e tente de novo.", "erro"); } catch (e) { erro(msgAuthEmail(e)); } },
        reenviar: async () => { try { await reenviarVerificacao(); toast("E-mail de confirmação reenviado.", "ok"); } catch (e) { erro(msgAuthEmail(e)); } }
    });
    return true;
}
