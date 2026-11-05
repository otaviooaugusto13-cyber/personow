// Lista dos módulos do app (arquivos `mod-*.js`, ver shell.js). Ordem = ordem em que os itens aparecem no menu.
// Um módulo que ainda não existe no servidor de arquivos é ignorado em silêncio.
export const LISTA_MODULOS = [
    "mod-niveis",       // níveis, missões, reputação (Bronze → Platina)
    "mod-formacao",     // formação e cursos do personal
    "mod-extrato",      // extrato de pagamentos e repasses
    "mod-comprovante",  // comprovante de aula com código de verificação
    "mod-suporte",      // chamados e conversa com o suporte
    "mod-presenca"      // ping de presença (usuários online no painel de TI)
];
