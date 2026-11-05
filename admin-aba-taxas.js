// Aba "Taxas e níveis": comissão por nível (opcional, desligada por padrão) e percentuais de cada nível. Rota: PUT /admin/taxas.
export default {
    id: "taxas", titulo: "Taxas e níveis", icone: "%",
    async render(raiz, ctx) {
        const { chamarFuncao, esc, toast } = ctx, sens = ctx.sensivel || ((fn) => fn());
        const t = await chamarFuncao("config/taxas", null);
        raiz.innerHTML = `<div class="ax-card"><h2>Comissão da plataforma</h2>
            <p class="ax-mut ax-sm ax-mb">Padrão: <strong>${t.comissaoBasePct}%</strong> do valor da aula para todos. Ligando a comissão por nível, cada personal paga o percentual do seu nível (quanto mais aulas, menor).</p>
            <label class="ax-row"><input type="checkbox" id="tx-lig"${t.comissaoPorNivel ? " checked" : ""}> <span>Comissão por nível ligada</span></label>
            <div class="ax-grid ax-g2 ax-mt">${t.niveis.map((n, i) => `<div><label class="ax-lbl" for="tx-n${i}">${esc(n.nome)} (${n.minAulas}+ aulas)</label><input class="ax-in" id="tx-n${i}" type="number" min="5" max="30" step="1" value="${n.comissaoPct}"></div>`).join("")}</div>
            <p class="ax-erro" id="tx-erro" role="alert"></p><button class="ax-btn pri ax-mt" id="tx-salvar">Salvar</button></div>`;
        raiz.querySelector("#tx-salvar").onclick = async () => {
            const body = { comissaoPorNivel: raiz.querySelector("#tx-lig").checked, niveisPct: t.niveis.map((_, i) => Number(raiz.querySelector(`#tx-n${i}`).value)) };
            try { await sens(() => chamarFuncao("admin/taxas", body, "PUT")); toast("Taxas salvas.", "ok"); } catch (e) { if (e?.code !== "cancelado") raiz.querySelector("#tx-erro").textContent = e?.message || "Não foi possível salvar."; }
        };
    }
};
