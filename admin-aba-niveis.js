// Aba "Advertências": aplica advertência a um personal (3 = bloqueio). Rota: POST /admin/personais/:uid/advertencia.
export default {
    id: "niveis", titulo: "Advertências", icone: "⚠",
    async render(raiz, ctx) {
        const { chamarFuncao, toast } = ctx, sens = ctx.sensivel || ((fn) => fn());
        raiz.innerHTML = `<div class="ax-card"><h2>Advertir personal</h2><p class="ax-mut ax-sm ax-mb">Cancelamento em cima da hora, não comparecimento ou quebra das regras. Na 3ª advertência a conta é bloqueada e a sessão cai. O personal vê o motivo.</p>
            <label class="ax-lbl" for="ad-uid">UID do personal (copie da fila de aprovação ou da ficha)</label><input class="ax-in" id="ad-uid" maxlength="128">
            <label class="ax-lbl ax-mt" for="ad-motivo">Motivo (mín. 5 caracteres)</label><textarea class="ax-ta" id="ad-motivo" rows="3" maxlength="300"></textarea>
            <p class="ax-erro" id="ad-erro" role="alert"></p><button class="ax-btn pri ax-mt" id="ad-enviar">Aplicar advertência</button></div>`;
        raiz.querySelector("#ad-enviar").onclick = async () => {
            const uid = raiz.querySelector("#ad-uid").value.trim(), motivo = raiz.querySelector("#ad-motivo").value.trim();
            try { const r = await sens(() => chamarFuncao(`admin/personais/${encodeURIComponent(uid)}/advertencia`, { motivo })); toast(r.bloqueado ? "Personal bloqueado (3ª advertência)." : `Advertência ${r.advertencias}/3 aplicada.`, "ok"); raiz.querySelector("#ad-erro").textContent = ""; }
            catch (e) { if (e?.code !== "cancelado") raiz.querySelector("#ad-erro").textContent = e?.message || "Não foi possível aplicar."; }
        };
    }
};
