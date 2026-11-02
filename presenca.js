// Batimento de presença: alimenta o contador "usuários online" do painel de TI.
// Pinga a cada 30 s enquanto há sessão E a aba está visível (aba escondida = não está "online" de verdade; economiza bateria e rede).
// O servidor considera online quem pingou nos últimos 75 s. Erros são ignorados: presença nunca atrapalha o app.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, chamarFuncao } from "./firebase.js";

const INTERVALO_MS = 30_000;
let timer = null;
async function ping() { if (document.hidden || !auth.currentUser) return; try { await chamarFuncao("presenca/ping", {}); } catch (e) { /* sem rede / sessão expirada: tenta no próximo ciclo */ } }
function ligar() { if (timer) return; ping(); timer = setInterval(ping, INTERVALO_MS); }
function desligar() { clearInterval(timer); timer = null; }
onAuthStateChanged(auth, (u) => (u ? ligar() : desligar()));
document.addEventListener("visibilitychange", () => { if (!document.hidden && timer) ping(); });
