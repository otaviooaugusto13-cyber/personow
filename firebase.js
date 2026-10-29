// Inicialização única do Firebase (antes cada página repetia a config) + chamadas ao servidor.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { FIREBASE_CONFIG, FUNCTIONS_BASE, USAR_EMULADOR } from "./config.js";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
if (USAR_EMULADOR) { connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "localhost", 8080); }
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/** Chama uma rota autenticada do servidor (Render). Lança Error com `.code`, `.status` e `.detalhe`.
 *  `corpo === null` faz GET (sem corpo); `metodo` força PUT/DELETE etc. O token vai SÓ no cabeçalho Authorization. */
export async function chamarFuncao(nome, corpo = {}, metodo) {
    if (!FUNCTIONS_BASE) throw Object.assign(new Error("backend-nao-configurado"), { code: "backend-nao-configurado" });
    if (!auth.currentUser) throw Object.assign(new Error("Faça login para continuar."), { code: "sem-login" });
    const idToken = await auth.currentUser.getIdToken();
    const m = metodo || (corpo === null ? "GET" : "POST");
    let r;
    try {
        r = await fetch(`${FUNCTIONS_BASE}/${nome}`, {
            method: m, headers: { ...(m === "GET" ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${idToken}` },
            ...(m === "GET" ? {} : { body: JSON.stringify(corpo || {}) })
        });
    } catch (e) {
        throw Object.assign(new Error("Sem conexão com o servidor. Tente novamente."), { code: "rede" });
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || "Falha ao falar com o servidor."), { code: j.codigo || r.status, status: r.status, detalhe: j.detalhe });
    return j;
}
export const consultar = (nome) => chamarFuncao(nome, null, "GET");

/** Baixa um CSV protegido (exige login e papel): GET com o token e salva o arquivo. */
export async function baixarCSVProtegido(caminho, nomeArquivo) {
    const idToken = await auth.currentUser.getIdToken();
    const r = await fetch(`${FUNCTIONS_BASE}/${caminho}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.erro || "Falha ao baixar."), { code: j.codigo || r.status }); }
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = nomeArquivo; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Pede um token novo (depois de o admin conceder/retirar papel, por exemplo). */
export const renovarToken = () => auth.currentUser?.getIdToken(true);
/** Esta conta é administradora? (lido do token assinado; a API confere de novo no servidor) */
export async function souAdmin() { try { const c = (await auth.currentUser.getIdTokenResult()).claims; return c.role === "admin" || c.admin === true; } catch (e) { return false; } }

export function mensagemErroAuth(error) {
    switch (error.code) {
        case "auth/unauthorized-domain": return "Domínio não autorizado no Firebase. Adicione este endereço em Authentication → Settings → Domínios autorizados.";
        case "auth/operation-not-allowed": return "Login com Google não está ativado no Firebase (Authentication → Sign-in method).";
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request": return null;   // o usuário fechou: sem alerta
        case "auth/network-request-failed": return "Sem conexão com a internet. Tente novamente.";
        default: return "Não foi possível entrar com o Google. (" + (error.code || "erro") + ")";
    }
}
