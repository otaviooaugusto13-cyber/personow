const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = "/home/claude/personow-main"; const stubs = require(ROOT + "/test/e2e.stubs.cjs");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
const srv = http.createServer((q, r) => { let u = q.url.split("?")[0]; if (u === "/") u = "/index.html"; if (u === "/painel-aluno") u = "/index.html"; if (u === "/painel-personal") u = "/personal.html"; if (u === "/painel-admin") u = "/admin.html"; const f = path.join(ROOT, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404, { "content-type": "application/json" }); return r.end('{"erro":"sem rota"}'); } r.writeHead(200, { "content-type": MIME[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });
const REAL = JSON.parse(fs.readFileSync("/home/claude/probe/api-real.json","utf8")); const rr = (k) => ({ corpo: REAL[k].corpo });
const dia = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
async function cenario(nome, pagina, { user, sessao, api = {}, store = {}, vp = { width: 390, height: 844 }, shot } = {}) {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: vp, hasTouch: vp.width < 600, isMobile: vp.width < 600 }); const page = await ctx.newPage();
  const js = [], http4 = [], nav = [], cons = [];
  page.on("console", (m) => { if (["warning","error"].includes(m.type()) && !/Failed to load resource/.test(m.text())) cons.push(m.text().slice(0,140)); });
  page.on("pageerror", (e) => js.push(e.message.slice(0, 160)));
  page.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 400 && !/\.(png|ico|map)$/.test(r.url())) http4.push(`${r.request().method()} ${r.url().replace(base, "")} ${r.status()}`); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) nav.push(f.url().replace(base, "")); });
  await page.route("**/*", (route) => { const rq = route.request(), u = rq.url(); const m = /firebasejs\/10\.8\.0\/(firebase-[a-z]+\.js)/.exec(u); if (m) return route.fulfill({ contentType: "text/javascript", body: stubs[m[1]] });
    if (/googleapis\.com\/maps|cdnjs\.cloudflare/.test(u)) return route.fulfill({ contentType: "text/javascript", body: "" });
    if (!u.startsWith(base)) return route.abort(); const p = new URL(u).pathname;
    if (p === "/sessao") { const s = typeof sessao === "function" ? sessao() : sessao; return route.fulfill({ status: s.status || 200, contentType: "application/json", body: JSON.stringify(s.corpo ?? s) }); }
    if (api[p]) { const s = api[p]; return route.fulfill({ status: s.status || 200, contentType: "application/json", body: JSON.stringify(s.corpo ?? s) }); }
    return route.continue(); });
  await page.addInitScript((f) => { window.__fake = { store: {}, log: [], ...f }; if (window.__fake.user) { window.__fake.user.getIdToken = async () => "tok"; window.__fake.user.emailVerified = true; } }, { user: user || null, store });
  await page.goto(base + "/" + pagina); await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ telas: [...document.querySelectorAll(".screen.active")].map((e) => e.id), texto: (document.querySelector(".screen.active, main, body")?.innerText || "").replace(/\s+/g, " ").slice(0, 170), overflowX: document.documentElement.scrollWidth > innerWidth + 1, w: innerWidth }));
  if (shot) await page.screenshot({ path: `/home/claude/probe/shots/${shot}.png` });
  console.log(`\n■ ${nome}\n  url final: ${page.url().replace(base, "")}  | navegações: ${nav.length}\n  telas ativas: ${JSON.stringify(r.telas)} | overflow-x: ${r.overflowX} (${r.w}px)\n  texto: ${r.texto}\n  erros JS: ${JSON.stringify(js)}\n  console: ${JSON.stringify(cons.slice(0,3))}\n  HTTP≥400: ${JSON.stringify([...new Set(http4)].slice(0, 8))}`);
  await b.close(); return r;
}
let base;
(async () => {
  await new Promise((ok) => srv.listen(0, ok)); base = `http://localhost:${srv.address().port}`;
  const ana = { uid: "ana", displayName: "Ana Souza", email: "ana@x.com" }, leo = { uid: "leo", displayName: "Leo Personal", email: "leo@x.com" };
  const rep = { "/reputacao": rr("rep_a"), "/config/taxas": rr("taxas"), "/personais/online": rr("mapa") };
  const lojaAluno = { "personais/leo": { uid: "leo", nome: "Leo Personal", status: "ativo", especialidade: "Hipertrofia", cref: "123-G/SP" }, "alunos/ana": { uid: "ana", nome: "Ana Souza", localizacao: { lat: -22.43, lng: -46.82, cidade: "Itapira", uf: "SP" } },
    "aulas/a1": { uid: "ana", status: "aberta", local: "Smart Fit", data: dia(3), entrada: "10:00", saida: "11:00", horario: "10:00 – 11:00", foco: "Funcional", valorCentavos: 8000 }, "aulas/a4": { uid: "outra", status: "aberta", local: "NAO DEVE APARECER", data: dia(1), entrada: "10:00", saida: "11:00", horario: "x", foco: "Funcional", valorCentavos: 8000 } };
  // ---- VISÃO ALUNO
  await cenario("ALUNO ok — celular 390px", "index.html", { user: ana, sessao: { estado: "ok", role: "aluno", perfis: ["aluno"] }, api: rep, store: lojaAluno, shot: "aluno-390" });
  await cenario("ALUNO ok — desktop 1280px", "index.html", { user: ana, sessao: { estado: "ok", role: "aluno", perfis: ["aluno"] }, api: rep, store: lojaAluno, vp: { width: 1280, height: 800 }, shot: "aluno-1280" });
  await cenario("ALUNO deslogado", "index.html", { user: null, sessao: { status: 401, corpo: { erro: "x" } }, shot: "aluno-login" });
  await cenario("RESTRIÇÃO: conta de PERSONAL abre o painel do aluno", "index.html", { user: leo, sessao: { estado: "outro-perfil", role: "personal", sugerido: "personal", perfis: ["personal"] }, api: rep, shot: "aluno-outro-perfil" });
  await cenario("RESTRIÇÃO: aluno banido (403 em /reputacao)", "index.html", { user: ana, sessao: { estado: "ok", role: "aluno", perfis: ["aluno"] }, api: { "/reputacao": { status: 403, corpo: { erro: "Conta bloqueada.", codigo: "conta-banida" } } }, store: lojaAluno, shot: "aluno-banido" });
  await cenario("RESILIÊNCIA: servidor 500 em /sessao", "index.html", { user: ana, sessao: { status: 500, corpo: { erro: "erro interno" } }, shot: "aluno-500" });
  // ---- PERSONAL
  const lojaPers = { "personais/leo": { uid: "leo", nome: "Leo Personal", status: "ativo", cref: "123-G/SP" } };
  const apiPers = { ...rep, "/reputacao": rr("rep_p"), "/habilitacao": rr("hab"), "/habilitacoes": rr("habs"), "/carteira": rr("cart"), "/perfil/personal/inteligente": rr("inteligente"), "/perfil/privado": { temCpf: true, cpfMascarado: "***.982.247-**", nascimento: "1990-01-01", nascimentoTravado: true, telefone: "", idade: 36, cref: "123-G/SP", pix: null } };
  await cenario("PERSONAL ok — celular", "personal.html", { user: leo, sessao: { estado: "ok", role: "personal", perfis: ["personal"] }, api: apiPers, store: lojaPers, shot: "personal-390" });
  await cenario("PERSONAL bloqueado pelo admin", "personal.html", { user: leo, sessao: { estado: "ok", role: "personal", perfis: ["personal"] }, api: apiPers, store: { "personais/leo": { uid: "leo", nome: "Leo", status: "bloqueado", recado: { texto: "Documento inválido" } } }, shot: "personal-bloqueado" });
  await cenario("RESTRIÇÃO: aluno abre o painel do personal", "personal.html", { user: ana, sessao: { estado: "outro-perfil", role: "aluno", sugerido: "aluno", perfis: ["aluno"] }, api: rep, shot: "personal-outro" });
  // ---- GESTÃO: parceiro, admin
  await cenario("PARCEIRO (painel B2B) ok", "parceiro.html", { user: { uid: "par", displayName: "Academia X", email: "p@x.com" }, sessao: { estado: "ok", role: "parceiro", perfis: ["parceiro"] }, api: { "/b2b/painel": { corpo: {} } }, shot: "parceiro-390" });
  await cenario("ADMIN ok — desktop", "admin.html", { user: { uid: "adm", displayName: "Admin", email: "a@x.com" }, sessao: { estado: "ok", role: "admin", perfis: ["admin"] }, vp: { width: 1280, height: 800 }, shot: "admin-1280" });
  await cenario("RESTRIÇÃO: aluno abre o painel admin", "admin.html", { user: ana, sessao: { estado: "outro-perfil", role: "aluno", sugerido: "aluno", perfis: ["aluno"] }, vp: { width: 1280, height: 800 }, shot: "admin-negado" });
  srv.close(); process.exit(0);
})();
