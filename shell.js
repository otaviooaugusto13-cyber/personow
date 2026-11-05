// ============================================================
// PERSONOW — "casca" de extensão do app (aluno e personal)
//
// Cada módulo novo (níveis, formação, suporte, comprovante, extrato…) vive em UM arquivo `mod-<nome>.js` e se pluga aqui,
// sem mexer em script.js / script-personal.js:
//
//   // mod-exemplo.js
//   export const portais = ["aluno", "personal"];                       // onde o módulo aparece (omitido = ambos)
//   export async function iniciar(ctx) {                                // chamado depois do login e do /sessao
//       ctx.shell.adicionarItemMenu({ id: "exemplo", icone: "🏅", titulo: "Exemplo", abrir: () => {
//           const t = ctx.shell.abrirTela("Exemplo");                   // { corpo, fechar }  → tela cheia, com botão voltar
//           t.corpo.innerHTML = "<div class='card'>Olá</div>";
//       } });
//   }
//
// ctx = { portal, user, perfil, chamarFuncao, consultar, db, auth, config, ui: { $, toast, ok, erro, esc, vazio, skeleton }, shell }
// Falha em um módulo NUNCA derruba o app: o erro vai para o console e o resto segue.
// ============================================================
import { $, toast, ok, erro, vazio, skeleton } from "./ui.js";
import { esc } from "./core.js";
import * as config from "./config.js";
import { auth, db, chamarFuncao, consultar } from "./firebase.js";
import { LISTA_MODULOS } from "./modulos.js";

const CONTAINER_MENU = { aluno: "#tab-perfil .menu-option-item", personal: "#tab-menu .menu-option-item" };

/** Pasta onde os itens do menu do portal ficam (o pai dos `.menu-option-item` existentes). */
function listaDoMenu(portal) {
    const ref = document.querySelector(CONTAINER_MENU[portal] || CONTAINER_MENU.aluno);
    return ref ? ref.parentElement : null;
}

let portalAtual = "aluno";
const itensAdicionados = new Set();

/**
 * Acrescenta um item ao menu de perfil (aluno: aba Perfil · personal: aba Menu), antes do último item (Ajuda/Sair).
 * `id` único: chamadas repetidas (ex.: refazer login) não duplicam. `abrir` roda ao tocar. `selo` (opcional) mostra um texto à direita.
 */
export function adicionarItemMenu({ id, icone = "•", titulo, selo = "", abrir, portal = portalAtual }) {
    const chave = `${portal}:${id}`;
    const pasta = listaDoMenu(portal);
    if (!pasta) return null;
    let el = document.getElementById(`menu-mod-${id}`);
    if (!el) {
        el = document.createElement("div");
        el.id = `menu-mod-${id}`; el.className = "menu-option-item"; el.setAttribute("role", "button"); el.tabIndex = 0;
        el.innerHTML = `<div class="option-left"><span class="ico"></span><span class="tit"></span></div><span class="option-arrow">›</span>`;
        pasta.insertBefore(el, pasta.lastElementChild);
    }
    el.querySelector(".ico").textContent = icone;
    el.querySelector(".tit").textContent = titulo;
    el.querySelector(".option-arrow").textContent = selo ? `${selo} ›` : "›";
    if (!itensAdicionados.has(chave)) {
        itensAdicionados.add(chave);
        const disparar = () => { try { abrir?.(); } catch (e) { console.error(`menu ${id}:`, e); toast("Não foi possível abrir agora.", "erro"); } };
        el.addEventListener("click", disparar);
        el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); disparar(); } });
    }
    return el;
}

/** Atualiza só o selo (contador/nível) de um item já criado. */
export function definirSelo(id, selo) {
    const a = document.querySelector(`#menu-mod-${id} .option-arrow`);
    if (a) a.textContent = selo ? `${selo} ›` : "›";
}

/**
 * Abre uma tela cheia (mesmo visual das subtelas de Perfil) com cabeçalho e botão voltar.
 * Devolve { el, corpo, fechar }. Se já existir uma tela com o mesmo `id`, ela é reaproveitada e o corpo é limpo.
 */
export function abrirTela(titulo, { id = "", aoFechar = null } = {}) {
    const tid = id ? `tela-mod-${id}` : `tela-mod-${Math.random().toString(36).slice(2, 8)}`;
    let el = document.getElementById(tid);
    if (!el) {
        el = document.createElement("div");
        el.id = tid; el.className = "app-overlay sub-overlay tela-modulo";
        el.innerHTML = `<div class="sub-inner"><div class="sub-head"><button type="button" aria-label="Voltar">❮</button><h2></h2></div><div class="tela-corpo"></div></div>`;
        document.body.appendChild(el);
    }
    el.querySelector("h2").textContent = titulo;
    const corpo = el.querySelector(".tela-corpo"); corpo.innerHTML = "";
    const fechar = () => { el.style.display = "none"; el.classList.remove("aberta"); try { aoFechar?.(); } catch (e) {} if (!id) el.remove(); };
    el.querySelector(".sub-head button").onclick = fechar;
    el.style.display = "block"; el.classList.add("aberta");
    el.scrollTop = 0;
    return { el, corpo, fechar, titulo: (t) => { el.querySelector("h2").textContent = t; } };
}

/** Confirmação simples em hoja (sem alert()). Resolve true/false. */
export function confirmar(texto, { sim = "Confirmar", nao = "Cancelar" } = {}) {
    return new Promise((resolver) => {
        const ov = document.createElement("div");
        ov.className = "sheet-overlay"; ov.style.display = "flex"; ov.style.alignItems = "flex-end"; ov.style.zIndex = 9999;
        ov.innerHTML = `<div class="sheet" style="width:100%;max-width:520px;margin:0 auto;padding:20px"><p class="mb" style="line-height:1.5"></p><div class="grid-2"><button class="btn btn-ghost" data-v="0"></button><button class="btn btn-primary" data-v="1"></button></div></div>`;
        ov.querySelector("p").textContent = texto;
        const [b0, b1] = ov.querySelectorAll("button"); b0.textContent = nao; b1.textContent = sim;
        ov.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b || e.target === ov) { ov.remove(); resolver(b?.dataset.v === "1"); } });
        document.body.appendChild(ov);
    });
}

export const shell = { adicionarItemMenu, definirSelo, abrirTela, confirmar };

/**
 * Carrega os módulos de `modulos.js` para o portal. Chamada UMA vez por login, depois de /sessao e do perfil estarem prontos.
 * `perfil` = documento do aluno/personal (já lido pelo app).
 */
export async function carregarModulos(portal, { user, perfil = {} } = {}) {
    portalAtual = portal;
    const ctx = { portal, user, perfil, chamarFuncao, consultar, db, auth, config, ui: { $, toast, ok, erro, esc, vazio, skeleton }, shell };
    const resultados = [];
    for (const nome of LISTA_MODULOS) {
        try {
            const m = await import(`./${nome}.js`);
            if (Array.isArray(m.portais) && !m.portais.includes(portal)) continue;
            await m.iniciar?.(ctx);
            resultados.push(nome);
        } catch (e) {
            if (/Failed to fetch dynamically imported module|Cannot find module|404|error loading dynamically/i.test(String(e?.message))) continue;   // módulo ainda não instalado
            console.error(`módulo ${nome} falhou:`, e);
        }
    }
    return resultados;
}
