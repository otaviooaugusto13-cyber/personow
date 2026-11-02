// ============================================================
// PERSONOW — painel B2B (parceiros/indústrias). Atualiza a cada 15 s (consulta ao servidor; o Firestore não é aberto a parceiros).
// ============================================================
import { signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, googleProvider, chamarFuncao, consultar, renovarToken, papelAtual } from "./firebase.js";
import { esc, fmtDataHora } from "./core.js";
import { $, erro, iniciarTema, alternarTema, registrarSW } from "./ui.js";
import { abrirFoto, chip, } from "./parceiro-ui.js";

iniciarTema(); registrarSW();
const tela = (id) => document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
let timer = null, regioesMontadas = "";

$("btn-login").addEventListener("click", async () => {
    try { await signInWithPopup(auth, googleProvider); } catch (e) { if (e.code === "auth/popup-blocked") { try { await signInWithRedirect(auth, googleProvider); } catch (e2) { erro("Não foi possível entrar."); } } else if (!/popup-closed|cancelled/.test(e.code || "")) erro("Não foi possível entrar com o Google."); }
});
const sair = async () => { clearInterval(timer); await signOut(auth); };
$("btn-sair").addEventListener("click", sair); $("btn-espera-sair").addEventListener("click", sair);
$("theme-toggle").addEventListener("change", alternarTema);
$("btn-atualizar").addEventListener("click", () => carregar(true)); $("f-dias").addEventListener("change", () => carregar(true)); $("f-regiao").addEventListener("change", () => carregar(true));
$("btn-liberado").addEventListener("click", async () => { try { await renovarToken(); await entrar(auth.currentUser); } catch (e) { erro("Ainda sem acesso. Confirme com a equipe do Personow."); } });

onAuthStateChanged(auth, async (u) => { clearInterval(timer); if (!u) return tela("screen-login"); try { await entrar(u); } catch (e) { console.error(e); erro("Não foi possível carregar o painel."); } });

async function entrar(u) {
    const papel = await papelAtual();
    if (papel !== "parceiro") { $("espera-email").textContent = u.email || ""; if (papel) $("espera-msg").textContent = "Esta conta tem outro perfil (aluno, personal ou admin). Entre com outra conta Google."; return tela("screen-espera"); }
    tela("screen-painel"); await carregar(true); timer = setInterval(() => { if (!document.hidden) carregar(false); }, 15_000);
}

async function carregar(forcar) {
    try {
        const d = await consultar(`b2b/painel?dias=${encodeURIComponent($("f-dias").value)}&regiao=${encodeURIComponent($("f-regiao").value)}`);
        pintar(d);
    } catch (e) {
        if (e.code === "sem-parceiro" || e.code === "sem-permissao") { $("espera-email").textContent = auth.currentUser?.email || ""; clearInterval(timer); return tela("screen-espera"); }
        if (forcar) erro(e.message || "Não foi possível atualizar.");
    }
}

const num = (n, c = 0) => Number(n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: c });
function pintar(d) {
    const k = d.kpis;
    $("b-parceiro").textContent = d.parceiros.map((m) => m.nome).join(" · ") || "Painel do parceiro";
    $("b-atual").textContent = `Últimos ${d.periodoDias} dias${d.regiao ? ` · ${d.regiao}` : ""}`;
    const chave = d.regioes.join("|"); if (chave !== regioesMontadas) { const sel = $("f-regiao").value; $("f-regiao").innerHTML = '<option value="">Todas as regiões</option>' + d.regioes.map((r) => `<option ${r === sel ? "selected" : ""} value="${esc(r)}">${esc(r)}</option>`).join(""); regioesMontadas = chave; }
    $("kpis").innerHTML = [
        ["Chamados", num(k.chamados), `${k.executados} executados`], ["Horas trabalhadas", num(k.horasTotal, 1), "em campo, por GPS"], ["Aula completa", k.taxaAulaCompleta === null ? "—" : k.taxaAulaCompleta + "%", "declarada no check-out", true],
        ["Fotos de auditoria", num(k.fotosAuditoria), `${k.auditoriaContestada} contestadas pelo aluno`], ["Personais", num(k.personais), "diferentes atendendo"], ["Check-ins negados", num(k.checkinsNegados), "fora do raio de 100 m"]
    ].map(([t, v, s, dest]) => `<div class="glass-card kpi ${dest ? "destaque" : ""}"><span>${esc(t)}</span><strong>${esc(v)}</strong><small>${esc(s)}</small></div>`).join("");
    const maxH = Math.max(...d.porRegiao.map((r) => r.horas), 1);
    $("g-regioes").innerHTML = d.porRegiao.length ? d.porRegiao.map((r) => `<div class="barra-h"><span>${esc(r.regiao)}</span><div class="trilho"><i style="width:${(r.horas / maxH) * 100}%"></i></div><b>${num(r.horas, 1)} h</b></div>`).join("") : '<p class="muted small">Sem execuções no período.</p>';
    const p = k.taxaAulaCompleta ?? 0;
    $("g-conclusao").innerHTML = `<div class="donut" style="--p:${p}"><div><span>${k.taxaAulaCompleta === null ? "—" : p + "%"}<small>completas</small></span></div></div><p class="muted small center mt">${k.executados} serviços executados</p>`;
    $("n-vivo").textContent = d.aoVivo.length ? `${d.aoVivo.length} em andamento` : ""; $("n-vivo").hidden = !d.aoVivo.length;
    $("g-vivo").innerHTML = d.aoVivo.length ? d.aoVivo.map((v) => `<div class="vivo-linha"><span><b>${esc(v.personal)}</b><br><span class="muted small">${esc(v.aluno)} · ${esc(v.regiao)}</span></span><span class="muted small">desde ${new Date(v.desde).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></div>`).join("") : '<p class="muted small">Nenhum personal em aluno neste momento.</p>';
    $("g-rank").innerHTML = d.ranking.length ? d.ranking.map((r, i) => `<div class="rank-linha"><span class="pos">${i + 1}</span><span><b>${esc(r.nome)}</b> ${chip(r.nivel)}<br><span class="muted small">${r.chamados} chamados · ${num(r.horas, 1)} h · cheia ${r.taxaCompleta}%${r.pontualidade !== null ? ` · pontual ${r.pontualidade}%` : ""}${r.nota ? ` · ★ ${num(r.nota, 1)}` : ""}</span></span><span class="score">${r.score}<small>score</small></span></div>`).join("") : '<p class="muted small">O ranking aparece após as primeiras execuções.</p>';
    $("g-fotos").innerHTML = d.fotos.length ? d.fotos.map((f) => `<button type="button" class="foto-card" data-foto="${esc(f.id)}" data-leg="${esc(f.aluno)}"><img src="${esc(f.miniatura)}" alt="Local — ${esc(f.aluno)}" loading="lazy"><div><b>${esc(f.aluno)}</b>${esc(f.personal)} · ${fmtDataHora(f.em)}<br>${f.conclusao === "completa" ? "✅ cheia" : "🟡 parcial"}${f.auditoria ? ` · aluno: ${esc(f.auditoria)}` : ""}</div></button>`).join("") : '<p class="muted small">Ainda não há fotos.</p>';
    $("g-presenca").innerHTML = `<thead><tr><th>Aluno</th><th>Região</th><th>Personal</th><th>Entrada</th><th>Saída</th><th>Tempo</th><th>Distância (check-in)</th><th>GPS</th></tr></thead><tbody>${d.presencas.map((x) => `<tr><td>${esc(x.aluno)}</td><td>${esc(x.regiao)}</td><td>${esc(x.personal)}</td><td>${fmtDataHora(x.entrada)}</td><td>${fmtDataHora(x.saida)}</td><td>${x.minutos ?? "—"} min</td><td>${x.distanciaM ?? "—"} m${x.precisaoM ? ` (±${x.precisaoM})` : ""}</td><td class="${x.noRaio ? "ok-gps" : "mau-gps"}">${x.noRaio ? "✔ no raio" : "✖ fora"}${x.simulado ? " · teste" : ""}</td></tr>`).join("") || '<tr><td colspan="8" class="muted">Sem registros.</td></tr>'}</tbody>`;
    $("b-rodape").textContent = `Atualizado às ${new Date(d.geradoEm).toLocaleTimeString("pt-BR")} · atualização automática a cada 15 s`;
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-foto]"); if (b) abrirFoto(`b2b/foto/${encodeURIComponent(b.dataset.foto)}`, b.dataset.leg); });
