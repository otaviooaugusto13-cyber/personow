// Fluxos do personal ligados à camada de jogo: check-in (geofence), check-out (foto), aluno ausente, chamados relâmpago e alertas.
import { chave } from "./portal.js";
import { chamarFuncao } from "./firebase.js";
import { esc, brl } from "./core.js";
import { NIVEIS, GEO_RAIO_METROS } from "./config.js";
import { $, toast, ok, erro, abrir, fechar } from "./ui.js";
import { lerGPS, vigiarGPS, distanciaM } from "./geo.js";
import { abrirCamera, deArquivo } from "./camera.js";
import { medalha } from "./gamificacao-ui.js";
import { obterTokenPush } from "./push.js";

const SHEETS = `
<div id="sheet-checkin" class="app-overlay" aria-hidden="true"><div class="sheet"><div class="grab"></div>
  <div class="sub-head"><h2>Check-in</h2><button class="icon-btn" data-fechar="sheet-checkin" aria-label="Fechar">✕</button></div>
  <p class="muted small center" id="ci-aluno"></p>
  <div class="radar busca" id="ci-radar" aria-live="polite"><span class="alvo">📍</span><span class="dist" id="ci-dist">Buscando GPS…</span></div>
  <div class="gps-linha"><span>Distância do aluno</span><b id="ci-d">—</b></div>
  <div class="gps-linha"><span>Precisão do GPS</span><b id="ci-p">—</b></div>
  <div class="gps-linha"><span>Raio permitido</span><b>${GEO_RAIO_METROS} m</b></div>
  <p class="msg-erro" id="ci-erro" role="alert"></p>
  <button class="btn btn-primary mt" id="ci-ir" disabled>Confirmar presença</button>
</div></div>
<div id="sheet-checkout" class="app-overlay" aria-hidden="true"><div class="sheet"><div class="grab"></div>
  <div class="sub-head"><h2>Finalizar serviço</h2><button class="icon-btn" data-fechar="sheet-checkout" aria-label="Fechar">✕</button></div>
  <p class="muted small mb">Tire uma foto do <b>local da aula</b>. Ela fica guardada para auditoria do aluno e do parceiro vinculado.</p>
  <div class="camera-box"><video id="co-video" playsinline muted></video><img id="co-prev" alt="Pré-visualização da foto" hidden><div class="mira" id="co-mira"></div><div class="dica" id="co-dica">Enquadre o local da aula</div></div>
  <div class="camera-acoes" id="co-acoes"><button class="btn-disparo" id="co-disparo" aria-label="Tirar foto"></button></div>
  <div class="camera-acoes" id="co-acoes2" hidden><button class="btn btn-ghost btn-sm" id="co-refazer">↺ Refazer</button></div>
  <label class="btn btn-ghost btn-sm" id="co-arq-l" style="display:none;text-align:center">📁 Escolher da câmera do aparelho<input id="co-arq" type="file" accept="image/*" capture="environment" hidden></label>
  <div class="conclusao-opcoes" role="radiogroup" aria-label="Como foi a aula"><label><input type="radio" name="co-g" value="completa" checked>✅ Aula completa</label><label><input type="radio" name="co-g" value="parcial">🟡 Parcial (faltou produto)</label></div>
  <div class="field"><label for="co-obs">Observação (opcional)</label><input id="co-obs" type="text" maxlength="300" placeholder="Ex: faltou equipamento"></div>
  <p class="msg-erro" id="co-erro" role="alert"></p>
  <button class="btn btn-primary" id="co-enviar" disabled>Enviar e finalizar</button>
</div></div>
<div id="sheet-falta" class="app-overlay" aria-hidden="true"><div class="sheet"><div class="grab"></div>
  <div class="sub-head"><h2>Aluno ausente</h2><button class="icon-btn" data-fechar="sheet-falta" aria-label="Fechar">✕</button></div>
  <p class="muted small mb">Use somente se você está no local e o serviço não pôde ser feito (aluno fechada, ninguém para receber). O aluno recebe uma advertência.</p>
  <div class="field"><label for="fl-motivo">O que aconteceu?</label><input id="fl-motivo" type="text" maxlength="200" placeholder="Ex: aluno fechada, ninguém atendeu"></div>
  <p class="msg-erro" id="fl-erro" role="alert"></p>
  <button class="btn btn-danger" id="fl-enviar">Reportar aluno ausente</button>
</div></div>
<div id="sheet-rep" class="app-overlay" aria-hidden="true"><div class="sheet"><div class="grab"></div>
  <div class="sub-head"><h2>Nível e vidas</h2><button class="icon-btn" data-fechar="sheet-rep" aria-label="Fechar">✕</button></div>
  <div id="rep-corpo"></div></div></div>
<div id="sheet-alertas" class="app-overlay" aria-hidden="true"><div class="sheet"><div class="grab"></div>
  <div class="sub-head"><h2>Chamados relâmpago ⚡</h2><button class="icon-btn" data-fechar="sheet-alertas" aria-label="Fechar">✕</button></div>
  <p class="muted small mb">Quando um aluno perto de você chamar uma aula relâmpago, avisamos na hora e você ganha um <b>bônus de velocidade</b> (100% seu). Usamos sua posição só para escolher quem está perto.</p>
  <div class="sw-row"><span>Receber chamados urgentes</span><label class="theme-switch"><input type="checkbox" id="al-chave" aria-label="Receber chamados urgentes"><span class="slider"></span></label></div>
  <p class="muted small mt" id="al-status"></p>
</div></div>`;

let T = null;                     // contexto vindo do script principal: { aulas(), recarregar(), eu() }
export function iniciar(ctx) { T = ctx; if (!$("sheet-checkin")) document.body.insertAdjacentHTML("beforeend", SHEETS); ligar(); }

// ---------------- CHECK-IN ----------------
let pare = null, fixAtual = null, aulaCI = null;
function pintarRadar() {
    const t = aulaCI, r = $("ci-radar"), d = $("ci-dist"); if (!t) return;
    if (!fixAtual) { r.className = "radar busca"; d.textContent = "Buscando GPS…"; $("ci-d").textContent = "—"; $("ci-p").textContent = "—"; $("ci-ir").disabled = true; return; }
    const dist = Math.ceil(distanciaM(fixAtual, t.local)), raio = t.raioM || GEO_RAIO_METROS, impreciso = fixAtual.precisao > 100, dentro = dist <= raio && !impreciso;
    r.className = "radar " + (dentro ? "ok" : "longe"); d.textContent = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`;
    $("ci-d").textContent = d.textContent; $("ci-p").textContent = `±${fixAtual.precisao} m${impreciso ? " (fraca)" : ""}`;
    $("ci-erro").textContent = dentro ? "" : impreciso ? "Sinal de GPS fraco: vá para um local aberto." : `Você está a ${dist} m. Chegue a até ${raio} m do aluno para fazer o check-in.`;
    $("ci-ir").disabled = !dentro;
}
export function abrirCheckin(t) {
    if (!t.local) return erro("O aluno ainda não tem localização cadastrada. Fale com o suporte.");
    aulaCI = t; fixAtual = null; $("ci-aluno").textContent = `${t.aluno} · ${t.entrada}–${t.saida}`; $("ci-erro").textContent = ""; pintarRadar(); abrir("sheet-checkin");
    pare?.(); pare = vigiarGPS((f) => { fixAtual = { ...f, lidoEm: Date.now() }; pintarRadar(); }, (e) => { $("ci-erro").textContent = e.message; $("ci-dist").textContent = "Sem GPS"; });
}
async function confirmarCheckin() {
    const b = $("ci-ir"), t = aulaCI; if (!t) return; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Verificando…'; $("ci-erro").textContent = "";
    try {
        // usa a leitura do radar se for recente (idade real somada); senão pede uma nova. O servidor exige GPS com menos de 2 min.
        const f = fixAtual && Date.now() - fixAtual.lidoEm < 20_000 ? { ...fixAtual, idadeFixMs: fixAtual.idadeFixMs + (Date.now() - fixAtual.lidoEm) } : await lerGPS();
        const r = await chamarFuncao("checkin", { aulaId: t.id, lat: f.lat, lng: f.lng, precisao: f.precisao, idadeFixMs: f.idadeFixMs });
        ok(`Check-in confirmado a ${r.distanciaM} m do aluno ✓`); fechar("sheet-checkin"); pare?.(); pare = null; T.recarregar?.();
    } catch (e) {
        $("ci-erro").textContent = e.message || "Não foi possível fazer o check-in.";
        if (e.code === "checkin-ja-feito") { fechar("sheet-checkin"); T.recarregar?.(); }
    } finally { b.textContent = "Confirmar presença"; pintarRadar(); }
}

// ---------------- CHECK-OUT ----------------
let cam = null, captura = null, aulaCO = null;
async function iniciarCamera() {
    const v = $("co-video"); $("co-erro").textContent = "";
    try { cam = await abrirCamera(v); $("co-arq-l").style.display = "none"; }
    catch (e) { cam = null; $("co-erro").textContent = e.message; $("co-arq-l").style.display = "block"; }
}
function pararCamera() { cam?.parar(); cam = null; }
export async function abrirCheckout(t) {
    aulaCO = t; captura = null; $("co-prev").hidden = true; $("co-video").hidden = false; $("co-mira").hidden = false; $("co-acoes").hidden = false; $("co-acoes2").hidden = true; $("co-enviar").disabled = true; $("co-obs").value = ""; $("co-dica").textContent = `Enquadre o local da aula de ${t.foco || "reposição"}`;
    abrir("sheet-checkout"); await iniciarCamera();
}
function mostrarCaptura(c) { captura = c; $("co-prev").src = c.foto; $("co-prev").hidden = false; $("co-video").hidden = true; $("co-mira").hidden = true; $("co-acoes").hidden = true; $("co-acoes2").hidden = false; $("co-enviar").disabled = false; pararCamera(); }
async function enviarCheckout() {
    const t = aulaCO; if (!t || !captura) return; const b = $("co-enviar"); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Enviando foto…'; $("co-erro").textContent = "";
    try {
        let gps = {}; try { const f = await lerGPS({ timeout: 6000 }); gps = { lat: f.lat, lng: f.lng, precisao: f.precisao, idadeFixMs: f.idadeFixMs }; } catch (e) { /* GPS do check-out é só auditoria */ }
        const g = document.querySelector('input[name="co-g"]:checked')?.value || "completa";
        const r = await chamarFuncao("checkout", { aulaId: t.id, foto: captura.foto, miniatura: captura.miniatura, conclusao: g, observacao: $("co-obs").value.trim(), ...gps });
        fechar("sheet-checkout"); captura = null; ok("Serviço finalizado! O aluno já pode efetuar o pagamento.");
        T.recarregar?.(); if (r.nivel?.subiu) T.subiuNivel?.(r.nivel);
    } catch (e) {
        $("co-erro").textContent = e.message || "Não foi possível enviar.";
        if (e.code === "checkout-ja-feito") { fechar("sheet-checkout"); T.recarregar?.(); }
    } finally { b.textContent = "Enviar e finalizar"; b.disabled = !captura; }
}

// ---------------- ALUNO AUSENTE ----------------
let aulaFL = null;
export function abrirFaltaAluno(t) { aulaFL = t; $("fl-motivo").value = ""; $("fl-erro").textContent = ""; abrir("sheet-falta"); }
async function enviarFalta() {
    const m = $("fl-motivo").value.trim(); if (m.length < 5) return ($("fl-erro").textContent = "Descreva o que aconteceu (mín. 5 letras).");
    const b = $("fl-enviar"); b.disabled = true;
    try { await chamarFuncao("reportarFaltaAluno", { aulaId: aulaFL.id, motivo: m }); ok("Registrado. A aula foi encerrado e o aluno recebeu uma advertência."); fechar("sheet-falta"); T.recarregar?.(); }
    catch (e) { $("fl-erro").textContent = e.message || "Não foi possível reportar."; } finally { b.disabled = false; }
}

// ---------------- ALERTAS (chamado relâmpago) ----------------
let vigia = null;
export async function salvarAlertas(ativo) {
    const corpo = { ativo };
    if (ativo) {
        const f = await lerGPS({ timeout: 12000 }); corpo.lat = f.lat; corpo.lng = f.lng;
        const tk = await obterTokenPush(); if (tk) corpo.fcmToken = tk;
    }
    await chamarFuncao("personal/alertas", corpo);
    try { localStorage.setItem(chave("alertas"), ativo ? "1" : "0"); } catch (e) {}
    return corpo;
}
export const alertasLigados = () => { try { return localStorage.getItem(chave("alertas")) === "1"; } catch (e) { return false; } };
/** Reenvia a posição periodicamente (a cada 10 min com o app aberto) para o aluno alcançar quem está perto. */
export function manterPosicao() { clearInterval(vigia); if (!alertasLigados()) return; const f = () => salvarAlertas(true).catch(() => {}); f(); vigia = setInterval(f, 600_000); }
export const pararPosicao = () => clearInterval(vigia);

/** Faixa de alerta animada (chamado urgente novo). `aoAbrir` leva o personal às ofertas. */
export function alertaRelampago(o, aoAbrir) {
    document.getElementById("alerta-rel")?.remove();
    const el = document.createElement("div"); el.id = "alerta-rel"; el.className = "alerta-relampago"; el.setAttribute("role", "alert");
    el.innerHTML = `<span class="zap">⚡</span><div class="grow"><b>Chamado relâmpago</b><div class="small">${esc(o.aluno)} · bônus ${brl(o.bonusCentavos || 0)}</div></div><button type="button" id="ar-ver">Ver</button><button type="button" class="x" id="ar-x" aria-label="Dispensar">✕</button>`;
    document.body.appendChild(el); try { navigator.vibrate?.([200, 100, 200]); } catch (e) {}
    el.querySelector("#ar-ver").onclick = () => { el.remove(); aoAbrir?.(); }; el.querySelector("#ar-x").onclick = () => el.remove(); setTimeout(() => el.remove(), 25_000);
}

function ligar() {
    $("ci-ir").addEventListener("click", confirmarCheckin);
    for (const id of ["sheet-checkin"]) $(id).addEventListener("click", (e) => { if (e.target.closest("[data-fechar]") || e.target.id === id) { pare?.(); pare = null; } });
    $("co-disparo").addEventListener("click", () => { try { mostrarCaptura(cam.capturar()); } catch (e) { $("co-erro").textContent = e.message; } });
    $("co-refazer").addEventListener("click", async () => { captura = null; $("co-prev").hidden = true; $("co-video").hidden = false; $("co-mira").hidden = false; $("co-acoes").hidden = false; $("co-acoes2").hidden = true; $("co-enviar").disabled = true; await iniciarCamera(); });
    $("co-arq").addEventListener("change", async (e) => { try { mostrarCaptura(await deArquivo(e.target.files[0])); } catch (er) { $("co-erro").textContent = er.message; } e.target.value = ""; });
    $("co-enviar").addEventListener("click", enviarCheckout);
    $("sheet-checkout").addEventListener("click", (e) => { if (e.target.closest("[data-fechar]") || e.target.id === "sheet-checkout") pararCamera(); });
    $("fl-enviar").addEventListener("click", enviarFalta);
    $("al-chave").addEventListener("change", async (e) => {
        const on = e.target.checked; $("al-status").textContent = on ? "Pegando sua posição…" : "";
        try { const c = await salvarAlertas(on); $("al-status").textContent = on ? `Alertas ativos${c.fcmToken ? " (com aviso no aparelho)" : " (aviso enquanto o app estiver aberto)"} ✓` : "Alertas desligados."; if (on) manterPosicao(); else pararPosicao(); }
        catch (er) { e.target.checked = !on; $("al-status").textContent = er.message || "Não foi possível alterar."; }
    });
    $("al-chave").checked = alertasLigados();
}
export { medalha, NIVEIS, toast };
