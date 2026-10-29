// Exportação CSV segura (Excel/LibreOffice pt-BR: separador ";", decimal ",", BOM UTF-8, CRLF).
// Defesa contra CSV/formula injection: texto que começa com = + - @ TAB ou CR recebe um apóstrofo na frente.
const PERIGOSO = /^[=+\-@\t\r]/;
const dinheiro = (centavos) => ({ __num: (Number(centavos) / 100).toFixed(2).replace(".", ",") });

function celula(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v.__num !== undefined) return v.__num;       // número já formatado (pode ser negativo)
  if (typeof v === "number") return String(v).replace(".", ",");
  if (v instanceof Date) return v.toISOString();
  let s = String(v);
  if (PERIGOSO.test(s)) s = "'" + s;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const paraCSV = (cabecalho, linhas) => "\uFEFF" + [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
const dataBR = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : ts ? new Date(ts) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "";
};
module.exports = { paraCSV, celula, dinheiro, dataBR };
