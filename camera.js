// Câmera do check-out: getUserMedia (câmera traseira) com reserva para <input capture>. Gera JPEG comprimido + miniatura.
// Nada sai do aparelho antes do envio ao servidor; o stream é sempre encerrado ao fechar.
const LADO_MAX = 1280, QUALIDADES = [0.8, 0.7, 0.6, 0.5, 0.42], LIMITE = 520_000, MINI_LADO = 160;

const dataUrlBytes = (u) => Math.floor(((u.length - u.indexOf(",") - 1) * 3) / 4);
function reduzir(fonte, w, h, lado) {
    const k = Math.min(1, lado / Math.max(w, h)), c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext("2d").drawImage(fonte, 0, 0, c.width, c.height); return c;
}
/** Converte uma imagem (video/img/bitmap) em { foto, miniatura, largura, altura } com tamanho dentro do limite do servidor. */
export function comprimir(fonte, w, h) {
    const c = reduzir(fonte, w, h, LADO_MAX); let foto = "";
    for (const q of QUALIDADES) { foto = c.toDataURL("image/jpeg", q); if (dataUrlBytes(foto) <= LIMITE) break; }
    if (dataUrlBytes(foto) > LIMITE) { const c2 = reduzir(fonte, w, h, 960); foto = c2.toDataURL("image/jpeg", 0.5); }
    if (dataUrlBytes(foto) > LIMITE) throw Object.assign(new Error("A foto ficou grande demais. Tente de novo mais perto do local."), { code: "foto-grande" });
    const m = reduzir(fonte, w, h, MINI_LADO), miniatura = m.toDataURL("image/jpeg", 0.6);
    return { foto, miniatura, largura: c.width, altura: c.height };
}

/** Abre a câmera dentro de `video`. Devolve { capturar(), parar() }. Lança erro com `code` se não der. */
export async function abrirCamera(video) {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("Câmera indisponível neste navegador."), { code: "sem-camera" });
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
    catch (e) { throw Object.assign(new Error(e.name === "NotAllowedError" ? "Permissão da câmera negada. Libere a câmera nas configurações do navegador." : "Não foi possível abrir a câmera."), { code: e.name === "NotAllowedError" ? "camera-negada" : "camera-falhou" }); }
    video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play().catch(() => {});
    const parar = () => { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
    return {
        parar,
        capturar() {
            if (!video.videoWidth) throw Object.assign(new Error("A câmera ainda não está pronta."), { code: "camera-falhou" });
            return comprimir(video, video.videoWidth, video.videoHeight);
        }
    };
}

/** Reserva: arquivo vindo de <input type=file accept=image/* capture=environment>. */
export async function deArquivo(arquivo) {
    if (!arquivo || !/^image\//.test(arquivo.type)) throw Object.assign(new Error("Escolha uma imagem."), { code: "foto-invalida" });
    const bmp = await createImageBitmap(arquivo).catch(() => null);
    if (!bmp) throw Object.assign(new Error("Não foi possível ler a imagem."), { code: "foto-invalida" });
    const r = comprimir(bmp, bmp.width, bmp.height); bmp.close?.(); return r;
}
