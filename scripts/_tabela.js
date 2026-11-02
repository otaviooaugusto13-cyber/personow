// Leitura de planilhas exportadas como CSV (vírgula, ponto e vírgula ou tab; aspas; BOM) e de JSON.
// Excel/Google Planilhas: "Salvar como CSV UTF-8". (Evitamos ler .xlsx direto: as bibliotecas disponíveis no npm têm falhas conhecidas.)

export function parseCsv(texto) {
  const t = String(texto).replace(/^\uFEFF/, "");
  const primeira = t.split(/\r?\n/, 1)[0] || "";
  const delim = [";", "\t", ","].map((d) => [d, primeira.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const linhas = []; let campo = "", linha = [], aspas = false;
  const fecharLinha = () => { linha.push(campo); campo = ""; if (linha.some((x) => x.trim() !== "")) linhas.push(linha); linha = []; };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c; }
    else if (c === '"') aspas = true;
    else if (c === delim) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; fecharLinha(); }
    else campo += c;
  }
  if (campo !== "" || linha.length) fecharLinha();
  const [cab, ...resto] = linhas;
  if (!cab) return [];
  return resto.map((l, i) => Object.assign({ __linha: i + 2 }, Object.fromEntries(cab.map((h, j) => [h.trim(), (l[j] ?? "").trim()]))));
}

export function parseJson(texto) {
  const d = JSON.parse(String(texto).replace(/^\uFEFF/, ""));
  const lista = Array.isArray(d) ? d : Object.values(d || {}).find(Array.isArray);
  if (!lista) throw new Error("O JSON precisa ser uma lista de resultados (ou um objeto que contenha essa lista).");
  return lista.map((o, i) => Object.assign({ __linha: i + 1 }, o && typeof o === "object" && !Array.isArray(o) ? o : {}));
}

export function lerTabela(texto, nomeArquivo) {
  const ext = String(nomeArquivo).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "json") return parseJson(texto);
  if (["csv", "tsv", "txt"].includes(ext)) return parseCsv(texto);
  throw new Error("Formato não suportado. Use .csv ou .json (no Excel: Salvar como CSV UTF-8).");
}
