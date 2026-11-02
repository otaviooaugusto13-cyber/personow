// Painel administrativo. A autorização é do SERVIDOR (claim role=admin); esta tela só consome a API e lê o Firestore
// com as permissões que as regras já concedem ao admin (personais, alunos, aulas).
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, reauthenticateWithPopup, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, query, where, orderBy, limit, onSnapshot, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db, googleProvider, entrarComGoogle, concluirLoginGoogle, chamarFuncao, consultar, baixarCSVProtegido, papelAtual, renovarToken } from "./firebase.js";
import { resolverAcesso } from "./acesso.js";
import { iniciarEquipeTI } from "./admin-ti.js";
import { ativarPush, desativarPush } from "./push.js";
import "./presenca.js";                       // contador de usuários online (painel de TI)
import { NOME_SUPORTE } from "./config.js";
import { brl, esc, fmtDataHora, fmtData, hojeLocal, soDigitos, mascaraDoc, mascaraTelefone, mascaraCPF, reaisParaCentavos } from "./core.js";

const $ = (id) => document.getElementById(id);
const dt = (v) => fmtDataHora(v) || "—";
const msg = (t = "") => { $("ax-msg").textContent = t; };
const S = { sup: [], supUid: "", supMsgs: [], supUn: null, vista: "visao", ut: "personal", us: "pendente", fa: "pag", missoes: [], alunos: [], pend: [], promo: [], mods: [], aud: [], pagos: [], conc: [], ativos: null, totAlunos: null };
const unsubs = [];
const TITULOS = { visao: "Visão geral", usuarios: "Usuários", missoes: "Missões", financeiro: "Financeiro", treino: "Treinamento", habil: "Habilitações", infracoes: "Infrações e multas", parceiros: "Parceiros (B2B)", moderacao: "Moderação e logs", config: "Configurações", ti: "Equipe de TI", suporte: "Suporte" };
const ST = { aberta: ["Aguardando", "b"], aceita: ["Aceita", "y"], paga: ["Paga", "g"], concluida: ["Concluída", "g"], cancelada: ["Cancelada", "r"] };
const badge = (s) => { const [t, c] = ST[s] || [s || "—", ""]; return `<span class="ax-badge ${c}">${esc(t)}</span>`; };
const td = (l, h, c = "") => `<td data-l="${esc(l)}"${c ? ` class="${c}"` : ""}>${h}</td>`;
const vazio = (n, t) => `<tr><td colspan="${n}" class="ax-empty">${esc(t)}</td></tr>`;
const tsDate = (t) => (t?.toDate ? t.toDate() : t ? new Date(t) : null);
const hm = (t) => tsDate(t)?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "";
const presenca = (m) => (m.checkoutEm ? `<span class="ax-ok">✓ ${hm(m.checkinEm)}–${hm(m.checkoutEm)}</span>${(m.divergencias || []).length ? ' <span class="ax-badge r">divergência</span>' : ""}` : m.checkinEm ? `<span class="ax-warn">desde ${hm(m.checkinEm)}</span>` : "—");
const buscaOk = (campos, q) => !q || campos.some((c) => String(c ?? "").toLowerCase().includes(q));

// ---------- toasts, erros, diálogos ----------
function toast(texto, tipo = "", ms = 7000, destino = "") {
    const el = document.createElement("div"); el.className = "ax-toast " + tipo;
    el.innerHTML = `<span class="t">${esc(texto)}</span><button aria-label="Fechar">×</button>`;
    el.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); el.remove(); });
    if (destino) { el.querySelector(".t").style.cursor = "pointer"; el.querySelector(".t").addEventListener("click", () => { el.remove(); ir(destino); }); }
    $("ax-toasts").append(el); if (ms) setTimeout(() => el.remove(), ms);
}
const seguro = (fn) => async (...a) => { msg(); try { await fn(...a); } catch (e) { console.error(e); msg(e.message || "Erro"); toast(e.message || "Erro inesperado.", "err"); } };
/** Ações de dinheiro exigem login recente: confirma com a senha (conta e-mail/senha) ou com o Google, e repete uma vez. */
async function sensivel(fn) {
    try { return await fn(); } catch (e) {
        if (e.code !== "reautenticar") throw e;
        const u = auth.currentUser, porSenha = u?.providerData?.some((p) => p.providerId === "password") && !u.providerData.some((p) => p.providerId === "google.com");
        try {
            if (porSenha) {
                const s = await pedirSenha(); if (!s) throw Object.assign(new Error("Ação cancelada."), { code: "cancelado" });
                await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, s));
            } else await reauthenticateWithPopup(u, googleProvider);   // confirmação rápida em popup; se o navegador bloquear, cai no catch abaixo
        } catch (e2) { throw e2.code === "cancelado" ? e2 : Object.assign(new Error(porSenha ? "Senha incorreta." : "Não foi possível confirmar sua identidade. Tente de novo."), { code: "reauth-falhou" }); }
        await renovarToken(); return fn();
    }
}
/** Pede a senha atual no mesmo diálogo dos outras aulas (campo de senha, nada fica guardado); null se cancelar. */
const pedirSenha = () => pedir({ titulo: "Confirme sua identidade", texto: "Por segurança, digite sua senha atual para continuar.", rotulo: "Senha atual", min: 1, ok: "Confirmar", senha: true });
/** Substitui prompt()/confirm(): retorna true/texto ao confirmar, null ao cancelar. */
const MODELOS = [
    ["Conferir CPF", "Olá, tudo bem? O CPF informado no seu cadastro não confere. Fale com o suporte pelo WhatsApp informando o CPF correto para a gente corrigir e liberar seu acesso."],
    ["Conferir nascimento", "Olá! A data de nascimento do seu cadastro não confere com seu documento. Fale com o suporte pelo WhatsApp para corrigirmos e liberar seu acesso."],
    ["CREF pendente", "Olá! Para liberar seu acesso falta informar o número do seu CREF. Complete essa etapa em Meus dados ou fale com o suporte pelo WhatsApp."],
    ["Treinamento", "Olá! Para liberar as aulas falta concluir o capacitação Personow. Assim que terminar, é só nos avisar."],
    ["Só um oi", "Oi, tudo bem? Passando para falar do seu cadastro no Personow. Pode nos responder pelo WhatsApp?"]
];
function pedir({ titulo, texto = "", rotulo = "", min = 0, ok = "Confirmar", perigo = false, modelos = false, senha = false }) {
    const d = $("ax-dlg"), i = $(senha ? "ax-dlg-s" : "ax-dlg-i"), b = $("ax-dlg-ok");
    $("ax-dlg-i").hidden = senha; $("ax-dlg-s").hidden = !senha; $("ax-dlg-l").htmlFor = i.id;
    $("ax-dlg-m")?.remove();
    if (modelos && rotulo) {                                                    // atalhos de mensagem pronta (o admin ainda pode editar)
        const m = document.createElement("div"); m.id = "ax-dlg-m"; m.className = "ax-row"; m.style.cssText = "flex-wrap:wrap;gap:6px;margin-bottom:8px";
        for (const [nome, msg] of MODELOS) { const x = document.createElement("button"); x.type = "button"; x.className = "ax-btn sm"; x.textContent = nome; x.addEventListener("click", () => { i.value = msg; i.focus(); }); m.appendChild(x); }
        $("ax-dlg-c").insertBefore(m, $("ax-dlg-l"));
    }
    $("ax-dlg-t").textContent = titulo; $("ax-dlg-p").textContent = texto; $("ax-dlg-c").hidden = !rotulo; $("ax-dlg-l").textContent = rotulo;
    i.value = ""; $("ax-dlg-e").textContent = ""; b.textContent = ok; b.className = "ax-btn " + (perigo ? "danger" : "pri");
    return new Promise((res) => {
        const validar = (ev) => { if (rotulo && i.value.trim().length < min) { ev.preventDefault(); $("ax-dlg-e").textContent = `Informe pelo menos ${min} caracteres.`; } };
        b.addEventListener("click", validar);
        d.addEventListener("close", () => { b.removeEventListener("click", validar); const v = i.value; i.value = ""; res(d.returnValue === "ok" ? (rotulo ? (senha ? v : v.trim()) : true) : null); }, { once: true });
        d.returnValue = ""; d.showModal();
    });
}

// Aba "Equipe de TI" (cadastro/remoção/liberação dos operadores do painel /painel-ti): código em admin-ti.js
const equipeTI = iniciarEquipeTI({ sensivel, toast, seguro, pedir });

// ---------- exportação client-side (CSV pt-BR p/ Excel; defesa contra formula injection) ----------
const cel = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function baixarLinhas(nome, cab, linhas, tipo = nome) {
    if (!linhas.length) return toast("Nada para exportar com estes filtros.", "err");
    chamarFuncao("admin/auditar-exportacao", { tipo, linhas: linhas.length }).catch(() => {});   // registra no log de auditoria
    const blob = new Blob(["\uFEFF" + [cab, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `personow-${nome}-${hojeLocal()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const reais = (c) => ((Number(c) || 0) / 100).toFixed(2).replace(".", ",");

// ---------- login / sessão ----------
const erroLogin = (t = "") => { $("ax-login-erro").textContent = t; };
const msgLogin = (c = "") => /too-many/.test(c) ? "Muitas tentativas. Aguarde alguns minutos."
    : /network/.test(c) ? "Sem conexão. Confira a internet e tente de novo."
    : /unauthorized-domain/.test(c) ? "Este endereço não está autorizado no Firebase (Authentication › Domínios autorizados)."
    : /user-disabled/.test(c) ? "Esta conta está desativada." : "E-mail ou senha incorretos.";
$("ax-login-f").addEventListener("submit", async (e) => {                       // e-mail + senha
    e.preventDefault(); erroLogin(); $("ax-entrar").disabled = true;
    try { await signInWithEmailAndPassword(auth, $("ax-email").value.trim(), $("ax-senha").value); $("ax-senha").value = ""; }
    catch (err) { erroLogin(msgLogin(err.code)); }
    finally { $("ax-entrar").disabled = false; }
});
$("ax-google").addEventListener("click", async () => {                          // Google por REDIRECT (sem popup / sem aviso de COOP)
    erroLogin(); $("ax-google").disabled = true;
    try { await entrarComGoogle(); }                                              // a página navega até o Google; ao voltar, o bloco abaixo conclui
    catch (err) { console.error(err); erroLogin(/unauthorized-domain/.test(err.code || "") ? msgLogin(err.code) : "Não foi possível entrar com o Google. Tente novamente."); $("ax-google").disabled = false; }
});
concluirLoginGoogle().then(({ erro }) => {                                      // volta do Google: o onAuthStateChanged abaixo cuida da sessão
    if (erro && !/no-auth-event|cancelled|popup-closed/.test(erro.code || "")) erroLogin(/unauthorized-domain/.test(erro.code || "") ? msgLogin(erro.code) : "Não foi possível concluir o login com o Google. Tente novamente.");
});
$("ax-sair").addEventListener("click", async () => { await desativarPush(); S.supUn?.(); await signOut(auth); });
onAuthStateChanged(auth, async (u) => {
    unsubs.splice(0).forEach((f) => f()); clearInterval(S.timer);
    $("ax-app").hidden = true; $("ax-login").hidden = false;
    if (!u) return;
    // O servidor reativa o perfil admin (a conta pode ter ficado com o perfil de aluno/personal ativo depois de usar outro portal).
    let r; try { r = await resolverAcesso("admin"); } catch (e) { $("ax-login-erro").textContent = "Não foi possível verificar suas permissões. Tente novamente."; return; }
    if (r.estado !== "ok" || (await papelAtual()) !== "admin") { $("ax-login-erro").textContent = "Esta conta não tem permissão de administrador." + (r.sugerido ? ` Ela é de ${r.sugerido === "aluno" ? "aluno" : "personal"}: use o portal correspondente ou entre com outra conta.` : ""); return; }   // sem signOut: a sessão é compartilhada com os outros portais
    $("ax-login").hidden = true; $("ax-app").hidden = false; $("ax-quem").textContent = $("ax-quem2").textContent = u.email;
    try { ouvir(); abrir(location.hash.slice(1) in TITULOS ? location.hash.slice(1) : "visao"); } catch (e) { console.error(e); toast("Parte do painel não carregou. Recarregue a página.", "err"); }
    seguro(kpiContagens)(); seguro(kpiVolume)(); seguro(carregarAviso)(); try { ativarPush(); } catch (e) { console.error(e); }
});

// ---------- navegação (drawer no mobile) ----------
const menu = (o) => { $("ax-side").classList.toggle("open", o); $("ax-veil").hidden = !o; $("ax-burger").setAttribute("aria-expanded", String(o)); document.body.style.overflow = o ? "hidden" : ""; };
$("ax-burger").addEventListener("click", () => menu(!$("ax-side").classList.contains("open")));
$("ax-veil").addEventListener("click", () => menu(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") menu(false); });
const CARGA = { suporte: () => renderSuporte(), visao: () => renderVisao(), usuarios: () => carregarUsuarios(), missoes: () => renderMissoes(), financeiro: () => finAba(S.fa), treino: () => carregarModulos(), habil: () => carregarHab(), infracoes: () => carregarInfracoes(), parceiros: () => carregarParceiros(), moderacao: () => { renderAlertas(); return carregarAuditoria(); }, config: () => carregarConfig(), ti: () => equipeTI.carregar() };
function ir(v) { if (location.hash === "#" + v) abrir(v); else location.hash = v; }
function abrir(v) {
    if (!(v in TITULOS)) v = "visao";
    S.vista = v; menu(false); $("ax-titulo").textContent = TITULOS[v]; document.title = `${TITULOS[v]} — Admin Personow`;
    for (const k of Object.keys(TITULOS)) $("v-" + k).hidden = k !== v;
    for (const b of document.querySelectorAll("#ax-nav .ax-nav")) b.classList.toggle("sel", b.dataset.v === v);
    clearInterval(S.timer); if (v === "moderacao") S.timer = setInterval(() => { if (!document.hidden && $("a-auto").checked) seguro(carregarAuditoria)(); }, 15000);   // log ao vivo
    seguro(CARGA[v])();
}
window.addEventListener("hashchange", () => { if (!$("ax-app").hidden) abrir(location.hash.slice(1)); });
$("ax-nav").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) ir(b.dataset.v); });
$("ax-sino").addEventListener("click", () => ir(S.pend.length ? "usuarios" : "moderacao"));
document.addEventListener("click", (e) => { const b = e.target.closest("[data-ir]"); if (b) ir(b.dataset.ir); });
document.addEventListener("click", seguro(async (e) => { const b = e.target.closest("[data-csv]"); if (b) await baixarCSVProtegido(`admin/exportar/${b.dataset.csv}.csv`, `personow-${b.dataset.csv}.csv`); }));

// ---------- tempo real (Firestore) ----------
function ouvir() {
    const escutar = (q, fn) => { let pronto = false; unsubs.push(onSnapshot(q, (s) => { fn(s, pronto); pronto = true; }, (e) => { console.error(e); msg("Tempo real indisponível: " + (e.code || e.message)); })); };
    escutar(query(collection(db, "personais"), where("status", "==", "pendente"), limit(200)), (s, p) => {
        S.pend = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
        if (p) s.docChanges().forEach((c) => c.type === "added" && toast(`Novo personal aguardando aprovação: ${c.doc.data().nome || "sem nome"}`, "new", 10000, "usuarios"));
        badges(); if (S.vista === "usuarios" && S.ut === "personal" && S.us === "pendente") seguro(carregarUsuarios)();
    });
    escutar(query(collection(db, "alunos"), orderBy("criadoEm", "desc"), limit(300)), (s, p) => {
        S.alunos = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
        if (p) { s.docChanges().forEach((c) => c.type === "added" && toast(`Nova aluno cadastrada: ${c.doc.data().nomeCompleto || c.doc.data().nome || "sem nome"}`, "new", 10000, "usuarios")); seguro(kpiContagens)(); }
        if (S.vista === "usuarios" && S.ut === "aluno") renderAlunos();
    });
    unsubs.push(() => { S.supUn?.(); S.supUn = null; });
    escutar(query(collection(db, "suporte_conversas"), orderBy("ultimaEm", "desc"), limit(100)), (s, p) => {
        S.sup = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
        if (p) s.docChanges().forEach((c) => { const x = c.doc.data(); if ((c.type === "added" || c.type === "modified") && x.ultimaDe === "usuario" && x.naoLidasSuporte > 0) { preCarregar(c.doc.id); if (!(S.vista === "suporte" && S.supUid === c.doc.id && !document.hidden)) avisarSuporte(x); } });
        badges(); if (S.vista === "suporte") renderSuporte();
    });
    escutar(query(collection(db, "aulas"), orderBy("criadoEm", "desc"), limit(400)), (s) => {
        S.missoes = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        badges(); if (S.vista === "visao") renderVisao(); if (S.vista === "missoes") renderMissoes(); if (S.vista === "moderacao") renderAlertas();
    });
}
function badges() {
    const sp = S.sup.filter((c) => c.naoLidasSuporte > 0).length; $("n-sup").hidden = !sp; $("n-sup").textContent = sp;
    const n = S.pend.length, a = alertas().length;
    $("n-pend").hidden = !n; $("n-pend").textContent = n; $("n-alert").hidden = !a; $("n-alert").textContent = a;
    $("ax-sino-n").hidden = !(n + a + sp); $("ax-sino-n").textContent = n + a + sp > 99 ? "99+" : n + a + sp;
}

// ---------- visão geral ----------
async function kpiContagens() {
    const [l, a] = await Promise.all([getCountFromServer(collection(db, "alunos")), getCountFromServer(query(collection(db, "personais"), where("status", "==", "ativo")))]);
    S.totAlunos = l.data().count; S.ativos = a.data().count; renderVisao();
}
async function kpiVolume() { S.pagos = await consultar("admin/pagamentos"); renderVisao(); }
function renderVisao() {
    const abertas = S.missoes.filter((m) => m.status === "aberta").length, reais_ = S.pagos.filter((p) => p.status === "aprovado" && !p.simulado);
    $("k-alunos").textContent = S.totAlunos ?? "—"; $("k-alunos-s").textContent = S.alunos.length ? `${S.alunos.length} mais recentes carregadas` : "";
    $("k-ativos").textContent = S.ativos ?? "—"; $("k-ativos-s").textContent = `${S.pend.length} pendente(s) de aprovação`;
    $("k-abertas").textContent = abertas; $("k-abertas-s").textContent = `de ${S.missoes.length} missões recentes`;
    $("k-vol").textContent = brl(reais_.reduce((t, p) => t + (p.totalCentavos || 0), 0)); $("k-vol-s").textContent = `${reais_.length} pagamento(s) aprovado(s) · últimos 300`;
    const cont = {}; for (const m of S.missoes) cont[m.status] = (cont[m.status] || 0) + 1;
    const cor = { aberta: "var(--ax-blue)", aceita: "var(--ax-gold)", paga: "var(--ax-green)", concluida: "#2fb37d", cancelada: "var(--ax-red)" }, tot = S.missoes.length || 1;
    $("g-status").innerHTML = Object.keys(ST).filter((k) => cont[k]).map((k) => `<div style="width:${(cont[k] / tot) * 100}%;background:${cor[k]}" title="${esc(ST[k][0])}: ${cont[k]}"></div>`).join("");
    $("g-status-l").innerHTML = Object.keys(ST).map((k) => `<span><i style="background:${cor[k]}"></i>${esc(ST[k][0])}: ${cont[k] || 0}</span>`).join("");
    const dias = [], hoje = new Date(); for (let i = 13; i >= 0; i--) { const d = new Date(hoje); d.setDate(d.getDate() - i); dias.push(d.toLocaleDateString("sv-SE")); }
    const soma = Object.fromEntries(dias.map((d) => [d, 0])); for (const p of reais_) { const d = p.pagoEm ? new Date(p.pagoEm).toLocaleDateString("sv-SE") : ""; if (d in soma) soma[d] += p.totalCentavos || 0; }
    const max = Math.max(1, ...Object.values(soma));
    $("g-vol").innerHTML = dias.map((d) => `<div title="${esc(fmtData(d))}: ${esc(brl(soma[d]))}"><b style="height:${(soma[d] / max) * 100}%"></b><span>${esc(d.slice(8))}</span></div>`).join("");
    const al = alertas();
    $("v-resumo").innerHTML = (S.pend.length ? `<div class="ax-alert w"><span>⏳</span><div>${S.pend.length} cadastro(s) de personal aguardando aprovação.</div></div>` : "") + al.slice(0, 3).map(htmlAlerta).join("") || '<p class="ax-mut ax-sm">Nada exigindo atenção agora.</p>';
}

// ---------- usuários ----------
const filtrosUsuarios = () => { const q = $("u-busca").value.trim().toLowerCase(); return q; };
async function carregarUsuarios() {
    for (const b of document.querySelectorAll("#u-tipo .ax-pill")) b.classList.toggle("sel", b.dataset.t === S.ut);
    for (const b of document.querySelectorAll("#u-status .ax-pill")) b.classList.toggle("sel", b.dataset.s === S.us);
    $("u-status").hidden = S.ut === "aluno";
    if (S.ut === "aluno") return renderAlunos();
    $("u-nota").textContent = "";
    S.promo = await consultar(`admin/personais?status=${encodeURIComponent(S.us)}`); renderPersonais();
}
const listaPersonais = () => { const q = filtrosUsuarios(); return S.promo.filter((p) => buscaOk([p.nome, p.cidade, p.uid], q)); };
function renderPersonais() {
    const l = listaPersonais();
    $("u-head").innerHTML = "<tr><th>Nome</th><th>Cidade</th><th>Treino</th><th>Nota</th><th>Criado</th><th></th></tr>";
    $("u-body").innerHTML = l.length ? l.map((p) => `<tr>${td("Nome", esc(p.nome))}${td("Cidade", esc(p.cidade || "—"))}${td("Treino", p.treinamentoOk ? '<span class="ax-ok">✓</span>' : "—")}${td("Nota", p.ratingMedia ? esc(p.ratingMedia) : "—")}${td("Criado", dt(p.criadoEm))}${td("", `<div class="ax-acts">
        <button class="ax-btn sm" data-acao="ficha" data-uid="${esc(p.uid)}">Perfil</button>
        <button class="ax-btn sm" data-acao="editar" data-tipo="personal" data-uid="${esc(p.uid)}">Editar</button>
        <button class="ax-btn sm" data-acao="recado" data-tipo="personal" data-uid="${esc(p.uid)}">Recado</button>
        ${p.status !== "ativo" ? `<button class="ax-btn sm ok" data-acao="aprovar" data-uid="${esc(p.uid)}">${p.status === "bloqueado" ? "Reativar" : "Aprovar"}</button>` : ""}
        ${p.status !== "bloqueado" ? `<button class="ax-btn sm danger" data-acao="bloquear" data-uid="${esc(p.uid)}">Bloquear</button>` : ""}
        <button class="ax-btn sm danger" data-acao="excluir" data-tipo="personal" data-uid="${esc(p.uid)}" data-nome="${esc(p.nome)}">Excluir</button></div>`, "acts")}</tr>`).join("") : vazio(6, "Nenhum cadastro neste filtro.");
}
function renderAlunos() {
    const q = filtrosUsuarios(), l = S.alunos.filter((x) => buscaOk([x.nomeCompleto, x.nome, x.email, x.documento], q));
    $("u-nota").textContent = "Alunos entram ativas no cadastro; o backend ainda não tem status de aprovação/suspensão de aluno. Use Editar para corrigir dados e Excluir para remover o perfil.";
    $("u-head").innerHTML = "<tr><th>Aluno</th><th>Objetivo</th><th>E-mail</th><th>Cadastro</th><th></th></tr>";
    $("u-body").innerHTML = l.length ? l.map((x) => `<tr>${td("Aluno", esc(x.nomeCompleto || x.nome || "—"))}${td("Objetivo", esc(x.objetivo || "—"))}${td("E-mail", esc(x.email || "—"))}${td("Cadastro", dt(x.criadoEm))}${td("", `<div class="ax-acts"><button class="ax-btn sm" data-acao="ficha-aluno" data-uid="${esc(x.uid)}">Perfil</button> <button class="ax-btn sm" data-acao="editar" data-tipo="aluno" data-uid="${esc(x.uid)}">Editar</button> <button class="ax-btn sm" data-acao="recado" data-tipo="aluno" data-uid="${esc(x.uid)}">Recado</button> <button class="ax-btn sm danger" data-acao="excluir" data-tipo="aluno" data-uid="${esc(x.uid)}" data-nome="${esc(x.nomeCompleto || x.nome || "")}">Excluir</button></div>`, "acts")}</tr>`).join("") : vazio(5, "Nenhuma aluno encontrada.");
}
$("u-tipo").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { S.ut = b.dataset.t; seguro(carregarUsuarios)(); } });
$("u-status").addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (b) { S.us = b.dataset.s; seguro(carregarUsuarios)(); } });
$("u-busca").addEventListener("input", () => (S.ut === "aluno" ? renderAlunos() : renderPersonais()));
$("u-atualizar").addEventListener("click", seguro(carregarUsuarios));
$("u-csv").addEventListener("click", () => {
    if (S.ut === "aluno") baixarLinhas("alunos", ["UID", "Nome completo", "Objetivo", "E-mail", "Telefone", "Endereço", "Cadastro"], S.alunos.map((x) => [x.uid, x.nomeCompleto || x.nome, x.objetivo, x.email, x.telefone, x.endereco, dt(x.criadoEm)]));
    else baixarLinhas(`personais-${S.us}`, ["UID", "Nome", "Cidade", "Status", "Treinamento", "Nota", "Criado"], listaPersonais().map((p) => [p.uid, p.nome, p.cidade, p.status, p.treinamentoOk ? "sim" : "não", p.ratingMedia, dt(p.criadoEm)]), "merchandisers");
});
const fichaAbrir = (html, acoes) => { $("ax-ficha-c").innerHTML = html; $("ax-ficha-a").innerHTML = acoes + '<button class="ax-btn" data-acao="fechar">Fechar</button>'; if (!$("ax-ficha").open) $("ax-ficha").showModal(); };
async function abrirFicha(uid) {
    const p = await consultar(`admin/personais/${encodeURIComponent(uid)}`), t = p.habilitacao || {};
    fichaAbrir(`<h2>${esc(p.nome)} <span class="ax-badge">${esc(p.status)}</span> ${p.cref ? "" : '<span class="ax-badge r">SEM CREF</span>'}</h2>
        <dl class="ax-dl"><dt>E-mail</dt><dd>${esc(p.email)}</dd><dt>Telefone</dt><dd>${esc(p.telefone)}</dd><dt>CPF</dt><dd>${esc(p.cpfMascarado)}</dd><dt>CREF</dt><dd>${esc(p.cref || "—")}${p.crefConferidoEm ? " ✓ conferido" : ""}</dd><dt>Cidade</dt><dd>${esc(p.cidade || "—")}</dd><dt>Nascimento</dt><dd>${esc(p.nascimento || "—")} (${esc(p.idade ?? "?")} anos)</dd>
        <dt>Treinamento</dt><dd>${esc(p.treinamento?.concluidos)}/${esc(p.treinamento?.total)}</dd><dt>Pendências</dt><dd>${esc((t.pendencias || []).join(", ") || "nenhuma")}</dd></dl>
        ${!p.nascimento ? '<div class="ax-alert w"><span>⚠️</span><div>Sem data de nascimento. A pessoa pode ser liberada, mas só aceita aulas depois de completar o cadastro. Você pode informar a data em <strong>Editar perfil</strong>.</div></div>' : ""}
        ${p.cref ? `<div class="ax-alert w"><span>🪪</span><div><strong>Confira o CREF ${esc(p.cref)} no sistema do CONFEF</strong> (nome e situação ativa) antes de aprovar. A aprovação registra a conferência.</div></div>` : '<p class="ax-bad">Sem número de CREF — não é possível aprovar.</p>'}`,
        `<button class="ax-btn ok" data-acao="aprovar" data-uid="${esc(uid)}">Aprovar</button><button class="ax-btn" data-acao="recado" data-tipo="personal" data-uid="${esc(uid)}">Enviar recado</button><button class="ax-btn" data-acao="editar" data-tipo="personal" data-uid="${esc(uid)}">Editar perfil</button><button class="ax-btn" data-acao="analise" data-uid="${esc(uid)}">Voltar p/ análise</button><button class="ax-btn danger" data-acao="bloquear" data-uid="${esc(uid)}">Bloquear</button><button class="ax-btn danger" data-acao="excluir" data-tipo="personal" data-uid="${esc(uid)}" data-nome="${esc(p.nome)}">Excluir perfil</button>`);
}
function abrirFichaAluno(uid) {
    const x = S.alunos.find((l) => l.uid === uid); if (!x) return;
    fichaAbrir(`<h2>${esc(x.nomeCompleto || x.nome || "Aluno")}</h2><dl class="ax-dl"><dt>Documento</dt><dd>${esc(x.documento || "—")}</dd><dt>Objetivo</dt><dd>${esc(x.objetivo || "—")}</dd><dt>E-mail</dt><dd>${esc(x.email || "—")}</dd><dt>Telefone</dt><dd>${esc(x.telefone || "—")}</dd><dt>Endereço</dt><dd>${esc(x.endereco || "—")}</dd><dt>Cadastro</dt><dd>${esc(dt(x.criadoEm))}</dd><dt>UID</dt><dd>${esc(x.uid)}</dd></dl>
        <p class="ax-xs ax-mut">Missões deste aluno: ${S.missoes.filter((m) => m.uid === uid).length} (entre as 400 mais recentes).</p>`, `<button class="ax-btn" data-acao="editar" data-tipo="aluno" data-uid="${esc(uid)}">Editar perfil</button><button class="ax-btn" data-acao="recado" data-tipo="aluno" data-uid="${esc(uid)}">Enviar recado</button><button class="ax-btn danger" data-acao="excluir" data-tipo="aluno" data-uid="${esc(uid)}" data-nome="${esc(x.nomeCompleto || x.nome || "")}">Excluir perfil</button>`);
}
/** Recado avulso (sem mudar status) para um personal ou um aluno. */
async function enviarRecado(tipo, uid) {
    const texto = await pedir({ titulo: tipo === "aluno" ? "Recado para o aluno" : "Recado para o personal", texto: "Aparece no painel dele(a), com botão para responder no WhatsApp. Fica registrado na auditoria.", rotulo: "Mensagem", min: 3, ok: "Enviar", modelos: true });
    if (!texto) return;
    await chamarFuncao(`admin/recado/${tipo}/${encodeURIComponent(uid)}`, { texto });
    toast("Recado enviado.", "ok");
}
async function mudarStatus(uid, novo) {
    let motivo = "";
    const reativando = novo === "ativo" && S.promo.find((x) => x.uid === uid)?.status === "bloqueado";
    if (novo === "ativo") { if (!(await pedir(reativando ? { titulo: "Reativar acesso?", texto: "A pessoa volta a entrar no app. Não exige data de nascimento: se faltar, ela completa o cadastro ao entrar e só aceita aulas depois disso.", ok: "Reativar" } : { titulo: "Aprovar cadastro?", texto: "O servidor confere idade e autorização do responsável antes de aprovar.", ok: "Aprovar" }))) return; }
    else { motivo = await pedir({ titulo: novo === "bloqueado" ? "Bloquear usuário" : "Voltar para análise", texto: novo === "bloqueado" ? "As sessões do usuário serão derrubadas. O motivo aparece para ele e fica na auditoria." : "O cadastro volta para análise. A mensagem abaixo aparece para o personal no portal dele e fica na auditoria.", rotulo: novo === "bloqueado" ? "Motivo" : "Mensagem para o personal", min: 3, ok: "Confirmar", perigo: novo === "bloqueado", modelos: novo !== "bloqueado" }); if (!motivo) return; }
    await chamarFuncao(`admin/personais/${encodeURIComponent(uid)}/status`, { status: novo, motivo });
    toast("Status atualizado.", "ok"); if ($("ax-ficha").open) $("ax-ficha").close(); await carregarUsuarios(); seguro(kpiContagens)();
}
document.addEventListener("click", seguro(async (e) => {
    const b = e.target.closest("[data-acao]"); if (!b) return; const uid = b.dataset.uid;
    switch (b.dataset.acao) {
        case "ficha": return abrirFicha(uid);
        case "ficha-aluno": return abrirFichaAluno(uid);
        case "aprovar": return mudarStatus(uid, "ativo");
        case "analise": return mudarStatus(uid, "pendente");
        case "recado": return enviarRecado(b.dataset.tipo || "personal", uid);
        case "bloquear": return mudarStatus(uid, "bloqueado");
        case "editar": return abrirEdicao(b.dataset.tipo || "personal", uid);
        case "excluir": return abrirExclusao(b.dataset.tipo || "personal", uid, b.dataset.nome);
        case "fechar": return $("ax-ficha").close();
    }
}));

// ---------- editar perfil (personal e aluno) ----------
/** Um campo do formulário de edição. `id` vira #ed-<id>. */
const campoEd = (id, rotulo, { tipo = "text", valor = "", dica = "", max = "", placeholder = "", inputmode = "", cheio = false } = {}) =>
    `<div${cheio ? ' style="grid-column:1/-1"' : ""}><label class="ax-lbl" for="ed-${id}">${esc(rotulo)}</label>${tipo === "textarea"
        ? `<textarea class="ax-ta" id="ed-${id}" maxlength="${max || 300}" placeholder="${esc(placeholder)}">${esc(valor)}</textarea>`
        : `<input class="ax-in" id="ed-${id}" type="${tipo}" value="${esc(valor)}"${max ? ` maxlength="${max}"` : ""} placeholder="${esc(placeholder)}"${inputmode ? ` inputmode="${inputmode}"` : ""} autocomplete="off">`}${dica ? `<span class="ax-xs ax-mut">${esc(dica)}</span>` : ""}</div>`;
const valEd = (id) => $("ed-" + id).value.trim();

async function abrirEdicao(tipo, uid) {
    const dlg = $("ax-edit"), ficha = $("ax-ficha");
    let original, titulo, aviso, html, paraCorpo;
    if (tipo === "aluno") {
        const x = S.alunos.find((l) => l.uid === uid); if (!x) throw new Error("Aluno não encontrada na lista. Recarregue a página.");
        titulo = `Editar aluno — ${x.nomeCompleto || x.nome || uid}`; aviso = "O e-mail abaixo é o de contato fiscal. O e-mail de login (Google) não muda.";
        original = { nomeCompleto: x.nomeCompleto || "", nome: x.nome || "", documento: x.documento ? mascaraDoc(x.documento) : "", email: x.email || "", telefone: x.telefone ? mascaraTelefone(x.telefone) : "", objetivo: x.objetivo || "", endereco: x.endereco || "" };
        html = campoEd("nomeCompleto", "Nome completo", { valor: original.nomeCompleto, max: 160 }) + campoEd("nome", "Nome de exibição", { valor: original.nome, max: 100 })
            + campoEd("documento", "CNPJ ou CPF", { valor: original.documento, max: 18, inputmode: "numeric" }) + campoEd("telefone", "Telefone", { valor: original.telefone, max: 16, inputmode: "tel" })
            + campoEd("email", "E-mail de contato", { valor: original.email, max: 120, tipo: "email" }) + campoEd("objetivo", "Objetivo", { valor: original.objetivo, max: 60 })
            + campoEd("endereco", "Endereço", { valor: original.endereco, max: 200, cheio: true });
        paraCorpo = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, k === "documento" || k === "telefone" ? soDigitos(v) : v]));
    } else {
        const p = await consultar(`admin/personais/${encodeURIComponent(uid)}`);
        titulo = `Editar personal — ${p.nome || uid}`; aviso = "Alterar CPF ou nascimento libera a trava de segurança do cadastro: confira o documento antes. Chave Pix e saldo não são editáveis aqui.";
        original = { nome: p.nome || "", cidade: p.cidade || "", telefone: p.telefone ? mascaraTelefone(p.telefone) : "", nascimento: p.nascimento || "", cref: p.cref || "", cpf: "", especialidade: p.especialidade || "", valorMin: p.valorMin ? (p.valorMin / 100).toFixed(2).replace(".", ",") : "", inicio: p.disponibilidade?.inicio || "", fim: p.disponibilidade?.fim || "", bio: p.bio || "" };
        html = campoEd("nome", "Nome", { valor: original.nome, max: 100 }) + campoEd("cidade", "Cidade", { valor: original.cidade, max: 80 })
            + campoEd("telefone", "WhatsApp", { valor: original.telefone, max: 16, inputmode: "tel" }) + campoEd("nascimento", "Data de nascimento", { tipo: "date", valor: original.nascimento, dica: "Mínimo 18 anos." })
            + campoEd("cref", "CREF", { valor: original.cref, max: 14, placeholder: "012345-G/SP", dica: "Formato 012345-G/SP. Conferir no CONFEF." }) + campoEd("cpf", "CPF (novo)", { valor: "", max: 14, inputmode: "numeric", placeholder: p.cpfMascarado || "não cadastrado", dica: "Deixe em branco para manter o atual." }) + campoEd("especialidade", "Especialidade", { valor: original.especialidade, max: 60 })
            + campoEd("valorMin", "Valor mínimo (R$)", { valor: original.valorMin, max: 9, inputmode: "decimal", dica: "Vazio = sem mínimo." }) + `<div class="ax-row" style="gap:8px;align-items:flex-end">${campoEd("inicio", "Disponível de", { tipo: "time", valor: original.inicio })}${campoEd("fim", "até", { tipo: "time", valor: original.fim })}</div>`
            + campoEd("bio", "Bio", { tipo: "textarea", valor: original.bio, max: 300, cheio: true });
        paraCorpo = (m) => {
            const c = {};
            for (const [k, v] of Object.entries(m)) {
                if (k === "telefone") c.telefone = soDigitos(v); else if (k === "cpf") c.cpf = soDigitos(v);
                else if (k === "valorMin") c.valorMin = v ? reaisParaCentavos(v) : null; else if (k !== "inicio" && k !== "fim") c[k] = v;
            }
            if ("inicio" in m || "fim" in m) c.disponibilidade = valEd("inicio") && valEd("fim") ? { inicio: valEd("inicio"), fim: valEd("fim") } : null;
            return c;
        };
    }
    $("ax-edit-t").textContent = titulo; $("ax-edit-p").textContent = aviso; $("ax-edit-c").innerHTML = html; $("ax-edit-e").textContent = "";
    for (const [id, f] of [["telefone", mascaraTelefone], ["cpf", mascaraCPF], ["documento", mascaraDoc]]) $("ed-" + id)?.addEventListener("input", (e) => { e.target.value = f(e.target.value); });
    const ok = $("ax-edit-ok");
    ok.onclick = async (ev) => {
        ev.preventDefault(); $("ax-edit-e").textContent = "";
        const mudou = {}; for (const [id, orig] of Object.entries(original)) if (valEd(id) !== orig) mudou[id] = valEd(id);
        if (!Object.keys(mudou).length) { $("ax-edit-e").textContent = "Nada foi alterado."; return; }
        ok.disabled = true; const rot = ok.textContent; ok.textContent = "Salvando…";
        try {
            await chamarFuncao(`admin/${tipo === "aluno" ? "alunos" : "personais"}/${encodeURIComponent(uid)}`, paraCorpo(mudou), "PUT");
            dlg.close("ok"); if (ficha.open) ficha.close(); toast("Perfil atualizado.", "ok");
            if (tipo !== "aluno") { await carregarUsuarios(); seguro(kpiContagens)(); }
        } catch (e) { console.error(e); $("ax-edit-e").textContent = e.message || "Não foi possível salvar."; }
        finally { ok.disabled = false; ok.textContent = rot; }
    };
    dlg.showModal(); $("ax-edit-c").querySelector("input,textarea")?.focus();
}

// ---------- excluir perfil (com confirmação de segurança) ----------
function abrirExclusao(tipo, uid, nome) {
    const dlg = $("ax-del"), ficha = $("ax-ficha"), ok = $("ax-del-ok"), mot = $("ax-del-motivo"), conf = $("ax-del-conf"), quem = tipo === "aluno" ? "o aluno" : "o personal";
    $("ax-del-aviso").innerHTML = `<span>⛔</span><div><strong>Isto é permanente e não pode ser desfeito.</strong><br>Vamos excluir ${quem} <strong>${esc(nome || uid)}</strong>: os dados cadastrais e a credencial de login. Se a pessoa voltar, precisará se cadastrar de novo.
        ${tipo === "aluno" ? "Aulas abertas ou aceitos e ainda não pagos serão cancelados." : "Não é possível excluir com saldo na carteira, saque pendente ou aula aceita sem pagamento."}
        <br><span class="ax-xs ax-mut">Por exigência fiscal e financeira ficam guardados: aulas, notas, pagamentos, lançamentos e a auditoria.</span></div>`;
    mot.value = conf.value = ""; $("ax-del-e").textContent = "";
    const validar = () => { ok.disabled = !(conf.value.trim().toUpperCase() === "EXCLUIR" && mot.value.trim().length >= 5); };
    mot.oninput = conf.oninput = validar; validar();
    ok.onclick = async (ev) => {
        ev.preventDefault(); ok.disabled = true; const rot = ok.textContent; ok.textContent = "Excluindo…"; $("ax-del-e").textContent = "";
        try {
            const r = await sensivel(() => chamarFuncao(`admin/${tipo === "aluno" ? "alunos" : "personais"}/${encodeURIComponent(uid)}/excluir`, { motivo: mot.value.trim(), confirmar: "EXCLUIR" }));
            dlg.close("ok"); if (ficha.open) ficha.close();
            toast(`Perfil excluído${r.aulasCancelados ? ` · ${r.aulasCancelados} aula(s) cancelado(s)` : ""}.`, "ok");
            if (tipo !== "aluno") await carregarUsuarios(); seguro(kpiContagens)();
        } catch (e) { console.error(e); $("ax-del-e").textContent = e.message || "Não foi possível excluir."; }
        finally { ok.textContent = rot; validar(); }
    };
    dlg.showModal(); mot.focus();
}
// ---------- suporte (chat) ----------
/** Aviso dentro do painel (toast que leva à aba) e, com a aba em segundo plano, notificação do navegador. */
function avisarSuporte(c) {
    toast(`${c.nome || "Usuário"}: ${c.ultimaMsg || "nova mensagem"}`, "new", 10000, "suporte");
    try { if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(`Suporte · ${c.nome || "nova mensagem"}`, { body: c.ultimaMsg || "", icon: "icons/icon-192.png" }); } catch (e) { /* sem notificação */ }
}
const nomeConv = (c) => c.nome || (c.tipo === "aluno" ? "Aluno" : "Personal");
function renderSuporte() {
    $("sp-notif").hidden = !("Notification" in window && Notification.permission === "default");
    $("sp-lista").innerHTML = S.sup.length ? S.sup.map((c) => `<button type="button" class="ax-sup-item${c.uid === S.supUid ? " sel" : ""}" data-conv="${esc(c.uid)}"><div class="q"><b>${esc(nomeConv(c))}</b><span class="p">${c.ultimaDe === "suporte" ? "Você: " : ""}${esc(c.ultimaMsg || "")}</span></div><div style="text-align:right"><span class="ax-badge ${c.tipo === "aluno" ? "b" : ""}">${c.tipo === "aluno" ? "aluno" : "personal"}</span>${c.naoLidasSuporte > 0 ? ` <span class="ax-badge y">${esc(c.naoLidasSuporte)}</span>` : ""}<br><span class="ax-xs ax-mut">${esc(dt(c.ultimaEm))}</span></div></button>`).join("") : '<p class="ax-mut ax-sm">Nenhuma conversa ainda. Use o botão "Recado" em Usuários para puxar assunto, ou aguarde as mensagens.</p>';
    const c = S.sup.find((x) => x.uid === S.supUid);
    $("sp-quem").textContent = c ? `${nomeConv(c)} · ${c.tipo === "aluno" ? "aluno" : "personal"}` : "Selecione uma conversa";
    $("v-suporte").querySelector(".ax-sup").classList.toggle("conversa", !!S.supUid);
    $("sp-txt").disabled = $("sp-enviar").disabled = !S.supUid;
    $("sp-modelos").innerHTML = S.supUid ? MODELOS.map(([n], i) => `<button type="button" class="ax-btn sm" data-modelo="${i}">${esc(n)}</button>`).join("") : "";
    pintarMensagens();
}
function pintarMensagens() {
    const box = $("sp-msgs"), perto = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = !S.supUid ? '<p class="ax-mut ax-sm">Escolha uma conversa ao lado.</p>' : S.supMsgs.length ? S.supMsgs.map((m) => `<div class="ax-msg${m.de === "suporte" ? " eu" : ""}">${esc(m.texto).replace(/\n/g, "<br>")}<small>${m.de === "suporte" ? esc(NOME_SUPORTE) + " · " : ""}${esc(dt(m.criadoEm))}</small></div>`).join("") : '<p class="ax-mut ax-sm">Sem mensagens ainda.</p>';
    if (perto) box.scrollTop = box.scrollHeight;
}
let supLendo = false;
async function marcarSuporteLido(uid) {
    const c = S.sup.find((x) => x.uid === uid); if (supLendo || !(c?.naoLidasSuporte > 0)) return;
    supLendo = true; try { await chamarFuncao(`admin/suporte/${encodeURIComponent(uid)}/lido`, {}); } catch (e) { console.warn(e); } finally { supLendo = false; }
}
function abrirConversa(uid) {
    S.supUn?.(); S.supUid = uid; S.supMsgs = [];
    S.supUn = onSnapshot(query(collection(db, "suporte_mensagens"), where("uid", "==", uid)), (s) => {
        S.supMsgs = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.id > b.id ? 1 : -1));
        pintarMensagens(); if (!document.hidden) marcarSuporteLido(uid);
    }, (e) => msg("Conversa indisponível: " + (e.code || e.message)));
    renderSuporte(); $("sp-msgs").scrollTop = $("sp-msgs").scrollHeight; $("sp-txt").focus(); marcarSuporteLido(uid);
    mostrarPerfil(uid);                                         // perfil instantâneo (cache/esqueleto) + revalidação
}
$("sp-lista").addEventListener("click", (e) => { const b = e.target.closest("[data-conv]"); if (b) abrirConversa(b.dataset.conv); });
$("sp-voltar").addEventListener("click", () => { S.supUn?.(); S.supUn = null; S.supUid = ""; perfilReq++; $("sp-perfil").innerHTML = '<p class="ax-mut ax-sm">O perfil de quem está falando aparece aqui assim que você abrir a conversa.</p>'; renderSuporte(); });
$("sp-modelos").addEventListener("click", (e) => { const b = e.target.closest("[data-modelo]"); if (b) { $("sp-txt").value = MODELOS[b.dataset.modelo][1]; $("sp-txt").focus(); } });
$("sp-notif").addEventListener("click", async () => { if ("Notification" in window && (await Notification.requestPermission()) === "granted") await ativarPush(); renderSuporte(); });
$("sp-form").addEventListener("submit", seguro(async (e) => {
    e.preventDefault(); const texto = $("sp-txt").value.trim(); if (!texto || !S.supUid) return;
    $("sp-enviar").disabled = true;
    try { await chamarFuncao(`admin/suporte/${encodeURIComponent(S.supUid)}/mensagem`, { texto }); $("sp-txt").value = ""; } finally { $("sp-enviar").disabled = !S.supUid; }
}));


// ---------- perfil 360 do usuário em atendimento ----------
// Estratégia "instantâneo": (1) PRÉ-CARGA — assim que chega mensagem nova (snapshot) ou o atendente passa o mouse/foco na conversa,
// o perfil já é buscado e guardado no cache; (2) ao abrir a conversa, pinta NA HORA do cache (ou dos dados que já estão em memória,
// como nome/tipo/alunos) e revalida em segundo plano; (3) um contador de requisição descarta respostas de conversas já trocadas.
const PERFIL_TTL = 60_000;                       // depois disso, abrir a conversa revalida (mostra o cache e atualiza por cima)
const perfis = new Map();                         // uid -> { dados, em } | { promessa }
let perfilReq = 0;
const iniciais = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || "").join("") || "?";
const ROT_ST = { aberta: ["Aguardando", "b"], aceita: ["Aceita", "y"], paga: ["Paga", "g"], concluida: ["Concluída", "g"], cancelada: ["Cancelada", "r"] };
const COR_USU = { ativo: "g", pendente: "y", bloqueado: "r" };

/** Busca (com cache e deduplicação de chamadas simultâneas). `forcar` ignora o cache. */
function carregarPerfil(uid, { forcar = false, leve = false } = {}) {
    const c = perfis.get(uid);
    if (c?.promessa && (leve || !c.leve)) return c.promessa;                                   // já há busca em andamento que serve
    if (!forcar && c?.dados && !(c.dados.parcial && !leve) && Date.now() - c.em < PERFIL_TTL) return Promise.resolve(c.dados);
    const promessa = consultar(`admin/suporte/${encodeURIComponent(uid)}/perfil${leve ? "?leve=1" : ""}`)
        .then((dados) => { const atual = perfis.get(uid)?.dados; if (leve && atual && !atual.parcial) { perfis.set(uid, { dados: atual, em: Date.now() }); return atual; } perfis.set(uid, { dados, em: Date.now() }); return dados; })
        .catch((e) => { if (c?.dados) perfis.set(uid, c); else perfis.delete(uid); throw e; });
    perfis.set(uid, { ...(c || {}), promessa, leve });
    return promessa;
}
const preCarregar = (uid) => { if (uid && !perfis.has(uid)) carregarPerfil(uid, { leve: true }).catch(() => {}); };   // silencioso e "leve": só aquece o cache, sem CPF/telefone nem auditoria

/** Esqueleto imediato com o que já sabemos (nome/tipo vêm da lista de conversas) — nunca tela em branco. */
function perfilEsqueleto(uid) {
    const c = S.sup.find((x) => x.uid === uid) || {};
    return `<div class="pf-head"><div class="pf-av">${esc(iniciais(nomeConv(c)))}</div><div><h3>${esc(nomeConv(c))}</h3><div class="ax-row"><span class="ax-badge ${c.tipo === "aluno" ? "b" : ""}">${c.tipo === "aluno" ? "aluno" : "personal"}</span></div></div></div>
        <div class="pf-skel ax-mt" aria-busy="true"><i style="width:80%"></i><i style="width:60%"></i><i style="width:90%"></i><i style="width:45%"></i></div>`;
}

function perfilHtml(p) {
    const c = p.cadastro, h = p.historico, aluno = p.tipo === "aluno";
    const st = (s) => { const [t, k] = ROT_ST[s] || [s || "—", ""]; return `<span class="ax-badge ${k}">${esc(t)}</span>`; };
    const kpi = (n, l) => `<div class="pf-kpi"><b>${esc(n)}</b><span>${esc(l)}</span></div>`;
    const linhas = aluno
        ? [["Documento", c.documento], ["Objetivo", c.objetivo], ["E-mail", p.email], ["Telefone", c.telefone], ["Endereço", c.endereco], ["Cartão", c.cartao], ["Cadastro", c.criadoEm ? dt(c.criadoEm) : ""]]
        : [["E-mail", p.email], ["Telefone", c.telefone], ["CPF", c.cpfMascarado], ["Cidade", c.cidade], ["Nascimento", c.nascimento ? `${c.nascimento}${c.idade != null ? ` (${c.idade} anos)` : ""}` : ""], ["Nota média", c.ratingMedia], ["Treinamento", `${c.treinamento.concluidos}/${c.treinamento.total}`], ["Cadastro", c.criadoEm ? dt(c.criadoEm) : ""]];
    const alertas = [
        !aluno && !c.cref ? '<div class="ax-alert w"><span>🪪</span><div>Sem CREF cadastrado: não pode ser aprovado nem aceitar aulas.</div></div>' : "",
        !aluno && !c.nascimento ? '<div class="ax-alert w"><span>⚠️</span><div>Sem data de nascimento: só aceita aulas depois de completar o cadastro.</div></div>' : "",
        !aluno && c.pendencias.length ? `<div class="ax-alert w"><span>📋</span><div><strong>Pendências:</strong> ${esc(c.pendencias.join(", "))}</div></div>` : "",
        c.status === "bloqueado" && c.statusMotivo ? `<div class="ax-alert e"><span>⛔</span><div><strong>Bloqueado:</strong> ${esc(c.statusMotivo)}</div></div>` : ""
    ].join("");
    const por = h.porStatus || {};
    const acoes = aluno
        ? `<button class="ax-btn sm" data-acao="ficha-aluno" data-uid="${esc(p.uid)}">Ficha completa</button><button class="ax-btn sm" data-acao="recado" data-tipo="aluno" data-uid="${esc(p.uid)}">Recado</button><button class="ax-btn sm" data-acao="editar" data-tipo="aluno" data-uid="${esc(p.uid)}">Editar</button>`
        : `<button class="ax-btn sm" data-acao="ficha" data-uid="${esc(p.uid)}">Ficha completa</button><button class="ax-btn sm" data-acao="recado" data-tipo="personal" data-uid="${esc(p.uid)}">Recado</button><button class="ax-btn sm" data-acao="editar" data-tipo="personal" data-uid="${esc(p.uid)}">Editar</button>${c.status !== "ativo" ? `<button class="ax-btn sm ok" data-acao="aprovar" data-uid="${esc(p.uid)}">${c.status === "bloqueado" ? "Reativar" : "Aprovar"}</button>` : ""}${c.status !== "bloqueado" ? `<button class="ax-btn sm danger" data-acao="bloquear" data-uid="${esc(p.uid)}">Bloquear</button>` : ""}`;
    return `<div class="pf-head"><div class="pf-av">${esc(iniciais(c.nome))}</div><div><h3>${esc(c.nome || "Sem nome")}</h3><div class="ax-row"><span class="ax-badge ${aluno ? "b" : ""}">${aluno ? "aluno" : "personal"}</span><span class="ax-badge ${COR_USU[c.status] || ""}">${esc(c.status || "—")}</span></div></div></div>
        <div class="ax-mt">${alertas}</div>
        <div class="pf-sec"><h4>Cadastro</h4><dl class="ax-dl">${linhas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd>`).join("")}</dl></div>
        <div class="pf-sec"><h4>Histórico de aulas</h4>
            <div class="pf-kpis">${kpi(h.total, "total")}${kpi((por.aceita || 0) + (por.paga || 0), "em andamento")}${kpi(por.concluida || 0, "concluídos")}</div>
            ${h.ultimos.length ? `<ul class="pf-list ax-mt">${h.ultimos.map((t) => `<li><span>${esc(t.data ? fmtData(t.data) : "—")} · ${esc(t.foco || t.contraparte || "aula")}</span>${st(t.status)}</li>`).join("")}</ul>` : '<p class="ax-mut ax-sm">Nenhum aula ainda.</p>'}</div>
        <div class="pf-sec"><h4>Conversa</h4><dl class="ax-dl"><dt>Mensagens</dt><dd>${esc(p.conversa.mensagens)}</dd><dt>1º contato</dt><dd>${esc(p.conversa.desde ? dt(p.conversa.desde) : "—")}</dd></dl></div>
        ${p.acoes.length ? `<div class="pf-sec"><h4>Últimas ações da equipe</h4><ul class="pf-list">${p.acoes.map((a) => `<li><span>${esc(ROT[a.acao] || a.acao)}</span><span class="ax-xs ax-mut">${esc(dt(a.em))}</span></li>`).join("")}</ul></div>` : ""}
        <div class="pf-sec"><div class="pf-acts">${acoes}</div><p class="pf-ts">Atualizado às ${esc(hm(p.carregadoEm))}</p></div>`;
}

/** Chamada por abrirConversa: pinta já (cache ou esqueleto) e atualiza quando a resposta chegar. */
async function mostrarPerfil(uid) {
    const el = $("sp-perfil"), minha = ++perfilReq, cache = perfis.get(uid);
    el.innerHTML = cache?.dados ? perfilHtml(cache.dados) : perfilEsqueleto(uid);
    if (cache?.dados && !cache.dados.parcial && Date.now() - cache.em < PERFIL_TTL) return;   // cache completo e fresco: nada a buscar
    try { const p = await carregarPerfil(uid, { forcar: !!cache?.dados }); if (minha === perfilReq && S.supUid === uid) el.innerHTML = perfilHtml(p); }
    catch (e) { if (minha === perfilReq && S.supUid === uid && !cache?.dados) el.innerHTML = `${perfilEsqueleto(uid).split('<div class="pf-skel')[0]}<div class="ax-alert e ax-mt"><span>!</span><div>Não foi possível carregar o perfil (${esc(e.message || "erro")}). <button class="ax-btn sm" id="pf-tentar" type="button">Tentar de novo</button></div></div>`; }
}
$("sp-perfil").addEventListener("click", (e) => { if (e.target.closest("#pf-tentar") && S.supUid) { perfis.delete(S.supUid); mostrarPerfil(S.supUid); } });
// pré-carga ao passar o mouse / focar / tocar numa conversa da lista
const aquecer = (e) => { const b = e.target.closest?.("[data-conv]"); if (b) preCarregar(b.dataset.conv); };
$("sp-lista").addEventListener("pointerenter", aquecer, true); $("sp-lista").addEventListener("focusin", aquecer); $("sp-lista").addEventListener("touchstart", aquecer, { passive: true });

// ---------- missões ----------
const listaMissoes = () => {
    const st = $("m-status").value, q = $("m-busca").value.trim().toLowerCase(), de = $("m-de").value, ate = $("m-ate").value;
    return S.missoes.filter((m) => (!st || m.status === st) && (!de || m.data >= de) && (!ate || m.data <= ate) && buscaOk([m.aluno, m.personalNome, m.foco], q));
};
function renderMissoes() {
    const l = listaMissoes();
    $("m-nota").textContent = `${l.length} de ${S.missoes.length} missões (as 400 mais recentes, atualizadas em tempo real).`;
    $("m-body").innerHTML = l.length ? l.map((m) => `<tr>${td("Data", esc(fmtData(m.data)))}${td("Horário", esc(m.horario || "—"))}${td("Aluno", esc(m.aluno || "—"))}${td("Foco", esc(m.foco || "—"))}${td("Repasse", esc(brl(m.valorPersonalCentavos)))}${td("Personal", esc(m.personalNome || "—"))}${td("Presença", presenca(m))}${td("Status", badge(m.status))}</tr>`).join("") : vazio(8, "Nenhuma missão neste filtro.");
}
for (const id of ["m-status", "m-busca", "m-de", "m-ate"]) $(id).addEventListener("input", renderMissoes);
$("m-csv").addEventListener("click", () => baixarLinhas("missoes", ["ID", "Data", "Entrada", "Saída", "Aluno", "Foco", "Repasse (R$)", "Personal", "Status", "Check-in", "Check-out", "Trabalhado (min)", "Divergências", "Criada em"], listaMissoes().map((m) => [m.id, m.data, m.entrada, m.saida, m.aluno, m.foco, reais(m.valorPersonalCentavos), m.personalNome, m.status, hm(m.checkinEm), hm(m.checkoutEm), m.trabalhadoMin ?? "", (m.divergencias || []).join(", "), dt(m.criadoEm)])));

// ---------- financeiro ----------
const soma = (l, k) => l.reduce((t, p) => t + (p[k] || 0), 0);
const diaDe = (iso) => (iso ? new Date(iso).toLocaleDateString("sv-SE") : "");
const haHoras = (iso) => { const h = Math.floor((Date.now() - new Date(iso)) / 36e5); return h < 1 ? "agora" : h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`; };
async function finAba(f) {
    S.fa = f; for (const b of document.querySelectorAll("#f-abas .ax-pill")) b.classList.toggle("sel", b.dataset.f === f);
    for (const k of ["pag", "saq", "conc"]) $("f-" + k).hidden = k !== f;
    await Promise.all([carregarResumoFin(), f === "pag" ? carregarPagamentos() : f === "saq" ? carregarSaques() : null]);
}
$("f-abas").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) seguro(finAba)(b.dataset.f); });
async function carregarResumoFin() { S.resumoFin = await consultar("admin/financeiro/resumo"); renderFinKpis(); }
function renderFinKpis() {
    const ap = S.pagos.filter((p) => p.status === "aprovado" && !p.simulado), es = S.pagos.filter((p) => p.status === "estornado" && !p.simulado), tot = soma(ap, "totalCentavos"), sa = S.resumoFin?.saquesAbertos;
    const horas = sa?.maisAntigoEm ? Math.floor((Date.now() - new Date(sa.maisAntigoEm)) / 36e5) : 0;
    const card = (l, v, s, c = "") => `<div class="ax-card ax-kpi ${c}"><span class="l">${esc(l)}</span><span class="v">${esc(v)}</span><span class="s">${esc(s)}</span></div>`;
    $("f-kpis").innerHTML = card("Recebido (aprovado)", brl(tot), `${ap.length} pagamento(s) · últimos 300`, "gold")
        + card("Comissão da plataforma", brl(soma(ap, "comissaoCentavos")), tot ? `${((soma(ap, "comissaoCentavos") / tot) * 100).toFixed(0)}% do recebido` : "")
        + card("Repasse aos personais", brl(soma(ap, "repasseCentavos")), "carência + disponível")
        + card("Estornos", brl(soma(es, "totalCentavos")), `${es.length} pagamento(s) estornado(s)`)
        + card("Saques em aberto", sa ? brl(sa.valorCentavos) : "—", sa ? `${sa.qtd} aula(s)${sa.qtd ? ` · mais antigo há ${horas} h` : ""}` : "", horas >= 24 ? "blue" : "");
    $("f-saq-n").hidden = !sa?.qtd; $("f-saq-n").textContent = sa?.qtd || "";
}
const listaPag = () => {
    const st = $("f-st").value, q = $("f-busca").value.trim().toLowerCase(), de = $("f-de").value, ate = $("f-ate").value;
    return S.pagos.filter((p) => { const d = diaDe(p.pagoEm); return (!st || p.status === st) && (!de || d >= de) && (!ate || d <= ate) && buscaOk([p.id, p.mpPaymentId, p.personalUid], q); });
};
function renderPag() {
    const l = listaPag(), n = S.fpag || 50;
    $("f-pag-b").innerHTML = l.length ? l.slice(0, n).map((p) => `<tr>${td("Aula", `${esc(p.id)}${p.simulado ? ' <span class="ax-badge">teste</span>' : ""}${p.estornoParcialCentavos ? ' <span class="ax-badge r">estorno parcial</span>' : ""}`)}${td("Status", `<span class="ax-badge ${p.status === "aprovado" ? "g" : "r"}">${esc(p.status)}</span>`)}${td("Método", esc(p.metodo || "—"))}${td("Total", esc(brl(p.totalCentavos)))}${td("Repasse", esc(brl(p.repasseCentavos)))}${td("Comissão", esc(brl(p.comissaoCentavos)))}${td("Pago em", dt(p.pagoEm))}${td("", p.status === "aprovado" ? `<button class="ax-btn sm danger" data-estornar="${esc(p.id)}">Estornar</button>` : "", "acts")}</tr>`).join("") : vazio(8, "Nenhum pagamento neste filtro.");
    $("f-pag-n").textContent = `${Math.min(n, l.length)} de ${l.length} pagamento(s) · soma do filtro: ${brl(soma(l, "totalCentavos"))}`; $("f-mais").hidden = l.length <= n;
}
async function carregarPagamentos() { S.pagos = await consultar("admin/pagamentos"); renderPag(); renderFinKpis(); renderVisao(); }
for (const id of ["f-st", "f-busca", "f-de", "f-ate"]) $(id).addEventListener("input", () => { S.fpag = 50; renderPag(); });
$("f-mais").addEventListener("click", () => { S.fpag = (S.fpag || 50) + 50; renderPag(); });
$("f-csv").addEventListener("click", () => baixarLinhas("pagamentos", ["Aula", "Status", "Método", "Total (R$)", "Repasse (R$)", "Comissão (R$)", "ID Mercado Pago", "Personal", "Teste", "Pago em"], listaPag().map((p) => [p.id, p.status, p.metodo, reais(p.totalCentavos), reais(p.repasseCentavos), reais(p.comissaoCentavos), p.mpPaymentId, p.personalUid, p.simulado ? "sim" : "não", dt(p.pagoEm)]), "pagamentos"));
async function carregarSaques() {
    const l = await consultar(`admin/saques?status=${encodeURIComponent($("f-saq-st").value)}`);
    $("f-saq-b").innerHTML = l.length ? l.map((s) => { const aberto = s.status === "solicitado", parado = aberto && Date.now() - new Date(s.em) > 864e5; return `<tr>${td("Quando", dt(s.em))}${td("Há", parado ? `<span class="ax-bad">${esc(haHoras(s.em))} ⚠</span>` : esc(haHoras(s.em)))}${td("Personal", esc(s.uid))}${td("Valor", esc(brl(s.valorCentavos)))}${td("Pix", s.pix ? `${esc(s.pix.tipo)}: <code>${esc(s.pix.chave)}</code>` : esc(s.comprovante || "—"))}${td("", aberto ? `<div class="ax-acts"><button class="ax-btn sm ok" data-pagar="${esc(s.id)}">Marcar pago</button><button class="ax-btn sm danger" data-rejeitar="${esc(s.id)}">Rejeitar</button></div>` : "", "acts")}</tr>`; }).join("") : vazio(6, "Nada aqui.");
}
$("f-saq-st").addEventListener("change", seguro(carregarSaques));
$("f-liberar").addEventListener("click", seguro(async () => { const r = await chamarFuncao("admin/liberar-saldos", {}); toast(`${r.liberados} lançamento(s) liberado(s).`, "ok"); }));
document.addEventListener("click", seguro(async (e) => {
    const est = e.target.closest("[data-estornar]"), pg = e.target.closest("[data-pagar]"), rj = e.target.closest("[data-rejeitar]");
    if (est) {
        const motivo = await pedir({ titulo: "Estornar pagamento", texto: "Devolve o valor ao aluno no Mercado Pago e desfaz repasse e comissão. Será auditado.", rotulo: "Motivo do estorno", min: 5, ok: "Estornar", perigo: true }); if (!motivo) return;
        const r = await sensivel(() => chamarFuncao(`admin/aulas/${encodeURIComponent(est.dataset.estornar)}/estornar`, { motivo }));
        toast(r.saldoNegativo ? "Estornado. Atenção: a carteira do personal ficou negativa." : "Estornado.", r.saldoNegativo ? "err" : "ok"); await carregarPagamentos(); seguro(carregarResumoFin)();
    }
    if (pg) { const c = await pedir({ titulo: "Marcar saque como pago", rotulo: "ID/comprovante do Pix enviado", min: 3, ok: "Marcar pago" }); if (!c) return; await sensivel(() => chamarFuncao(`admin/saques/${encodeURIComponent(pg.dataset.pagar)}/pagar`, { comprovante: c })); toast("Saque pago.", "ok"); await carregarSaques(); seguro(carregarResumoFin)(); }
    if (rj) { const m = await pedir({ titulo: "Rejeitar saque", texto: "O valor volta à carteira do personal.", rotulo: "Motivo da rejeição", min: 3, ok: "Rejeitar", perigo: true }); if (!m) return; await sensivel(() => chamarFuncao(`admin/saques/${encodeURIComponent(rj.dataset.rejeitar)}/rejeitar`, { motivo: m })); toast("Saque rejeitado.", "ok"); await carregarSaques(); seguro(carregarResumoFin)(); }
}));
async function conciliar(mp) {
    const r = await consultar(`admin/conciliacao${mp ? "?mp=1" : ""}`), t = r.totais;
    S.conc = r.divergencias.filter((d) => !d.informativo).map((d) => ({ n: "e", t: `Divergência financeira: ${d.tipo}`, d: d.descricao })); badges();
    $("c-res").innerHTML = `<h3 class="${r.ok ? "ax-ok" : "ax-bad"}">${r.ok ? "✓ Tudo conciliado" : "✗ Há divergências"}</h3>
        <p class="ax-sm ax-mt">Recebido líquido: <strong>${esc(brl(t.recebidoLiquidoCentavos))}</strong> · Saldos: <strong>${esc(brl(t.saldosCentavos))}</strong> · Saques em aberto: ${esc(brl(t.saquesSolicitadosCentavos))} · Saques pagos: ${esc(brl(t.saquesPagosCentavos))} · Diferença: <strong class="${t.diferencaCentavos ? "ax-bad" : "ax-ok"}">${esc(brl(t.diferencaCentavos))}</strong></p>
        <p class="ax-xs ax-mut">${esc(r.contagens.lancamentos)} lançamentos · ${esc(r.contagens.carteiras)} carteiras · ${esc(r.contagens.pagamentos)} pagamentos${mp ? ` · ${esc(r.contagens.conferidosMP)} conferidos no Mercado Pago` : ""}</p>
        ${r.divergencias.length ? `<div class="ax-tw ax-mt"><table class="ax-tbl"><thead><tr><th>Tipo</th><th>Ref.</th><th>Descrição</th><th>Esperado</th><th>Encontrado</th></tr></thead><tbody>${r.divergencias.map((d) => `<tr>${td("Tipo", esc(d.tipo) + (d.informativo ? " (info)" : ""))}${td("Ref.", esc(d.ref))}${td("Descrição", esc(d.descricao))}${td("Esperado", `<pre>${esc(JSON.stringify(d.esperado))}</pre>`)}${td("Encontrado", `<pre>${esc(JSON.stringify(d.encontrado))}</pre>`)}</tr>`).join("")}</tbody></table></div>` : ""}`;
    return r;
}
$("c-rodar").addEventListener("click", seguro(() => conciliar(false))); $("c-rodar-mp").addEventListener("click", seguro(() => conciliar(true)));

// ---------- treinamento (categorias + prova) ----------
// Modelo do servidor: obrigatório (≠ false) = "habilitacao" (Personow, sequencial, libera as aulas); o resto são cursos opcionais por categoria.
// As habilitações por MODALIDADE (Musculação, Funcional, Corrida, Mente e corpo, Lutas, Consultoria) têm aba própria: "Habilitações".
const CATS = [["habilitacao", "Habilitação Personow"], ["tecnica", "Técnica de treino"], ["saude", "Saúde e prevenção de lesões"], ["atendimento", "Atendimento e postura"], ["seguranca", "Segurança e primeiros socorros"], ["carreira", "Carreira e finanças"], ["geral", "Outros cursos"]];
const obrigM = (m) => m.obrigatorio !== false;
const catM = (m) => (obrigM(m) ? "habilitacao" : CATS.some(([k]) => k === m.categoria) && m.categoria !== "habilitacao" ? m.categoria : "geral");
const sincCat = () => { const o = $("t-obrig").checked; if (o) $("t-cat").value = "habilitacao"; else if ($("t-cat").value === "habilitacao") $("t-cat").value = "geral"; $("t-cat").disabled = o; };
$("t-obrig").addEventListener("change", sincCat);
$("t-cat").innerHTML = CATS.map(([k, n]) => `<option value="${k}">${n}</option>`).join("");
async function carregarModulos() {
    S.mods = await consultar("admin/treinamento/modulos"); S.cat ||= "habilitacao"; renderModulos();
    if (!S.mods.some((m) => m.ativo && obrigM(m))) toast("Sem módulo obrigatório ativo: ninguém consegue aceitar aulas.", "err", 6000);
}
function renderModulos() {
    $("t-cats").innerHTML = CATS.map(([k, n]) => `<button class="ax-pill${S.cat === k ? " sel" : ""}" data-cat="${k}">${esc(n)} (${S.mods.filter((m) => catM(m) === k).length})</button>`).join("");
    const l = S.mods.filter((m) => catM(m) === S.cat).sort((a, b) => a.ordem - b.ordem); $("t-tit").textContent = `Módulos · ${CATS.find(([k]) => k === S.cat)[1]}`;
    $("t-body").innerHTML = l.length ? l.map((m) => `<tr>${td("Ordem", esc(m.ordem))}${td("Título", `${esc(m.titulo)}<br><span class="ax-xs ax-mut">${esc(m.id)}</span>`)}${td("Duração", Math.round(m.duracaoSeg / 60) + " min")}${td("Prova", m.perguntas?.length ? `${m.perguntas.length} pergunta(s) · mín. ${esc(m.notaMinima || 70)}%` : "—")}${td("Obrigatório", obrigM(m) ? '<span class="ax-warn">sim</span>' : "não")}${td("Ativo", m.ativo ? '<span class="ax-ok">sim</span>' : "não")}${td("", `<button class="ax-btn sm" data-edit-mod="${esc(m.id)}">Editar</button>`, "acts")}</tr>`).join("") : vazio(7, S.cat === "geral" ? "Nenhum módulo geral: ninguém consegue aceitar aulas até você publicar o treinamento." : "Nenhum módulo nesta categoria ainda.");
}
$("t-cats").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) { S.cat = b.dataset.cat; $("t-editor").hidden = true; renderModulos(); } });

// editor: estado em S.perg; os campos de texto atualizam S.perg sem redesenhar (não perde o foco)
S.perg = []; S.edId = "";
const novaPerg = () => ({ enunciado: "", alternativas: ["", ""], correta: 0 });
function abrirEditor(m) {
    S.edId = m?.id || ""; $("t-editor").hidden = false; $("t-ed-tit").textContent = m ? `Editar módulo` : `Novo módulo · ${CATS.find(([k]) => k === S.cat)[1]}`;
    const prox = Math.max(0, ...S.mods.filter((x) => catM(x) === S.cat).map((x) => x.ordem || 0)) + 1;
    $("t-cat").value = m ? catM(m) : S.cat; $("t-ordem").value = m?.ordem ?? prox; $("t-titulo").value = m?.titulo || ""; $("t-desc").value = m?.descricao || ""; $("t-prov").value = m?.provedor || "youtube"; $("t-ref").value = m?.videoRef || "";
    $("t-dur").value = m?.duracaoSeg || ""; $("t-nota").value = m?.notaMinima || 70; $("t-ativo").checked = m ? !!m.ativo : true; $("t-obrig").checked = m ? obrigM(m) : S.cat === "habilitacao"; sincCat();
    S.perg = (m?.perguntas || []).map((q) => ({ enunciado: q.enunciado, alternativas: [...q.alternativas], correta: q.correta })); renderPerguntas();
    $("t-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderPerguntas() {
    $("t-pergs").innerHTML = S.perg.length ? S.perg.map((q, i) => `<div class="ax-q"><div class="ax-row"><strong class="ax-grow">Pergunta ${i + 1}</strong><button class="ax-btn sm danger" data-qdel="${i}">Remover</button></div>
        <textarea class="ax-ta" data-q="${i}" maxlength="300" placeholder="Escreva a pergunta" aria-label="Pergunta ${i + 1}">${esc(q.enunciado)}</textarea>
        ${q.alternativas.map((a, j) => `<div class="ax-alt"><label class="ax-chk"><input type="radio" name="c${i}" data-qc="${i}" value="${j}"${q.correta === j ? " checked" : ""}>Correta</label><input class="ax-in" data-qa="${i}:${j}" maxlength="150" value="${esc(a)}" placeholder="Alternativa ${j + 1}" aria-label="Alternativa ${j + 1} da pergunta ${i + 1}"><button class="ax-btn sm" data-adel="${i}:${j}" aria-label="Remover alternativa">×</button></div>`).join("")}
        <div><button class="ax-btn sm" data-aadd="${i}"${q.alternativas.length >= 6 ? " disabled" : ""}>+ Adicionar alternativa</button></div></div>`).join("") : '<p class="ax-mut ax-sm ax-mb">Nenhuma pergunta: o módulo conclui só com o vídeo.</p>';
    tamanho();
}
const corpoModulo = () => ({
    categoria: $("t-obrig").checked ? "habilitacao" : $("t-cat").value, ordem: Number($("t-ordem").value), titulo: $("t-titulo").value.trim(), descricao: $("t-desc").value.trim(), provedor: $("t-prov").value, videoRef: $("t-ref").value.trim(), duracaoSeg: Number($("t-dur").value),
    notaMinima: Number($("t-nota").value) || 70, ativo: $("t-ativo").checked, obrigatorio: $("t-obrig").checked,
    perguntas: S.perg.map((q) => { const alts = q.alternativas.map((a, j) => [a.trim(), j]).filter(([a]) => a); return { enunciado: q.enunciado.trim(), alternativas: alts.map(([a]) => a), correta: Math.max(0, alts.findIndex(([, j]) => j === q.correta)) }; }),
});
const LIMITE_KB = 19000;   // o servidor limita o corpo da requisição a ~20 KB
function tamanho() { const n = JSON.stringify(corpoModulo()).length; $("t-tam").textContent = `${(n / 1000).toFixed(1)} de ${(LIMITE_KB / 1000).toFixed(0)} KB`; $("t-tam").className = "ax-xs " + (n > LIMITE_KB ? "ax-bad" : "ax-mut"); return n; }
$("t-novo").addEventListener("click", () => abrirEditor(null));
$("t-cancelar").addEventListener("click", () => { $("t-editor").hidden = true; });
$("t-add-q").addEventListener("click", () => { if (S.perg.length >= 20) return toast("Máximo de 20 perguntas por módulo.", "err"); S.perg.push(novaPerg()); renderPerguntas(); });
$("t-pergs").addEventListener("input", (e) => { const d = e.target.dataset; if (d.q !== undefined) S.perg[+d.q].enunciado = e.target.value; else if (d.qa) { const [i, j] = d.qa.split(":").map(Number); S.perg[i].alternativas[j] = e.target.value; } tamanho(); });
$("t-pergs").addEventListener("change", (e) => { if (e.target.dataset.qc !== undefined) S.perg[+e.target.dataset.qc].correta = Number(e.target.value); });
$("t-pergs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return; const d = b.dataset;
    if (d.qdel !== undefined) S.perg.splice(+d.qdel, 1);
    else if (d.aadd !== undefined) { const q = S.perg[+d.aadd]; if (q.alternativas.length < 6) q.alternativas.push(""); }
    else if (d.adel) { const [i, j] = d.adel.split(":").map(Number), q = S.perg[i]; if (q.alternativas.length <= 2) return toast("Cada pergunta precisa de pelo menos 2 alternativas.", "err"); q.alternativas.splice(j, 1); if (q.correta === j) q.correta = 0; else if (q.correta > j) q.correta--; }
    else return;
    renderPerguntas();
});
document.addEventListener("click", (e) => { const b = e.target.closest("[data-edit-mod]"); if (b) { const m = S.mods.find((x) => x.id === b.dataset.editMod); if (m) abrirEditor(m); } });
$("t-salvar").addEventListener("click", seguro(async () => {
    const c = corpoModulo(), n = tamanho();
    if (n > LIMITE_KB) throw new Error("Prova grande demais: reduza perguntas ou textos.");
    for (const [i, q] of S.perg.entries()) if (!q.alternativas[q.correta]?.trim()) throw new Error(`Pergunta ${i + 1}: a alternativa marcada como correta está vazia.`);
    for (const [i, q] of c.perguntas.entries()) { if (q.enunciado.length < 5) throw new Error(`Pergunta ${i + 1}: escreva o enunciado.`); if (q.alternativas.length < 2) throw new Error(`Pergunta ${i + 1}: preencha pelo menos 2 alternativas.`); }
    await chamarFuncao(S.edId ? `admin/treinamento/modulos/${encodeURIComponent(S.edId)}` : "admin/treinamento/modulos", c, S.edId ? "PUT" : "POST");
    toast("Módulo salvo.", "ok"); S.cat = c.categoria; $("t-editor").hidden = true; await carregarModulos();
}));

// ---------- habilitações por modalidade (vídeo + cronômetro + prova 100%) ----------
S.hab = []; S.habSel = ""; S.hperg = [];
const HAB_MAX_Q = 4, HAB_MAX_ALT = 5, HAB_MIN_ALT = 2;
async function carregarHab() { S.hab = await consultar("admin/habilitacoes/categorias"); S.habSel ||= S.hab[0]?.id || ""; renderHab(); }
function renderHab() {
    $("h-cats").innerHTML = S.hab.map((c) => `<button class="ax-pill${c.id === S.habSel ? " sel" : ""}" data-hab="${esc(c.id)}">${esc(c.ico)} ${esc(c.titulo)} ${c.pronta ? "✓" : "•"}</button>`).join("");
    const c = S.hab.find((x) => x.id === S.habSel); if (!c) return;
    $("h-tit").textContent = `${c.ico} ${c.titulo}`;
    $("h-status").innerHTML = c.pronta ? '<span class="ax-ok">Publicada: os personais já podem se habilitar neste modalidade.</span>' : '<span class="ax-bad">Incompleta ou inativa: ninguém consegue se habilitar e as aulas deste modalidade ficam travadas.</span>';
    $("h-prov").value = c.provedor || "youtube"; $("h-ref").value = c.videoRef || ""; $("h-dur").value = c.duracaoSeg || ""; $("h-desc").value = c.descricao || ""; $("h-ativo").checked = c.ativo !== false;
    S.hperg = (c.perguntas || []).map((p) => ({ texto: p.texto, opcoes: [...p.opcoes], correta: p.correta })); renderHPerg();
}
function renderHPerg() {
    $("h-pergs").innerHTML = S.hperg.length ? S.hperg.map((q, i) => `<div class="ax-q"><div class="ax-row"><strong class="ax-grow">Pergunta ${i + 1}</strong><button class="ax-btn sm danger" data-hqdel="${i}">Remover</button></div>
        <textarea class="ax-ta" data-hq="${i}" maxlength="300" placeholder="Escreva a pergunta" aria-label="Pergunta ${i + 1}">${esc(q.texto)}</textarea>
        ${q.opcoes.map((a, j) => `<div class="ax-alt"><label class="ax-chk"><input type="radio" name="hc${i}" data-hqc="${i}" value="${j}"${q.correta === j ? " checked" : ""}>Correta</label><input class="ax-in" data-hqa="${i}:${j}" maxlength="150" value="${esc(a)}" placeholder="Alternativa ${j + 1}" aria-label="Alternativa ${j + 1} da pergunta ${i + 1}"><button class="ax-btn sm" data-hadel="${i}:${j}" aria-label="Remover alternativa">×</button></div>`).join("")}
        <div><button class="ax-btn sm" data-haadd="${i}"${q.opcoes.length >= HAB_MAX_ALT ? " disabled" : ""}>+ Adicionar alternativa</button></div></div>`).join("") : '<p class="ax-mut ax-sm ax-mb">Nenhuma pergunta ainda.</p>';
    $("h-add-q").disabled = S.hperg.length >= HAB_MAX_Q;
}
$("h-cats").addEventListener("click", (e) => { const b = e.target.closest("[data-hab]"); if (b) { S.habSel = b.dataset.hab; renderHab(); } });
$("h-add-q").addEventListener("click", () => { if (S.hperg.length < HAB_MAX_Q) { S.hperg.push({ texto: "", opcoes: ["", ""], correta: 0 }); renderHPerg(); } });
$("h-pergs").addEventListener("input", (e) => { const d = e.target.dataset; if (d.hq !== undefined) S.hperg[+d.hq].texto = e.target.value; else if (d.hqa) { const [i, j] = d.hqa.split(":").map(Number); S.hperg[i].opcoes[j] = e.target.value; } });
$("h-pergs").addEventListener("change", (e) => { if (e.target.dataset.hqc !== undefined) S.hperg[+e.target.dataset.hqc].correta = Number(e.target.value); });
$("h-pergs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return; const d = b.dataset;
    if (d.hqdel !== undefined) S.hperg.splice(+d.hqdel, 1);
    else if (d.haadd !== undefined) { const q = S.hperg[+d.haadd]; if (q.opcoes.length < HAB_MAX_ALT) q.opcoes.push(""); }
    else if (d.hadel) { const [i, j] = d.hadel.split(":").map(Number), q = S.hperg[i]; if (q.opcoes.length <= HAB_MIN_ALT) return toast("Cada pergunta precisa de pelo menos 2 alternativas.", "err"); q.opcoes.splice(j, 1); if (q.correta === j) q.correta = 0; else if (q.correta > j) q.correta--; }
    else return;
    renderHPerg();
});
$("h-salvar").addEventListener("click", seguro(async () => {
    for (const [i, q] of S.hperg.entries()) {
        if (q.texto.trim().length < 5) throw new Error(`Pergunta ${i + 1}: escreva o enunciado.`);
        if (q.opcoes.filter((a) => a.trim()).length < HAB_MIN_ALT) throw new Error(`Pergunta ${i + 1}: preencha pelo menos 2 alternativas.`);
        if (!q.opcoes[q.correta]?.trim()) throw new Error(`Pergunta ${i + 1}: a alternativa marcada como correta está vazia.`);
    }
    const perguntas = S.hperg.map((q) => { const ops = q.opcoes.map((a, j) => [a.trim(), j]).filter(([a]) => a); return { texto: q.texto.trim(), opcoes: ops.map(([a]) => a), correta: ops.findIndex(([, j]) => j === q.correta) }; });
    await chamarFuncao(`admin/habilitacoes/categorias/${encodeURIComponent(S.habSel)}`, { descricao: $("h-desc").value.trim(), provedor: $("h-prov").value, videoRef: $("h-ref").value.trim(), duracaoSeg: Number($("h-dur").value), ativo: $("h-ativo").checked, perguntas }, "PUT");
    toast("Habilitação salva.", "ok"); await carregarHab();
}));

// ---------- moderação e auditoria ----------
/** Alertas derivados das missões em tempo real + divergências da última conciliação. (O app ainda não registra check-in/check-out.) */
function alertas() {
    const h = hojeLocal(), a = [], d = (m) => `${m.aluno || "Aluno"} · ${fmtData(m.data)} ${m.horario || ""} · ${m.personalNome || "sem personal"}`;
    const agora = new Date(), min = agora.getHours() * 60 + agora.getMinutes(), mi = (x) => { const [p, q] = String(x || "0:0").split(":").map(Number); return p * 60 + q; }, d7 = new Date(Date.now() - 7 * 864e5).toLocaleDateString("sv-SE");
    for (const m of S.missoes) {
        const andamento = m.status === "aceita" || m.status === "paga";
        if (andamento && m.data === h && !m.checkinEm && min > mi(m.entrada) + 15 && min <= mi(m.saida)) a.push({ n: "w", t: "Sem check-in (mais de 15 min de atraso)", d: d(m) });
        if (andamento && m.checkinEm && !m.checkoutEm && (m.data < h || (m.data === h && min > mi(m.saida) + 30))) a.push({ n: "w", t: "Sem check-out após o fim da aula", d: d(m) });
        if ((m.divergencias || []).length && m.data >= d7) a.push({ n: "w", t: `Divergência de presença: ${m.divergencias.join(", ")}`, d: d(m) });
        if (m.status === "aceita" && m.data < h) a.push({ n: "w", t: "Aula vencido sem pagamento/conclusão", d: d(m) });
        else if (m.status === "aberta" && m.data < h) a.push({ n: "", t: "Oferta expirada sem personal", d: d(m) });
    }
    return [...S.conc, ...a];
}
const htmlAlerta = (x) => `<div class="ax-alert ${x.n}"><span>${x.n === "e" ? "⛔" : x.n === "w" ? "⚠️" : "ℹ️"}</span><div><strong>${esc(x.t)}</strong><br><span class="ax-sm ax-mut">${esc(x.d)}</span></div></div>`;
function renderAlertas() { const a = alertas(); $("a-lista").innerHTML = a.length ? a.slice(0, 60).map(htmlAlerta).join("") + (a.length > 60 ? `<p class="ax-xs ax-mut">+ ${a.length - 60} alerta(s) não exibidos.</p>` : "") : '<p class="ax-mut ax-sm">Nenhum alerta no momento.</p>'; }
$("a-conc").addEventListener("click", seguro(async () => { const r = await conciliar(false); renderAlertas(); toast(r.ok ? "Conciliação sem divergências." : "Há divergências financeiras.", r.ok ? "ok" : "err"); }));
const ROT = { "admin.exportar": "Exportou relatório", "admin.personal.ver_ficha": "Abriu ficha de cadastro", "admin.personal.status": "Mudou status de cadastro", "admin.sessoes.revogar": "Derrubou sessões", "admin.treinamento.criar": "Criou módulo de treinamento", "admin.treinamento.editar": "Editou módulo de treinamento", "admin.pagamento.estornar": "Estornou pagamento", "admin.saques.listar_com_pix": "Consultou saques (com Pix)", "admin.saque.pagar": "Pagou saque", "admin.saque.rejeitar": "Rejeitou saque", "admin.conciliacao": "Rodou conciliação", "admin.liberar_saldos": "Liberou saldos", "admin.aviso.salvar": "Salvou aviso global", "carteira.saque.solicitar": "Personal pediu saque", "perfil.pix.alterar": "Personal trocou chave Pix", "perfil.privado.atualizar": "Personal atualizou dados", "admin.suporte.ver_perfil": "Abriu perfil no atendimento", "admin.suporte.responder": "Respondeu no suporte", "admin.recado.enviar": "Enviou recado" };
const catAud = (a = "") => (a.startsWith("admin.exportar") ? "exp" : /pagamento|saque|conciliacao|liberar|carteira/.test(a) ? "fin" : a.startsWith("admin.treinamento") ? "trei" : a.startsWith("admin.aviso") ? "cfg" : /personal|sessoes|perfil/.test(a) ? "cad" : "");
const detalhes = (d) => { const t = Object.entries(d || {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · "); return t.length > 140 ? t.slice(0, 140) + "…" : t; };
const listaAud = () => { const q = $("a-busca").value.trim().toLowerCase(), c = S.catAud || ""; return S.aud.filter((a) => (!c || catAud(a.acao) === c) && buscaOk([a.acao, ROT[a.acao], a.alvo, a.uid, a.papel, a.ip], q)); };
async function carregarAuditoria() {
    S.aud = await consultar("admin/auditoria?limite=200"); renderAuditoria();
    $("a-hora").textContent = "atualizado às " + new Date().toLocaleTimeString("pt-BR"); $("a-live").textContent = $("a-auto").checked ? "● ao vivo" : "○ pausado"; $("a-live").className = $("a-auto").checked ? "ax-ok" : "ax-mut";
}
function renderAuditoria() {
    const l = listaAud();
    $("a-body").innerHTML = l.length ? l.map((a) => `<tr>${td("Quando", dt(a.em))}${td("Quem", `${esc(a.papel || "—")} <span class="ax-xs ax-mut">${esc(a.uid)}</span>`)}${td("Ação", `${esc(ROT[a.acao] || a.acao)}<br><span class="ax-xs ax-mut">${esc(a.acao)}</span>`)}${td("Alvo", esc(a.alvo || "—"))}${td("Detalhes", `<span class="ax-xs">${esc(detalhes(a.detalhes)) || "—"}</span>`)}${td("IP", esc(a.ip))}</tr>`).join("") : vazio(6, "Sem registros neste filtro.");
}
$("a-busca").addEventListener("input", renderAuditoria); $("a-atualizar").addEventListener("click", seguro(carregarAuditoria));
$("a-auto").addEventListener("change", () => { $("a-live").textContent = $("a-auto").checked ? "● ao vivo" : "○ pausado"; $("a-live").className = $("a-auto").checked ? "ax-ok" : "ax-mut"; if ($("a-auto").checked) seguro(carregarAuditoria)(); });
$("a-cats").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; S.catAud = b.dataset.c; for (const x of document.querySelectorAll("#a-cats .ax-pill")) x.classList.toggle("sel", x === b); renderAuditoria(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.vista === "moderacao" && $("a-auto").checked) seguro(carregarAuditoria)(); });
$("a-csv").addEventListener("click", () => baixarLinhas("auditoria", ["Quando", "Papel", "UID", "Ação", "Alvo", "Detalhes", "IP"], listaAud().map((a) => [dt(a.em), a.papel, a.uid, ROT[a.acao] || a.acao, a.alvo, detalhes(a.detalhes), a.ip]), "auditoria"));

// ---------- infrações, multas e banimentos ----------
const TIPO_INF = { desistencia_tardia: "Desistência tardia", falta_personal: "Falta do personal", cancelamento_tardio_aluno: "Cancelamento tardio (aluno)", falta_aluno: "Aluno ausente" };
async function carregarInfracoes() {
    const [l, b] = await Promise.all([consultar(`admin/infracoes?status=${$("i-st").value}`), consultar("admin/banidos")]);
    $("i-ban-b").innerHTML = b.length ? b.map((x) => `<tr>${td("Conta", `<code>${esc(x.uid)}</code>`)}${td("Papel", esc(x.papel))}${td("Motivo", esc(x.motivo))}${td("Quando", dt(x.em))}${td("Ação", `<button class="ax-btn sm" data-desbanir="${esc(x.uid)}">Desbanir</button>`)}</tr>`).join("") : vazio(5, "Nenhuma conta bloqueada.");
    $("i-b").innerHTML = l.length ? l.map((i) => `<tr>${td("Quando", dt(i.em))}${td("Conta", `<code>${esc(i.uid)}</code><br><span class="ax-xs ax-mut">${esc(i.papel)}</span>`)}${td("Tipo", esc(TIPO_INF[i.tipo] || i.rotulo || i.tipo))}${td("Detalhe", `<span class="ax-xs">${esc(i.detalhe || "")}</span>`)}`
        + `${td("Multa", i.multaCentavos ? `R$ ${(i.multaCentavos / 100).toFixed(2).replace(".", ",")}<br><span class="ax-xs ax-mut">${esc(i.multaStatus || "")}</span>` : "—")}${td("Adv.", esc(String(i.advertenciaNum || "")))}`
        + `${td("Ação", i.status === "ativa" ? `${i.papel === "aluno" && i.multaCentavos && i.multaStatus === "pendente" ? `<button class="ax-btn sm" data-multa="${esc(i.id)}">Multa cobrada</button> ` : ""}<button class="ax-btn sm" data-revogar="${esc(i.id)}">Revogar</button>` : "revogada")}</tr>`).join("") : vazio(7, "Nada por aqui.");
}
$("i-st").addEventListener("change", seguro(carregarInfracoes)); $("i-atualizar").addEventListener("click", seguro(carregarInfracoes));
document.addEventListener("click", seguro(async (e) => {
    let b;
    if ((b = e.target.closest("[data-revogar]"))) {
        const motivo = await pedir({ titulo: "Revogar infração", texto: "Devolve a multa e a vida do usuário. Será auditado.", rotulo: "Motivo da revogação", min: 5, ok: "Revogar", perigo: true }); if (!motivo) return;
        await sensivel(() => chamarFuncao(`admin/infracoes/${encodeURIComponent(b.dataset.revogar)}/revogar`, { motivo })); toast("Infração revogada (multa e vida devolvidas).", "ok"); await carregarInfracoes();
    } else if ((b = e.target.closest("[data-multa]"))) {
        await chamarFuncao(`admin/infracoes/${encodeURIComponent(b.dataset.multa)}/multa-cobrada`, {}); toast("Multa marcada como cobrada.", "ok"); await carregarInfracoes();
    } else if ((b = e.target.closest("[data-desbanir]"))) {
        const motivo = await pedir({ titulo: "Desbanir conta", texto: "A conta volta a operar e as advertências são zeradas. Será auditado.", rotulo: "Motivo do desbloqueio", min: 5, ok: "Desbanir" }); if (!motivo) return;
        await sensivel(() => chamarFuncao(`admin/contas/${encodeURIComponent(b.dataset.desbanir)}/desbanir`, { motivo, zerar: true })); toast("Conta desbloqueada e advertências zeradas.", "ok"); await carregarInfracoes();
    }
}));

// ---------- parceiros (B2B) ----------
async function carregarParceiros() {
    const l = await consultar("admin/parceiros");
    $("mk-b").innerHTML = l.length ? l.map((m) => `<tr>${td("Parceiro", esc(m.nome))}${td("Acessos", esc(String(m.acessos)))}${td("Vincular e-mail", `<input class="ax-inp" data-mk-email="${esc(m.id)}" placeholder="email@empresa.com" maxlength="120"> <button class="ax-btn sm" data-mk-add="${esc(m.id)}">Vincular</button> <button class="ax-btn sm" data-mk-rem="${esc(m.id)}">Remover</button>`)}</tr>`).join("") : vazio(3, "Nenhuma parceiro cadastrada.");
}
$("mk-criar").addEventListener("click", seguro(async () => { await chamarFuncao("admin/parceiros", { nome: $("mk-nome").value.trim() }); $("mk-nome").value = ""; toast("Parceiro criada.", "ok"); await carregarParceiros(); }));
document.addEventListener("click", seguro(async (e) => {
    const add = e.target.closest("[data-mk-add]"), rem = e.target.closest("[data-mk-rem]"), b = add || rem; if (!b) return;
    const id = b.dataset.mkAdd || b.dataset.mkRem, email = document.querySelector(`[data-mk-email="${CSS.escape(id)}"]`).value.trim();
    await chamarFuncao(`admin/parceiros/${encodeURIComponent(id)}/acesso`, { email, remover: !!rem }); toast(rem ? "Acesso removido." : "Acesso vinculado.", "ok"); await carregarParceiros();
}));

// ---------- configurações ----------
// ---------- taxas da plataforma (editáveis) ----------
// A fonte da verdade é o servidor (PUT /admin/taxas valida de novo e grava em configuracoes/taxas).
// Esta tela: máscara de moeda, mantém aula = comissão + repasse, valida ao vivo e confirma antes de aplicar.
const TX = { atual: null, limites: null, padrao: null };
const fmtMoeda = (c) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const centavosDe = (el) => Number(String(el.value).replace(/\D/g, "").slice(0, 8) || 0);      // máx. R$ 999.999,99
const numDe = (el) => (String(el.value).trim() === "" ? NaN : Number(String(el.value).replace(",", ".")));
const ID_MOEDA = { precoCentavos: "tx-preco", comissaoCentavos: "tx-comissao", repasseCentavos: "tx-repasse", taxaFixaCentavos: "tx-taxafixa" };
const ID_NUM = { horasMin: "tx-hmin", horasMax: "tx-hmax", maxSemana: "tx-maxsem" };
const lerTaxas = () => ({ ...Object.fromEntries(Object.entries(ID_MOEDA).map(([k, id]) => [k, centavosDe($(id))])), ...Object.fromEntries(Object.entries(ID_NUM).map(([k, id]) => [k, numDe($(id))])) });
const CAMPOS_TX = [...Object.keys(ID_MOEDA), ...Object.keys(ID_NUM)];
const mudouTaxas = (f) => !!TX.atual && CAMPOS_TX.some((k) => !Object.is(f[k], TX.atual[k]));

/** Espelho das regras do servidor (que continua sendo quem decide). "" = ok. */
function erroTaxas(f) {
    const L = TX.limites || {}, m = (c) => `R$ ${fmtMoeda(c)}`;
    if (CAMPOS_TX.some((k) => !Number.isFinite(f[k]))) return "Preencha todos os campos.";
    const [dMin, dMax] = L.precoCentavos || [1000, 500000], [tMin, tMax] = L.taxaFixaCentavos || [0, 50000], [hLo, hHi] = L.horas || [0.5, 12], [sLo, sHi] = L.maxSemana || [1, 7];
    if (f.precoCentavos < dMin || f.precoCentavos > dMax) return `A aula deve ficar entre ${m(dMin)} e ${m(dMax)}.`;
    if (f.taxaFixaCentavos < tMin || f.taxaFixaCentavos > tMax) return `A taxa fixa deve ficar entre ${m(tMin)} e ${m(tMax)}.`;
    if (f.repasseCentavos <= 0) return "O repasse ao personal precisa ser maior que zero.";
    if (f.comissaoCentavos + f.repasseCentavos !== f.precoCentavos) return `Comissão (${m(f.comissaoCentavos)}) + repasse (${m(f.repasseCentavos)}) deve ser igual à aula (${m(f.precoCentavos)}).`;
    if (!Number.isInteger(f.horasMin * 2) || !Number.isInteger(f.horasMax * 2)) return "A duração da aula deve ser em horas inteiras ou meias horas (ex.: 4 ou 4,5).";
    if (f.horasMin < hLo || f.horasMax > hHi) return `A duração da aula deve ficar entre ${hLo} h e ${hHi} h.`;
    if (f.horasMin > f.horasMax) return "A duração mínima não pode ser maior que a máxima.";
    if (!Number.isInteger(f.maxSemana) || f.maxSemana < sLo || f.maxSemana > sHi) return `Máx. de aulas por semana: número inteiro de ${sLo} a ${sHi}.`;
    return "";
}

function preencherTaxas(t) {
    for (const [k, id] of Object.entries(ID_MOEDA)) $(id).value = fmtMoeda(t[k]);
    for (const [k, id] of Object.entries(ID_NUM)) $(id).value = String(t[k]);
    renderTaxas();
}
function renderTaxas() {
    const f = lerTaxas(), erro = erroTaxas(f), sujo = mudouTaxas(f), pct = (p) => (Number.isFinite(p) ? `(${p.toFixed(p % 1 ? 1 : 0).replace(".", ",")}%)` : "");
    $("tx-pct-com").textContent = f.precoCentavos > 0 ? pct((f.comissaoCentavos / f.precoCentavos) * 100) : "";
    $("tx-pct-rep").textContent = f.precoCentavos > 0 ? pct((f.repasseCentavos / f.precoCentavos) * 100) : "";
    const somaErrada = !!erro && /Comissão|repasse/i.test(erro);                                    // erro de soma: destaca os três campos envolvidos
    for (const [k, id] of [...Object.entries(ID_MOEDA), ...Object.entries(ID_NUM)]) $(id).classList.toggle("inv", !Number.isFinite(f[k]) || (somaErrada && ["precoCentavos", "comissaoCentavos", "repasseCentavos"].includes(k)));
    $("tx-erro").textContent = sujo || erro ? erro : "";
    $("tx-salvar").disabled = !sujo || !!erro; $("tx-descartar").disabled = !sujo;
    $("tx-estado").className = "ax-badge " + (erro ? "r" : sujo ? "y" : "g"); $("tx-estado").textContent = erro ? "Valores inválidos" : sujo ? "Alterações não salvas" : "Em vigor";
    const ok = !erro, depois = ok ? { total: f.precoCentavos + f.taxaFixaCentavos, plataforma: f.comissaoCentavos + f.taxaFixaCentavos, prof: f.repasseCentavos } : null;
    const antes = TX.atual && { total: TX.atual.precoCentavos + TX.atual.taxaFixaCentavos, plataforma: TX.atual.comissaoCentavos + TX.atual.taxaFixaCentavos, prof: TX.atual.repasseCentavos };
    const linha = (rot, k) => (depois ? `<dt>${esc(rot)}</dt><dd>${sujo && antes && antes[k] !== depois[k] ? `<span class="ax-mut">R$ ${esc(fmtMoeda(antes[k]))} →</span> ` : ""}<strong>R$ ${esc(fmtMoeda(depois[k]))}</strong></dd>` : "");
    $("tx-prev").innerHTML = depois ? linha("Aluno paga por aula", "total") + linha("Plataforma retém", "plataforma") + linha("Personal recebe", "prof") : '<dt>Prévia</dt><dd class="ax-mut">Corrija os valores para ver a prévia.</dd>';
}

// máscara de moeda "estilo caixa": digita só números, o valor vai se formando (2 → 0,02 → 0,20 → 2,00)
for (const id of Object.values(ID_MOEDA)) $(id).addEventListener("input", () => { $(id).value = fmtMoeda(centavosDe($(id))); });
// aula = comissão + repasse: editar um ajusta o outro (o admin pode digitar o que quiser, o total sempre fecha)
const resto = (a, b) => Math.max(0, a - b);
$("tx-preco").addEventListener("input", () => { $("tx-repasse").value = fmtMoeda(resto(centavosDe($("tx-preco")), centavosDe($("tx-comissao")))); });
$("tx-comissao").addEventListener("input", () => { $("tx-repasse").value = fmtMoeda(resto(centavosDe($("tx-preco")), centavosDe($("tx-comissao")))); });
$("tx-repasse").addEventListener("input", () => { $("tx-comissao").value = fmtMoeda(resto(centavosDe($("tx-preco")), centavosDe($("tx-repasse")))); });
for (const id of [...Object.values(ID_MOEDA), ...Object.values(ID_NUM)]) $(id).addEventListener("input", renderTaxas);
for (const id of Object.values(ID_MOEDA)) $(id).addEventListener("focus", () => setTimeout(() => $(id).select?.(), 0));

function aplicarRespostaTaxas(r) {
    TX.atual = Object.fromEntries([...CAMPOS_TX, "versao", "atualizadoEm", "atualizadoPor", "origem"].map((k) => [k, r[k]]));
    TX.limites = r.limites || TX.limites; TX.padrao = r.padrao || TX.padrao;
    $("tx-meta").textContent = r.origem === "padrao" ? "Usando os valores padrão (nunca editado)." : `Versão ${r.versao} · alterado ${r.atualizadoEm ? "em " + dt(r.atualizadoEm) : ""}${r.atualizadoPor ? " por " + r.atualizadoPor : ""}`;
    preencherTaxas(TX.atual);
}
async function carregarTaxas() { aplicarRespostaTaxas(await consultar("admin/taxas")); }

$("tx-descartar").addEventListener("click", () => { if (TX.atual) preencherTaxas(TX.atual); });
$("tx-padrao").addEventListener("click", () => { if (TX.padrao) preencherTaxas(TX.padrao); toast("Padrão carregado no formulário. Clique em salvar para aplicar.", "", 4000); });

$("tx-salvar").addEventListener("click", seguro(async () => {
    const f = lerTaxas(), erro = erroTaxas(f); if (erro) return renderTaxas();
    const a = TX.atual, m = (c) => `R$ ${fmtMoeda(c)}`, varia = (x, y) => (x === y ? m(y) : `${m(x)} → ${m(y)}`);
    const salto = Math.abs(f.precoCentavos - a.precoCentavos) / a.precoCentavos;
    const ok = await pedir({
        titulo: "Aplicar novas taxas?",
        texto: `Aula: ${varia(a.precoCentavos, f.precoCentavos)} · Comissão: ${varia(a.comissaoCentavos, f.comissaoCentavos)} · Repasse: ${varia(a.repasseCentavos, f.repasseCentavos)} · Taxa fixa: ${varia(a.taxaFixaCentavos, f.taxaFixaCentavos)} · Aula: ${f.horasMin}–${f.horasMax} h · Máx./semana por aluno: ${f.maxSemana}.${salto > 0.3 ? " ⚠️ A aula muda mais de 30%: confira se não é erro de digitação." : ""} Vale imediatamente para os próximos aulas.`,
        ok: "Aplicar agora", perigo: salto > 0.3
    });
    if (!ok) return;
    const b = $("tx-salvar"), html = b.innerHTML; b.disabled = true; b.textContent = "Salvando…";
    try {
        const r = await sensivel(() => chamarFuncao("admin/taxas", { ...f, versao: a.versao }, "PUT"));
        aplicarRespostaTaxas(r); toast("Taxas atualizadas. Já valem para os próximos aulas.", "ok");
    } catch (e) {
        if (e.code === "taxas-desatualizadas") { await carregarTaxas(); toast(e.message, "err", 12000); } else throw e;
    } finally { b.innerHTML = html; renderTaxas(); }
}));

const dl = (pares) => pares.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("");
function carregarConfig() {
    $("c-integ").innerHTML = dl([["Mercado Pago", "MP_ACCESS_TOKEN · MP_WEBHOOK_SECRET"], ["Firebase Admin", "FIREBASE_SERVICE_ACCOUNT"], ["Criptografia de dados", "chaves de gerar-chaves.js"], ["Cron de liberação", "CRON_SECRET → POST /interno/liberar"]]);
    return Promise.all([carregarTaxas(), carregarAviso()]);
}
$("c-testar-mp").addEventListener("click", seguro(async () => { const r = await conciliar(true); toast(r.ok ? "Mercado Pago respondeu e tudo confere." : "Conciliação com divergências — veja Financeiro.", r.ok ? "ok" : "err"); }));
async function carregarAviso() {
    const a = await consultar("admin/aviso");
    $("c-av-txt").value = a.texto || ""; $("c-av-nivel").value = a.nivel || "info"; $("c-av-on").checked = !!a.ativo;
    $("ax-aviso").hidden = !a.ativo; $("ax-aviso").textContent = a.ativo ? `Aviso global ativo: ${a.texto}` : "";
}
$("c-av-salvar").addEventListener("click", seguro(async () => {
    await chamarFuncao("admin/aviso", { texto: $("c-av-txt").value.trim(), nivel: $("c-av-nivel").value, ativo: $("c-av-on").checked }, "PUT");
    toast("Aviso salvo.", "ok"); await carregarAviso();
}));
