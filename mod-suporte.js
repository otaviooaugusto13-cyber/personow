// Suporte: abrir chamado e conversar com a equipe.
import { css, esc, erroMsg } from "./mod-base.js";
export const portais = ["aluno", "personal"];
const ROTULO = { aberto: ["Aberto", "warn"], em_andamento: ["Em andamento", "accent"], resolvido: ["Resolvido", "ok"] };
const CATS = { pagamento: "Pagamento", aula: "Aula", conta: "Minha conta", personal: "Sobre um personal", app: "Problema no app", outro: "Outro" };
export async function iniciar(ctx) { css("style-modulos.css"); ctx.shell.adicionarItemMenu({ id: "suporte", icone: "💬", titulo: "Meus chamados", abrir: () => lista(ctx) }); }
async function lista(ctx) {
    const t = ctx.shell.abrirTela("Meus chamados", { id: "suporte" }); t.corpo.innerHTML = ctx.ui.skeleton(3);
    try {
        const ls = await ctx.consultar("suporte/chamados");
        t.corpo.innerHTML = `<button class="btn btn-primary mb" style="width:100%" data-novo>Novo chamado</button><div class="card">${ls.length ? ls.map((c) => `<button class="menu-item" data-id="${esc(c.id)}"><span class="grow"><strong>${esc(c.assunto)}</strong><div class="muted small">${esc(CATS[c.categoria] || "")}</div></span><span class="pill ${ROTULO[c.status]?.[1] || ""}">${esc(ROTULO[c.status]?.[0] || c.status)}</span></button>`).join("") : ctx.ui.vazio("💬", "Nenhum chamado", "Precisa de ajuda? Abra um chamado.")}</div>`;
        t.corpo.querySelector("[data-novo]").onclick = () => novo(ctx, t);
        t.corpo.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => conversa(ctx, t, b.dataset.id)));
    } catch (e) { t.corpo.innerHTML = `<div class="banner danger">${esc(erroMsg(e))}</div>`; }
}
function novo(ctx, t) {
    t.titulo("Novo chamado");
    t.corpo.innerHTML = `<form class="card" novalidate><div class="field"><label for="sc-cat">Assunto geral</label><select id="sc-cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div class="field"><label for="sc-ass">Título</label><input id="sc-ass" maxlength="100"></div><div class="field"><label for="sc-txt">Conte o que aconteceu</label><textarea id="sc-txt" rows="5" maxlength="1000"></textarea></div>
        <p class="msg-erro" data-erro></p><button class="btn btn-primary" style="width:100%" type="submit">Enviar</button></form><button class="btn btn-ghost mt" style="width:100%" data-voltar>Cancelar</button>`;
    t.corpo.querySelector("[data-voltar]").onclick = () => { t.titulo("Meus chamados"); lista(ctx); };
    t.corpo.querySelector("form").onsubmit = async (ev) => {
        ev.preventDefault();
        try { const r = await ctx.chamarFuncao("suporte/chamados", { categoria: t.corpo.querySelector("#sc-cat").value, assunto: t.corpo.querySelector("#sc-ass").value, texto: t.corpo.querySelector("#sc-txt").value }); ctx.ui.ok("Chamado enviado."); conversa(ctx, t, r.id); }
        catch (e) { t.corpo.querySelector("[data-erro]").textContent = erroMsg(e, "Não foi possível enviar."); }
    };
}
async function conversa(ctx, t, id) {
    t.titulo("Chamado"); t.corpo.innerHTML = ctx.ui.skeleton(2);
    try {
        const c = await ctx.consultar(`suporte/chamados/${id}`);
        t.corpo.innerHTML = `<div class="row between mb"><strong>${esc(c.assunto)}</strong><span class="pill ${ROTULO[c.status]?.[1] || ""}">${esc(ROTULO[c.status]?.[0] || c.status)}</span></div>
            <div>${c.mensagens.map((m) => `<div class="chamado-msg ${m.de === "equipe" ? "equipe" : ""}"><small>${esc(m.nome)}</small>${esc(m.texto)}</div>`).join("")}</div>
            <form class="mt" novalidate><div class="field"><textarea id="sc-resp" rows="3" maxlength="1000" placeholder="Escreva sua mensagem" aria-label="Mensagem"></textarea></div><p class="msg-erro" data-erro></p>
            <button class="btn btn-primary" style="width:100%" type="submit">Enviar</button></form><button class="btn btn-ghost mt" style="width:100%" data-voltar>Voltar</button>`;
        t.corpo.querySelector("[data-voltar]").onclick = () => { t.titulo("Meus chamados"); lista(ctx); };
        t.corpo.querySelector("form").onsubmit = async (ev) => { ev.preventDefault(); try { await ctx.chamarFuncao(`suporte/chamados/${id}/mensagens`, { texto: t.corpo.querySelector("#sc-resp").value }); conversa(ctx, t, id); } catch (e) { t.corpo.querySelector("[data-erro]").textContent = erroMsg(e, "Não foi possível enviar."); } };
    } catch (e) { t.corpo.innerHTML = `<div class="banner danger">${esc(erroMsg(e))}</div>`; }
}
