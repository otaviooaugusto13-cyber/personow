// Utilidades de interface compartilhadas: toast, tema, máscaras, modal, service worker.
import { esc } from "./core.js";

export const $ = (id) => document.getElementById(id);

export function toast(msg, tipo = "info") {
    let box = $("toast-area");
    if (!box) {
        box = document.createElement("div");
        box.id = "toast-area";
        box.setAttribute("role", "status");
        box.setAttribute("aria-live", "polite");
        document.body.appendChild(box);
    }
    const t = document.createElement("div");
    t.className = `toast toast-${tipo}`;
    const ico = { ok: "✓", erro: "!", info: "i" }[tipo] || "i";
    t.innerHTML = `<span class="toast-ico">${ico}</span><span>${esc(msg)}</span>`;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, tipo === "erro" ? 5500 : 3500);
}
export const ok = (m) => toast(m, "ok");
export const erro = (m) => toast(m, "erro");

// ---- Tema: segue o sistema por padrão; escolha manual fica salva ----
export function iniciarTema() {
    let t = null;
    try { t = localStorage.getItem("personow_tema"); } catch (e) {}
    const claro = t ? t === "claro" : window.matchMedia?.("(prefers-color-scheme: light)").matches;
    document.body.classList.toggle("light-theme", !!claro);
    const cb = $("theme-toggle"); if (cb) cb.checked = !!claro;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", claro ? "#FFFFFF" : "#0B0B0D");
}
export function alternarTema() {
    const claro = $("theme-toggle").checked;
    document.body.classList.toggle("light-theme", claro);
    try { localStorage.setItem("personow_tema", claro ? "claro" : "escuro"); } catch (e) {}
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", claro ? "#FFFFFF" : "#0B0B0D");
}

// ---- Máscaras: <input data-mask="cpf|cnpj|doc|tel"> ----
export function ligarMascaras(mapa) {
    document.querySelectorAll("input[data-mask]").forEach((el) => {
        const fn = mapa[el.dataset.mask];
        if (fn) el.addEventListener("input", () => { el.value = fn(el.value); });
    });
}

// ---- Modal/subtela acessível ----
export function abrir(id) { const e = $(id); if (!e) return; e.classList.add("active"); e.removeAttribute("aria-hidden"); e.querySelector("input,select,textarea,button")?.focus?.({ preventScroll: true }); document.body.classList.add("no-scroll"); }
export function fechar(id) { const e = $(id); if (!e) return; e.classList.remove("active"); e.setAttribute("aria-hidden", "true"); if (!document.querySelector(".app-overlay.active")) document.body.classList.remove("no-scroll"); }
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") document.querySelectorAll(".app-overlay.active").forEach((e) => fechar(e.id)); });

// ---- Modal de decisão (substitui confirm()/alert()): acessível, com foco e Esc ----
let dlgSeq = 0;
/**
 * Mostra uma pergunta com botões e resolve com o `valor` escolhido (null se fechar com Esc ou clicando fora).
 *   acoes:  [{ rotulo, valor, tipo?: "primary" | "ghost" | "danger" }]  (a 1ª é a ação principal)
 *   html:   conteúdo CONFIÁVEL opcional (ex.: textoTermos) mostrado numa caixa rolável — nunca passe texto de usuário aqui
 *   marcar: texto de uma caixa que precisa ser marcada para liberar as ações "primary" (ex.: aceite dos Termos)
 */
export function dialogo({ titulo, texto = "", icone = "", acoes, html = "", marcar = "" }) {
    return new Promise((resolve) => {
        const id = `dlg-${++dlgSeq}`, voltar = document.activeElement, ov = document.createElement("div");
        ov.id = id; ov.className = "app-overlay centro active"; ov.setAttribute("role", "alertdialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", `${id}-t`); ov.setAttribute("aria-describedby", `${id}-p`);
        ov.innerHTML = `<div class="modal-box">${icone ? `<div class="modal-ico" aria-hidden="true">${esc(icone)}</div>` : ""}<h3 id="${id}-t">${esc(titulo)}</h3>${texto ? `<p class="muted small" id="${id}-p" style="margin-top:8px">${esc(texto)}</p>` : `<span id="${id}-p"></span>`}
            ${html ? `<div class="modal-termos small muted">${html}</div>` : ""}
            ${marcar ? `<label class="check-line" style="text-align:left;margin-top:12px"><input type="checkbox" id="${id}-ck"><span>${esc(marcar)}</span></label>` : ""}
            <div class="modal-acoes"></div></div>`;
        const box = ov.querySelector(".modal-acoes"), ck = ov.querySelector(`#${id}-ck`), botoes = [];
        const fim = (v) => { document.removeEventListener("keydown", tecla, true); ov.remove(); if (!document.querySelector(".app-overlay.active")) document.body.classList.remove("no-scroll"); try { voltar?.focus?.({ preventScroll: true }); } catch (e) {} resolve(v); };
        const tecla = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); fim(null); } };
        acoes.forEach((a) => {
            const b = document.createElement("button"); b.type = "button"; b.textContent = a.rotulo;
            b.className = `btn ${a.tipo === "ghost" ? "btn-ghost" : a.tipo === "danger" ? "btn-danger" : "btn-primary"}`;
            if (ck && a.tipo !== "ghost" && a.tipo !== "danger") b.disabled = true;
            b.addEventListener("click", () => fim(a.valor)); box.appendChild(b); botoes.push([b, a]);
        });
        ck?.addEventListener("change", () => botoes.forEach(([b, a]) => { if (a.tipo !== "ghost" && a.tipo !== "danger") b.disabled = !ck.checked; }));
        ov.addEventListener("click", (e) => { if (e.target === ov) fim(null); });
        document.addEventListener("keydown", tecla, true);
        document.body.appendChild(ov); document.body.classList.add("no-scroll");
        (ck || botoes[0]?.[0])?.focus?.({ preventScroll: true });
    });
}

// ---- Skeletons e estados vazios ----
export const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join("");
export const vazio = (icone, titulo, texto, acao = "") => `<div class="empty-state"><div class="empty-icon">${icone}</div><h4>${esc(titulo)}</h4><p>${esc(texto)}</p>${acao}</div>`;

// ---- PWA ----
export function registrarSW() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
let promptInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstalar = e; document.querySelectorAll(".btn-instalar").forEach((b) => (b.hidden = false)); });
export async function instalarApp() { if (!promptInstalar) return toast("Use o menu do navegador → “Adicionar à tela inicial”."); promptInstalar.prompt(); promptInstalar = null; }

// ---- Notificação do navegador (quando a aula muda de estado) ----
export async function pedirPermissaoNotificacao() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
}
export function notificar(titulo, corpo) {
    toast(`${titulo} — ${corpo}`, "ok");
    try { if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(titulo, { body: corpo, icon: "icons/icon-192.png" }); } catch (e) {}
    try { navigator.vibrate?.(120); } catch (e) {}
}

export function baixarCSV(nome, linhas) {
    const csv = "﻿" + linhas.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
