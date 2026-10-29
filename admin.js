// Painel administrativo do Personow. Toda a autorização é do SERVIDOR (claim `admin` + rotas /admin/*); aqui só exibimos.
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, googleProvider, chamarFuncao, baixarCSVProtegido, renovarToken, souAdmin } from "./firebase.js";
import { brl, esc, fmtDataHora, fmtData } from "./core.js";
import { $ } from "./ui.js";

const msg = (t = "") => { $("ax-msg").textContent = t; };
const erro = (e) => msg(e?.code === "reautenticar" ? "Por segurança, saia e entre de novo." : (e?.message || "Falha na operação."));
const ts = (iso) => (iso ? fmtDataHora(iso) : "");
let statusAtual = "pendente", statusAulas = "paga";

// ---------- entrada ----------
$("ax-entrar").onclick = () => signInWithPopup(auth, googleProvider).catch(() => ($("ax-login-erro").textContent = "Não foi possível entrar com o Google."));
$("ax-sair").onclick = () => signOut(auth);
onAuthStateChanged(auth, async (u) => {
    $("ax-login").hidden = !!u; $("ax-app").hidden = true;
    if (!u) return;
    try { await renovarToken(); if (!(await souAdmin())) throw new Error("negado"); await chamarFuncao("admin/eu", null); }
    catch (e) { $("ax-login").hidden = false; $("ax-login-erro").textContent = "Esta conta não tem permissão de administrador."; await signOut(auth); return; }
    $("ax-quem").textContent = u.email || ""; $("ax-app").hidden = false;
    abrir("visao");
});

// ---------- navegação ----------
const TITULOS = { visao: "Visão geral", personais: "Personais", aulas: "Aulas", moderacao: "Moderação", auditoria: "Auditoria", config: "Aviso e exportação" };
function abrir(v) {
    msg();
    document.querySelectorAll("#ax-app section").forEach((s) => (s.hidden = s.id !== `v-${v}`));
    document.querySelectorAll("#ax-nav .ax-nav").forEach((b) => b.classList.toggle("sel", b.dataset.v === v));
    $("ax-titulo").textContent = TITULOS[v];
    ({ visao, personais, aulas, moderacao, auditoria, config }[v] || (() => {}))().catch(erro);
}
$("ax-nav").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) abrir(b.dataset.v); });
const aba = (id, fn) => $(id).addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (!b) return; document.querySelectorAll(`#${id} .ax-btn`).forEach((x) => x.classList.toggle("sel", x === b)); fn(b.dataset.s).catch(erro); });
aba("tabs-status", (s) => { statusAtual = s; return personais(); });
aba("tabs-aulas", (s) => { statusAulas = s; return aulas(); });

const linhas = (id, html, vazio, colunas) => { $(id).innerHTML = html || `<tr><td colspan="${colunas}" class="ax-mut">${esc(vazio)}</td></tr>`; };

// ---------- visão geral ----------
async function visao() {
    const r = await chamarFuncao("admin/financeiro/resumo", null);
    const k = (l, v) => `<div class="ax-card ax-kpi"><span class="l">${esc(l)}</span><span class="v">${esc(v)}</span></div>`;
    $("kpis").innerHTML = k("Aulas pagas", r.aulasPagas) + k("Volume", brl(r.volumeCentavos)) + k("Comissão da plataforma", brl(r.comissaoCentavos)) + k("Repassado aos personais", brl(r.repasseCentavos))
        + k("Ticket médio", brl(r.ticketMedioCentavos)) + k("Pedidos abertos", r.aulasAbertas) + k("Aulas aceitas (a pagar)", r.aulasAceitas) + k("Personais ativos", r.personaisAtivos) + k("Personais em análise", r.personaisPendentes);
    $("n-pend").hidden = !r.personaisPendentes; $("n-pend").textContent = r.personaisPendentes;
    if (r.amostraLimitada) msg("Atenção: o resumo considerou só as 1.000 primeiras aulas pagas. Use a exportação para o total.");
}

// ---------- personais ----------
async function personais() {
    const l = await chamarFuncao(`admin/personais?status=${statusAtual}`, null);
    linhas("tb-personais", l.map((p) => `<tr><td>${esc(p.nome)}</td><td>${esc(p.cref || "—")}</td><td>${esc(p.cidade || "—")}</td><td>${p.mpConectado ? "✓" : "—"}</td><td>${p.ratingQtd ? esc(String(p.ratingMedia).replace(".", ",")) + " (" + p.ratingQtd + ")" : "—"}</td><td><button class="ax-btn sm" data-ficha="${esc(p.uid)}">Analisar</button></td></tr>`).join(""), "Nenhum personal nesta situação.", 6);
}
$("tb-personais").addEventListener("click", (e) => { const b = e.target.closest("[data-ficha]"); if (b) ficha(b.dataset.ficha).catch(erro); });
async function ficha(uid) {
    const p = await chamarFuncao(`admin/personais/${encodeURIComponent(uid)}`, null);
    const exp = (p.experiencias || []).map((x) => `${esc(x.foco)} (${x.anos}a)`).join(", ") || "—";
    $("dlg-corpo").innerHTML = `<h2 class="ax-h2">${esc(p.nome)} <span class="ax-mut">· ${esc(p.status)}</span></h2><dl>
        <dt>CREF</dt><dd>${esc(p.cref || "—")}</dd><dt>CPF</dt><dd>${esc(p.cpfMascarado || "não informado")}</dd><dt>Idade</dt><dd>${p.idade ?? "—"}</dd>
        <dt>Telefone</dt><dd>${esc(p.telefone || "—")}</dd><dt>E-mail</dt><dd>${esc(p.email || "—")}</dd><dt>Cidade</dt><dd>${esc(p.cidade || "—")}</dd>
        <dt>Experiência</dt><dd>${exp}</dd><dt>Mercado Pago</dt><dd>${p.mpConectado ? "conectado" : "não conectado"}</dd>
        <dt>Infrações no chat</dt><dd>${p.infracoes}${p.revisaoManual ? " ⚠️ revisão manual" : ""}</dd><dt>Cadastro</dt><dd>${esc(ts(p.criadoEm))}</dd></dl>
        ${p.bio ? `<p class="ax-mut ax-xs">${esc(p.bio)}</p>` : ""}
        <textarea id="dlg-motivo" class="ax-in" rows="2" maxlength="300" placeholder="Mensagem para o personal (obrigatória para bloquear)"></textarea>
        <div class="ax-row ax-mt"><button class="ax-btn pri" data-acao="ativo">Aprovar</button><button class="ax-btn" data-acao="pendente">Devolver p/ análise</button><button class="ax-btn bad" data-acao="bloqueado">Bloquear</button>
        <button class="ax-btn" data-acao="recado">Só enviar recado</button><button class="ax-btn" data-acao="sessoes">Encerrar sessões</button></div>`;
    $("dlg-corpo").dataset.uid = uid; $("dlg").showModal();
}
$("dlg-corpo").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-acao]"); if (!b) return;
    const uid = $("dlg-corpo").dataset.uid, motivo = $("dlg-motivo").value.trim(), acao = b.dataset.acao;
    try {
        if (acao === "sessoes") { if (!confirm("Encerrar todas as sessões desta conta?")) return; await chamarFuncao(`admin/usuarios/${encodeURIComponent(uid)}/revogar-sessoes`, {}); }
        else if (acao === "recado") { await chamarFuncao(`admin/recado/personal/${encodeURIComponent(uid)}`, { texto: motivo }); }
        else { if (acao === "bloqueado" && !confirm("Bloquear este personal? A sessão dele será encerrada.")) return; await chamarFuncao(`admin/personais/${encodeURIComponent(uid)}/status`, { status: acao, motivo }); }
        $("dlg").close(); msg(""); await personais(); await visao();
    } catch (err) { $("dlg").close(); erro(err); }
});
$("dlg-fechar").onclick = () => $("dlg").close();

// ---------- aulas ----------
async function aulas() {
    const l = await chamarFuncao(`admin/aulas?status=${statusAulas}`, null);
    linhas("tb-aulas", l.map((a) => `<tr><td>${esc(fmtData(a.data))}</td><td>${esc(a.horario)}</td><td>${esc(a.foco)}</td><td>${esc(a.alunoNome)}</td><td>${esc(a.personalNome || "—")}</td><td>${a.valorCentavos != null ? brl(a.valorCentavos) : "—"}</td><td>${a.valorPersonalCentavos != null ? brl(a.valorPersonalCentavos) : "—"}</td></tr>`).join(""), "Nenhuma aula nesta situação.", 7);
}

// ---------- moderação / auditoria ----------
async function moderacao() {
    const r = await chamarFuncao("admin/moderacao", null);
    linhas("tb-reinc", r.reincidentes.map((x) => `<tr><td>${esc(x.uid)}</td><td>${x.total}</td><td>${esc(ts(x.ultimaEm))}</td><td><button class="ax-btn sm" data-rec="${esc(x.uid)}">Enviar recado (aluno)</button></td></tr>`).join(""), "Ninguém em revisão.", 4);
    linhas("tb-moder", r.ocorrencias.map((x) => `<tr><td>${esc(ts(x.criadoEm))}</td><td>${esc(x.uid)}</td><td>${esc(x.trecho)}</td></tr>`).join(""), "Nenhuma ocorrência.", 3);
}
$("tb-reinc").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rec]"); if (!b) return;
    const texto = prompt("Mensagem do suporte para esta conta:"); if (!texto) return;
    const tentar = async (tipo) => chamarFuncao(`admin/recado/${tipo}/${encodeURIComponent(b.dataset.rec)}`, { texto });
    try { await tentar("aluno"); msg("Recado enviado."); } catch (err) { try { await tentar("personal"); msg("Recado enviado."); } catch (e2) { erro(e2); } }
});
async function auditoria() {
    const l = await chamarFuncao("admin/auditoria?limite=200", null);
    linhas("tb-aud", l.map((a) => `<tr><td>${esc(ts(a.em))}</td><td>${esc(a.uid)}</td><td>${esc(a.acao)}</td><td>${esc(a.alvo)}</td></tr>`).join(""), "Sem registros.", 4);
}

// ---------- aviso e CSV ----------
async function config() {
    const a = await chamarFuncao("admin/aviso", null);
    $("av-ativo").checked = a.ativo; $("av-nivel").value = a.nivel; $("av-texto").value = a.texto;
}
$("av-salvar").onclick = () => chamarFuncao("admin/aviso", { ativo: $("av-ativo").checked, nivel: $("av-nivel").value, texto: $("av-texto").value.trim() }, "PUT").then(() => msg("Aviso salvo.")).catch(erro);
document.querySelectorAll("[data-csv]").forEach((b) => (b.onclick = () => baixarCSVProtegido(`admin/exportar/${b.dataset.csv}`, `personow-${b.dataset.csv}.csv`).catch(erro)));
