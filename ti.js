// Painel de TI. A autorização é do SERVIDOR (claim role=ti + operador ativo); esta tela só consome a API (/ti/*).
// Nada de innerHTML com dado cru: tudo passa por esc(). Tempo real: stream SSE via fetch (token no cabeçalho, nunca na URL).
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, reauthenticateWithCredential, reauthenticateWithPopup, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, googleProvider, entrarComGoogle, concluirLoginGoogle, chamarFuncao, consultar, baixarCSVProtegido, renovarToken } from "./firebase.js";
import { FUNCTIONS_BASE } from "./config.js";
import { esc } from "./core.js";
import "./presenca.js";

const $ = (id) => document.getElementById(id);
const S = { google: false, op: null, perm: [], cfg: null, vista: "dashboard", dias: 7, cv: "abertos", cproximo: null, os: "ativo", equipe: [], aproximo: null, parar: null, timer: null };
const pode = (p) => S.perm.includes(p);
const TITULOS = { dashboard: "Dashboard", chamados: "Chamados", operadores: "Operadores", admins: "Administradores", auditoria: "Auditoria" };
const ST = { aberto: ["Aberto", "b"], em_atendimento: ["Em atendimento", "y"], aguardando_usuario: ["Aguardando usuário", ""], resolvido: ["Resolvido", "g"], cancelado: ["Cancelado", "r"] };
const PRI = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };
const CAT = { acesso: "Acesso/login", pagamento: "Pagamento", app: "Aplicativo", bug: "Erro/bug", dados: "Dados", infra: "Infraestrutura", outro: "Outro" };
const badge = (t, c = "") => `<span class="ax-badge ${c}">${esc(t)}</span>`;
const stBadge = (s) => badge(...(ST[s] || [s, ""]));
const priBadge = (p) => `<span class="ax-badge ti-pri-${esc(p)}">${esc(PRI[p] || p)}</span>`;
const td = (l, h, c = "") => `<td data-l="${esc(l)}"${c ? ` class="${c}"` : ""}>${h}</td>`;
const vazio = (n, t) => `<tr><td colspan="${n}" class="ax-empty">${esc(t)}</td></tr>`;
const dt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const dur = (s) => { if (s == null) return "—"; s = Math.round(s); if (s < 60) return `${s} s`; const m = Math.round(s / 60); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; if (h < 48) return r ? `${h} h ${r} min` : `${h} h`; return `${Math.round(h / 24)} d`; };
const idade = (iso) => dur((Date.now() - new Date(iso).getTime()) / 1000);
const msg = (t = "") => { $("ax-msg").textContent = t; };
function toast(texto, tipo = "", ms = 6000) {
    const el = document.createElement("div"); el.className = "ax-toast " + tipo;
    el.innerHTML = `<span class="t">${esc(texto)}</span><button aria-label="Fechar">×</button>`; el.querySelector("button").addEventListener("click", () => el.remove());
    $("ax-toasts").append(el); if (ms) setTimeout(() => el.remove(), ms);
}
const seguro = (fn) => async (...a) => { msg(); try { await fn(...a); } catch (e) { console.error(e); if (e.code === "trocar-senha") return trocaObrigatoria(); msg(e.message || "Erro"); toast(e.message || "Erro inesperado.", "err"); } };

// ---------- diálogos ----------
/** Formulário modal. campos: [{n, label, tipo: text|password|textarea|select|checkbox, opcoes:[[valor,rótulo]], req, min, max, ph, valor}]. Resolve com { campo: valor } ou null. */
function formulario({ titulo, texto = "", campos = [], ok = "Confirmar", perigo = false, html = "", destino = "ti-dlg" }) {
    const d = $(destino);
    const campo = (c) => {
        const id = `f-${c.n}`, at = `${c.req ? " required" : ""}${c.min ? ` minlength="${c.min}"` : ""} maxlength="${c.max || 300}"`;
        const ctl = c.tipo === "textarea" ? `<textarea class="ax-ta" id="${id}" name="${c.n}"${at} placeholder="${esc(c.ph || "")}">${esc(c.valor || "")}</textarea>`
            : c.tipo === "select" ? `<select class="ax-sel" id="${id}" name="${c.n}"${c.req ? " required" : ""}>${c.opcoes.map(([v, l]) => `<option value="${esc(v)}"${v === c.valor ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`
            : c.tipo === "checkbox" ? `<label class="ax-chk"><input type="checkbox" id="${id}" name="${c.n}"${c.valor ? " checked" : ""}> ${esc(c.label)}</label>`
            : `<input class="ax-in" id="${id}" name="${c.n}" type="${c.tipo || "text"}"${at} placeholder="${esc(c.ph || "")}" value="${esc(c.valor || "")}" autocomplete="${c.tipo === "password" ? "new-password" : "off"}">`;
        return `<div class="ti-field">${c.tipo === "checkbox" ? "" : `<label class="ax-lbl" for="${id}">${esc(c.label)}</label>`}${ctl}</div>`;
    };
    d.innerHTML = `<form method="dialog"><h2>${esc(titulo)}</h2>${texto ? `<p class="ax-sm ax-mut ax-mt">${esc(texto)}</p>` : ""}${html}${campos.map(campo).join("")}<p class="ax-erro ax-mt" id="f-erro"></p>
        <div class="ax-row ax-mt" style="justify-content:flex-end"><button class="ax-btn" value="cancel" formnovalidate>Cancelar</button><button class="ax-btn ${perigo ? "danger" : "pri"}" value="ok">${esc(ok)}</button></div></form>`;
    return new Promise((res) => {
        d.addEventListener("close", () => {
            if (d.returnValue !== "ok") return res(null);
            const v = {}; for (const c of campos) { const e = d.querySelector(`[name="${c.n}"]`); v[c.n] = c.tipo === "checkbox" ? e.checked : e.value; } res(v);
        }, { once: true });
        d.returnValue = ""; d.showModal(); d.querySelector("input,textarea,select")?.focus();
    });
}
const informar = (titulo, html, ok = "Fechar") => { const d = $("ti-dlg"); d.innerHTML = `<form method="dialog"><h2>${esc(titulo)}</h2>${html}<div class="ax-row ax-mt" style="justify-content:flex-end"><button class="ax-btn pri" value="ok">${esc(ok)}</button></div></form>`; return new Promise((r) => { d.addEventListener("close", r, { once: true }); d.showModal(); }); };
function senhaUnica(nome, senha) {
    const p = informar("Senha temporária", `<p class="ax-sm ax-mut ax-mt">Entregue a <b>${esc(nome)}</b> por um canal seguro. Ela é exibida <b>só agora</b>, não fica guardada e o primeiro acesso exige criar uma senha nova.</p><div class="ti-senha ax-mt">${esc(senha)}</div><button type="button" class="ax-btn sm ax-mt" id="cp">Copiar</button>`);
    $("cp").addEventListener("click", () => navigator.clipboard?.writeText(senha).then(() => toast("Copiada.", "ok", 2000)));
    return p;
}
/** Ações sensíveis exigem login recente: pede a senha atual, reautentica e repete uma vez. */
async function sensivel(fn) {
    try { return await fn(); } catch (e) {
        if (e.code !== "reautenticar") throw e;
        if (S.google) {   // entrou com Google: confirma com o Google, não há senha para digitar
            try { await reauthenticateWithPopup(auth.currentUser, googleProvider); } catch { throw Object.assign(new Error("Ação cancelada."), { code: "cancelado" }); }
            await renovarToken(); return fn();
        }
        const v = await formulario({ titulo: "Confirme sua identidade", texto: "Por segurança, digite sua senha atual para continuar.", campos: [{ n: "s", label: "Senha atual", tipo: "password", req: true, max: 128 }], ok: "Confirmar" });
        if (!v) throw Object.assign(new Error("Ação cancelada."), { code: "cancelado" });
        try { await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, v.s)); } catch { throw new Error("Senha incorreta."); }
        await renovarToken(); return fn();
    }
}
const POLITICA = "Mínimo 12 caracteres, com 3 dos 4 tipos (minúscula, maiúscula, número, símbolo). Não use seu nome ou e-mail.";

// ---------- login / sessão ----------
$("ti-login-f").addEventListener("submit", async (e) => {
    e.preventDefault(); $("ti-login-erro").textContent = ""; $("ti-entrar").disabled = true;
    try { await signInWithEmailAndPassword(auth, $("ti-email").value.trim(), $("ti-senha").value); $("ti-senha").value = ""; }
    catch (err) { $("ti-login-erro").textContent = /too-many/.test(err.code || "") ? "Muitas tentativas. Aguarde alguns minutos." : "E-mail ou senha incorretos."; }
    finally { $("ti-entrar").disabled = false; }
});
$("ti-google").addEventListener("click", async () => {
    $("ti-login-erro").textContent = ""; $("ti-google").disabled = true;
    try { await entrarComGoogle(); }   // redirect: a página navega até o Google e volta
    catch (err) { console.error(err); $("ti-login-erro").textContent = "Não foi possível entrar com o Google. Tente novamente."; $("ti-google").disabled = false; }
});
concluirLoginGoogle().then(({ erro }) => { if (erro && !/no-auth-event|cancelled|popup-closed/.test(erro.code || "")) $("ti-login-erro").textContent = "Não foi possível concluir o login com o Google. Tente novamente."; });
onAuthStateChanged(auth, async (u) => {
    pararTempoReal(); clearInterval(S.timer); $("ti-app").hidden = true; $("ti-login").hidden = false;
    if (!u) return;
    try { S.google = (await u.getIdTokenResult()).signInProvider === "google.com"; } catch { S.google = false; }
    try {
        const r = await chamarFuncao("ti/sessao", {}); S.op = r.operador; S.perm = r.permissoes; S.cfg = r.config;
    } catch (e) {
        if (e.code === "trocar-senha") { $("ti-login").hidden = true; return trocaObrigatoria(); }
        $("ti-login-erro").textContent = e.code === "sem-permissao" ? (S.google ? "Esta conta Google não está liberada para o painel de TI. Peça ao administrador para cadastrar o seu e-mail (se ele já cadastrou, saia e entre de novo; contas de aluno, personal ou admin não servem)." : "Esta conta não é de operador de TI. O painel de TI usa e-mail e senha próprios, criados pelo administrador ou pelo gestor — não a conta de aluno, personal ou admin.") : e.code === "operador-inativo" ? "Esta conta de operador está desativada. Fale com o gestor de TI." : "Não foi possível entrar agora. Tente novamente.";
        await signOut(auth); return;
    }
    if (S.op?.trocarSenha) { $("ti-login").hidden = true; return trocaObrigatoria(); }
    iniciar();
});
/** Primeiro acesso / senha redefinida por um gestor: obriga criar a própria senha antes de qualquer coisa. */
async function trocaObrigatoria() { await trocarSenha(true); }
async function trocarSenha(obrigatoria = false) {
    for (;;) {
        const v = await formulario({ titulo: obrigatoria ? "Defina sua nova senha" : "Alterar minha senha", texto: obrigatoria ? "Sua senha atual é temporária. " + POLITICA : POLITICA, ok: "Salvar senha",
            campos: [{ n: "a", label: "Nova senha", tipo: "password", req: true, min: 12, max: 128 }, { n: "b", label: "Repita a nova senha", tipo: "password", req: true, min: 12, max: 128 }] });
        if (!v) { if (obrigatoria) { await signOut(auth); } return; }
        if (v.a !== v.b) { toast("As senhas não conferem.", "err"); continue; }
        try { await sensivel(() => chamarFuncao("ti/eu/senha", { senhaNova: v.a })); } catch (e) { if (e.code === "cancelado") continue; toast(e.message, "err"); continue; }
        await signOut(auth); $("ti-login-erro").textContent = "Senha alterada. Entre novamente com a nova senha."; return;
    }
}
$("ti-minha-senha").addEventListener("click", () => trocarSenha(false));
$("ti-sair").addEventListener("click", async () => { try { await chamarFuncao("ti/sessao/sair", {}); } catch { /* sai mesmo assim */ } await signOut(auth); });

function iniciar() {
    $("ti-login").hidden = true; $("ti-app").hidden = false; $("ax-quem").textContent = `${S.op?.nome} · ${S.op?.nivel}`; $("ti-minha-senha").hidden = S.google;   // sem senha própria quando o acesso é pelo Google
    for (const sel of [$("c-pri")]) sel.innerHTML = '<option value="">Todas as prioridades</option>' + S.cfg.prioridades.map((p) => `<option value="${esc(p)}">${esc(PRI[p])}</option>`).join("");
    document.querySelector('#ax-nav [data-v="operadores"]').hidden = !pode("operadores.ler"); document.querySelector('#ax-nav [data-v="admins"]').hidden = !pode("admins.gerir"); $("a-op").hidden = !pode("auditoria.ler"); $("a-verificar").hidden = !pode("auditoria.verificar"); $("a-csv").hidden = !pode("auditoria.ler");
    seguro(carregarEquipe)(); abrir(location.hash.slice(1) in TITULOS ? location.hash.slice(1) : "dashboard"); ligarTempoReal();
    S.timer = setInterval(() => { if (!document.hidden && S.vista === "dashboard") seguro(carregarDashboard)(); }, 30000);   // métricas do período; o resto vem pelo stream
}
async function carregarEquipe() {
    S.equipe = await consultar("ti/operadores");
    const opts = S.equipe.filter((o) => o.status === "ativo");
    $("c-resp").innerHTML = '<option value="">Qualquer responsável</option><option value="nenhum">Sem responsável</option>' + opts.map((o) => `<option value="${esc(o.uid)}">${esc(o?.nome)}</option>`).join("");
    $("a-op").innerHTML = '<option value="">Todos os operadores</option>' + opts.map((o) => `<option value="${esc(o.uid)}">${esc(o?.nome)}</option>`).join("");
}

// ---------- administradores (contas do painel administrativo) ----------
async function carregarAdmins() {
    const l = await consultar("ti/administradores");
    $("ad-body").innerHTML = l.length ? l.map((a) => `<tr>${td("Nome", esc(a.nome || "—"))}${td("E-mail", esc(a.email))}${td("Criado em", esc(dt(a.criadoEm)))}${td("Origem", esc(a.origem))}
        ${td("", `<div class="ax-acts"><button class="ax-btn sm" data-aa="senha" data-uid="${esc(a.uid)}" data-nome="${esc(a.nome || a.email)}">Redefinir senha</button><button class="ax-btn sm danger" data-aa="revogar" data-uid="${esc(a.uid)}" data-nome="${esc(a.nome || a.email)}">Remover acesso</button></div>`)}</tr>`).join("") : vazio(5, "Nenhum administrador encontrado.");
}
$("ad-novo").addEventListener("click", seguro(async () => {
    const v = await formulario({ titulo: "Novo administrador", texto: "Cria a conta com e-mail já verificado e acesso ao Painel administrativo. Senha em branco gera uma temporária (mostrada uma única vez).", ok: "Criar", campos: [
        { n: "nome", label: "Nome completo", req: true, min: 3, max: 100 }, { n: "email", label: "E-mail", tipo: "email", req: true, max: 120 }, { n: "senha", label: "Senha (opcional)", tipo: "password", max: 128 }] });
    if (!v) return; if (!v.senha) delete v.senha;
    const r = await sensivel(() => chamarFuncao("ti/administradores", v)); toast("Administrador criado.", "ok"); await carregarAdmins(); if (r.senhaTemporaria) senhaUnica(r.administrador?.nome, r.senhaTemporaria);
}));
$("ad-body").addEventListener("click", seguro(async (e) => {
    const b = e.target.closest("[data-aa]"); if (!b) return; const { aa, uid, nome } = b.dataset, base = `ti/administradores/${encodeURIComponent(uid)}`; let r;
    if (aa === "senha") {
        const v = await formulario({ titulo: `Redefinir senha de ${nome}`, texto: "Encerra as sessões abertas dessa conta. Senha em branco gera uma temporária. Quem fez a ação e o motivo ficam na auditoria.", ok: "Redefinir", perigo: true, campos: [
            { n: "senha", label: "Nova senha (opcional)", tipo: "password", max: 128 }, { n: "motivo", label: "Motivo (fica na auditoria)", req: true, min: 5, max: 200 }] });
        if (!v) return; if (!v.senha) delete v.senha; r = await chamarFuncao(base + "/senha", v); toast("Senha redefinida.", "ok");
    } else if (aa === "revogar") {
        const v = await formulario({ titulo: `Remover o acesso de ${nome}?`, texto: "A conta deixa de ser administradora na hora (as sessões são encerradas). Ela continua existindo, sem papel.", ok: "Remover", perigo: true, campos: [{ n: "motivo", label: "Motivo (fica na auditoria)", req: true, min: 5, max: 200 }] });
        if (!v) return; await chamarFuncao(base + "/revogar", v); toast("Acesso removido.", "ok");
    }
    await carregarAdmins(); if (r?.senhaTemporaria) senhaUnica(nome, r.senhaTemporaria);
}));

// ---------- perfil do solicitante (aluno/personal) ----------
const brlC = (c) => ((Number(c) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const linha = (r, v) => (v === "" || v == null ? "" : `<div><span class="ax-mut">${esc(r)}</span><br>${esc(String(v))}</div>`);
async function verPerfil(uid, tipo) {
    const p = await consultar(`ti/solicitantes/${encodeURIComponent(uid)}/perfil?tipo=${encodeURIComponent(tipo || "")}`);
    const m = p.missoes, st = Object.entries(m.porStatus).map(([k, v]) => `${esc(k)}: ${v}`).join(" · ") || "—";
    const campos = p.tipo === "aluno"
        ? [["Nome completo", p.nomeCompleto], ["Documento", p.documento], ["Telefone", p.telefone], ["Endereço", p.endereco], ["Objetivo", p.objetivo], ["Cartão", p.cartao]]
        : [["CPF", p.cpfMascarado], ["CREF", p.cref], ["Nascimento", p.nascimento ? `${p.nascimento}${p.idade != null ? ` (${p.idade} anos)` : ""}` : ""], ["Telefone", p.telefone], ["Treinamento", p.treinamentoOk ? "concluído" : "pendente"],
            ["Carteira", p.carteira ? `disponível ${brlC(p.carteira.disponivelCentavos)} · pendente ${brlC(p.carteira.pendenteCentavos)}` : ""], ["Nota média", p.notaMedia ? `${p.notaMedia} (${p.avaliacoes} avaliações)` : ""]];
    const rec = m.recentes.map((x) => `<tr>${td("Data", esc(x.data))}${td("Horário", esc(x.horario))}${td("Local", esc(x.aluno))}${td("Status", esc(x.status))}</tr>`).join("") || vazio(4, "Sem missões.");
    await informar(`${p.nome || "Perfil"} · ${p.tipo === "aluno" ? "aluno" : "personal"}`, `<div class="ti-split ax-mt ax-sm">${[["E-mail", p.email], ["Situação", p.status], ["Cidade", p.cidade], ["Nível", p.nivel], ...campos].map(([r, v]) => linha(r, v)).join("")}</div>
        <h3 class="ax-mt">Missões (${m.total})</h3><p class="ax-xs ax-mut">${st}</p>
        <div class="ax-tw ax-mt"><table class="ax-tbl"><thead><tr><th>Data</th><th>Horário</th><th>Local</th><th>Status</th></tr></thead><tbody>${rec}</tbody></table></div>
        <p class="ax-xs ax-mut ax-mt">Esta consulta fica registrada na auditoria.</p>`);
}

// ---------- navegação ----------
const menu = (o) => { $("ax-side").classList.toggle("open", o); $("ax-veil").hidden = !o; $("ax-burger").setAttribute("aria-expanded", String(o)); document.body.style.overflow = o ? "hidden" : ""; };
$("ax-burger").addEventListener("click", () => menu(!$("ax-side").classList.contains("open"))); $("ax-veil").addEventListener("click", () => menu(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") menu(false); });
const CARGA = { dashboard: () => carregarDashboard(), chamados: () => carregarChamados(true), operadores: () => carregarOperadores(), admins: () => carregarAdmins(), auditoria: () => carregarAuditoria(true) };
function abrir(v) {
    if (!(v in TITULOS) || (v === "operadores" && !pode("operadores.ler")) || (v === "admins" && !pode("admins.gerir"))) v = "dashboard";
    S.vista = v; menu(false); $("ax-titulo").textContent = TITULOS[v]; document.title = `${TITULOS[v]} — TI Personow`;
    for (const k of Object.keys(TITULOS)) $("v-" + k).hidden = k !== v;
    for (const b of document.querySelectorAll("#ax-nav .ax-nav")) b.classList.toggle("sel", b.dataset.v === v);
    seguro(CARGA[v])();
}
const ir = (v) => (location.hash === "#" + v ? abrir(v) : (location.hash = v));
window.addEventListener("hashchange", () => { if (!$("ti-app").hidden) abrir(location.hash.slice(1)); });
$("ax-nav").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) ir(b.dataset.v); });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-ir]"); if (b) ir(b.dataset.ir); });

// ---------- tempo real (SSE via fetch) ----------
function pintarTick(r) {
    const o = r.online, f = r.fila;
    $("k-online").textContent = o.total; $("k-online-s").textContent = `${o.alunos} alunos · ${o.personais} personais · ${o.admins + o.ti} equipe`;
    $("k-abertos").textContent = f.totalAbertos; $("k-abertos-s").textContent = `${f.aberto} na fila · ${f.emAtendimento} em atendimento · ${f.aguardandoUsuario} aguardando`;
    $("k-atraso").textContent = f.foraDoPrazo; $("k-atraso").style.color = f.foraDoPrazo ? "var(--ax-red)" : "";
    $("n-ch").hidden = !f.aberto; $("n-ch").textContent = f.aberto;
    $("ti-dot").classList.add("on"); $("ti-live-t").textContent = `ao vivo · ${new Date(r.em).toLocaleTimeString("pt-BR")}`;
    if (S.ultimaFila !== undefined && f.aberto > S.ultimaFila) toast("Novo chamado na fila.", "new", 5000);
    S.ultimaFila = f.aberto;
}
async function ligarTempoReal() {
    pararTempoReal(); const ctl = new AbortController(); S.parar = () => ctl.abort(); let falhas = 0;
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    while (!ctl.signal.aborted) {
        if (document.hidden) { await espera(2000); continue; }                       // aba escondida: não segura conexão aberta
        try {
            const tok = await auth.currentUser.getIdToken();
            const r = await fetch(`${FUNCTIONS_BASE}/ti/stream`, { headers: { Authorization: `Bearer ${tok}`, Accept: "text/event-stream" }, signal: ctl.signal });
            if (!r.ok) throw new Error("stream " + r.status);
            falhas = 0; const leitor = r.body.getReader(), dec = new TextDecoder(); let buf = "";
            for (;;) {
                const { value, done } = await leitor.read(); if (done) break;
                buf += dec.decode(value, { stream: true });
                for (let i; (i = buf.indexOf("\n\n")) >= 0;) {
                    const bloco = buf.slice(0, i); buf = buf.slice(i + 2);
                    const ev = /^event: (.+)$/m.exec(bloco)?.[1], dados = /^data: (.+)$/m.exec(bloco)?.[1];
                    if (ev === "tick" && dados) pintarTick(JSON.parse(dados));
                    if (ev === "encerrado") { await signOut(auth); return; }          // conta excluída/rebaixada/senha trocada
                }
                if (document.hidden) { await leitor.cancel(); break; }
            }
        } catch (e) { if (ctl.signal.aborted) return; falhas++; }
        if (ctl.signal.aborted) return;
        $("ti-dot").classList.remove("on"); $("ti-live-t").textContent = "reconectando…";
        if (falhas >= 3) { try { const d = await consultar(`ti/dashboard?dias=${S.dias}`); pintarTick({ online: d.online, fila: d.fila, em: d.geradoEm }); } catch { /* tenta o stream de novo */ } }   // plano B: consulta periódica
        await espera(Math.min(30000, 1000 + 3000 * falhas));
    }
}
function pararTempoReal() { S.parar?.(); S.parar = null; }

// ---------- dashboard ----------
async function carregarDashboard() {
    for (const b of document.querySelectorAll("#d-dias .ax-pill")) b.classList.toggle("sel", Number(b.dataset.d) === S.dias);
    const [d, fila] = await Promise.all([consultar(`ti/dashboard?dias=${S.dias}`), consultar("ti/chamados?visao=abertos&limite=8")]);
    pintarTick({ online: d.online, fila: d.fila, em: d.geradoEm }); const p = d.periodo;
    $("k-tma").textContent = dur(p.tmaSeg); $("k-tma-s").textContent = p.slaAtendimentoPct == null ? "até um operador assumir" : `${p.slaAtendimentoPct}% dentro do SLA`;
    $("k-tmr").textContent = dur(p.tmrSeg); $("k-res").textContent = p.resolvidos; $("k-res-s").textContent = `${p.criados} aberto(s) no período` + (p.slaResolucaoPct == null ? "" : ` · ${p.slaResolucaoPct}% no SLA`);
    $("d-rank").innerHTML = d.ranking.length ? d.ranking.map((r) => `<tr>${td("#", r.posicao <= 3 ? ["🥇", "🥈", "🥉"][r.posicao - 1] : r.posicao)}${td("Operador", esc(r?.nome))}${td("Resolvidos", `<b>${r.resolvidos}</b>`)}${td("Assumidos", r.assumidos)}${td("Atend. médio", dur(r.tmaSeg))}${td("Resol. média", dur(r.tmrSeg))}</tr>`).join("") : vazio(6, "Sem atendimentos no período.");
    const max = Math.max(1, ...p.serie.flatMap((x) => [x.criados, x.resolvidos]));
    $("d-serie").innerHTML = p.serie.map((x) => `<div title="${esc(x.dia.split("-").reverse().join("/"))}: ${x.criados} criados, ${x.resolvidos} resolvidos"><div class="ti-bar2"><b class="c" style="height:${(x.criados / max) * 100}%"></b><b class="r" style="height:${(x.resolvidos / max) * 100}%"></b></div><span>${esc(x.dia.slice(p.dias > 31 ? 5 : 8))}</span></div>`).join("");
    $("d-fila").innerHTML = fila.itens.length ? fila.itens.map((c) => linhaChamado(c, true)).join("") : vazio(6, "Nenhum chamado em aberto. 🎉");
}
$("d-dias").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b) { S.dias = Number(b.dataset.d); seguro(carregarDashboard)(); } });

// ---------- chamados ----------
const prazo = (c) => {
    const alvo = c.status === "aberto" ? c.slaAtendEm : c.status === "em_atendimento" ? c.slaResolEm : null; if (!alvo) return "—";
    const ms = new Date(alvo).getTime() - Date.now(); return ms < 0 ? `<span class="ti-late">atrasado ${esc(dur(-ms / 1000))}</span>` : `em ${esc(dur(ms / 1000))}`;
};
const linhaChamado = (c, curta = false) => `<tr class="ti-click" data-id="${esc(c.id)}">${td("Protocolo", esc(c.protocolo))}${td("Chamado", `<b>${esc(c.titulo)}</b><br><span class="ax-xs ax-mut">${esc(CAT[c.categoria] || c.categoria)}</span>`)}${td("Prioridade", priBadge(c.prioridade))}${td("Status", stBadge(c.status))}`
    + (curta ? "" : td("Solicitante", esc(c.solicitante?.nome || "—"))) + td("Responsável", esc(c.atribuidoNome || "—")) + td("Prazo", prazo(c)) + (curta ? "" : td("Aberto", `${esc(dt(c.criadoEm))}<br><span class="ax-xs ax-mut">há ${esc(idade(c.criadoEm))}</span>`)) + "</tr>";
async function carregarChamados(reiniciar) {
    for (const b of document.querySelectorAll("#c-visao .ax-pill")) b.classList.toggle("sel", b.dataset.v === S.cv);
    const q = new URLSearchParams({ visao: S.cv, limite: "100" }); for (const [k, id] of [["prioridade", "c-pri"], ["atribuido", "c-resp"], ["q", "c-busca"]]) if ($(id).value.trim()) q.set(k, $(id).value.trim());
    if (!reiniciar && S.cproximo) q.set("cursor", S.cproximo);
    const r = await consultar(`ti/chamados?${q}`); S.cproximo = r.proximo;
    const html = r.itens.map((c) => linhaChamado(c)).join(""); $("c-body").innerHTML = reiniciar ? (html || vazio(8, "Nenhum chamado neste filtro.")) : $("c-body").innerHTML + html;
    $("c-mais").hidden = !r.proximo; $("c-nota").textContent = r.truncado && S.cv === "abertos" ? "Mostrando os 100 mais urgentes. Use os filtros para refinar." : "";
}
for (const id of ["c-pri", "c-resp"]) $(id).addEventListener("change", seguro(() => carregarChamados(true)));
let tb; $("c-busca").addEventListener("input", () => { clearTimeout(tb); tb = setTimeout(seguro(() => carregarChamados(true)), 350); });
$("c-visao").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { S.cv = b.dataset.v; seguro(() => carregarChamados(true))(); } });
$("c-atualizar").addEventListener("click", seguro(() => carregarChamados(true))); $("c-mais").addEventListener("click", seguro(() => carregarChamados(false)));
document.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr && !e.target.closest("button")) seguro(() => detalhe(tr.dataset.id))(); });
$("c-novo").addEventListener("click", seguro(async () => {
    const v = await formulario({ titulo: "Novo chamado", texto: "Registre um problema relatado por telefone, WhatsApp ou pessoalmente.", ok: "Abrir chamado", campos: [
        { n: "solicitanteNome", label: "Quem pediu", req: true, min: 2, max: 100, ph: "Nome da pessoa / aluno" }, { n: "titulo", label: "Título", req: true, min: 5, max: 120 },
        { n: "descricao", label: "Descrição", tipo: "textarea", req: true, min: 10, max: 2000 },
        { n: "categoria", label: "Categoria", tipo: "select", valor: "outro", opcoes: S.cfg?.categorias.map((c) => [c, CAT[c]]) }, { n: "prioridade", label: "Prioridade", tipo: "select", valor: "media", opcoes: S.cfg.prioridades.map((p) => [p, PRI[p]]) }] });
    if (!v) return; const c = await chamarFuncao("ti/chamados", v); toast(`Chamado ${c.protocolo} aberto.`, "ok"); await carregarChamados(true); detalhe(c.id);
}));

async function detalhe(id) {
    const c = await consultar(`ti/chamados/${encodeURIComponent(id)}`), d = $("ti-det"), meu = c.atribuidoUid === S.op.uid, gestor = pode("chamados.atribuir"), aberto = ["aberto", "em_atendimento", "aguardando_usuario"].includes(c.status);
    const prox = S.cfg.transicoes[c.status] || [], podeMexer = meu || gestor || (!c.atribuidoUid && c.status === "aberto");
    const ev = c.eventos.map((e) => { const txt = e.tipo === "criado" ? "Chamado aberto" : e.tipo === "assumido" ? "Assumiu o chamado" : e.tipo === "status" ? `${ST[e.de]?.[0] || e.de} → ${ST[e.para]?.[0] || e.para}` : e.tipo === "comentario" ? "" : e.texto;
        return `<div class="ti-ev${e.interno ? " int" : ""}"><div class="m">${esc(dt(e.em))} · ${esc(e.autor || "—")}${e.interno ? " · nota interna" : ""}</div>${txt ? `<div>${esc(txt)}</div>` : ""}${e.texto && e.tipo !== "atribuido" && e.tipo !== "prioridade" ? `<div>${esc(e.texto)}</div>` : ""}</div>`; }).join("");
    d.innerHTML = `<form method="dialog"><div class="ax-row"><h2 class="ax-grow">${esc(c.protocolo)} · ${esc(c.titulo)}</h2><button class="ax-btn sm" value="x" aria-label="Fechar">✕</button></div>
        <div class="ax-row ax-mt">${priBadge(c.prioridade)} ${stBadge(c.status)} ${badge(CAT[c.categoria] || c.categoria)} ${c.reaberturas ? badge(`reaberto ${c.reaberturas}x`, "r") : ""}</div>
        <p class="ax-sm ax-mt" style="white-space:pre-wrap">${esc(c.descricao)}</p>
        <div class="ti-split ax-mt ax-sm"><div><span class="ax-mut">Solicitante</span><br>${esc(c.solicitante?.nome)} <span class="ax-mut">(${esc(c.solicitante.tipo)})</span></div><div><span class="ax-mut">Responsável</span><br>${esc(c.atribuidoNome || "—")}</div><div><span class="ax-mut">Aberto em</span><br>${esc(dt(c.criadoEm))}</div><div><span class="ax-mut">1º atendimento</span><br>${c.atendidoEm ? esc(dur(c.tempoAtendSeg)) : "ainda não"}</div><div><span class="ax-mut">Prazo</span><br>${prazo(c)}</div></div>
        ${c.resolucao ? `<p class="ax-sm ax-mt"><b>Resolução:</b> ${esc(c.resolucao)}</p>` : ""}
        <h3 class="ax-mt">Linha do tempo</h3><div class="ti-tl ax-mt">${ev}</div>
        <div class="ax-row ax-mt" id="ti-acoes"></div></form>`;
    const A = $("ti-acoes"), btn = (txt, fn, cls = "") => { const b = document.createElement("button"); b.type = "button"; b.className = "ax-btn sm " + cls; b.textContent = txt; b.addEventListener("click", seguro(async () => { if (await fn()) { d.close(); await recarregar(); } })); A.append(b); };
    const acao = async (rota, corpo, metodo) => { await chamarFuncao(`ti/chamados/${encodeURIComponent(id)}/${rota}`, corpo, metodo); return true; };
    if (["aluno", "personal"].includes(c.solicitante?.tipo) && c.solicitante.uid) btn("👤 Ver perfil", async () => { await verPerfil(c.solicitante.uid, c.solicitante.tipo); return false; });
    if (aberto || c.status === "resolvido") btn("💬 Comentar", async () => { const v = await formulario({ titulo: "Comentar", destino: "ti-dlg", ok: "Enviar", campos: [{ n: "texto", label: "Mensagem", tipo: "textarea", req: true, max: 1000 }, { n: "publico", label: "Visível ao solicitante (desmarcado = nota interna)", tipo: "checkbox" }] }); return v && acao("comentarios", { texto: v.texto, interno: !v.publico }); });
    if (c.status === "aberto" || (c.status === "em_atendimento" && !c.atribuidoUid)) btn("✋ Assumir", () => acao("assumir", {}), "pri");
    if (podeMexer) for (const p of prox.filter((x) => x !== "em_atendimento" || c.status !== "aberto")) {
        const rot = { aguardando_usuario: "Aguardar usuário", resolvido: "Resolver", aberto: "Devolver à fila", cancelado: "Cancelar", em_atendimento: c.status === "resolvido" ? "Reabrir" : "Retomar" }[p];
        btn(rot, async () => { const exige = p === "resolvido" || p === "cancelado"; const v = await formulario({ titulo: rot, ok: rot, perigo: p === "cancelado", campos: [{ n: "nota", label: p === "resolvido" ? "O que foi feito (o solicitante verá)" : exige ? "Motivo" : "Nota (opcional)", tipo: "textarea", req: exige, min: exige ? 5 : 0, max: 1000 }] }); return v && acao("status", { status: p, nota: v.nota }); }, p === "resolvido" ? "ok" : p === "cancelado" ? "danger" : "");
    }
    if (gestor && aberto) btn("➜ Encaminhar", async () => { const v = await formulario({ titulo: "Encaminhar chamado", ok: "Encaminhar", campos: [{ n: "operadorUid", label: "Para", tipo: "select", req: true, opcoes: S.equipe.filter((o) => o.status === "ativo" && o.uid !== c.atribuidoUid).map((o) => [o.uid, `${o?.nome} (${o?.nivel})`]) }] }); return v && acao("atribuir", v); });
    if (podeMexer && aberto) btn("⚑ Prioridade", async () => { const v = await formulario({ titulo: "Alterar prioridade", ok: "Salvar", campos: [{ n: "prioridade", label: "Prioridade", tipo: "select", valor: c.prioridade, opcoes: S.cfg.prioridades.map((p) => [p, PRI[p]]) }] }); return v && v.prioridade !== c.prioridade && acao("prioridade", v, "PUT"); });
    d.showModal();
}
const recarregar = async () => { await CARGA[S.vista](); };

// ---------- operadores ----------
async function carregarOperadores() {
    for (const b of document.querySelectorAll("#o-status .ax-pill")) b.classList.toggle("sel", b.dataset.s === S.os);
    const l = await consultar(`ti/operadores?status=${S.os}`);
    $("o-nota").textContent = "Exclusão é lógica: o histórico e a auditoria continuam apontando para a pessoa. Senhas nunca ficam guardadas; reset gera uma senha temporária exibida uma única vez.";
    $("o-body").innerHTML = l.length ? l.map((o) => `<tr>${td("Nome", esc(o?.nome) + (o.uid === S.op.uid ? " (você)" : ""))}${td("E-mail", esc(o.email))}${td("Nível", badge(o?.nivel, o?.nivel === "gestor" ? "y" : ""))}${td("Último acesso", esc(dt(o.ultimoLoginEm)))}
        ${td("Situação", o.status === "excluido" ? badge("Excluído", "r") + `<br><span class="ax-xs ax-mut">${esc(o.motivoExclusao)} — ${esc(o.excluidoPor)}</span>` : o.trocarSenha ? badge("Troca de senha pendente", "y") : badge("Ativo", "g"))}
        ${td("", o.status === "excluido" ? `<button class="ax-btn sm ok" data-oa="restaurar" data-uid="${esc(o.uid)}" data-nome="${esc(o?.nome)}">Restaurar</button>` : o.uid === S.op.uid ? "" : `<div class="ax-acts"><button class="ax-btn sm" data-oa="nivel" data-uid="${esc(o.uid)}" data-nome="${esc(o?.nome)}" data-n="${esc(o?.nivel)}">Nível</button><button class="ax-btn sm" data-oa="senha" data-uid="${esc(o.uid)}" data-nome="${esc(o?.nome)}">Redefinir senha</button><button class="ax-btn sm danger" data-oa="excluir" data-uid="${esc(o.uid)}" data-nome="${esc(o?.nome)}">Excluir</button></div>`, "acts")}</tr>`).join("") : vazio(6, "Nenhum operador.");
}
$("o-status").addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (b) { S.os = b.dataset.s; seguro(carregarOperadores)(); } });
$("o-novo").addEventListener("click", seguro(async () => {
    const v = await formulario({ titulo: "Novo operador de TI", texto: "Deixe a senha em branco para gerar uma temporária (recomendado). O primeiro acesso exige trocá-la.", ok: "Cadastrar", campos: [
        { n: "nome", label: "Nome completo", req: true, min: 3, max: 100 }, { n: "email", label: "E-mail corporativo", tipo: "email", req: true, max: 120 },
        { n: "nivel", label: "Nível", tipo: "select", valor: "tecnico", opcoes: [["tecnico", "Técnico — atende chamados"], ["gestor", "Gestor — gerencia equipe, auditoria e encaminha chamados"]] }, { n: "senha", label: "Senha (opcional)", tipo: "password", max: 128 }] });
    if (!v) return; if (!v.senha) delete v.senha;
    const r = await sensivel(() => chamarFuncao("ti/operadores", v)); toast("Operador cadastrado.", "ok"); await carregarEquipe(); await carregarOperadores(); if (r.senhaTemporaria) senhaUnica(r.operador?.nome, r.senhaTemporaria);
}));
$("o-body").addEventListener("click", seguro(async (e) => {
    const b = e.target.closest("[data-oa]"); if (!b) return; const { oa, uid, nome } = b.dataset, base = `ti/operadores/${encodeURIComponent(uid)}`; let r;
    if (oa === "nivel") { const v = await formulario({ titulo: `Nível de ${nome}`, ok: "Salvar", campos: [{ n: "nivel", label: "Nível", tipo: "select", valor: b.dataset.n, opcoes: [["tecnico", "Técnico"], ["gestor", "Gestor"]] }] }); if (!v || v?.nivel === b.dataset.n) return; await sensivel(() => chamarFuncao(base + "/nivel", v, "PUT")); toast("Nível atualizado.", "ok"); }
    else if (oa === "senha") {
        const v = await formulario({ titulo: `Redefinir senha de ${nome}`, texto: "Encerra as sessões abertas dele(a) e exige trocar a senha no próximo acesso. Senha em branco gera uma temporária. Quem fez a ação e o motivo ficam na auditoria.", ok: "Redefinir", perigo: true, campos: [
            { n: "senha", label: "Nova senha (opcional)", tipo: "password", max: 128 }, { n: "motivo", label: "Motivo (fica na auditoria)", req: true, min: 5, max: 200 }] });
        if (!v) return; if (!v.senha) delete v.senha; r = await chamarFuncao(base + "/senha", v); toast("Senha redefinida.", "ok");
    }
    else if (oa === "excluir") { const v = await formulario({ titulo: `Excluir ${nome}?`, texto: "O acesso é bloqueado imediatamente e os chamados em andamento voltam para a fila. O histórico é preservado e dá para restaurar depois.", ok: "Excluir", perigo: true, campos: [{ n: "motivo", label: "Motivo (fica na auditoria)", req: true, min: 5, max: 200 }] }); if (!v) return; const x = await chamarFuncao(base + "/excluir", v); toast(`${nome} excluído(a). ${x.chamadosDevolvidos} chamado(s) devolvido(s) à fila.`, "ok"); }
    else if (oa === "restaurar") { if (!(await formulario({ titulo: `Restaurar ${nome}?`, texto: "Reativa o acesso com uma nova senha temporária.", ok: "Restaurar" }))) return; r = await sensivel(() => chamarFuncao(base + "/restaurar", {})); }
    await carregarEquipe(); await carregarOperadores(); if (r?.senhaTemporaria) senhaUnica(nome, r.senhaTemporaria);
}));

// ---------- auditoria ----------
const filtroAud = () => { const q = new URLSearchParams(); for (const [k, id] of [["operador", "a-op"], ["acao", "a-acao"], ["resultado", "a-res"], ["de", "a-de"], ["ate", "a-ate"]]) if ($(id).value.trim()) q.set(k, $(id).value.trim()); return q; };
async function carregarAuditoria(reiniciar) {
    const q = filtroAud(); q.set("limite", "50"); if (!reiniciar && S.aproximo) q.set("cursor", S.aproximo);
    const r = await consultar(`ti/auditoria?${q}`); S.aproximo = r.proximo;
    const cor = { ok: "g", negado: "r", erro: "y" };
    const html = r.itens.map((a) => `<tr class="ti-click" data-seq="${a.seq}">${td("Data/hora", esc(dt(a.em)))}${td("Operador", esc(a.operadorNome || "—"))}${td("Ação", `<code>${esc(a.acao)}</code>`)}${td("Resumo", esc(a.resumo))}${td("Resultado", badge(a.resultado, cor[a.resultado]))}${td("IP", esc(a.ip))}</tr>
        <tr hidden data-det="${a.seq}"><td colspan="6"><div class="ti-split"><div><b class="ax-xs ax-mut">ANTES</b><div class="ti-pre">${esc(JSON.stringify(a.antes, null, 1) ?? "—")}</div></div><div><b class="ax-xs ax-mut">DEPOIS</b><div class="ti-pre">${esc(JSON.stringify(a.depois, null, 1) ?? "—")}</div></div><div><b class="ax-xs ax-mut">DETALHES</b><div class="ti-pre">${esc(`#${a.seq}  ${a.alvoTipo} ${a.alvoId}\n${a.rota}\nreq ${a.reqId}\n${a.ua}\nhash ${a.hash.slice(0, 16)}…${a.meta ? "\n" + JSON.stringify(a.meta) : ""}`)}</div></div></div></td></tr>`).join("");
    $("a-body").innerHTML = reiniciar ? (html || vazio(6, "Nenhum registro neste filtro.")) : $("a-body").innerHTML + html; $("a-mais").hidden = !r.proximo;
}
$("a-body").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-seq]"); if (tr) { const d = $("a-body").querySelector(`tr[data-det="${tr.dataset.seq}"]`); d.hidden = !d.hidden; } });
$("a-buscar").addEventListener("click", seguro(() => carregarAuditoria(true))); $("a-mais").addEventListener("click", seguro(() => carregarAuditoria(false)));
$("a-csv").addEventListener("click", seguro(() => baixarCSVProtegido(`ti/auditoria/exportar?${filtroAud()}`, "personow-ti-auditoria.csv")));
$("a-verificar").addEventListener("click", seguro(async () => {
    const r = await consultar("ti/auditoria/verificar?limite=1000"), el = $("a-integ"); el.hidden = false; el.className = "ax-banner " + (r.ok ? "" : "err");
    el.textContent = r.ok ? `✔ Cadeia íntegra: ${r.verificados} registros verificados (#${r.primeiroSeq} a #${r.ultimoSeq}). Nenhuma alteração ou remoção detectada.` : `✖ INCONSISTÊNCIAS: ${r.problemas.map((p) => `#${p.seq} ${p.problema}`).join(", ")}. Acione a segurança.`;
}));
