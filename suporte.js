// ============================================================
// PERSONOW — chat com o suporte (portais do aluno e do personal)
// Leitura em tempo real (onSnapshot nas coleções suporte_*, protegidas pelas regras); escrita só pela API.
// Notifica dentro do app (toast + selo no botão) e, com push ativo, também com o app fechado.
// ============================================================
import { collection, doc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db, chamarFuncao } from "./firebase.js";
import { NOME_SUPORTE, WHATSAPP_SUPORTE } from "./config.js";
import { esc, fmtDataHora } from "./core.js";
import { $, abrir, fechar, erro, notificar, pedirPermissaoNotificacao } from "./ui.js";
import { ativarPush, pushDisponivel } from "./push.js";

let uid = null, desligar = [], msgs = [], conv = null, anterior = null, aberto = false, enviando = false;

const ICONE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

/**
 * O botão do chat NÃO é mais um elemento fixo no <body> (era isso que o fazia aparecer em todas as telas).
 * Ele vive DENTRO da folha "Ajuda e suporte" (#sheet-ajuda), ancorado no canto dela com position:sticky.
 * Como a folha só existe na tela quando está aberta, o botão some sozinho de todas as outras páginas,
 * sem depender de JS para esconder. Um pontinho no item de menu "Ajuda e suporte" avisa que há resposta nova.
 */
function montarBotao() {
    const folha = document.querySelector("#sheet-ajuda .sheet");
    if (!folha || $("btn-suporte")) return;
    const b = document.createElement("button");
    b.id = "btn-suporte"; b.type = "button"; b.className = "btn-suporte"; b.setAttribute("aria-label", `Falar com o ${NOME_SUPORTE}`); b.title = `Falar com o ${NOME_SUPORTE}`;
    b.innerHTML = `${ICONE}<span class="sup-badge" id="sup-badge" hidden>0</span>`;
    b.addEventListener("click", () => { fechar("sheet-ajuda"); abrirSuporte(); });   // Ajuda → Chat (nunca os dois abertos)
    folha.appendChild(b);
    document.querySelector('.menu-item[data-abrir="sheet-ajuda"]')?.classList.add("tem-selo-sup");
}

function montar() {
    if ($("sheet-suporte")) return;
    montarBotao();
    const s = document.createElement("div");
    s.id = "sheet-suporte"; s.className = "app-overlay"; s.setAttribute("aria-hidden", "true");
    s.innerHTML = `<div class="sheet" role="dialog" aria-labelledby="sup-titulo"><div class="grab"></div>
        <div class="sub-head"><div style="flex:1"><h2 id="sup-titulo">${esc(NOME_SUPORTE)}</h2><p class="muted small" style="margin:2px 0 0">Respondemos por aqui e avisamos você.</p></div><button type="button" class="icon-btn" id="sup-fechar" aria-label="Fechar">✕</button></div>
        <div id="sup-notif" class="banner mb" hidden><span class="ico">🔔</span><div class="grow">Receba um aviso quando o suporte responder.<br><button type="button" class="btn btn-ghost btn-sm mt" id="sup-ativar">Ativar avisos</button></div></div>
        <div class="chat-box" id="sup-box" aria-live="polite"></div>
        <form class="chat-send" id="sup-form"><input id="sup-input" type="text" maxlength="1000" placeholder="Escreva sua mensagem…" autocomplete="off" aria-label="Mensagem"><button class="btn btn-primary" aria-label="Enviar">➤</button></form>
        <p class="muted small center mt"><a id="sup-zap" target="_blank" rel="noopener" href="#">Prefere o WhatsApp?</a></p></div>`;
    document.body.appendChild(s);
    $("sup-zap").href = `https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent("Olá! Preciso de ajuda no Personow.")}`;
    $("sup-fechar").addEventListener("click", fecharSuporte);
    s.addEventListener("click", (e) => { if (e.target === s) fecharSuporte(); });
    $("sup-form").addEventListener("submit", enviar);
    $("sup-ativar").addEventListener("click", async () => { if (await pedirPermissaoNotificacao()) { await ativarPush(); } avisoNotif(); });
}

/** Mostra o convite para ativar avisos só quando faz sentido (ainda não decidiu e o navegador suporta). */
function avisoNotif() { $("sup-notif").hidden = !("Notification" in window && Notification.permission === "default"); }

function pintar() {
    const box = $("sup-box"); if (!box) return;
    box.innerHTML = msgs.length
        ? msgs.map((m) => { const eu = m.de === "usuario"; return `<div class="msg ${eu ? "msg-me" : "msg-other"}">${eu ? "" : `<small style="margin:0 0 3px;font-weight:700">${esc(NOME_SUPORTE)}</small>`}${esc(m.texto).replace(/\n/g, "<br>")}<small>${esc(fmtDataHora(m.criadoEm))}</small></div>`; }).join("")
        : `<p class="muted small center" style="margin:auto">Mande sua dúvida. A equipe responde por aqui.</p>`;
    box.scrollTop = box.scrollHeight;
}

let lendo = false;
async function marcarLido() {
    if (lendo || !(conv?.naoLidasUsuario > 0)) return;
    lendo = true; try { await chamarFuncao("suporte/lido", {}); } catch (e) { console.warn(e); } finally { lendo = false; }
}

async function enviar(e) {
    e.preventDefault();
    const i = $("sup-input"), texto = i.value.trim(); if (!texto || enviando) return;
    enviando = true; i.disabled = true;
    try { await chamarFuncao("suporte/mensagem", { texto }); i.value = ""; }
    catch (err) { erro(err.code === "limite-requisicoes" ? "Muitas mensagens seguidas. Aguarde um instante." : "Mensagem não enviada. Tente de novo."); }
    finally { enviando = false; i.disabled = false; i.focus(); }
}

/** Abre a conversa. Devolve false se o chat ainda não foi iniciado (quem chamou pode cair no WhatsApp). */
export function abrirSuporte() {
    if (!uid) return false;
    aberto = true; pintar(); avisoNotif(); abrir("sheet-suporte"); $("sup-box").scrollTop = $("sup-box").scrollHeight; marcarLido();
    return true;
}
function fecharSuporte() { aberto = false; fechar("sheet-suporte"); }

/** Liga o chat para o usuário logado. Chame uma vez por login (depois que o painel carregou). */
export function iniciarSuporte(u) {
    pararSuporte(); uid = u.uid; msgs = []; conv = null; anterior = null; montar();
    desligar.push(onSnapshot(doc(db, "suporte_conversas", uid), (s) => {
        conv = s.exists() ? s.data() : null;
        const n = conv?.naoLidasUsuario || 0, selo = $("sup-badge");
        selo.hidden = n < 1 || aberto; selo.textContent = n > 9 ? "9+" : String(n);
        document.querySelector(".menu-item.tem-selo-sup")?.classList.toggle("com-novidade", n > 0 && !aberto);   // pontinho no menu
        if (anterior !== null && n > anterior && !(aberto && !document.hidden)) notificar(NOME_SUPORTE, conv.ultimaMsg || "Nova mensagem");   // 1º snapshot só mostra o selo
        anterior = n;
        if (aberto && !document.hidden) marcarLido();
    }, (e) => console.warn("suporte:", e.code || e)));
    desligar.push(onSnapshot(query(collection(db, "suporte_mensagens"), where("uid", "==", uid)), (s) => {
        msgs = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.id > b.id ? 1 : -1));   // o id começa pelo relógio: ordem cronológica
        if (aberto) pintar();
    }, (e) => console.warn("suporte:", e.code || e)));
    ativarPush();                                                       // se já houver permissão, registra o aparelho
    if (new URLSearchParams(location.search).get("suporte") === "1") { abrirSuporte(); history.replaceState(null, "", location.pathname); }   // veio do clique na notificação
}

/** Desliga tudo (logout/troca de conta). */
export function pararSuporte() {
    desligar.forEach((f) => f()); desligar = []; uid = null; aberto = false; msgs = []; conv = null; anterior = null;
    $("btn-suporte")?.remove(); $("sheet-suporte")?.remove();
    document.querySelector(".menu-item.tem-selo-sup")?.classList.remove("tem-selo-sup", "com-novidade");
    document.body.classList.remove("no-scroll");
}
export { pushDisponivel };
