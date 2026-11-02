// Inicialização única do Firebase (antes cada página repetia a config).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initializeAuth, getAuth, setPersistence, browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence, browserPopupRedirectResolver, GoogleAuthProvider, connectAuthEmulator, signInWithCustomToken, signInWithRedirect, signInWithPopup, getRedirectResult, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { FIREBASE_CONFIG, FIREBASE_CONFIGURADO, FUNCTIONS_BASE, USAR_EMULADOR } from "./config.js";
import { PORTAL, NOME_APP, chave } from "./portal.js";

export { PORTAL, FIREBASE_CONFIGURADO };
// Um app Firebase por portal (ver portal.js): sessões de aluno, personal, parceiro, admin e TI nunca se misturam no mesmo navegador.
export const app = initializeApp(FIREBASE_CONFIG, NOME_APP);
// SESSÃO PERSISTENTE: o login fica salvo no aparelho (localStorage; se indisponível, IndexedDB; por último a sessão da aba) e é restaurado
// ao reabrir o app. É declarado na criação do Auth — sem corrida com o primeiro login. Sessões antigas (IndexedDB) são migradas sozinhas.
function criarAuth() {
    try { return initializeAuth(app, { persistence: [browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence], popupRedirectResolver: browserPopupRedirectResolver }); }
    catch (e) { const a = getAuth(app); setPersistence(a, browserLocalPersistence).catch(() => {}); return a; }   // já inicializado em outro lugar: pede a persistência local explicitamente
}
export const auth = criarAuth();
export const db = getFirestore(app);
if (USAR_EMULADOR) { connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "localhost", 8080); }
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/** Espera o Firebase terminar de RESTAURAR a sessão salva. Antes, auth.currentUser era null logo após abrir a página e a 1ª chamada falhava. */
export function aguardarAuth() {
    if (typeof auth.authStateReady === "function") return auth.authStateReady();
    return new Promise((res) => { const off = onAuthStateChanged(auth, () => { off(); res(); }); });
}
async function tokenAtual(forcar = false) {
    await aguardarAuth();
    if (!auth.currentUser) throw Object.assign(new Error("Sua sessão terminou. Entre novamente."), { code: "sem-sessao", status: 401 });
    return auth.currentUser.getIdToken(forcar);
}
/** Mensagem legível quando o servidor não manda `erro` no corpo (antes virava só "falha"). */
const MSG_STATUS = { 400: "Aula inválido.", 401: "Sua sessão terminou. Entre novamente.", 403: "Você não tem permissão para esta ação.", 404: "Recurso não encontrado.", 429: "Muitas tentativas. Aguarde um instante.", 500: "Erro interno do servidor. Tente de novo." };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chama a API do servidor (token no cabeçalho Authorization; nunca em URL). `metodo` padrão: POST (ou GET se corpo === null).
 * Resiliência (era a causa de "pede login toda hora"): token velho (401 sessao-invalida) → renova UMA vez e repete;
 * rede/502/503/504 em chamadas idempotentes (GET e /sessao) → repete até 6x com espera crescente (o plano gratuito do Render "acorda" em até ~50 s).
 */
export async function chamarFuncao(nome, corpo = {}, metodo) {
    if (!FUNCTIONS_BASE) throw Object.assign(new Error("backend-nao-configurado"), { code: "backend-nao-configurado" });
    const m = metodo || (corpo === null ? "GET" : "POST"), idempotente = m === "GET" || nome === "sessao";
    let renovou = false;
    for (let tentativa = 0; ; tentativa++) {
        let r;
        try {
            const idToken = await tokenAtual(renovou);
            r = await fetch(`${FUNCTIONS_BASE}/${nome}`, {
                method: m, headers: { ...(m === "GET" ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${idToken}` },
                ...(m === "GET" ? {} : { body: JSON.stringify(corpo || {}) })
            });
        } catch (e) {
            if (e.code === "sem-sessao" || String(e.code || "").startsWith("auth/")) throw e;
            if (idempotente && tentativa < 6) { await dormir(2500 * Math.min(tentativa + 1, 4)); continue; }
            throw Object.assign(new Error("Sem conexão com o servidor. Confira a internet e tente de novo."), { code: "rede" });
        }
        if (r.status === 401 && !renovou && (await r.clone().json().catch(() => ({}))).codigo === "sessao-invalida") { renovou = true; continue; }
        if ([502, 503, 504].includes(r.status) && idempotente && tentativa < 6) { await dormir(2500 * Math.min(tentativa + 1, 4)); continue; }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.erro || MSG_STATUS[r.status] || `Erro no servidor (${r.status}).`), { code: j.codigo || r.status, status: r.status, detalhe: j.detalhe });
        return j;
    }
}
/** Acorda o servidor (Render gratuito dorme) enquanto a pessoa ainda está na tela de login. Falha em silêncio. */
export const aquecerServidor = () => { try { if (FUNCTIONS_BASE) fetch(`${FUNCTIONS_BASE}/saude`, { cache: "no-store" }).catch(() => {}); } catch (e) {} };
export const consultar = (nome) => chamarFuncao(nome, null, "GET");

/** Baixa um CSV protegido (exige login): faz GET com o token e salva o arquivo. */
export async function baixarCSVProtegido(caminho, nomeArquivo) {
    const idToken = await tokenAtual();
    const r = await fetch(`${FUNCTIONS_BASE}/${caminho}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.erro || MSG_STATUS[r.status] || `Erro no servidor (${r.status}).`), { code: j.codigo || r.status }); }
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = nomeArquivo; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Depois de cadastro, treinamento ou mudança de papel o servidor atualiza as claims: pede um token novo. */
export const renovarToken = () => auth.currentUser?.getIdToken(true);
/** Papel atual (aluno | personal | admin) lido do token assinado. */
export async function papelAtual() { try { return (await auth.currentUser.getIdTokenResult()).claims.role || null; } catch (e) { return null; } }

// ---------- Modo de teste (sandbox): só aparece se o servidor estiver com MODO_TESTE=1 ----------
export async function testeAtivo() {
    try { const r = await fetch(`${FUNCTIONS_BASE}/teste/status`); return r.ok && (await r.json()).ativo === true; } catch (e) { return false; }
}
/** Entra com uma conta fictícia ("aluno" ou "personal"), sem Google e sem Mercado Pago. */
export async function loginDeTeste(perfil) {
    const r = await fetch(`${FUNCTIONS_BASE}/teste/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ perfil }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || "falha"), { code: j.codigo || r.status });
    return signInWithCustomToken(auth, j.customToken);
}
/** true se a sessão atual é uma conta de teste (claim emitido pelo servidor). */
export async function contaDeTeste() {
    try { return (await auth.currentUser.getIdTokenResult()).claims.teste === true; } catch (e) { return false; }
}

// ---------- Login / logout (um único caminho para os três portais) ----------
/**
 * Entra com o Google. Tenta POPUP (rápido, sem sair da página); se o navegador bloquear o popup ou não o suportar, cai para REDIRECIONAMENTO
 * (quem conclui é `concluirLoginGoogle()` ao carregar a página). Devolve a credencial (popup), ou null (redirect iniciado / popup fechado pela pessoa).
 */
export async function entrarComGoogle() {
    try { return await signInWithPopup(auth, googleProvider); }
    catch (e) {
        if (["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(e.code)) return null;
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/web-storage-unsupported"].includes(e.code)) { await signInWithRedirect(auth, googleProvider); return null; }
        throw e;
    }
}
/** Conclui o login por redirecionamento. Nunca lança: devolve { cred } (ou { cred: null } se não houve redirect) ou { erro } com o erro original. */
export async function concluirLoginGoogle() {
    try { return { cred: await getRedirectResult(auth) }; }
    catch (erro) { console.error("getRedirectResult:", erro); return { cred: null, erro }; }
}

// ---------- E-mail e senha ----------
/** true se a conta entrou por e-mail/senha e ainda não confirmou o e-mail (o servidor recusa tokens assim: ver server/lib/seguranca.js). */
export const emailPendente = (u) => !!u && !u.emailVerified && (u.providerData || []).some((p) => p.providerId === "password");
export const entrarComEmail = (email, senha) => signInWithEmailAndPassword(auth, email.trim(), senha);
/** Cria a conta, grava o nome e dispara o e-mail de confirmação. A sessão fica aberta, mas só vale no servidor depois de confirmar. */
export async function criarContaComEmail(nome, email, senha) {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), senha);
    try { if (nome) await updateProfile(cred.user, { displayName: nome.trim().slice(0, 100) }); } catch (e) { console.warn("updateProfile:", e); }
    await sendEmailVerification(cred.user);
    return cred;
}
export const reenviarVerificacao = () => sendEmailVerification(auth.currentUser);
export const recuperarSenha = (email) => sendPasswordResetEmail(auth, email.trim());
/** "Já confirmei": recarrega o usuário e renova o token (claim email_verified). true se o e-mail já está confirmado. */
export async function conferirVerificacao() {
    await auth.currentUser?.reload();
    if (auth.currentUser?.emailVerified) { await auth.currentUser.getIdToken(true); return true; }
    return false;
}
/** Encerra a sessão e limpa os marcadores do fluxo de entrada (modo e anti-loop), para recomeçar do zero. */
export async function sairDaConta() {
    try { sessionStorage.removeItem("personow_redir"); sessionStorage.removeItem(chave("termos")); sessionStorage.removeItem(chave("modo")); } catch (e) {}
    await signOut(auth);
}

/** Baixa um arquivo protegido (foto) e devolve uma URL local (blob:). Quem chama deve revogar com URL.revokeObjectURL. */
export async function baixarBlobProtegido(caminho) {
    const idToken = await auth.currentUser.getIdToken();
    const r = await fetch(`${FUNCTIONS_BASE}/${caminho}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.erro || "falha"), { code: j.codigo || r.status }); }
    return URL.createObjectURL(await r.blob());
}
