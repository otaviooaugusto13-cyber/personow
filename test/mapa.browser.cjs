// Verificação em navegador (Chromium/Playwright) do mapa do aluno. NÃO entra no `npm test` (precisa de Chromium).
// Rodar: NODE_PATH=<pasta do playwright>/node_modules node test/mapa.browser.cjs
// Firebase e API são falsos; o Leaflet é SIMULADO (o real vem do cdnjs e este teste roda sem rede) — valida a integração e a lógica do
// módulo mapa-aluno.js, os estados da tela, o fluxo "Chamar este personal" e o layout em 360/390/430 px; NÃO valida o desenho real do Leaflet.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const stubs = require("./e2e.stubs.cjs");
const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url.split("?")[0] === "/" ? "index.html" : q.url.split("?")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });

const FIREBASE_STUB = `
export const PORTAL = "aluno", FIREBASE_CONFIGURADO = true, app = {}, db = {}, googleProvider = {};
export const auth = { get currentUser() { return window.__fake.user || null; } };
export const aguardarAuth = async () => auth.currentUser;
export const chamarFuncao = async (n, c, m) => window.__api(n, c, m);
export const consultar = (n) => window.__api(n, null, "GET");
export const renovarToken = async () => {}, testeAtivo = async () => false, contaDeTeste = async () => !!window.__fake.teste, loginDeTeste = async () => {};
export const entrarComGoogle = async () => {}, sairDaConta = async () => {}, mensagemErroAuth = (e) => e?.message || "erro";
export const entrarComEmail = async () => {}, criarContaComEmail = async () => {}, recuperarSenha = async () => {}, reenviarVerificacao = async () => {}, conferirVerificacao = async () => {};
export const baixarCSVProtegido = async () => {}, baixarBlobProtegido = async () => new Blob([]), concluirLoginGoogle = async () => {}, papelAtual = async () => "aluno";
export const emailPendente = () => false, navegadorEmbutido = () => false, aquecerServidor = () => {};`;

// Leaflet SIMULADO: só o que mapa-aluno.js usa; cada marcador vira um <div class="leaflet-marker-icon pm-pin|pm-eu"> de 44×44 dentro do contêiner.
const LEAFLET_MOCK = `(() => {
  const ev = (o) => (o.on = (t, f) => ((o._h = o._h || {})[t] = f, o), o.fire = (t, e) => o._h?.[t]?.(e || {}), o);
  const mk = (ll, opts) => { const m = ev({ ll, opts, addTo(map) { m.map = map; const d = document.createElement("div"); d.className = "leaflet-marker-icon " + (opts.icon.className || ""); d.style.cssText = "position:absolute;width:44px;height:44px;left:" + (60 + map._n++ * 70) + "px;top:120px"; d.tabIndex = opts.keyboard === false ? -1 : 0; d.title = opts.title || ""; d.innerHTML = opts.icon.html || ""; if (opts.interactive !== false) d.addEventListener("click", (e) => { e.stopPropagation(); m.fire("click", { originalEvent: e }); }); map._el.appendChild(d); m._icon = d; map._markers.push(m); return m; }, setLatLng(l) { m.ll = l; return m; }, remove() { m._icon?.remove(); m.map._markers = m.map._markers.filter((x) => x !== m); } }); return ev(m); };
  window.L = { version: "mock",
    map(el, opts) { el.classList.add("leaflet-container"); el.style.position = "relative"; const map = ev({ _el: el, _n: 0, _markers: [], opts, view: null, setView(c, z) { map.view = [c, z]; return map; }, fitBounds(p) { map.fitted = p; }, invalidateSize() {}, getSize() { return { x: el.clientWidth, y: el.clientHeight }; }, latLngToContainerPoint() { return { x: 100, y: 100 }; }, panBy() {} }); el.addEventListener("click", () => map.fire("click")); window.__mapa = map; return map; },
    tileLayer(u, o) { return { addTo() { window.__tiles = { u, o }; } }; },
    control: { attribution() { return { addTo() {} }; }, zoom() { return { addTo() {} }; } },
    divIcon: (o) => o, marker: mk, circle: (ll, o) => ({ addTo(map) { this.map = map; return this; }, setLatLng() {}, remove() {} }),
    DomEvent: { stopPropagation: (e) => e?.originalEvent?.stopPropagation?.() } };
})();`;

// Google Maps SIMULADO: Map, OverlayView (marcadores HTML), LatLng/LatLngBounds, importLibrary e o callback do carregamento assíncrono.
const GOOGLE_MOCK = (authFalha) => `(() => {
  class OverlayView { setMap(m) { if (m) { this._m = m; (window.__gp = window.__gp || new Set()).add(this); this.onAdd(); this.draw(); } else { this.onRemove(); window.__gp?.delete(this); } } getPanes() { return { overlayMouseTarget: window.__gel }; }
    getProjection() { return { fromLatLngToDivPixel: () => ({ x: 60 + [...window.__gp].indexOf(this) * 70, y: 150 }), fromLatLngToContainerPixel: () => ({ x: 100, y: 100 }) }; } }
  class LatLng { constructor(a, b) { this.lat = a; this.lng = b; } }
  class LatLngBounds { constructor() { this.p = []; } extend(p) { this.p.push(p); } }
  class GMap { constructor(el, o) { const d = document.createElement("div"); d.className = "gm-style"; d.style.cssText = "position:absolute;inset:0"; el.appendChild(d); window.__gel = d; window.__gmap = this; this.opts = o; this.ls = {}; d.addEventListener("click", () => this.ls.click?.()); }
    addListener(t, f) { this.ls[t] = f; } setCenter(c) { this.c = c; } setZoom(z) { this.z = z; } getZoom() { return this.z || 14; } fitBounds(b, p) { this.fitted = b; this.pad = p; } setOptions(o) { Object.assign(this.opts, o); } panBy() {} }
  window.google = { maps: { importLibrary: async () => ({ Map: GMap }), OverlayView, LatLng, LatLngBounds, event: { addListenerOnce() {}, trigger() {} } } };
  window.__pmGoogleInit?.();
  ${authFalha ? "setTimeout(() => window.gm_authFailure?.(), 60);" : ""}
})();`;

const P = (id, nome, lat, lng, extra = {}) => ({ id, nome, foto: "", ratingMedia: 4.8, ratingQtd: 12, modalidades: ["Musculação"], lat, lng, distanciaKm: 1.6, ...extra });

(async () => {
  await new Promise((ok) => srv.listen(0, ok)); const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch(); let falhas = 0;
  const ok = (c, m) => { if (!c) { falhas++; console.log("  ✗", m); } else console.log("  ✓", m); };

  async function abrir({ largura = 390, loc = { lat: -22.4358, lng: -46.8216, cidade: "Itapira", uf: "SP" }, personais = [], leaflet = "mock", falhaApi = false, teste = false, google = null } = {}) {   // google: null (sem chave) | "mock" | "authfail" | "bloqueado"
    const ctx = await browser.newContext({ viewport: { width: largura, height: 800 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(), erros = [], chamadas = [], urlsGoogle = [];
    page.on("pageerror", (e) => erros.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) erros.push(m.text()); });
    await page.exposeFunction("__api", (nome, corpo, metodo) => {
      chamadas.push({ nome, corpo, metodo });
      if (nome === "sessao") return { estado: "ok", role: "aluno", perfis: ["aluno"] };
      if (nome === "personais/online") { if (falhaApi) throw Object.assign(new Error("falha"), { code: "rede" }); return loc ? { semLocalizacao: false, raioKm: 20, total: personais.length, personais, atualizadoEm: "x" } : { semLocalizacao: true, raioKm: 20, total: 0, personais: [] }; }
      if (nome === "reputacao") return { vidas: 3, vidasMax: 3, infracoes: [], nivel: "bronze" };
      if (nome === "teste/personais-online") return { ok: true, personais: 3 };
      if (/parceiro/.test(nome)) return [];
      return {};
    });
    await page.route("**/*", (route) => {
      const u = route.request().url(), m = /firebasejs\/10\.8\.0\/(firebase-[a-z]+\.js)/.exec(u);
      if (m) return route.fulfill({ contentType: "text/javascript", body: stubs[m[1]] || "" });
      if (/\/config\.js$/.test(u) && u.startsWith(base) && google) return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(ROOT, "config.js"), "utf8").replace('GOOGLE_MAPS_KEY = ""', 'GOOGLE_MAPS_KEY = "TESTE"') });
      if (/maps\.googleapis\.com\/maps\/api\/js/.test(u)) { urlsGoogle.push(u); return google === "bloqueado" ? route.abort() : route.fulfill({ contentType: "text/javascript", body: GOOGLE_MOCK(google === "authfail") }); }
      if (/\/firebase\.js$/.test(u) && u.startsWith(base)) return route.fulfill({ contentType: "text/javascript", body: FIREBASE_STUB });
      if (/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.js$/.test(u)) return leaflet === "mock" ? route.fulfill({ contentType: "text/javascript", body: LEAFLET_MOCK }) : route.abort();
      if (/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.css$/.test(u)) return route.fulfill({ contentType: "text/css", body: ".leaflet-container{overflow:hidden}" });
      if (u.startsWith(base)) return route.continue();
      return route.abort();
    });
    const store = { "alunos/ana": { uid: "ana", nomeCompleto: "Ana", ...(loc ? { localizacao: loc } : {}) }, "personais/leo": { uid: "leo", nome: "Leo", status: "ativo" } };
    await page.addInitScript((f) => { window.__fake = { store: f.store, log: [], user: f.user, teste: f.teste }; }, { store, teste, user: { uid: "ana", displayName: "Ana Souza", email: "ana@x.com", emailVerified: true, photoURL: "" } });
    await page.goto(base + "/index.html"); await page.waitForTimeout(900);
    return { page, erros, chamadas, ctx, urlsGoogle };
  }
  const semScrollX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

  console.log("COM PERSONAIS ONLINE (390 px)");
  let { page, erros, chamadas, ctx } = await abrir({ personais: [P("p1", "Carla Souza", -22.44, -46.81), P("p2", "Rafa <b>X</b>", -22.43, -46.83, { ratingQtd: 0, ratingMedia: null })] });
  ok(await page.locator("#screen-main").evaluate((e) => e.classList.contains("active")), "entra no app do aluno");
  ok((await page.locator("#form-aula").count()) === 1 && !(await page.locator("#tab-home #form-aula").count()), "form-aula saiu da tela inicial (agora está na sheet)");
  ok((await page.locator("#tab-home #card-mapa").count()) === 1, "mapa está na tela inicial");
  ok((await page.locator("#mapa-contador").textContent()).trim() === "2 personais ativos agora", "contador: 2 personais ativos agora → " + (await page.locator("#mapa-contador").textContent()));
  ok((await page.locator(".pm-pin").count()) === 2 && (await page.locator(".pm-eu").count()) === 1, "2 marcadores de personal + 1 do aluno");
  ok(await page.locator("#mapa-vazio").isHidden() && await page.locator("#mapa-aviso").isHidden(), "sem aviso de vazio nem de localização");
  ok(chamadas.some((c) => c.nome === "personais/online" && c.metodo === "GET"), "consulta GET /personais/online");
  ok(await page.evaluate(() => window.__tiles.u.startsWith("https://tile.openstreetmap.org/")), "tiles do OpenStreetMap");
  const tela = await page.evaluate(() => { const t = document.getElementById("tab-home").getBoundingClientRect(), n = document.querySelector(".bottom-nav").getBoundingClientRect(), m = document.getElementById("mapa-personais").getBoundingClientRect(); return { topo: Math.round(t.top), base: Math.round(t.bottom), navTopo: Math.round(n.top), larg: Math.round(t.width), mapaH: Math.round(m.height), vh: innerHeight, vw: innerWidth }; });
  ok(tela.topo === 0 && Math.abs(tela.base - tela.navTopo) <= 2 && tela.larg === tela.vw, "a tela inicial é o mapa em TELA CHEIA " + JSON.stringify(tela));
  ok(tela.mapaH >= tela.vh - 120, "mapa ocupa a altura toda (" + tela.mapaH + " de " + tela.vh + ")");
  ok(await page.evaluate(() => ["nome-home", "aviso-cartao", "rep-aluno-home", "lista-personais"].every((i) => document.getElementById(i)?.closest("#sheet-inicio") && !document.getElementById(i).closest("#tab-home"))), "saudação, avisos, reputação e lista foram para a sheet Resumo (mesmos ids)");
  const acoes = await page.evaluate(() => ["#btn-relampago", "#btn-agendar"].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height), Math.round(r.bottom)]; }));
  ok(acoes.every(([, w, h, b]) => w >= 44 && h >= 44 && b <= tela.base - 20), "ações flutuantes visíveis, ≥ 44 px e acima da logo/atribuição do mapa " + JSON.stringify(acoes));
  await page.evaluate(() => document.querySelectorAll("#sheet-inicio .banner").forEach((b) => { b.hidden = true; })); await page.waitForTimeout(100);
  ok(await page.locator("#mapa-pendencias").isHidden(), "sem aviso pendente: sem bolinha no ☰");
  await page.evaluate(() => { document.getElementById("aviso-cartao").hidden = false; }); await page.waitForTimeout(100);
  ok(await page.locator("#mapa-pendencias").isVisible(), "aviso pendente: bolinha azul no ☰");
  await page.locator("#btn-resumo").click();
  ok(await page.locator("#sheet-inicio").evaluate((e) => e.classList.contains("active")) && await page.locator("#sheet-inicio #aviso-cartao").isVisible(), "☰ abre o Resumo com o aviso");
  await page.locator('#sheet-inicio [data-fechar="sheet-inicio"]').click(); await page.waitForTimeout(350);
  if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT + "-home.png" }); await page.evaluate(() => document.body.classList.remove("light-theme")); await page.waitForTimeout(200); await page.screenshot({ path: process.env.SHOT + "-home-escuro.png" }); await page.evaluate(() => document.body.classList.add("light-theme")); }
  await page.locator(".pm-pin").first().click();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + "-cartao.png" });
  ok(await page.locator("#mapa-cartao").isVisible(), "tocar no marcador abre o cartão");
  const cart = await page.locator("#mapa-cartao").textContent();
  ok(/Carla Souza/.test(cart) && /4,8/.test(cart) && /Musculação/.test(cart) && /≈/.test(cart), "cartão: nome, nota, modalidade e distância → " + cart.replace(/\s+/g, " ").trim());
  const alvos = await page.evaluate(() => ["#mapa-cartao .btn", ".pm-fechar"].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height)]; }));
  ok(alvos.every(([, w, h]) => w >= 44 && h >= 44), "alvos de toque ≥ 44 px " + JSON.stringify(alvos));
  await page.locator("#mapa-cartao .pm-chamar").click();
  ok(await page.locator("#sheet-agendar").evaluate((e) => e.classList.contains("active")), "\"Chamar este personal\" abre a sheet Agendar aula");
  ok(await page.locator("#banner-preferido").isVisible() && (await page.locator("#nome-preferido").textContent()) === "Carla Souza", "banner de personal preferido com o nome");
  ok(await page.locator("#sheet-agendar #modalidade-grid .chip").count() > 3 && await page.locator("#p-entrada").isVisible() && await page.locator("#btn-enviar").isVisible(), "formulário completo na sheet (modalidades, horário, enviar)");
  if (process.env.SHOT) { await page.waitForTimeout(700); await page.screenshot({ path: process.env.SHOT + "-sheet.png" }); }
  const fonte = await page.evaluate(() => ["#p-local", "#p-data", "#p-entrada", "#p-saida"].map((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize)));
  ok(fonte.every((f) => f >= 16), "campos com fonte ≥ 16 px " + fonte);
  // envia: o pedido leva personalPreferido
  await page.fill("#p-local", "Mercado Central — Rua 1");
  await page.evaluate(() => { window.__fake.store["cartoes/ana"] = { status: "ativo" }; });
  await page.close();

  console.log("ESTADOS");
  ({ page, erros } = await abrir({ personais: [] }));
  ok((await page.locator("#mapa-vazio").isVisible()) && /Nenhum personal online agora/.test(await page.locator("#mapa-vazio").textContent()), "estado vazio amigável");
  ok((await page.locator("#mapa-contador").textContent()).startsWith("0 personais"), "contador 0");
  ok(await page.locator("#btn-relampago").isVisible(), "Chamado relâmpago continua disponível");
  await page.locator("#btn-agendar").click();
  ok(await page.locator("#sheet-agendar").evaluate((e) => e.classList.contains("active")) && await page.locator("#banner-preferido").isHidden(), "botão Agendar aula abre a sheet (sem preferido)");
  await page.close();

  ({ page, erros, chamadas } = await abrir({ loc: null }));
  ok(await page.locator("#mapa-aviso").isVisible() && /Definir minha localização/.test(await page.locator("#mapa-definir-local").textContent()), "sem localização: aviso + botão Definir minha localização");
  ok(!chamadas.some((c) => c.nome === "personais/online"), "sem localização não consulta o servidor");
  ok(await page.evaluate(() => Math.abs(window.__mapa.view[0][0] - -22.4358) < 0.01), "mapa centralizado na cidade padrão");
  await page.locator("#mapa-definir-local").click();
  ok(await page.locator("#sheet-local").evaluate((e) => e.classList.contains("active")), "o botão abre a sheet de localização");
  await page.close();

  ({ page, erros } = await abrir({ personais: [P("p1", "Carla", -22.44, -46.81)], leaflet: "bloqueado" }));
  ok(await page.locator("#mapa-lista .card").count() === 1 && /Não foi possível carregar o mapa/.test(await page.locator("#mapa-status").textContent()), "Leaflet indisponível: lista de plano B");
  await page.locator("#mapa-lista [data-pm-chamar]").click();
  ok(await page.locator("#sheet-agendar").evaluate((e) => e.classList.contains("active")), "plano B também chama o personal");
  ok(erros.length === 0, "sem erros de JS " + JSON.stringify(erros));
  await page.close();

  ({ page, erros } = await abrir({ personais: [P("p1", "Carla", -22.44, -46.81)], falhaApi: true }));
  ok(/Sem conexão/.test(await page.locator("#mapa-status").textContent()), "falha de rede: aviso discreto, sem quebrar");
  ok(erros.length === 0, "sem erros de JS na falha " + JSON.stringify(erros));
  await page.close();

  console.log("ATUALIZAÇÃO (relógio) e aba oculta");
  ({ page, erros, chamadas } = await abrir({ personais: [P("p1", "Carla", -22.44, -46.81)] }));
  await page.clock?.install?.().catch(() => {});
  const antes = chamadas.filter((c) => c.nome === "personais/online").length;
  await page.evaluate(() => Object.defineProperty(document, "hidden", { value: true, configurable: true }));
  await page.waitForTimeout(100);
  ok(chamadas.filter((c) => c.nome === "personais/online").length === antes, "aba oculta: não consulta");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(300);
  ok(chamadas.filter((c) => c.nome === "personais/online").length > antes, "voltou a ficar visível: consulta na hora");
  await page.close();

  console.log("GOOGLE MAPS (simulado)");
  let urls;
  ({ page, erros, urlsGoogle: urls } = await abrir({ google: "mock", personais: [P("p1", "Carla Souza", -22.44, -46.81), P("p2", "Rafa", -22.43, -46.83)] }));
  ok(urls.length === 1 && /key=TESTE/.test(urls[0]) && /loading=async/.test(urls[0]) && /v=quarterly/.test(urls[0]) && /callback=__pmGoogleInit/.test(urls[0]), "carrega a API do Google com a chave, carregamento assíncrono e versão fixa (quarterly) → " + (urls[0] || "").replace(/^https:\/\/maps\.googleapis\.com/, ""));
  ok(await page.locator(".pm-gpin.pm-pin").count() === 2 && await page.locator(".pm-gpin.pm-eu").count() === 1 && await page.locator(".leaflet-container").count() === 0, "Google: 2 marcadores de personal + 1 do aluno, sem Leaflet");
  const og = await page.evaluate(() => { const o = window.__gmap.opts, off = (f) => o.styles.some((x) => x.featureType === f && (x.elementType || "all") === "all" && x.stylers[0].visibility === "off"); return { ui: o.disableDefaultUI, ci: o.clickableIcons, gh: o.gestureHandling, poi: off("poi"), transit: off("transit"), fundo: o.backgroundColor, zoomCtl: o.zoomControl }; });
  ok(og.ui === true && og.ci === false && og.gh === "greedy" && og.poi && og.transit && og.zoomCtl === false, "estilo clean (sem controles, sem POI/trânsito, fundo grafite, gestos livres) " + JSON.stringify(og));
  ok(await page.evaluate(() => window.__gmap.fitted?.p?.length === 3 && window.__gmap.pad.top >= 90 && window.__gmap.pad.bottom >= 140), "enquadra aluno + personais deixando folga para o contador e as ações");
  ok((await page.locator("#mapa-contador").textContent()).trim() === "2 personais ativos agora", "contador no Google");
  await page.locator(".pm-gpin.pm-pin").first().click();
  ok(await page.locator("#mapa-cartao").isVisible() && /Carla Souza/.test(await page.locator("#mapa-cartao").textContent()) && await page.locator("#tab-home").evaluate((e) => e.classList.contains("pm-card-aberto")) && await page.locator("#btn-agendar").isHidden(), "marcador do Google abre o cartão e esconde as ações");
  await page.locator("#mapa-cartao .pm-chamar").click();
  ok(await page.locator("#sheet-agendar").evaluate((e) => e.classList.contains("active")) && (await page.locator("#nome-preferido").textContent()) === "Carla Souza", "Google: \"Chamar este personal\" abre Agendar aula com o preferido");
  for (const [claro, cor] of [[false, "#14171B"], [true, "#F4F5F7"]]) {
    await page.evaluate((c) => { document.body.classList.toggle("light-theme", c); document.dispatchEvent(new Event("visibilitychange")); }, claro); await page.waitForTimeout(400);
    ok(await page.evaluate((x) => window.__gmap.opts.backgroundColor === x, cor), `tema ${claro ? "claro" : "escuro"}: o estilo do mapa acompanha (${cor})`);
  }
  ok(erros.length === 0, "Google: sem erros de JS " + JSON.stringify(erros));
  await page.close();

  ({ page, erros } = await abrir({ google: "authfail", personais: [P("p1", "Carla", -22.44, -46.81)] })); await page.waitForTimeout(500);
  ok(await page.locator(".leaflet-container").count() === 1 && await page.locator(".leaflet-marker-icon.pm-pin").count() === 1 && await page.locator(".gm-style").count() === 0, "Google recusa a chave (gm_authFailure): cai no Leaflet/OSM com os marcadores");
  ok(erros.length === 0, "troca de provedor sem erros " + JSON.stringify(erros));
  await page.close();
  ({ page, erros } = await abrir({ google: "bloqueado", personais: [P("p1", "Carla", -22.44, -46.81)] }));
  ok(await page.locator(".leaflet-marker-icon.pm-pin").count() === 1, "Google fora do ar/bloqueado: usa Leaflet/OSM");
  await page.close();

  console.log("LAYOUT (360 / 390 / 430 px)");
  for (const w of [360, 390, 430]) {
    ({ page } = await abrir({ largura: w, personais: [P("p1", "Carla Souza", -22.44, -46.81)] }));
    const m = await page.evaluate(() => { const r = document.getElementById("mapa-personais").getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), vh: innerHeight }; });
    ok(await semScrollX(page), `${w}px: sem scroll horizontal`);
    ok(m.h >= m.vh - 120, `${w}px: mapa em tela cheia (${m.h}px de ${m.vh})`);
    await page.locator(".pm-pin").first().click();
    ok(await semScrollX(page), `${w}px: sem scroll horizontal com o cartão aberto`);
    await page.locator(".pm-fechar").click(); await page.locator("#btn-agendar").click(); ok(await semScrollX(page), `${w}px: sem scroll horizontal com a sheet aberta`);
    await page.close();
  }
  console.log("TEMA CLARO e movimento reduzido");
  ({ page } = await abrir({ personais: [P("p1", "Carla", -22.44, -46.81)] }));
  await page.evaluate(() => document.body.classList.add("light-theme"));
  ok(await page.evaluate(() => getComputedStyle(document.querySelector(".pm-wrap")).backgroundColor !== "rgb(20, 23, 27)"), "tema claro troca o fundo do mapa");
  await page.emulateMedia({ reducedMotion: "reduce" });
  ok(await page.evaluate(() => getComputedStyle(document.querySelector(".pm-eu"), "::after").animationName === "none"), "prefers-reduced-motion desliga o pulso");
  ok(await page.evaluate(() => window.__mapa.opts.zoomAnimation === true), "(sem redução na criação do mapa: opção lida no carregamento)");
  await page.close();

  await browser.close(); srv.close();
  console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTudo certo"); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
