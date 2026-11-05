// Extrato: o que foi pago (aluno) ou recebido, com comissão e repasse (personal). Somente leitura — não há saque nem custódia.
import { css, brl, fmtData, esc, mesNome, erroMsg } from "./mod-base.js";
import { baixarCSVProtegido } from "./firebase.js";
export const portais = ["aluno", "personal"];
export async function iniciar(ctx) {
    css("style-modulos.css");
    ctx.shell.adicionarItemMenu({ id: "extrato", icone: "🧾", titulo: "Extrato", abrir: () => abrir(ctx) });
}
async function abrir(ctx, mes = "") {
    const t = ctx.shell.abrirTela("Extrato", { id: "extrato" }); t.corpo.innerHTML = ctx.ui.skeleton(3);
    try {
        const e = await ctx.consultar(`extrato${mes ? `?mes=${mes}` : ""}`), p = e.papel === "personal", r = e.resumo;
        const opcoes = [`<option value="">Todos os meses</option>`, ...e.meses.map((m) => `<option value="${esc(m.mes)}"${m.mes === mes ? " selected" : ""}>${esc(mesNome(m.mes))}</option>`)].join("");
        t.corpo.innerHTML = `
            <div class="grid-2 mb">${p
                ? `<div class="stat"><b>${brl(r.repasseCentavos)}</b><span>Recebido (repasse)</span></div><div class="stat"><b>${brl(r.comissaoCentavos)}</b><span>Comissão Personow</span></div>`
                : `<div class="stat"><b>${brl(r.totalPagoCentavos)}</b><span>Total pago</span></div><div class="stat"><b>${r.aulas}</b><span>Aulas pagas</span></div>`}</div>
            <div class="row between mb"><select id="ex-mes" class="field" style="margin:0;padding:10px;border-radius:12px;background:var(--surface-2);color:var(--text);border:1px solid var(--line-strong)" aria-label="Mês">${opcoes}</select>
                <button class="btn btn-ghost btn-sm" id="ex-csv">Baixar CSV</button></div>
            <div class="card mod-lista">${e.itens.length ? e.itens.map((i) => `<div class="linha"><div><strong>${esc(i.foco)} · ${esc(i.contraparte)}</strong><div class="muted small">${esc(fmtData(i.data))} · ${esc(i.horario)}</div></div>
                <div class="valor">${brl(p ? i.repasseCentavos : i.totalPagoCentavos)}${p ? `<div class="muted xs">comissão ${brl(i.comissaoCentavos)}</div>` : ""}</div></div>`).join("") : ctx.ui.vazio("🧾", "Nada por aqui ainda", "As aulas pagas aparecem neste extrato.")}</div>
            <p class="muted xs mt">${p ? "O repasse é feito direto na sua conta Mercado Pago no momento do pagamento." : "Pagamentos processados pelo Mercado Pago."}</p>`;
        t.corpo.querySelector("#ex-mes").onchange = (ev) => abrir(ctx, ev.target.value);
        t.corpo.querySelector("#ex-csv").onclick = () => baixarCSVProtegido(`extrato.csv${mes ? `?mes=${mes}` : ""}`, `extrato-${mes || "geral"}.csv`).catch((x) => ctx.ui.erro(erroMsg(x)));
    } catch (e) { t.corpo.innerHTML = `<div class="banner danger">${esc(erroMsg(e))}</div>`; }
}
