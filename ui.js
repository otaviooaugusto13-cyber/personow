// Utilidades de interface compartilhadas: toast, tema, notificações, service worker.
export const $ = (id) => document.getElementById(id);

export function toast(msg) {
    let t = $("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 3800);
}

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

export function baixarCSV(nome, linhas) {
    const csv = "\ufeff" + linhas.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const vazio = (icone, titulo, texto) => `<div class="empty-state"><div class="empty-icon">${icone}</div><h4>${titulo}</h4><p>${texto}</p></div>`;
