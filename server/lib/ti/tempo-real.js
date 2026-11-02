// Tempo real do painel de TI via Server-Sent Events (SSE). Um único ticker por instância calcula o "retrato" (online + fila)
// UMA vez a cada 5 s e o envia a todos os operadores conectados — custo no banco independe de quantos estão olhando.
// O cliente usa fetch() com Authorization (EventSource não envia cabeçalhos e o projeto proíbe token em URL).
const { Falha } = require("../erros");
const K = require("./constantes");

function criarTempoReal({ presenca, chamados }) {
  const assinantes = new Set();      // { res, uid, fimMs }
  let timer = null;

  async function retrato() { const [online, fila] = await Promise.all([presenca.contar(), chamados.contagens()]); return { online, fila, em: new Date().toISOString() }; }
  const enviar = (a, evento, dados) => { try { a.res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`); return true; } catch { return false; } };
  const fechar = (a) => { assinantes.delete(a); try { a.res.end(); } catch { /* já fechado */ } if (!assinantes.size) { clearInterval(timer); timer = null; } };

  async function tick() {
    if (!assinantes.size) return;
    let r; try { r = await retrato(); } catch (e) { console.warn("stream:", e.message); return; }
    const agora = Date.now();
    for (const a of [...assinantes]) {
      if (agora >= a.fimMs) { enviar(a, "reconectar", {}); fechar(a); continue; }      // vida máxima: o cliente reconecta com token renovado
      if (!enviar(a, "tick", r)) fechar(a);
    }
  }

  /** Abre o stream para o operador. Lança Falha 429 se passou dos limites. */
  async function assinar(req, res) {
    const uid = req.usuario.uid;
    if (assinantes.size >= K.STREAM_MAX_GLOBAL) throw new Falha(503, "Muitos painéis conectados. Tente novamente em instantes.", "stream-lotado");
    if ([...assinantes].filter((a) => a.uid === uid).length >= K.STREAM_MAX_POR_OPERADOR) throw new Falha(429, "Você já tem painéis demais abertos.", "stream-limite");
    res.status(200); res.setHeader("Content-Type", "text/event-stream; charset=utf-8"); res.setHeader("Cache-Control", "no-store, no-transform"); res.setHeader("Connection", "keep-alive"); res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const a = { res, uid, fimMs: Date.now() + K.STREAM_VIDA_MAX_MS }; assinantes.add(a);
    req.on?.("close", () => fechar(a));
    res.write("retry: 5000\n\n");
    try { enviar(a, "tick", await retrato()); } catch (e) { console.warn("stream:", e.message); }
    if (!timer) { timer = setInterval(() => tick(), K.STREAM_INTERVALO_MS); timer.unref?.(); }
    return a;
  }
  /** Derruba os streams de um operador (excluído/rebaixado/senha trocada). */
  const encerrarDe = (uid) => { for (const a of [...assinantes]) if (a.uid === uid) { enviar(a, "encerrado", {}); fechar(a); } };

  return { assinar, encerrarDe, retrato, tick, _assinantes: assinantes };
}
module.exports = { criarTempoReal };
