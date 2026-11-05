// Ping de presença anônimo (alimenta "online agora" no painel de TI). Falha em silêncio; pausa com a aba oculta.
export async function iniciar(ctx) {
    const ping = () => { if (!document.hidden) ctx.chamarFuncao("presenca/ping", {}).catch(() => {}); };
    ping(); setInterval(ping, 60_000);
}
