// ============================================================
// PERSONOW — namespace de sessão por portal
//
// Cada página declara o seu portal em <html data-portal="aluno|personal|parceiro|admin|ti">. Daí saem:
//   • o NOME do app Firebase (`personow-<portal>`): o Firebase guarda a sessão em chave própria por app
//     (firebase:authUser:<apiKey>:<nome>), então entrar como aluno numa aba e como personal em outra NÃO sobrescreve nem derruba a sessão da outra;
//   • o prefixo de TODA chave de armazenamento do portal (`personow:<portal>:<chave>`): modo de entrada, aceite de termos, trava anti-loop, alertas, etc.
// Só tema (claro/escuro) e cache de taxas são compartilhados, porque não são dados de sessão.
// ============================================================
export const PORTAIS = ["aluno", "personal", "parceiro", "admin", "ti"];
const declarado = typeof document !== "undefined" ? document.documentElement.dataset.portal : "";
export const PORTAL = PORTAIS.includes(declarado) ? declarado : "publico";
export const NOME_APP = `personow-${PORTAL}`;
/** Chave de armazenamento isolada deste portal. */
export const chave = (nome) => `personow:${PORTAL}:${nome}`;
