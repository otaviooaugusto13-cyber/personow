// ============================================================
// PERSONOW — recado do suporte (admin → personal/aluno)
// O admin escreve (painel → "Recado" ou o motivo de "Voltar p/ análise"/"Bloquear"); o servidor grava em `recado` no
// documento da própria pessoa; aqui só exibimos. "Entendi" apaga o recado pela API (o navegador nunca escreve nele).
// ============================================================
import { esc } from "./core.js";
import { chamarFuncao } from "./firebase.js";
import { WHATSAPP_SUPORTE } from "./config.js";
import { abrirSuporte } from "./suporte.js";

const TITULO = { pendente: "Seu cadastro precisa de ajustes", bloqueado: "Acesso suspenso", info: "Mensagem do suporte" };

/** Mostra (ou remove) o aviso logo depois de `ancora`. `recado` = { texto, tipo } ou vazio. */
export function pintarRecado(ancora, recado) {
    document.getElementById("banner-recado")?.remove();
    if (!ancora || !recado?.texto) return;
    const zap = `https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent(`Olá! Recebi uma mensagem do suporte do Personow: "${String(recado.texto).slice(0, 120)}"`)}`;
    const el = document.createElement("div");
    el.id = "banner-recado"; el.className = "banner mb"; el.setAttribute("role", "status");
    el.innerHTML = `<span class="ico">💬</span><div class="grow"><strong>${esc(TITULO[recado.tipo] || TITULO.info)}</strong><br><span>${esc(recado.texto)}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="btn btn-primary btn-sm" data-responder>Responder</button><button type="button" class="btn btn-ghost btn-sm" data-lido>Entendi</button></div></div>`;
    el.querySelector("[data-responder]").addEventListener("click", () => { if (!abrirSuporte()) window.open(zap, "_blank", "noopener"); });   // sem chat iniciado, cai no WhatsApp
    el.querySelector("[data-lido]").addEventListener("click", async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { await chamarFuncao("perfil/recado/lido", {}); el.remove(); } catch (err) { console.warn(err); b.disabled = false; }
    });
    ancora.after(el);
}
