// Batimento de presença: alimenta o contador "usuários online" do painel de TI.
// Pinga a cada 30 s enquanto há sessão E a aba está visível (aba escondida = não está "online" de verdade; economiza bateria e rede).
// O servidor considera online quem pingou nos últimos 75 s. Erros são ignorados: presença nunca atrapalha o app.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, chamarFuncao } from "./firebase.js";
import { capturarPosicao } from "./geo.js";

const INTERVALO_MS = 30_000;
let timer = null;
// Mapa do aluno: o PAINEL DO PERSONAL pede para compartilhar a posição atual (aproximada) no mesmo ping. Só o personal chama compartilharPosicao();
// nos outros painéis o ping segue sem posição. O servidor arredonda de novo (~300 m) e só publica quem está aprovado e com ping nos últimos 75 s.
let querPosicao = () => false;
export function compartilharPosicao(fn) { querPosicao = typeof fn === "function" ? fn : () => !!fn; }
/** Posição para o ping: arredondada já no aparelho (3 casas ≈ 110 m). Sem permissão/GPS/sinal: o ping segue sem posição (o personal só não aparece no mapa). */
async function posicaoDoPing() {
    if (!querPosicao()) return {};
    try { const p = await capturarPosicao({ timeout: 8000, maxAge: 60_000 }); return { lat: Math.round(p.lat * 1e3) / 1e3, lng: Math.round(p.lng * 1e3) / 1e3, precisao: Math.round(p.precisaoM || 0) }; } catch (e) { return {}; }
}
async function ping() { if (document.hidden || !auth.currentUser) return; try { await chamarFuncao("presenca/ping", await posicaoDoPing()); } catch (e) { /* sem rede / sessão expirada: tenta no próximo ciclo */ } }
function ligar() { if (timer) return; ping(); timer = setInterval(ping, INTERVALO_MS); }
function desligar() { clearInterval(timer); timer = null; }
onAuthStateChanged(auth, (u) => (u ? ligar() : desligar()));
document.addEventListener("visibilitychange", () => { if (!document.hidden && timer) ping(); });
