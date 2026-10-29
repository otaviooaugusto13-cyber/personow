// ============================================================
// PERSONOW — recado do suporte (admin → aluno/personal)
// O admin escreve (painel → "Recado", ou o motivo de "Devolver p/ análise"/"Bloquear"); o servidor grava `recado` no documento da
// própria pessoa; aqui só exibimos. "Entendi" apaga o recado pela API (o navegador nunca escreve nele).
// ============================================================
import { esc } from "./core.js";
import { chamarFuncao } from "./firebase.js";
import { WHATSAPP_SUPORTE } from "./config.js";

const TITULO = { pendente: "Seu cadastro precisa de ajustes", bloqueado: "Acesso suspenso", info: "Mensagem do suporte" };

/** Mostra (ou remove) o aviso no TOPO de `container`. `recado` = { texto, tipo } ou vazio. `tipo` = "aluno" | "personal". */
export function pintarRecado(container, recado, tipo) {
    document.getElementById("banner-recado")?.remove();
    if (!container || !recado?.texto) return;
    const zap = `https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent(`Olá! Recebi uma mensagem do suporte do Personow: "${String(recado.texto).slice(0, 120)}"`)}`;
    const el = document.createElement("div");
    el.id = "banner-recado"; el.className = "aviso-box banner-recado"; el.setAttribute("role", "status");
    el.innerHTML = `<span aria-hidden="true">💬</span><div class="grow"><strong>${esc(TITULO[recado.tipo] || TITULO.info)}</strong><br><span>${esc(recado.texto)}</span>
        <div class="acoes"><a class="btn-mini primario" target="_blank" rel="noopener" href="${esc(zap)}">Responder no WhatsApp</a><button type="button" class="btn-mini" data-lido>Entendi</button></div></div>`;
    el.querySelector("[data-lido]").addEventListener("click", async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { await chamarFuncao("perfil/recado/lido", { tipo }); el.remove(); } catch (err) { console.warn(err); b.disabled = false; }
    });
    container.prepend(el);
}
