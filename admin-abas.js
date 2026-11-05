// Registro de abas do painel admin. Cada módulo entrega `admin-aba-<nome>.js` com:
//   export default { id, titulo, icone, render(container, ctx) }
//   ctx = { chamarFuncao, consultar, esc, toast, baixarCSVProtegido, sensivel, pedir, brl }
// O carregador é TOLERANTE: arquivo ausente (404) ou com erro não derruba o painel; a aba só não aparece.
const NOMES = ["taxas", "niveis", "formacao", "ti", "academias"];
const abas = [];

/** Registra uma aba (ignora definição inválida ou id repetido). Devolve true se entrou. */
export function registrarAba(def) {
    if (!def || typeof def.id !== "string" || !/^[a-z0-9-]{1,30}$/.test(def.id) || typeof def.render !== "function") return false;
    if (abas.some((a) => a.id === def.id)) return false;
    abas.push({ id: def.id, titulo: String(def.titulo || def.id), icone: String(def.icone || "•"), render: def.render });
    return true;
}
export const listarAbas = () => abas.slice();

/** Importa admin-aba-<nome>.js de cada módulo que existir. `importar` é injetável (testes). */
export async function carregarAbas(importar = (n) => import(`./admin-aba-${n}.js`), nomes = NOMES) {
    const res = await Promise.allSettled(nomes.map((n) => importar(n)));
    res.forEach((r, i) => {
        if (r.status === "fulfilled") { if (!registrarAba(r.value?.default)) console.warn(`admin-aba-${nomes[i]}.js: definição de aba inválida`); }
        else console.debug(`admin-aba-${nomes[i]}.js não carregada:`, r.reason?.message || r.reason);
    });
    return listarAbas();
}
