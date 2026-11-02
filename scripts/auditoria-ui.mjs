#!/usr/bin/env node
// ============================================================
// Auditoria estática de UI — Personow (sem dependências; roda em segundos)
//   node scripts/auditoria-ui.mjs [pasta]     imprime o relatório; sai com código 1 se houver achado CRITICO
//   node scripts/auditoria-ui.mjs --json      saída em JSON (para CI)
//
// O que ela faz: acha a classe de bug que o olho não vê (id que não existe, handler que acumula, botão que fica morto,
// campo que dá zoom no iPhone, CSS que estoura no celular). O que ela NÃO faz: julgar aparência. Isso é o roteiro manual.
// Severidade: CRITICO = quebra de verdade · ALTO = bug visível provável · MEDIO = lixo/manutenção · INFO = revisar com calma
// Precisão antes de volume: cada regra foi calibrada para NÃO acusar o que o código faz de propósito (id criado em JS, `?.`, <style> inline...).
// ============================================================
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || ".");
const JSON_OUT = process.argv.includes("--json");
const ler = (f) => fs.readFileSync(path.join(raiz, f), "utf8");
const existe = (f) => fs.existsSync(path.join(raiz, f));
const lista = (re) => fs.readdirSync(raiz).filter((f) => re.test(f)).sort();
const linhaDe = (txt, i) => txt.slice(0, i).split("\n").length;
const htmls = lista(/\.html$/), jss = lista(/\.js$/), csss = lista(/\.css$/);
const achados = [];
const add = (sev, regra, arq, linha, msg) => achados.push({ sev, regra, arq, linha, msg });

/** Corpo de cada `function nome(...) { ... }` por contagem de chaves. */
function* funcoes(t, re) {
  for (const m of t.matchAll(re)) {
    const ini = t.indexOf("{", m.index + m[0].length - 1); let n = 0, j = ini;
    for (; j < t.length; j++) { if (t[j] === "{") n++; else if (t[j] === "}" && --n === 0) break; }
    yield { nome: m[1], corpo: t.slice(ini, j + 1), i: m.index };
  }
}
const rotasLimpas = new Set([
  ...(existe("server/server.js") ? [...ler("server/server.js").matchAll(/"(painel-[\w-]+)"\s*:/g)].map((m) => "/" + m[1]) : []),
  ...(existe("firebase.json") ? [...ler("firebase.json").matchAll(/"source":\s*"(\/[\w-]+)"/g)].map((m) => m[1]) : [])
]);

// ---------- 1) HTML ----------
const idsPorHtml = {};
for (const h of htmls) {
  const t = ler(h), visto = new Map();
  for (const m of t.matchAll(/\sid="([^"]+)"/g)) {
    if (visto.has(m[1])) add("CRITICO", "id-duplicado", h, linhaDe(t, m.index), `id="${m[1]}" repetido (1ª vez na linha ${visto.get(m[1])}): getElementById pega só o primeiro e o outro "não responde"`);
    else visto.set(m[1], linhaDe(t, m.index));
  }
  idsPorHtml[h] = new Set(visto.keys());
  if (!/<html[^>]*\slang=/.test(t)) add("MEDIO", "html-lang", h, 1, "<html> sem lang (leitor de tela e tradutor erram o idioma)");
  if (!/name="viewport"/.test(t)) add("ALTO", "viewport", h, 1, "sem <meta viewport>: no celular a página renderiza em escala de desktop");
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?![\d.])/.test(t)) add("MEDIO", "zoom-bloqueado", h, 1, "viewport bloqueia o zoom (acessibilidade: baixa visão não consegue ampliar)");
  if (!/name="theme-color"/.test(t)) add("INFO", "theme-color", h, 1, "sem <meta theme-color>: a barra do navegador no celular não acompanha o tema escuro");
  for (const m of t.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/g)) add("MEDIO", "img-sem-alt", h, linhaDe(t, m.index), "<img> sem alt");
  for (const f of t.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const total = [...f[2].matchAll(/<button\b/g)].length, semType = [...f[2].matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)].length;
    if (total > 1 && semType && !/method="dialog"/.test(f[1])) add("MEDIO", "button-sem-type", h, linhaDe(t, f.index), `form com ${total} botões e ${semType} sem type: o botão "extra" também envia o formulário`);
  }
  for (const m of t.matchAll(/<a\b[^>]*href="#"[^>]*>/g)) if (!/role="button"|\sid=|data-/.test(m[0])) add("INFO", "href-vazio", h, linhaDe(t, m.index), 'link href="#" sem handler: sobe a página ao clicar');
  for (const m of t.matchAll(/\son(click|change|submit|load|error)=/g)) add("MEDIO", "handler-inline", h, linhaDe(t, m.index), `handler inline on${m[1]}: a CSP do projeto bloqueia e o clique fica morto`);
  for (const m of t.matchAll(/<input\b(?![^>]*type="(?:hidden|checkbox|radio|file|submit|button)")[^>]*\sid="([^"]+)"[^>]*>/g)) {
    const id = m[1], ok = new RegExp(`for="${id}"`).test(t) || /aria-label|aria-labelledby/.test(m[0]) || new RegExp(`<label[^>]*>[^<]*<input[^>]*id="${id}"`).test(t);
    if (!ok) add("MEDIO", "input-sem-label", h, linhaDe(t, m.index), `#${id} sem <label for>/aria-label (toque no rótulo não foca; leitor de tela fica mudo)`);
  }
  for (const m of t.matchAll(/(?:src|href)="(?!https?:|data:|#|mailto:|tel:|\/\/)([^"?#]+)[^"]*"/g)) {
    const f = m[1].replace(/^\.\//, "");
    if (f && !rotasLimpas.has("/" + f.replace(/^\//, "")) && !rotasLimpas.has(f) && !existe(f.replace(/^\//, ""))) add("ALTO", "recurso-inexistente", h, linhaDe(t, m.index), `${f} referenciado e não existe (404 no console / imagem quebrada)`);
  }
  for (const m of t.matchAll(/data-(abrir|fechar)="([^"]+)"/g)) if (!idsPorHtml[h].has(m[2]) && !new RegExp(`id="${m[2]}"`).test(t)) add("CRITICO", "alvo-inexistente", h, linhaDe(t, m.index), `data-${m[1]}="${m[2]}" aponta para um id que não existe: o botão não faz nada`);
}

// ---------- 2) JS ↔ HTML: $("id") que não existe ----------
const paginaDoScript = {};
for (const h of htmls) for (const m of ler(h).matchAll(/<script[^>]*src="\.?\/?([^"?]+)"/g)) (paginaDoScript[m[1]] ||= []).push(h);
const compartilhados = new Set(["ui.js", "acesso.js", "entrada.js", "geo.js", "taxas.js", "recado.js", "suporte.js"]);
const donosDe = (j) => paginaDoScript[j] || (compartilhados.has(j) ? htmls.filter((h) => (paginaDoScript["script-aluno.js"] || []).includes(h) || (paginaDoScript["script-personal.js"] || []).includes(h) || (paginaDoScript["admin.js"] || []).includes(h)) : []);
for (const j of jss) {
  const t = ler(j), donos = donosDe(j); if (!donos.length || /^(core|config|firebase|sw)\.js$/.test(j)) continue;
  const dinamicos = new Set([...t.matchAll(/\.id\s*=\s*["']([\w-]+)["']|\bid=\\?["']?([\w-]+)/g)].map((m) => m[1] || m[2]));   // ids criados pelo próprio JS
  for (const m of t.matchAll(/(?:\$|getElementById)\(\s*["']([\w-]+)["']\s*\)(\?\.)?/g)) {
    const id = m[1];
    if (m[2] || dinamicos.has(id)) continue;                                                                                   // `?.` ou criado dinamicamente: seguro
    if (donos.every((h) => !idsPorHtml[h].has(id))) add(compartilhados.has(j) ? "ALTO" : "CRITICO", "id-do-js-inexistente", j, linhaDe(t, m.index), `$("${id}") não existe em ${donos.join(", ")}: devolve null e a função inteira quebra em silêncio (a tela "trava" sem erro visível)`);
  }
}

// ---------- 3) JS: bugs silenciosos ----------
const CAMPOS_DE_USUARIO = /\.(nome|aluno|nomeCompleto|texto|email|foco|bio|cidade|descricao|motivo|obs|observacao|comentario|personalNome|endereco|objetivo|titulo|msg|mensagem)\b/;
for (const j of jss) {
  const t = ler(j);
  for (const m of t.matchAll(/\b(console\.log|debugger)\b/g)) add("MEDIO", "lixo-debug", j, linhaDe(t, m.index), `${m[1]} esquecido`);
  for (const m of t.matchAll(/\/\/\s*(TODO|FIXME|XXX|HACK)\b.*/g)) add("INFO", "pendencia", j, linhaDe(t, m.index), m[0].slice(0, 90));
  for (const m of t.matchAll(/catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/g)) add("INFO", "catch-vazio", j, linhaDe(t, m.index), "catch vazio engole o erro. Se for intencional (ex.: storage bloqueado), comente o porquê");
  // campo vindo do banco/usuário interpolado em HTML sem esc(): aspas ou "<" quebram o layout (e é XSS se o dado for de terceiro)
  for (const m of t.matchAll(/(innerHTML|insertAdjacentHTML\([^,]+,)\s*[+]?=?\s*`([^`]*)`/g)) {
    const crus = [...m[2].matchAll(/\$\{([^}]+)\}/g)].map((x) => x[1].trim()).filter((e) => CAMPOS_DE_USUARIO.test(e) && !/esc\(|brl\(|fmt\w+\(|Number\(|\.length/.test(e));
    if (crus.length) add("ALTO", "innerHTML-sem-escape", j, linhaDe(t, m.index), `campo de usuário sem esc(): \${${crus.slice(0, 2).join("}, ${")}}`);
  }
  // onSnapshot guardado em variável e nunca cancelado: ao sair/entrar na conta a lista duplica e as leituras do Firestore crescem
  for (const v of new Set([...t.matchAll(/(\w+)\s*=\s*onSnapshot\(/g)].map((m) => m[1]))) if (!new RegExp(`${v}\\?*\\.?\\(\\)`).test(t)) add("ALTO", "onSnapshot-sem-cancelar", j, 1, `${v} = onSnapshot(...) nunca é cancelado`);
  // ouvinte em alvo PERSISTENTE dentro de função chamada várias vezes: acumula e o clique dispara N vezes (elemento criado na própria função não conta)
  for (const f of funcoes(t, /function\s+(render\w*|pintar\w*|abrir\w*|mostrar\w*|carregar\w*)\s*\([^)]*\)\s*\{/g))
    for (const a of f.corpo.matchAll(/(document|window|\$\([^)]*\)|document\.getElementById\([^)]*\)|document\.querySelector\([^)]*\))\.addEventListener\(\s*["'](\w+)["']/g))
      if (!/once\s*:\s*true/.test(f.corpo.slice(a.index, a.index + 220))) add("ALTO", "listener-em-funcao-repetida", j, linhaDe(t, f.i), `${f.nome}() registra "${a[2]}" em ${a[1].slice(0, 26)} a cada chamada: depois de reabrir a tela o clique dispara várias vezes (registre uma vez no topo ou use delegação)`);
  // botão desabilitado antes de um await e nunca reabilitado (micro-trava clássica após falha de rede)
  for (const m of t.matchAll(/(\$\("[\w-]+"\)|\b[a-z]\w*)\.disabled\s*=\s*true\b/g)) {
    const linha = t.slice(t.lastIndexOf("\n", m.index), t.indexOf("\n", m.index)), janela = t.slice(m.index, m.index + 3000);
    if (/\.hidden\s*=/.test(linha)) continue;                                                 // botão controlado por estado (ex.: libera quando o vídeo termina)
    if (/\bawait\s/.test(janela) && !/finally|\.disabled\s*=\s*(false|!)/.test(janela)) add("ALTO", "botao-fica-travado", j, linhaDe(t, m.index), `${m[1]}.disabled = true antes de um await, sem voltar a false (use finally): após uma falha de rede o botão fica morto até recarregar`);
  }
  for (const m of t.matchAll(/setInterval\(/g)) if (!/clearInterval/.test(t)) add("INFO", "interval-sem-clear", j, linhaDe(t, m.index), "setInterval sem clearInterval: confirme que faz sentido com a aba oculta (polling gasta bateria/dados) e que não é iniciado duas vezes");
}

// ---------- 4) CSS ----------
const css = csss.map((f) => [f, ler(f)]);
const inline = htmls.map((h) => [...ler(h).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n")).join("\n");
const todoCss = css.map(([, t]) => t).join("\n") + "\n" + inline;
const definidas = new Set([...todoCss.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
const fontes = [...htmls, ...jss].map((f) => [f, ler(f)]);
const usadas = new Map();
for (const [f, t] of fontes) {
  for (const m of t.matchAll(/class(?:Name)?="([^"$]+)"/g)) for (const c of m[1].split(/\s+/)) if (/^[a-z][\w-]*$/.test(c) && !usadas.has(c)) usadas.set(c, f);
  for (const m of t.matchAll(/classList\.(?:add|toggle|remove)\(\s*["']([\w-]+)["']/g)) if (!usadas.has(m[1])) usadas.set(m[1], f);
}
for (const [c, f] of usadas) if (!definidas.has(c) && !/^(on|sel|hidden|active|show|open|is-.*|js-.*)$/.test(c)) add("INFO", "classe-sem-css", f, 1, `classe "${c}" sem regra de CSS (gancho de JS ou estilo esquecido: confira se o elemento aparece "cru")`);
const textoFontes = fontes.map(([, t]) => t).join("\n");
const mortos = [...definidas].filter((c) => !usadas.has(c) && !new RegExp(`\\b${c}\\b`).test(textoFontes)).length;
if (mortos) add("INFO", "css-morto", "*.css", 0, `~${mortos} seletores de classe sem nenhum uso em HTML/JS (candidatos a remoção; confirme antes: podem ser montados dinamicamente)`);
for (const [f, t] of css) {
  const z = [...t.matchAll(/z-index\s*:\s*(-?\d+)/g)].map((m) => Number(m[1])), imp = (t.match(/!important/g) || []).length;
  if (z.length) add("INFO", "z-index", f, 0, `${z.length} z-index (valores: ${[...new Set(z)].sort((a, b) => a - b).join(", ")}). Duas camadas com o mesmo valor dependem da ordem do DOM: causa típica de modal/toast "atrás" de outro`);
  if (imp > 8) add("MEDIO", "important", f, 0, `${imp} usos de !important (guerra de especificidade: o próximo ajuste de estilo "não pega")`);
  // iOS: campo com fonte < 16px faz o Safari dar zoom ao focar e não voltar
  for (const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim(), corpo = m[2], fs = /(?:^|[;\s])font-size\s*:\s*(\d+(?:\.\d+)?)px/.exec(corpo), ln = linhaDe(t, m.index + m[0].indexOf("{"));
    if (fs && /(^|[\s,>+~])(input|select|textarea)(?![\w-])/.test(sel) && !/type=["']?(checkbox|radio)/.test(sel) && Number(fs[1]) < 16) add("ALTO", "ios-zoom-no-foco", f, ln, `${sel.split(",")[0].trim().slice(0, 50)} com font-size ${fs[1]}px (<16px): o Safari do iPhone dá ZOOM ao focar o campo e não volta (a tela "pula" e desalinha)`);
    if (/^\.(icon-btn|btn-sm|pill|chip)$/.test(sel)) {
      const h2 = /(?:^|[;\s])(?:min-)?height\s*:\s*(\d+)px/.exec(corpo), pad = /padding\s*:\s*(\d+)px/.exec(corpo), fs2 = /font-size\s*:\s*(\d+(?:\.\d+)?)px/.exec(corpo);
      const alt = h2 ? Number(h2[1]) : pad && fs2 ? Math.round(2 * Number(pad[1]) + 1.45 * Number(fs2[1])) : null;
      if (alt && alt < 40) add("MEDIO", "alvo-de-toque-pequeno", f, ln, `${sel.split(",")[0].trim().slice(0, 40)} ≈ ${alt}px de altura (ideal ≥ 44px: o dedo erra e parece que "não respondeu")`);
    }
    if (/(?:^|[;\s])(?:min-)?width\s*:\s*([6-9]\d\d|\d{4,})px/.test(corpo) && !/max-width/.test(corpo.split(";").find((x) => /width/.test(x)) || "")) add("ALTO", "largura-fixa", f, ln, `${sel.split(",")[0].trim().slice(0, 40)} com largura fixa ≥ 600px: estoura a tela de 360px (barra horizontal)`);
  }
  if (/100vh/.test(t) && !/100dvh/.test(t)) add("ALTO", "100vh-mobile", f, 0, "100vh sem dvh: no celular rodapé/botões fixos ficam atrás da barra do navegador");
  for (const m of t.matchAll(/transition\s*:\s*all\b/g)) add("MEDIO", "transition-all", f, linhaDe(t, m.index), "transition: all anima propriedades de layout e engasga em aparelho fraco; liste só color/opacity/transform");
  if (!/prefers-reduced-motion/.test(t) && /@keyframes|animation\s*:|transition\s*:/.test(t) && f !== "style-landing.css" && f !== "admin.css") add("MEDIO", "reduced-motion", f, 0, "animações sem @media (prefers-reduced-motion): desconforto para quem desativou movimento e micro-travas em aparelho fraco");
  if (f === "style.css" && !/dvh|env\(safe-area/.test(t)) add("MEDIO", "viewport-mobile", f, 0, "sem dvh/safe-area: entalhe/barra do celular cobre botões fixos");
}

// ---------- 5) Service worker e manifest ----------
if (existe("sw.js")) {
  const sw = ler("sw.js"), base = [...(sw.match(/BASE\s*=\s*\[([\s\S]*?)\]/)?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const f of base) if (f !== "./" && !f.startsWith("http") && !rotasLimpas.has(f) && !existe(f.replace(/^\.?\//, ""))) add("ALTO", "sw-cache-inexistente", "sw.js", 1, `${f} está no precache e não existe: addAll() falha e o service worker NÃO instala (app nunca atualiza)`);
  for (const j of jss) if (!/^sw\.js$/.test(j) && !base.includes(j) && paginaDoScript[j]) add("INFO", "sw-fora-do-cache", "sw.js", 1, `${j} fora do precache (offline sem esse módulo)`);
  if (!/VERSAO\s*=/.test(sw)) add("MEDIO", "sw-versao", "sw.js", 1, "sem VERSAO de cache: usuários ficam presos em arquivos velhos após o deploy");
}
if (existe("manifest.json")) for (const i of JSON.parse(ler("manifest.json")).icons || []) if (!existe(i.src.replace(/^\.?\//, ""))) add("ALTO", "manifest-icone", "manifest.json", 1, `ícone ${i.src} não existe`);

// ---------- relatório ----------
const ordem = { CRITICO: 0, ALTO: 1, MEDIO: 2, INFO: 3 };
achados.sort((a, b) => ordem[a.sev] - ordem[b.sev] || a.arq.localeCompare(b.arq) || a.linha - b.linha);
const por = (s) => achados.filter((a) => a.sev === s).length;
if (JSON_OUT) console.log(JSON.stringify({ resumo: Object.fromEntries(Object.keys(ordem).map((s) => [s, por(s)])), achados }, null, 2));
else {
  console.log(`\nAUDITORIA DE UI — ${raiz}\n${htmls.length} HTML · ${jss.length} JS · ${csss.length} CSS\n`);
  let ult = "";
  for (const a of achados) { if (a.sev !== ult) { console.log(`\n== ${a.sev} (${por(a.sev)}) ==`); ult = a.sev; } console.log(`  [${a.regra}] ${a.arq}${a.linha ? ":" + a.linha : ""}  ${a.msg}`); }
  console.log(`\nResumo: ${Object.keys(ordem).map((s) => `${s} ${por(s)}`).join(" · ")}\n`);
}
process.exit(por("CRITICO") ? 1 : 0);
