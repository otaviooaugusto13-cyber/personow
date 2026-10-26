// Service worker: o app abre mesmo com internet ruim. Dados (Firestore) e API nunca são cacheados aqui.
const VERSAO = "personow-v4";
const BASE = ["./", "index.html", "personal.html", "pagar.html", "recibo.html", "landing.html", "style.css", "style-personal.css", "style-landing.css", "polish.css",
    "config.js", "core.js", "ui.js", "firebase.js", "script.js", "script-personal.js", "manifest.json", "icon-192.png", "logo-branco.png"];

// allSettled: se um arquivo faltar, o resto continua sendo guardado (antes, um 404 derrubava a instalação inteira).
self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(VERSAO).then((c) => Promise.allSettled(BASE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
    const u = new URL(e.request.url);
    if (e.request.method !== "GET" || u.origin !== location.origin) return;                         // Firebase, Maps, fontes: direto na rede
    if (/^\/(mp|criar|aceitar|enviar|avaliar|confirmar|webhook|saude|diagnostico)/.test(u.pathname)) return;   // API: nunca cachear
    // rede primeiro (sempre a versão nova do app); cache só quando estiver offline
    e.respondWith(fetch(e.request).then((r) => {
        if (r.ok) { const cp = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, cp)); }
        return r;
    }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
