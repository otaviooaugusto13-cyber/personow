// Busca as taxas vigentes no servidor (GET /config/taxas) e as aplica em TAXAS (core.js).
// - Abre com o último valor conhecido (localStorage) ou o padrão de config.js: o app nunca fica "sem preço".
// - Atualiza ao abrir, ao voltar para a aba e a cada 5 min. Se mudou, dispara "taxas:atualizadas" para os textos se redesenharem.
// - É só EXIBIÇÃO: quem cobra, repassa e valida é o servidor (ele lê a mesma configuração no banco).
import { aplicarTaxas, TAXAS } from "./core.js";
import { FUNCTIONS_BASE } from "./config.js";

export const EVENTO_TAXAS = "taxas:atualizadas";
const CHAVE = "personow_taxas_v1", A_CADA_MS = 5 * 60_000;

try { aplicarTaxas(JSON.parse(localStorage.getItem(CHAVE) || "null")); } catch (e) { /* sem cache: segue com o padrão */ }

let emVoo = null;
export function carregarTaxas() {
    emVoo ||= (async () => {
        try {
            const r = await fetch(`${FUNCTIONS_BASE}/config/taxas`, { cache: "no-store" });
            if (!r.ok) return false;
            const antes = JSON.stringify(TAXAS), t = await r.json();
            if (!aplicarTaxas(t)) return false;
            try { localStorage.setItem(CHAVE, JSON.stringify(TAXAS)); } catch (e) { /* modo privado: ignora */ }
            if (JSON.stringify(TAXAS) !== antes) window.dispatchEvent(new CustomEvent(EVENTO_TAXAS, { detail: { ...TAXAS } }));
            return true;
        } catch (e) { return false; }      // offline / servidor acordando: mantém o que já tem
        finally { emVoo = null; }
    })();
    return emVoo;
}

/** `aoMudar` roda uma vez já (com cache/padrão) e de novo sempre que o servidor trouxer valores diferentes. */
export function iniciarTaxas(aoMudar) {
    if (aoMudar) { window.addEventListener(EVENTO_TAXAS, () => aoMudar()); aoMudar(); }
    const primeira = carregarTaxas();
    setInterval(carregarTaxas, A_CADA_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) carregarTaxas(); });
    return primeira;
}
