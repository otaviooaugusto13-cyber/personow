// Utilidades de interface compartilhadas: toast, tema, notificações, service worker, instalação do PWA, aviso global.
import { FUNCTIONS_BASE } from "./config.js";
export const $ = (id) => document.getElementById(id);

/** `tipo` opcional ("ok" | "erro" | "info"): só muda a cor da borda (polish.css). Chamadas antigas toast(msg) seguem iguais. */
export function toast(msg, tipo = "info") {
    let t = $("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.remove("toast-ok", "toast-erro");
    if (tipo === "ok" || tipo === "erro") t.classList.add(`toast-${tipo}`);
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), tipo === "erro" ? 5500 : 3800);
}
export const ok = (m) => toast(m, "ok");
export const erro = (m) => toast(m, "erro");

/** Placeholders de carregamento (some quando o conteúdo real chega). */
export const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton" aria-hidden="true"></div>').join("");

// ---- Tema (mesma chave de antes: personow_tema) ----
export function iniciarTema() {
    let t = null;
    try { t = localStorage.getItem("personow_tema"); } catch (e) {}
    const claro = t === "claro";
    document.body.classList.toggle("light-theme", claro);
    const cb = $("theme-toggle"); if (cb) cb.checked = claro;
}
export function alternarTema() {
    const claro = $("theme-toggle").checked;
    document.body.classList.toggle("light-theme", claro);
    try { localStorage.setItem("personow_tema", claro ? "claro" : "escuro"); } catch (e) {}
}

// ---- PWA ----
export function registrarSW() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---- Aviso quando a aula muda de estado (toast + notificação do navegador se a aba estiver em segundo plano) ----
export async function pedirPermissaoNotificacao() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
}
export function notificar(titulo, corpo) {
    toast(`${titulo} — ${corpo}`);
    try { if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(titulo, { body: corpo, icon: "icon-192.png" }); } catch (e) {}
    try { navigator.vibrate?.(120); } catch (e) {}
}

// ---- Instalar o app (PWA): mostra o botão .btn-instalar quando o navegador permite ----
let promptInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstalar = e; document.querySelectorAll(".btn-instalar").forEach((b) => (b.hidden = false)); });
export async function instalarApp() {
    if (!promptInstalar) return toast("Use o menu do navegador → “Adicionar à tela inicial”.");
    promptInstalar.prompt(); promptInstalar = null;
    document.querySelectorAll(".btn-instalar").forEach((b) => (b.hidden = true));
}

// ---- Aviso global do suporte (manutenção etc.): GET /aviso. Falha em silêncio; "Fechar" vale só nesta sessão. ----
export async function carregarAviso() {
    try {
        if (!FUNCTIONS_BASE || sessionStorage.getItem("personow_aviso_fechado")) return;
        const r = await fetch(`${FUNCTIONS_BASE}/aviso`); if (!r.ok) return;
        const a = await r.json(); if (!a.ativo || !a.texto) return;
        document.getElementById("aviso-global")?.remove();
        const el = document.createElement("div");
        el.id = "aviso-global"; el.className = `aviso-global ${a.nivel === "alerta" ? "alerta" : ""}`; el.setAttribute("role", "status");
        const t = document.createElement("span"); t.textContent = a.texto;
        const b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-label", "Fechar aviso"); b.textContent = "×";
        b.addEventListener("click", () => { el.remove(); try { sessionStorage.setItem("personow_aviso_fechado", "1"); } catch (e) {} });
        el.append(t, b); document.body.prepend(el);
    } catch (e) { /* aviso é opcional */ }
}

export function baixarCSV(nome, linhas) {
    const csv = "\ufeff" + linhas.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const vazio = (icone, titulo, texto) => `<div class="empty-state"><div class="empty-icon">${icone}</div><h4>${titulo}</h4><p>${texto}</p></div>`;
