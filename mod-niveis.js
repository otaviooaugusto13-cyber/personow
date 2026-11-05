// Níveis (personal), conquistas e sequência semanal (aluno).
import { css, esc, erroMsg } from "./mod-base.js";
export const portais = ["aluno", "personal"];
const ICONE = { bronze: "🥉", prata: "🥈", ouro: "🥇", platina: "💎" };
export async function iniciar(ctx) {
    css("style-modulos.css");
    const personal = ctx.portal === "personal";
    ctx.shell.adicionarItemMenu({ id: "niveis", icone: personal ? "🏅" : "🔥", titulo: personal ? "Meu nível" : "Minhas conquistas", abrir: () => abrir(ctx) });
}
async function abrir(ctx) {
    const t = ctx.shell.abrirTela(ctx.portal === "personal" ? "Meu nível" : "Conquistas", { id: "niveis" }); t.corpo.innerHTML = ctx.ui.skeleton(3);
    try {
        const d = await ctx.consultar("niveis/eu"), conq = `<div class="conquistas">${d.conquistas.map((c) => `<div class="conquista ${c.ok ? "ok" : ""}"><span class="i">${c.icone}</span>${esc(c.titulo)}</div>`).join("")}</div>`;
        if (d.papel === "aluno") {
            t.corpo.innerHTML = `<div class="grid-2 mb"><div class="stat"><b>${d.aulas}</b><span>Aulas feitas</span></div><div class="stat"><b>${d.sequenciaSemanas}</b><span>Semanas seguidas</span></div></div>
                <div class="card"><h3 class="mb">Conquistas</h3>${conq}</div><p class="muted small mt">Treinar toda semana mantém sua sequência. 💪</p>`;
            return;
        }
        t.corpo.innerHTML = `<div class="card destaque mb"><div class="nivel-selo nivel-${esc(d.nivel.id)}">${ICONE[d.nivel.id] || "🏅"} ${esc(d.nivel.nome)}</div>
            <p class="muted small mt">${d.aulas} aulas concluídas${d.proximo ? ` · faltam ${d.faltam} para ${esc(d.proximo.nome)}` : " · nível máximo!"}</p>
            <div class="progresso mt"><i style="width:${Math.max(4, d.progressoPct)}%"></i></div></div>
            ${d.advertencias ? `<div class="banner warn mb">⚠️ Você tem ${d.advertencias}/${d.maxAdvertencias} advertências. Cancelamentos em cima da hora e não comparecimento geram advertência; ${d.maxAdvertencias} bloqueiam a conta.</div>` : ""}
            <div class="card mb"><h3 class="mb">Níveis</h3>${d.niveis.map((n) => `<div class="linha"><span>${ICONE[n.id] || ""} <strong>${esc(n.nome)}</strong></span><span class="muted small">${n.minAulas}+ aulas${d.comissaoPorNivel ? ` · comissão ${n.comissaoPct}%` : ""}</span></div>`).join("")}
            <p class="muted xs mt">Níveis mais altos ganham destaque na busca dos alunos.${d.comissaoPorNivel ? "" : ""}</p></div>
            <div class="card"><h3 class="mb">Conquistas</h3>${conq}</div>${d.formacaoOk ? `<p class="pill ok mt">🎓 Formado Personow</p>` : ""}`;
    } catch (e) { t.corpo.innerHTML = `<div class="banner danger">${esc(erroMsg(e))}</div>`; }
}
