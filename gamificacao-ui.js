// Componentes visuais da camada de jogo: vidas (corações), medalhas de nível, tela de banimento, perda de vida e lightbox de foto.
import { esc, brl, fmtDataHora } from "./core.js";
import { NIVEIS, VIDAS_MAX } from "./config.js";
import { baixarBlobProtegido } from "./firebase.js";

const ICO = { bronze: "🥉", prata: "🥈", ouro: "🥇", platina: "💎" };
const COR = { bronze: "var(--bronze)", prata: "var(--prata)", ouro: "var(--ouro)", platina: "var(--platina)" };
export const corNivel = (id) => COR[id] || COR.bronze;
export const medalha = (id, { sm = false, nova = false } = {}) => `<span class="medalha ${esc(id)}${sm ? " sm" : ""}${nova ? " nova" : ""}" aria-hidden="true">${ICO[id] || "🥉"}</span>`;
export const chipNivel = (id, nome) => `<span class="chip-nivel">${medalha(id, { sm: true })}${esc(nome || id)}</span>`;

const PATH = "M12 21s-7.5-4.6-9.6-9.2C.9 8.5 2.7 4.5 6.4 4.5c2 0 3.5 1.1 5.6 3.2 2.1-2.1 3.6-3.2 5.6-3.2 3.7 0 5.5 4 4 7.3C19.5 16.4 12 21 12 21z";
const coracao = (cheio, extra = "") => `<svg class="coracao ${cheio ? "cheio" : "vazio"} ${extra}" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATH}" stroke-width="1.6"/></svg>`;
/** Corações: `vidas` coloridos, o resto silhueta cinza. `quebrando` = índice do coração que acabou de se perder. */
export function coracoes(vidas, max = VIDAS_MAX, { sm = false, quebrando = -1 } = {}) {
    let h = ""; for (let i = 0; i < max; i++) h += i === quebrando ? coracao(true, "quebrando") : coracao(i < vidas);
    return `<span class="vidas${sm ? " sm" : ""}" role="img" aria-label="${vidas} de ${max} vidas">${h}</span>`;
}

/** Cartão de nível do personal (comissão, progresso, trilha, aviso de inatividade). */
export function cartaoNivel(r) {
    if (!r?.nivel) return "";
    const n = r.nivel, prox = r.proximo, cor = corNivel(n.id), ex = r.inatividade?.expiraEm ? new Date(r.inatividade.expiraEm) : null;
    const dias = ex ? Math.ceil((ex - Date.now()) / 86_400_000) : null;
    return `<div class="glass-card raio" style="--nivel-cor:${cor}">
      <div class="nivel-topo">${medalha(n.id)}<div class="grow"><div class="nivel-nome">${esc(n.nome)}</div><div class="nivel-sub">Taxa da plataforma ${n.comissaoPct}% · você recebe ${brl(r.repasseCentavos)} por aula</div></div></div>
      <div class="barra-nivel" role="progressbar" aria-valuenow="${r.progressoPct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${r.progressoPct}%"></i></div>
      <div class="nivel-sub">${prox ? `Faltam <b>${prox.faltam}</b> chamados concluídos para <b>${esc(prox.nome)}</b> (taxa de ${prox.comissaoPct}%).` : "Nível máximo atingido 🎉"} · ${r.concluidos} concluídos</div>
      ${dias !== null && dias <= 21 ? `<div class="banner red mt"><span class="ico">⏳</span><div class="small">Sem concluir chamados, seu nível cai em <b>${Math.max(0, dias)} dia(s)</b>. Faça uma aula para manter ${esc(n.nome)}.</div></div>` : ""}
      <div class="trilha">${NIVEIS.map((x) => `<div class="etapa ${x.id === n.id ? "atual" : NIVEIS.findIndex((y) => y.id === x.id) < NIVEIS.findIndex((y) => y.id === n.id) ? "ok" : ""}" style="--nivel-cor:${corNivel(x.id)}">${medalha(x.id, { sm: true })}<b>${esc(x.nome)}</b><br>${x.comissaoPct}%<br>${x.minConcluidos}+</div>`).join("")}</div></div>`;
}

export function listaInfracoes(inf = []) {
    return inf.length ? inf.map((i) => `<div class="infracao ${i.status === "revogada" ? "revogada" : ""}"><span class="n">${i.advertenciaNum || "!"}</span><div class="grow"><b>${esc(i.rotulo)}</b>${i.multaCentavos ? ` · multa ${brl(i.multaCentavos)}` : ""}<div class="muted small">${esc(i.detalhe)} · ${fmtDataHora(i.em)}</div></div></div>`).join("") : '<p class="muted small center">Nenhuma advertência. Continue assim! 💚</p>';
}

// ---------- Perda de vida (modal animado) ----------
export function animarPerdaVida(infracao) {
    let el = document.getElementById("perda-vida");
    if (!el) { el = document.createElement("div"); el.id = "perda-vida"; el.className = "perda-vida"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
    const vidas = infracao.vidas ?? 0, perdido = Math.min(VIDAS_MAX - 1, vidas);
    el.innerHTML = `<div class="caixa"><div class="sirene" aria-hidden="true">⚠️</div><h3>Você perdeu uma vida</h3>${coracoes(vidas + 1, VIDAS_MAX)}<p class="muted small" style="margin:10px 0">${esc(infracao.rotulo || "Advertência registrada")}${infracao.multaCentavos ? ` · multa de ${brl(infracao.multaCentavos)}` : ""}</p><p class="small">Restam <b>${vidas}</b> de ${VIDAS_MAX} vidas. Ao chegar a zero, a conta é bloqueada.</p><button class="btn btn-primary mt" id="perda-ok">Entendi</button></div>`;
    el.classList.add("ativa");
    setTimeout(() => { el.querySelector(".vidas")?.replaceWith(Object.assign(document.createElement("span"), { innerHTML: coracoes(vidas, VIDAS_MAX, { quebrando: perdido }) }).firstChild); }, 350);
    el.querySelector("#perda-ok").onclick = () => el.classList.remove("ativa"); el.querySelector("#perda-ok").focus();
}

// ---------- Tela de banimento (crítica, vermelha) ----------
export function telaBanido(r, aoSair) {
    let el = document.getElementById("tela-banido");
    if (!el) { el = document.createElement("div"); el.id = "tela-banido"; el.className = "banido-tela"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
    el.innerHTML = `<div class="banido-caixa"><div class="sirene" aria-hidden="true">🚨</div><h2>Conta bloqueada permanentemente</h2>${coracoes(0, VIDAS_MAX)}
      <div class="banido-motivo"><small>Motivo do bloqueio</small>${esc(r.banidoMotivo || "Acúmulo de 3 advertências.")}${r.banidoEm ? `<div class="small" style="opacity:.7;margin-top:6px">${fmtDataHora(r.banidoEm)}</div>` : ""}</div>
      <div class="banido-lista">${(r.infracoes || []).filter((i) => i.status !== "revogada").map((i) => `<div><b>${i.advertenciaNum || ""}ª</b> ${esc(i.rotulo)} — ${esc(i.detalhe)}</div>`).join("")}</div>
      <p class="small" style="opacity:.8">Se acredita que houve um engano, fale com o suporte pelo chat do app informando seu e-mail de cadastro.</p>
      <button class="btn btn-danger mt" id="banido-sair" style="width:100%">Sair da conta</button></div>`;
    el.classList.add("ativa"); document.body.classList.add("no-scroll"); el.querySelector("#banido-sair").onclick = aoSair; el.querySelector("#banido-sair").focus();
}
export const esconderBanido = () => { document.getElementById("tela-banido")?.classList.remove("ativa"); };

// ---------- Lightbox (foto protegida, sem nova aba) ----------
export async function abrirFoto(caminho, legenda = "") {
    let el = document.getElementById("lightbox");
    if (!el) { el = document.createElement("div"); el.id = "lightbox"; el.className = "lightbox"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
    el.innerHTML = `<div class="barra"><span>${esc(legenda)}</span><button type="button" id="lb-x">Fechar ✕</button></div><img alt="Foto do local da aula" hidden><p class="center muted" style="padding:30px">Carregando…</p>`;
    el.classList.add("ativa"); let url = null; const fechar = () => { el.classList.remove("ativa"); if (url) URL.revokeObjectURL(url); }; el.querySelector("#lb-x").onclick = fechar; el.onclick = (e) => { if (e.target === el) fechar(); };
    try { url = await baixarBlobProtegido(caminho); const im = el.querySelector("img"); im.src = url; im.hidden = false; el.querySelector("p").remove(); }
    catch (e) { el.querySelector("p").textContent = "Não foi possível carregar a foto."; }
}
