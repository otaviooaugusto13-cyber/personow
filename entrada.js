// ============================================================
// PERSONOW — tela inicial: "Entrar na minha conta" × "Criar nova conta" (aluno e personal usam o mesmo módulo)
//
// Antes havia um único botão "Continuar com Google" que servia para as duas coisas e deixava a pessoa sem saber o que ia acontecer
// (entrar? cadastrar? e com qual conta?). Agora são duas opções separadas, com texto, botão e exigências próprios:
//   entrar → só escolhe a conta Google; se não houver cadastro, pergunta se quer criar (nunca cria sozinho)
//   criar  → exige o aceite dos Termos ANTES de abrir o Google
// ============================================================
import { $ } from "./ui.js";
import { chave } from "./portal.js";

export const MODOS = ["entrar", "criar"];
const CHAVE_MODO = chave("modo"), CHAVE_TERMOS = chave("termos");
const ler = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const gravar = (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} };

export const modoSalvo = () => (MODOS.includes(ler(CHAVE_MODO)) ? ler(CHAVE_MODO) : null);
export const gravarModo = (m) => gravar(CHAVE_MODO, MODOS.includes(m) ? m : null);
/** O aceite dos Termos só vale para a tentativa de cadastro em curso (some ao sair da conta). */
export const termosAceitos = () => ler(CHAVE_TERMOS) === "1";
export const gravarTermos = (v) => gravar(CHAVE_TERMOS, v ? "1" : null);

/** Modo inicial: ?modo=criar|entrar na URL > link de indicação (?ref=) abre "criar" > o último usado na sessão > "entrar". */
export function modoInicial() {
    const q = new URLSearchParams(location.search);
    if (MODOS.includes(q.get("modo"))) return q.get("modo");
    if (q.has("ref")) return "criar";
    return modoSalvo() || "entrar";
}

/**
 * Liga os dois botões (#modo-entrar, #modo-criar), troca título/subtítulo/rótulo do botão e mostra os Termos só em "criar".
 * Elementos esperados: #login-titulo, #login-sub, #bloco-criar (benefícios + Termos), #check-termos, #btn-login, #btn-login-txt.
 *   textos: { entrar: { titulo, sub, botao }, criar: { titulo, sub, botao } }
 * Devolve { definir(modo), atual(), atualizarBotao() }.
 */
export function ligarSeletorDeModo({ textos, aoMudar = () => {} }) {
    let modo = modoInicial();
    const botoes = { entrar: $("modo-entrar"), criar: $("modo-criar") };
    // O botão NUNCA fica travado por causa dos Termos (antes ele ficava desabilitado, sem explicar o motivo): sem o aceite, o clique abre os Termos.
    const atualizarBotao = () => { const b = $("btn-login"); if (!b.dataset.ocupado) b.disabled = false; };
    function definir(novo) {
        modo = MODOS.includes(novo) ? novo : "entrar"; gravarModo(modo);
        for (const m of MODOS) { botoes[m].setAttribute("aria-selected", String(m === modo)); botoes[m].tabIndex = m === modo ? 0 : -1; }
        const t = textos[modo];
        $("login-titulo").textContent = t.titulo; $("login-sub").textContent = t.sub; $("btn-login-txt").textContent = t.botao;
        $("bloco-criar").hidden = modo !== "criar";
        const dica = $("dica-modo");
        if (dica) dica.innerHTML = modo === "entrar" ? 'Ainda não tem conta? <button type="button" data-modo="criar">Criar nova conta</button>' : 'Já tem conta? <button type="button" data-modo="entrar">Entrar na minha conta</button>';
        atualizarBotao(); aoMudar(modo);
    }
    for (const m of MODOS) botoes[m].addEventListener("click", () => definir(m));
    $("check-termos").addEventListener("change", atualizarBotao);
    $("dica-modo")?.addEventListener("click", (e) => { const b = e.target.closest("[data-modo]"); if (b) definir(b.dataset.modo); });
    definir(modo);
    return { definir, atual: () => modo, atualizarBotao };
}
