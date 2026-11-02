// Validação da foto do local da aula (JPEG em data URL). Confere formato REAL (assinatura JPEG), tamanho e dimensões:
// não confiamos no Content-Type nem na extensão que o navegador diz ter.
const crypto = require("crypto");
const { Falha } = require("./erros");

const PREFIXO = "data:image/jpeg;base64,";
/** data URL JPEG → Buffer validado. Lança Falha se não for um JPEG íntegro dentro dos limites. */
function jpegDeDataUrl(dataUrl, campo, { min = 0, max }) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PREFIXO)) throw new Falha(400, `${campo}: envie uma imagem JPEG.`, "foto-invalida");
  const b64 = dataUrl.slice(PREFIXO.length);
  if (b64.length > Math.ceil((max * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Falha(400, `${campo}: imagem inválida ou grande demais.`, "foto-invalida");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > max) throw new Falha(400, `${campo}: imagem grande demais (máx. ${Math.round(max / 1000)} KB).`, "foto-grande");
  if (buf.length < min) throw new Falha(400, `${campo}: imagem pequena demais para auditoria.`, "foto-invalida");
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff || buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) throw new Falha(400, `${campo}: o arquivo não é um JPEG íntegro.`, "foto-invalida");
  return buf;
}
/** Largura e altura lidas do cabeçalho SOF do JPEG (sem decodificar a imagem). */
function dimensoesJpeg(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Falha(400, "Não foi possível ler as dimensões da foto.", "foto-invalida");
}
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
module.exports = { jpegDeDataUrl, dimensoesJpeg, sha256 };
