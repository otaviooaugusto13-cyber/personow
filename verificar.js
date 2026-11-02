// Verificação pública (sem login) de autenticidade do comprovante: POST /nota/verificar → { valida, numeroFmt, serie, emitidaEm, estornado }.
import { FUNCTIONS_BASE } from "./config.js";
import { esc, fmtDataHora } from "./core.js";
const $ = (i) => document.getElementById(i);
const q = new URLSearchParams(location.search); if (q.get("id")) $("v-id").value = q.get("id");
$("v-cod").addEventListener("input", () => { const d = $("v-cod").value.replace(/\D/g, "").slice(0, 24); $("v-cod").value = d.replace(/(.{4})/g, "$1 ").trim(); });
$("v-ok").addEventListener("click", async () => {
    const b = $("v-ok"), res = $("v-res"); b.disabled = true; res.innerHTML = '<span class="spinner"></span> Conferindo…';
    try {
        const r = await fetch(`${FUNCTIONS_BASE}/nota/verificar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: $("v-id").value.trim(), codigo: $("v-cod").value }) });
        if (r.status === 429) throw new Error("Muitas tentativas. Aguarde um minuto.");
        const j = await r.json();
        res.innerHTML = j.valida
            ? `<div class="card" style="border-color:#1f9d63"><h3 style="color:#1f9d63;margin:0 0 6px">✔ Documento autêntico</h3><p style="margin:0">Comprovante nº <strong>${esc(j.numeroFmt)}</strong>, série ${esc(j.serie)}, emitido em ${esc(fmtDataHora(j.emitidaEm))}.</p>${j.estornado ? '<p style="margin:8px 0 0;color:#c0392b"><strong>Atenção:</strong> o pagamento deste comprovante foi estornado; ele não tem mais efeito.</p>' : ""}</div>`
            : `<div class="card" style="border-color:#c0392b"><h3 style="color:#c0392b;margin:0 0 6px">✖ Não foi possível confirmar</h3><p style="margin:0">Os dados não correspondem a um comprovante emitido pelo Personow. Confira o código do documento e os 24 dígitos, ou desconfie do documento.</p></div>`;
    } catch (e) { res.innerHTML = `<p style="color:#c0392b">${esc(e.message || "Não foi possível conferir agora.")}</p>`; } finally { b.disabled = false; }
});
