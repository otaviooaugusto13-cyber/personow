// Service worker: o app abre mesmo com internet ruim. Dados (Firestore) nunca são cacheados aqui.
const VERSAO = "personow-v15";
const BASE = ["./", "index.html", "personal.html", "/painel-aluno", "/painel-personal", "entrada.js", "pagar.html", "nota.html", "nota.css", "login-cena.css", "verificar.html", "verificar.js", "landing.html", "style.css", "style-landing.css", "config.js", "core.js", "ui.js", "firebase.js", "acesso.js", "recado.js", "script-aluno.js", "script-personal.js", "pagar.js", "nota.js", "landing.js", "manifest.json", "icons/icon-192.png", "taxas.js", "geo.js", "perfil-inteligente.js", "cursos.js", "suporte.js", "push.js", "parceiro.html", "style-jogo.css", "style-b2b.css", "camera.js", "gamificacao-ui.js", "personal-jogo.js", "aluno-jogo.js", "parceiro.js", "parceiro-ui.js", "mapa-aluno.js", "style-mapa.css"];
// allSettled: se um arquivo faltar, o resto continua sendo guardado (antes, um 404 derrubava a instalação inteira).
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSAO).then((c) => Promise.allSettled(BASE.map((u) => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (/^\/(teste|cadastro|perfil|habilitacao|habilitacoes|sessao|treinamento|carteira|aluno|admin|interno|cartao|criar|aceitar|cancelar|desistir|avaliar|confirmar|webhook|saude|config\/taxas|suporte|push|nota\/|checkin|checkout|reportar|auditar|execucao|reputacao|personal\/|personais\/|parceiros|b2b)/.test(u.pathname)) return;   // API: nunca cachear       // Firebase, Maps, fontes: direto na rede
  // rede primeiro (sempre a versão nova do app); cache só quando estiver offline
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match(u.pathname.includes("personal") ? "personal.html" : "index.html") : Response.error()))));   // offline: cada painel volta para a SUA página (antes o personal caía na tela do aluno)
});

// ---------- notificações push (FCM, mensagens só de dados): suporte e chamado relâmpago ----------
self.addEventListener("push", (e) => {
  let d = {}; try { const j = e.data?.json(); d = j?.data || j?.notification || j || {}; } catch (err) { /* payload ilegível: usa o padrão */ }
  const relampago = d.tipo === "relampago" || !!d.aulaId, titulo = d.titulo || d.title || "";
  e.waitUntil((async () => {
    // Suporte: se o app já está aberto e visível, quem avisa é a própria página (toast + selo): aqui não duplicamos. O chamado relâmpago sempre notifica.
    if (!relampago) { const abertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); if (abertas.some((c) => c.visibilityState === "visible")) return; }
    if (relampago && !titulo) return;
    await self.registration.showNotification(titulo || "Personow", relampago
      ? { body: d.corpo || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: d.aulaId || "relampago", requireInteraction: true, vibrate: [200, 100, 200], data: { url: d.url || "personal.html" } }
      : { body: d.corpo || d.body || "Você tem uma nova mensagem.", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "suporte", renotify: true, data: { url: d.url || "./" } });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || "./", self.registration.scope).href, semQuery = (u) => u.split(/[?#]/)[0];
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (ws) => {
    for (const w of ws) if (semQuery(w.url) === semQuery(alvo)) { await w.focus(); return w.navigate ? w.navigate(alvo) : undefined; }
    return self.clients.openWindow(alvo);
  }));
});
