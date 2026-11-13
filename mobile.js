// PERSONOW — comportamentos de celular (sem dependências, sem Firebase; seguro carregar em qualquer página).
//   1) detecta teclado aberto (visualViewport) → esconde menu fixo e rola o campo focado para a vista;
//   2) dicas de teclado certas (enterkeyhint, autocapitalize, spellcheck) sem mexer em cada HTML;
//   3) vibração curtinha ao tocar no menu inferior (Android);
//   4) aviso de "sem internet";
//   5) convite para instalar o app (Android: prompt nativo; iPhone: instrução do Safari), 1× a cada 14 dias.
(() => {
    "use strict";
    const doc = document, body = doc.body, vv = window.visualViewport;
    const guarda = (f) => { try { return f(); } catch { return null; } };
    const lerLS = (k) => guarda(() => localStorage.getItem(k));
    const gravaLS = (k, v) => guarda(() => localStorage.setItem(k, v));

    // ---------- 1) teclado ----------
    let alturaBase = vv ? vv.height : innerHeight;
    const emCampo = () => /^(INPUT|TEXTAREA|SELECT)$/.test(doc.activeElement?.tagName || "") && !/^(checkbox|radio|button|submit)$/.test(doc.activeElement.type || "");
    const atualizaTeclado = () => {
        if (!vv) return;
        if (vv.height > alturaBase) alturaBase = vv.height;                       // rotação / barra do navegador recolhendo
        const aberto = emCampo() && alturaBase - vv.height > 140;
        body.classList.toggle("teclado-aberto", aberto);
        doc.documentElement.style.setProperty("--vvh", vv.height + "px");
        if (aberto) rolarCampo();
    };
    let tRolar = 0;
    function rolarCampo() {
        clearTimeout(tRolar);
        tRolar = setTimeout(() => { guarda(() => doc.activeElement?.scrollIntoView({ block: "center", behavior: "smooth" })); }, 120);
    }
    vv?.addEventListener("resize", atualizaTeclado);
    vv?.addEventListener("scroll", () => { if (body.classList.contains("teclado-aberto")) doc.documentElement.style.setProperty("--vvh", vv.height + "px"); });
    doc.addEventListener("focusin", () => setTimeout(atualizaTeclado, 250));
    doc.addEventListener("focusout", () => setTimeout(() => { if (!emCampo()) body.classList.remove("teclado-aberto"); }, 120));
    addEventListener("orientationchange", () => { alturaBase = 0; setTimeout(() => { alturaBase = vv ? vv.height : innerHeight; atualizaTeclado(); }, 400); });

    // Enter no teclado do celular: "Próximo" nos campos do meio, "Ir/Enviar" no último do formulário
    const dicas = () => {
        doc.querySelectorAll("input, textarea").forEach((el) => {
            const t = (el.type || "text").toLowerCase();
            if (el.dataset.mob) return; el.dataset.mob = "1";
            if (!el.hasAttribute("enterkeyhint") && !/^(checkbox|radio|file|range|color|hidden|button|submit)$/.test(t) && el.tagName === "INPUT") {
                const caixa = el.closest("form, .sheet, .auth-card"), campos = caixa ? [...caixa.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea")] : [];
                el.setAttribute("enterkeyhint", campos.length && campos[campos.length - 1] === el ? "go" : "next");
            }
            if (t === "email" || t === "password" || t === "url" || el.dataset.mask === "doc" || el.dataset.mask === "tel") {
                if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "none");
                if (!el.hasAttribute("autocorrect")) el.setAttribute("autocorrect", "off");
                if (!el.hasAttribute("spellcheck")) el.setAttribute("spellcheck", "false");
            }
            if (el.dataset.mask === "tel" && !el.hasAttribute("inputmode")) el.setAttribute("inputmode", "tel");
            if (el.dataset.mask === "doc" && !el.hasAttribute("inputmode")) el.setAttribute("inputmode", "numeric");
            if (t === "text" && /nome|name/i.test(el.id + el.autocomplete) && !el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "words");
        });
    };
    dicas();
    new MutationObserver(() => { clearTimeout(dicas.t); dicas.t = setTimeout(dicas, 200); }).observe(body, { childList: true, subtree: true });

    // ---------- 3) vibração ao tocar no menu inferior ----------
    doc.addEventListener("click", (e) => { if (e.target.closest?.(".nav-item") && navigator.vibrate) guarda(() => navigator.vibrate(8)); }, { passive: true });

    // ---------- 4) sem internet ----------
    const faixa = doc.createElement("div"); faixa.className = "pw-offline"; faixa.setAttribute("role", "status"); faixa.textContent = "Sem internet — verificando a conexão…";
    body.appendChild(faixa);
    const rede = () => faixa.classList.toggle("on", navigator.onLine === false);
    addEventListener("online", rede); addEventListener("offline", rede); rede();

    // ---------- 5) instalar o app ----------
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const pagina = location.pathname;
    const ehApp = /(^|\/)(index|personal|parceiro)\.html$|\/painel-(aluno|personal)$|\/$/.test(pagina) && !/landing/.test(pagina);
    const recente = () => { const t = Number(lerLS("pw-instalar-ate") || 0); return t && Date.now() < t; };
    const adia = (dias) => gravaLS("pw-instalar-ate", String(Date.now() + dias * 864e5));
    if (!standalone && ehApp && !recente()) {
        let evento = null;
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
        const montar = (texto, acao) => {
            if (doc.querySelector(".pw-instalar")) return;
            const b = doc.createElement("div"); b.className = "pw-instalar"; b.setAttribute("role", "dialog"); b.setAttribute("aria-label", "Instalar o aplicativo");
            b.innerHTML = '<img src="icons/icon-192.png" alt="" width="40" height="40"><div class="txt"><b>Instale o Personow</b><span></span></div>' + (acao ? '<button type="button" class="ok">Instalar</button>' : "") + '<button type="button" class="x" aria-label="Fechar">✕</button>';
            b.querySelector(".txt span").textContent = texto; body.appendChild(b);
            // só aparece depois de a pessoa já ter usado um pouco (evita atrapalhar o login)
            setTimeout(() => { if (!body.classList.contains("teclado-aberto") && !doc.querySelector(".login-screen.active")) b.classList.add("on"); else setTimeout(() => b.classList.add("on"), 20000); }, 15000);
            b.querySelector(".x").onclick = () => { b.remove(); adia(14); };
            b.querySelector(".ok")?.addEventListener("click", async () => { if (!evento) return; b.remove(); evento.prompt(); const r = await evento.userChoice.catch(() => ({})); evento = null; adia(r.outcome === "accepted" ? 365 : 14); });
        };
        addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); evento = e; montar("Abre mais rápido, em tela cheia e com avisos das suas aulas.", true); });
        addEventListener("appinstalled", () => { doc.querySelector(".pw-instalar")?.remove(); adia(365); });
        if (ios) montar("Toque em Compartilhar e depois em “Adicionar à Tela de Início”.", false);
    }
})();
