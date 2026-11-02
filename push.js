// ============================================================
// PERSONOW — notificações push (Firebase Cloud Messaging)
// Só funciona com FCM_VAPID_KEY preenchida em config.js e permissão de notificação concedida pela pessoa.
// O token do aparelho é enviado ao servidor (/push/registrar), que avisa quando chega mensagem do suporte.
// ============================================================
import { chave } from "./portal.js";
import { app, chamarFuncao } from "./firebase.js";
import { FCM_VAPID_KEY } from "./config.js";

const CHAVE = chave("push_token");
export const pushDisponivel = () => !!FCM_VAPID_KEY && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Registra este aparelho (se a permissão já foi dada). Chame depois do login e depois de a pessoa aceitar avisos. */
export async function ativarPush() {
    if (!pushDisponivel() || Notification.permission !== "granted") return false;
    try {
        const { getMessaging, getToken, isSupported } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js");
        if (!(await isSupported())) return false;
        const token = await getToken(getMessaging(app), { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: await navigator.serviceWorker.ready });
        if (!token) return false;
        await chamarFuncao("push/registrar", { token });
        try { localStorage.setItem(CHAVE, token); } catch (e) {}
        return true;
    } catch (e) { console.warn("push:", e); return false; }
}

/** Desvincula este aparelho da conta. Chame ANTES do signOut, para ele não receber avisos de quem saiu. */
export async function desativarPush() {
    let t = null; try { t = localStorage.getItem(CHAVE); } catch (e) {}
    if (!t) return;
    try { await chamarFuncao("push/remover", { token: t }); localStorage.removeItem(CHAVE); } catch (e) { console.warn("push:", e); }
}

// ---- Push para chamados relâmpago (melhor esforço: sem chave VAPID ou sem permissão, o app continua avisando em tempo real enquanto aberto) ----
/** Pede permissão e devolve o token FCM (ou null). Usa o service worker do app (sw.js). */
export async function obterTokenPush() {
    try {
        if (!FCM_VAPID_KEY || !("Notification" in window) || !("serviceWorker" in navigator)) return null;
        if (Notification.permission === "default") await Notification.requestPermission();
        if (Notification.permission !== "granted") return null;
        const { getMessaging, getToken, isSupported } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js");
        if (!(await isSupported())) return null;
        const reg = await navigator.serviceWorker.ready;
        return (await getToken(getMessaging(app), { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg })) || null;
    } catch (e) { console.warn("push indisponível:", e.message); return null; }
}
