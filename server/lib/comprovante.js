// Comprovante de aula (SEM valor fiscal): código de verificação HMAC de 24 dígitos + PDF simples gerado sem dependências.
const crypto = require("crypto");
const chave = () => process.env.NOTA_HMAC_KEY || process.env.BLIND_INDEX_KEY || (process.env.AMBIENTE === "producao" ? "" : "chave-de-desenvolvimento");
/** 24 dígitos derivados de HMAC-SHA256(aulaId|numero|total). Sem a chave do servidor não dá para fabricar um código válido. */
function codigoDe(aulaId, numero, totalCentavos) {
  const k = chave(); if (!k) throw new Error("NOTA_HMAC_KEY ausente");
  const h = crypto.createHmac("sha256", k).update(`${aulaId}|${numero}|${totalCentavos}`).digest();
  return BigInt("0x" + h.subarray(0, 12).toString("hex")).toString().padStart(29, "0").slice(-24);
}
const fmtCodigo = (c) => c.replace(/(\d{4})(?=\d)/g, "$1 ").trim();

const latin = (s) => Buffer.from(String(s).normalize("NFC"), "latin1");
const esc = (s) => latin(s).toString("latin1").replace(/[\\()]/g, "\\$&").replace(/[\r\n]+/g, " ");
/** PDF de 1 página (A4, Helvetica). `linhas`: [{ t, tam, neg }] de cima para baixo. */
function gerarPDF(linhas) {
  let y = 800, cont = "BT\n";
  for (const l of linhas) { if (l.esp) { y -= l.esp; continue; } cont += `/${l.neg ? "F2" : "F1"} ${l.tam || 11} Tf 1 0 0 1 56 ${y} Tm (${esc(l.t)}) Tj\n`; y -= (l.tam || 11) + 8; }
  cont += "ET\n";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${latin(cont).length} >>\nstream\n${latin(cont).toString("latin1")}endstream`
  ];
  let out = "%PDF-1.4\n"; const off = [];
  objs.forEach((o, i) => { off.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
module.exports = { codigoDe, fmtCodigo, gerarPDF };
