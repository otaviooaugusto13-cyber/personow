// Utilitários dos módulos de app (mod-*.js): CSS sob demanda e atalhos de formatação.
import { brl, fmtData, esc } from "./core.js";
export { brl, fmtData, esc };
const carregados = new Set();
export function css(href) {
    if (carregados.has(href)) return;
    carregados.add(href);
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
}
export const mesNome = (aaaamm) => { if (!aaaamm) return "Todos os meses"; const [a, m] = aaaamm.split("-"); return new Date(Number(a), Number(m) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); };
export const erroMsg = (e, padrao = "Não foi possível carregar agora.") => (e?.message && e.code !== "backend-nao-configurado" ? e.message : padrao);
