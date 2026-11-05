// Painel da academia parceira (somente leitura, agregado). Claim `academia:true` concedida pelo admin; primeiro acesso por convite de e-mail.
import { chamarFuncao, consultar, renovarToken, sairDaConta } from "./firebase.js";
import { iniciarAcesso } from "./acesso.js";
import { esc, fmtData } from "./core.js";
const $ = (id) => document.getElementById(id);
let acesso = null, idAtual = "";
$("ac-sair").addEventListener("click", () => acesso?.sair());
$("ac-dias").addEventListener("change", () => carregar());

async function carregar() {
    const c = $("ac-corpo"); c.innerHTML = '<p class="ax-mut">Carregando…</p>';
    try {
        const p = await consultar(`academia/painel?dias=${$("ac-dias").value}${idAtual ? `&id=${encodeURIComponent(idAtual)}` : ""}`);
        $("ac-titulo").textContent = p.academia.nome; idAtual = p.academia.id;
        const k = p.kpis, max = Math.max(1, ...p.porHora);
        c.innerHTML = `${p.academias.length > 1 ? `<select class="ax-in ax-mb" id="ac-troca" aria-label="Academia">${p.academias.map((a) => `<option value="${esc(a.id)}"${a.id === idAtual ? " selected" : ""}>${esc(a.nome)}</option>`).join("")}</select>` : ""}
            <div class="ax-grid ax-g3 ax-mb">${[["Aulas realizadas", k.aulasRealizadas], ["Agendadas e pagas", k.aulasPagasAgendadas], ["Personais ativos", k.personaisAtivos]].map(([t, v]) => `<div class="ax-card"><div class="ax-mut ax-sm">${t}</div><div style="font-size:28px;font-weight:800">${esc(v)}</div></div>`).join("")}</div>
            <div class="ax-card ax-mb"><h2>Horários de pico</h2><p class="ax-mut ax-sm">${p.picos.length ? p.picos.map((x) => `${esc(x.faixa)} (${x.aulas})`).join(" · ") : "Sem dados no período."}${p.diaPico ? ` · Dia mais movimentado: ${esc(p.diaPico)}` : ""}</p>
            <div style="display:flex;align-items:flex-end;gap:3px;height:90px;margin-top:12px" role="img" aria-label="Aulas por hora do dia">${p.porHora.map((n, h) => `<div title="${h}h: ${n}" style="flex:1;background:#3B82F6;border-radius:3px 3px 0 0;height:${Math.round((n / max) * 100)}%;min-height:2px"></div>`).join("")}</div></div>
            <div class="ax-card"><h2>Por foco</h2>${p.porFoco.length ? p.porFoco.map((f) => `<div class="ax-row ax-mb"><span class="ax-grow">${esc(f.foco)}</span><strong>${f.aulas}</strong></div>`).join("") : '<p class="ax-mut">Sem aulas no período.</p>'}</div>`;
        c.querySelector("#ac-troca")?.addEventListener("change", (e) => { idAtual = e.target.value; carregar(); });
    } catch (e) {
        if (e.code === "sem-permissao" || e.code === "sem-academia") {
            try { const r = await chamarFuncao("academia/reivindicar", {}); if (r.atualizarToken) { await renovarToken(); return carregar(); } } catch (x) { c.innerHTML = `<div class="ax-card"><p class="ax-erro">${esc(x.message)}</p></div>`; return; }
        }
        c.innerHTML = `<div class="ax-card"><p class="ax-erro">${esc(e.message || "Não foi possível carregar.")}</p></div>`;
    }
}
// Login: usa o fluxo de acesso (sem /sessao: a autorização real é a claim `academia`, conferida no servidor).
acesso = iniciarAcesso({
    portal: "academia", semSessao: true, container: "ac-acesso", estilo: "ax", permitirCriar: false,
    mostrarLogin: () => { $("ac-login").hidden = false; $("ac-app").hidden = true; },
    aoSair: () => { $("ac-login").hidden = false; $("ac-app").hidden = true; },
    aoPronto: () => { $("ac-login").hidden = true; $("ac-app").hidden = false; carregar(); }
});
