// Formação opcional do personal: módulos curtos + prova (corrigida no servidor). Concluir dá o selo "Formado Personow".
import { css, esc, erroMsg } from "./mod-base.js";
export const portais = ["personal"];
export async function iniciar(ctx) { css("style-modulos.css"); ctx.shell.adicionarItemMenu({ id: "formacao", icone: "🎓", titulo: "Formação", abrir: () => lista(ctx) }); }
async function lista(ctx) {
    const t = ctx.shell.abrirTela("Formação", { id: "formacao" }); t.corpo.innerHTML = ctx.ui.skeleton(3);
    try {
        const d = await ctx.consultar("formacao");
        t.corpo.innerHTML = `<div class="card destaque mb"><strong>${d.formado ? "🎓 Formado Personow" : `${d.concluidos}/${d.total} módulos concluídos`}</strong><div class="progresso mt"><i style="width:${Math.round((d.concluidos / d.total) * 100)}%"></i></div>
            <p class="muted small mt">Opcional: não impede você de aceitar aulas. Quem conclui ganha o selo e mais destaque para os alunos. Nota mínima ${d.notaMinima}%.</p></div>
            <div class="card">${d.modulos.map((m) => `<button class="menu-item" data-id="${esc(m.id)}"><span>${m.aprovado ? "✅" : "📘"}</span><span class="grow"><strong>${esc(m.titulo)}</strong><div class="muted small">${m.minutos} min${m.nota != null ? ` · nota ${m.nota}%` : ""}</div></span><span class="seta">›</span></button>`).join("")}</div>`;
        t.corpo.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => modulo(ctx, d.modulos.find((m) => m.id === b.dataset.id), t)));
    } catch (e) { t.corpo.innerHTML = `<div class="banner danger">${esc(erroMsg(e))}</div>`; }
}
function modulo(ctx, m, pai) {
    pai.titulo(m.titulo);
    pai.corpo.innerHTML = `<div class="card mb">${m.conteudo.map((p) => `<p class="mb" style="line-height:1.6">${esc(p)}</p>`).join("")}</div>
        <form class="card" novalidate><h3 class="mb">Prova</h3>${m.perguntas.map((q, i) => `<fieldset style="border:0;padding:0;margin:0 0 6px"><legend style="font-weight:700;margin-bottom:6px">${i + 1}. ${esc(q.p)}</legend><div class="opcoes-prova">${q.o.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}"> <span>${esc(o)}</span></label>`).join("")}</div></fieldset>`).join("")}
        <p class="msg-erro" data-erro></p><button class="btn btn-primary" style="width:100%" type="submit">Enviar respostas</button></form>
        <button class="btn btn-ghost mt" style="width:100%" data-voltar>Voltar aos módulos</button>`;
    pai.corpo.querySelector("[data-voltar]").onclick = () => { pai.titulo("Formação"); lista(ctx); };
    pai.corpo.querySelector("form").onsubmit = async (ev) => {
        ev.preventDefault();
        const resp = m.perguntas.map((_, i) => { const c = ev.target.querySelector(`input[name=q${i}]:checked`); return c ? Number(c.value) : -1; });
        if (resp.includes(-1)) { ev.target.querySelector("[data-erro]").textContent = "Responda todas as perguntas."; return; }
        try {
            const r = await ctx.chamarFuncao(`formacao/modulos/${m.id}/prova`, { respostas: resp });
            if (r.atualizarToken) await import("./firebase.js").then((f) => f.renovarToken());
            ctx.ui.toast(r.aprovado ? `Aprovado com ${r.nota}%! 🎉` : `Nota ${r.nota}%. Releia o conteúdo e tente de novo.`, r.aprovado ? "ok" : "erro");
            if (r.formado) ctx.ui.toast("🎓 Você agora é Formado Personow!", "ok");
            if (r.aprovado) { pai.titulo("Formação"); lista(ctx); }
        } catch (e) { ev.target.querySelector("[data-erro]").textContent = erroMsg(e, "Não foi possível enviar."); }
    };
}
