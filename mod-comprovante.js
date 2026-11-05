// Comprovante de aula (sem valor fiscal) com código de verificação: lista as aulas pagas e abre o PDF.
import { css, brl, fmtData, esc, erroMsg } from "./mod-base.js";
import { baixarBlobProtegido } from "./firebase.js";
export const portais = ["aluno", "personal"];
export async function iniciar(ctx) { css("style-modulos.css"); ctx.shell.adicionarItemMenu({ id: "comprovante", icone: "📄", titulo: "Comprovantes de aula", abrir: () => abrir(ctx) }); }
async function abrir(ctx) {
    const t = ctx.shell.abrirTela("Comprovantes", { id: "comprovante" }); t.corpo.innerHTML = ctx.ui.skeleton(3);
    try {
        const e = await ctx.consultar("extrato");
        t.corpo.innerHTML = `<p class="muted small mb">Documento <strong>sem valor fiscal</strong>, com código para conferir em <a href="verificar.html" target="_blank" rel="noopener">verificar.html</a>.</p><div class="card mod-lista">${e.itens.length ? e.itens.map((i) => `<div class="linha"><div><strong>${esc(i.foco)}</strong><div class="muted small">${esc(fmtData(i.data))} · ${esc(i.horario)} · ${brl(i.totalPagoCentavos)}</div></div><button class="btn btn-ghost btn-sm" data-id="${esc(i.id)}">Abrir PDF</button></div>`).join("") : ctx.ui.vazio("📄", "Sem comprovantes", "Depois de pagar uma aula, o comprovante aparece aqui.")}</div>`;
        t.corpo.querySelectorAll("[data-id]").forEach((b) => (b.onclick = async () => {
            b.disabled = true;
            try { await ctx.chamarFuncao(`comprovante/${b.dataset.id}/emitir`, {}); const url = await baixarBlobProtegido(`comprovante/${b.dataset.id}/pdf`); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60000); }
            catch (x) { ctx.ui.erro(erroMsg(x)); }
            b.disabled = false;
        }));
    } catch (e) { t.corpo.innerHTML = `<div class="banner danger">${esc(erroMsg(e))}</div>`; }
}
