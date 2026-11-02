// ============================================================
// PERSONOW — entrar / criar conta com E-MAIL e SENHA (o Google continua no botão ao lado)
//
// Mesmo princípio da entrada com Google (entrada.js): "Entrar" nunca cria conta sozinho e "Criar" exige os Termos ANTES.
// Conta nova por e-mail só vale depois de confirmar o endereço (o servidor recusa tokens sem e-mail verificado);
// quem cuida dessa espera é a tela de `telaVerificarEmail` (acesso.js), acionada pelo painel via `emailPendente()`.
// Elementos esperados no HTML: #form-email, #campo-nome, #em-nome, #em-email, #em-senha, #e-em, #btn-email, #btn-email-txt, #btn-esqueci.
// ============================================================
import { $, toast, erro } from "./ui.js";
import { entrarComEmail, criarContaComEmail, recuperarSenha } from "./firebase.js";

const SENHA_MIN = 8;
const MSG = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "Este e-mail já tem conta. Use “Entrar na minha conta” (ou “Esqueci minha senha”).",
    "auth/weak-password": `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`,
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
    "auth/network-request-failed": "Sem conexão com a internet.",
    "auth/operation-not-allowed": "Login por e-mail e senha não está ativado no Firebase (Authentication → Sign-in method)."
};
export const msgAuthEmail = (e) => MSG[e?.code] ?? `Não foi possível concluir. (${e?.code || "erro"})`;

/**
 * @param {{ modo: () => "entrar"|"criar", termosAceitos: () => boolean, pedirTermos: () => void }} o
 * @returns {{ atualizarModo: (modo: string) => void }}
 */
export function ligarLoginEmail({ modo, termosAceitos, pedirTermos }) {
    const form = $("form-email"); if (!form) return { atualizarModo() {} };
    const msg = (t) => { $("e-em").textContent = t || ""; };
    const ocupado = (v) => { $("btn-email").disabled = v; $("btn-esqueci").disabled = v; };
    const rotulo = () => { $("btn-email-txt").textContent = modo() === "criar" ? "Criar conta com e-mail" : "Entrar com e-mail"; };
    function atualizarModo() {
        const criar = modo() === "criar";
        $("campo-nome").hidden = !criar; $("btn-esqueci").hidden = criar;
        $("em-senha").autocomplete = criar ? "new-password" : "current-password";
        msg(""); rotulo();
    }
    form.addEventListener("submit", async (ev) => {
        ev.preventDefault(); msg("");
        const criar = modo() === "criar", nome = $("em-nome").value.trim(), email = $("em-email").value.trim(), senha = $("em-senha").value;
        if (!/^\S+@\S+\.\S+$/.test(email)) return msg("Informe um e-mail válido.");
        if (!senha) return msg("Informe a senha.");
        if (criar) {
            if (nome.length < 3) return msg("Informe o seu nome completo.");
            if (senha.length < SENHA_MIN) return msg(`A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`);
            if (!termosAceitos()) return pedirTermos();
        }
        ocupado(true);
        try {
            if (criar) { await criarContaComEmail(nome, email, senha); }
            else await entrarComEmail(email, senha);
            $("em-senha").value = "";                                  // o resto é com o onAuthStateChanged do painel
        } catch (e) { console.warn(e.code); msg(msgAuthEmail(e)); }
        finally { ocupado(false); }
    });
    $("btn-esqueci").addEventListener("click", async () => {
        msg(""); const email = $("em-email").value.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) return msg("Digite seu e-mail acima e toque de novo em “Esqueci minha senha”.");
        ocupado(true);
        try { await recuperarSenha(email); toast("Se existir uma conta com este e-mail, enviamos o link para redefinir a senha.", "ok"); }
        catch (e) { if (e.code === "auth/invalid-email" || e.code === "auth/too-many-requests" || e.code === "auth/network-request-failed") erro(msgAuthEmail(e)); else toast("Se existir uma conta com este e-mail, enviamos o link para redefinir a senha.", "ok"); }
        finally { ocupado(false); }
    });
    atualizarModo();
    return { atualizarModo };
}
