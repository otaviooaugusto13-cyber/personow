const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const stubs = require("./e2e.stubs.cjs");
const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url.split("?")[0] === "/" ? "index.html" : q.url.split("?")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); });
const dia = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  await new Promise((ok) => srv.listen(0, ok)); const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  let falhas = 0;
  const ok = (c, m) => { if (!c) { falhas++; console.log("  ✗", m); } else console.log("  ✓", m); };

  async function abrir(pagina, fake, extra = "") {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const page = await ctx.newPage();
    const erros = [];
    page.on("pageerror", (e) => erros.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) erros.push(m.text()); });
    await page.route("**/*", (route) => {
      const u = route.request().url();
      const m = /firebasejs\/10\.8\.0\/(firebase-[a-z]+\.js)/.exec(u);
      if (m) return route.fulfill({ contentType: "text/javascript", body: stubs[m[1]] });
      if (/googleapis\.com\/maps|cdnjs\.cloudflare/.test(u)) return route.fulfill({ contentType: "text/javascript", body: "" });
      if (u.startsWith(base)) return route.continue();
      return route.abort();
    });
    await page.addInitScript((f) => { window.__fake = { store: {}, log: [], ...f }; }, fake);
    await page.goto(base + "/" + pagina + extra);
    await page.waitForTimeout(500);
    return { page, erros, ctx };
  }

  // ---------- ALUNO ----------
  console.log("ALUNO — deslogado");
  let { page, erros } = await abrir("index.html", { user: null });
  ok(await page.locator("#screen-login").evaluate((e) => e.classList.contains("active")), "tela de login aparece");
  ok(erros.length === 0, "sem erros de JS no carregamento " + JSON.stringify(erros));

  console.log("ALUNO — logado, com dados");
  const ana = { uid: "ana", displayName: "Ana Souza", email: "ana@x.com", photoURL: "https://lh3.googleusercontent.com/a" };
  const store = {
    "personais/leo": { uid: "leo", nome: "Leo Personal", status: "ativo", especialidade: "Hipertrofia", cref: "123-G/SP", valorMin: 70, ratingMedia: 4.8, ratingQtd: 12, bio: "<img src=x onerror=window.__xss=1>" },
    "personais/rui": { uid: "rui", nome: "Rui", status: "pendente" },
    ["aulas/a1"]: { alunoUid: "ana", status: "aberta", local: "<b>Smart</b> Fit", data: dia(3), entrada: "10:00", saida: "11:00", horario: "10:00–11:00", foco: "Funcional", valorCentavos: 8000, criadoEm: null },
    ["aulas/a2"]: { alunoUid: "ana", status: "aceita", personalUid: "leo", personalNome: "Leo Personal", local: "Academia X", data: dia(4), entrada: "09:00", saida: "10:00", horario: "09:00–10:00", foco: "Hipertrofia", valorCentavos: 10000 },
    ["aulas/a3"]: { alunoUid: "ana", status: "paga", personalUid: "leo", personalNome: "Leo Personal", local: "Academia Y", data: dia(-2), entrada: "08:00", saida: "09:00", horario: "08:00–09:00", foco: "Corrida", valorCentavos: 6000, reciboId: "r1", reciboNumero: 1 },
    ["aulas/a4"]: { alunoUid: "outro", status: "aberta", local: "NÃO DEVE APARECER", data: dia(1), entrada: "10:00", saida: "11:00", horario: "x", foco: "Funcional", valorCentavos: 8000 }
  };
  ({ page, erros } = await abrir("index.html", { user: ana, store }));
  ok(await page.locator("#screen-main").evaluate((e) => e.classList.contains("active")), "entra no app");
  ok((await page.locator("#display-name-home").textContent()) === "Ana", "mostra o primeiro nome");
  ok((await page.locator("#lista-personais-reais .pc").count()) === 1, "lista só personal ATIVO (1 de 2)");
  ok((await page.locator("#lista-personais-reais").textContent()).includes("4,8"), "mostra a nota média do personal");
  await page.evaluate(() => verPerfil(0));
  ok((await page.evaluate(() => window.__xss)) === undefined, "bio com HTML malicioso NÃO executa (XSS)");
  await page.evaluate(() => fecharSheetPerfil());
  const pedidos = await page.locator("#lista-pedidos .agenda-slot").count();
  ok(pedidos === 3, `mostra só as 3 aulas da Ana (achou ${pedidos})`);
  ok(!(await page.locator("#lista-pedidos").textContent()).includes("NÃO DEVE"), "não mostra pedido de outro aluno");
  ok((await page.locator("#lista-pedidos").innerHTML()).includes("&lt;b&gt;Smart"), "local com HTML é escapado");
  ok((await page.locator('#lista-pedidos a[href^="pagar.html?id=a2"]').count()) === 1, "aula aceita tem botão Pagar");
  ok((await page.locator('#lista-pedidos a[href="recibo.html?id=r1"]').count()) === 1, "aula paga tem link do Recibo");
  ok((await page.locator('#lista-pedidos [data-acao="avaliar"]').count()) === 1, "aula paga tem Avaliar");
  ok((await page.locator('#lista-pedidos [data-acao="cancelar"]').count()) === 2, "aberta e aceita têm Cancelar");
  ok((await page.locator("#cart-total").textContent()).replace(/\s/g, " ").includes("60,00"), "carteira soma só o pago (R$ 60,00)");
  ok((await page.locator("#cart-abertos").textContent()) === "2", "2 aulas em aberto");
  ok((await page.locator("#lista-conversas .conversa-item").count()) === 2, "conversas: aceita + paga");
  // sheet de pedido
  await page.evaluate(() => abrirSheetPedido());
  await page.fill("#solicitacao-valor", "80");
  ok((await page.locator("#rv-prom").textContent()).includes("68,00") && (await page.locator("#rv-taxa").textContent()).includes("12,00"), "resumo 85% / 15% correto (68 / 12)");
  await page.fill("#solicitacao-local", "Smart Fit Centro");
  await page.fill("#solicitacao-saida", await page.inputValue("#solicitacao-entrada"));
  await page.evaluate(() => confirmarPedido());
  await page.waitForTimeout(100);
  ok((await page.locator("#toast").textContent()).includes("término"), "bloqueia aula com término = início");
  // avaliação
  await page.evaluate(() => { fecharSheetPedido(); switchTab("tab-pedidos", document.querySelectorAll("#bottom-nav .nav-item")[1]); });
  await page.click('#lista-pedidos [data-acao="avaliar"]');
  ok(await page.locator("#sheet-avaliar").evaluate((e) => e.classList.contains("open")), "abre a folha de avaliação");
  await page.click("#avaliar-estrelas .star:nth-child(4)");
  ok((await page.locator("#avaliar-estrelas .star.on").count()) === 4, "4 estrelas marcadas");
  // chat
  await page.evaluate(() => fecharAvaliacao());
  await page.click('#lista-pedidos [data-acao="chat"] >> nth=0'); 
  ok(await page.locator("#modal-chat-aluno").evaluate((e) => e.classList.contains("active")), "abre o chat da aula");
  await page.fill("#chat-aluno-input", "me chama no zap 19 99999-1111");
  await page.keyboard.press("Enter");
  ok((await page.locator("#toast").textContent()).includes("Telefone"), "filtro anti-fuga avisa antes de enviar");
  // calendário
  ok((await page.locator("#calendar-days-grid .cal-day.has-treino").count()) >= 1, "calendário marca dias com treino");
  ok(erros.length === 0, "sem erros de JS durante o uso " + JSON.stringify(erros));
  await page.context().close();

  // ---------- PERSONAL ----------
  console.log("PERSONAL — deslogado");
  ({ page, erros } = await abrir("personal.html", { user: null }));
  ok(await page.locator("#screen-login-personal").evaluate((e) => e.classList.contains("active")), "tela de login");
  ok((await page.locator("#input-cpf").count()) === 0, "não existe mais login por CPF");
  ok(await page.locator("#btn-google").isDisabled(), "botão Google bloqueado até aceitar termos");
  await page.check("#check-termos");
  ok(!(await page.locator("#btn-google").isDisabled()), "libera ao aceitar os termos");
  await page.evaluate(() => abrirModalTermos());
  ok((await page.locator("#termos-personal-corpo").textContent()).includes("15%"), "termos mostram a comissão vinda do config");
  ok(erros.length === 0, "sem erros de JS " + JSON.stringify(erros));
  await page.context().close();

  console.log("PERSONAL — ativo, com Mercado Pago");
  const leo = { uid: "leo", displayName: "Leo Personal", email: "leo@x.com", photoURL: "" };
  const sp = {
    "personais/leo": { uid: "leo", nome: "Leo Personal", status: "ativo", mpConectado: true, valorMin: 60, cref: "123-G/SP" },
    "personais_privado/leo": { cpf: "52998224725", telefone: "(19) 99999-0000" },
    "aulas/o1": { alunoUid: "x", alunoNome: "Bia", status: "aberta", local: "Smart Fit", data: dia(2), entrada: "10:00", saida: "11:00", horario: "10:00–11:00", foco: "Funcional", valorCentavos: 8000, valorPersonalCentavos: 6800 },
    "aulas/o2": { alunoUid: "x", alunoNome: "Caio", status: "aberta", local: "Choque", data: dia(5), entrada: "09:30", saida: "10:30", horario: "x", foco: "Corrida", valorCentavos: 8000, valorPersonalCentavos: 6800 },
    "aulas/o3": { alunoUid: "x", alunoNome: "Dani", status: "aberta", local: "Barato", data: dia(2), entrada: "15:00", saida: "16:00", horario: "x", foco: "Funcional", valorCentavos: 4000, valorPersonalCentavos: 3400 },
    "aulas/o4": { alunoUid: "x", alunoNome: "Edu", status: "aberta", local: "Reservado p/ outro", data: dia(2), entrada: "17:00", saida: "18:00", horario: "x", foco: "Funcional", valorCentavos: 9000, valorPersonalCentavos: 7650, personalPreferidoUid: "rui", exclusivoAte: { __ms: Date.now() + 3e5 } },
    "aulas/m1": { alunoUid: "y", alunoNome: "Fê", status: "aceita", personalUid: "leo", local: "Minha aula", data: dia(5), entrada: "10:00", saida: "11:00", horario: "10:00–11:00", foco: "Hipertrofia", valorCentavos: 10000, valorPersonalCentavos: 8500 },
    "aulas/m2": { alunoUid: "z", alunoNome: "Gui", status: "paga", personalUid: "leo", local: "Paga", data: dia(-3), entrada: "08:00", saida: "09:00", horario: "x", foco: "Corrida", valorCentavos: 10000, valorPersonalCentavos: 8500 }
  };
  ({ page, erros } = await abrir("personal.html", { user: leo, store: sp, negar: () => false }));
  ok(await page.locator("#screen-dashboard").evaluate((e) => e.classList.contains("active")), "entra no painel");
  const of = await page.locator("#lista-demandas-cards .agenda-slot").count();
  ok(of === 2, `ofertas: só as elegíveis (achou ${of}: sem o barato, sem o reservado p/ outro)`);
  const txt = await page.locator("#lista-demandas-cards").textContent();
  ok(txt.includes("Choque com sua aula"), "oferta que bate com a agenda mostra aviso de choque");
  ok(txt.includes("68,00"), "mostra o líquido do personal (R$ 68,00)");
  ok(!txt.includes("Reservado p/ outro"), "pedido reservado a outro personal fica oculto");
  ok((await page.locator('#lista-demandas-cards [data-acao="aceitar"]').count()) === 1, "só 1 botão Aceitar (o do choque some)");
  ok((await page.locator("#carteira-total-pago").textContent()).includes("85,00"), "carteira: repassado R$ 85,00");
  ok((await page.locator("#carteira-a-receber").textContent()).includes("85,00"), "carteira: a receber R$ 85,00");
  ok((await page.locator("#mp-titulo").textContent()).includes("conectado"), "mostra Mercado Pago conectado");
  ok((await page.locator('#lista-agenda [data-acao="qr"]').count()) === 1, "aula aceita tem Cobrar (QR)");
  await page.evaluate(() => abrirModalCadastrarAluno());
  await page.fill("#cad-aluno-nome", "Marcos"); await page.fill("#cad-aluno-preco", "90");
  await page.evaluate(() => confirmarCadastroAluno());
  await page.waitForTimeout(150);
  ok((await page.locator("#lista-meus-alunos").textContent()).includes("Marcos"), "'Meus alunos' agora PERSISTE e aparece na lista");
  ok(erros.length === 0, "sem erros de JS " + JSON.stringify(erros));
  await page.context().close();

  console.log("PERSONAL — pendente (em análise): permissão negada nos pedidos");
  const pend = { ...sp, "personais/leo": { uid: "leo", nome: "Leo", status: "pendente" } };
  ({ page, erros } = await abrir("personal.html", { user: leo, store: pend, negar: (q) => q.filtros.some((f) => f.v === "aberta") }));
  ok((await page.locator("#lista-demandas-cards").textContent()).includes("liberados após aprovação"), "pendente vê mensagem de aprovação");
  ok(erros.length === 0, "sem erros de JS " + JSON.stringify(erros));
  await page.context().close();

  // ---------- PÁGINAS DE PAGAMENTO / RECIBO ----------
  console.log("PAGAR / RECIBO");
  ({ page, erros } = await abrir("pagar.html", { user: ana, store }, "?id=a2"));
  ok(await page.locator("#estado-pedido").isVisible(), "pagar.html mostra o resumo da aula aceita");
  ok((await page.locator("#p-total").textContent()).includes("100,00"), "total R$ 100,00");
  await page.context().close();
  ({ page, erros } = await abrir("pagar.html", { user: { uid: "intruso" }, store }, "?id=a2"));
  ok((await page.locator("#msg").textContent()).includes("outra conta"), "outro usuário não paga aula alheia");
  await page.context().close();
  ({ page, erros } = await abrir("pagar.html", { user: ana, store }, "?id=a3"));
  ok(await page.locator("#estado-ok").isVisible(), "aula já paga mostra confirmação");
  ok((await page.locator("#link-recibo").getAttribute("href")) === "recibo.html?id=r1", "link do recibo certo");
  await page.context().close();
  const st2 = { ...store, "recibos/r1": { numeroFmt: "000001", serie: "A1", alunoUid: "ana", aluno: { nome: "Ana", email: "ana@x.com" }, personal: { nome: "Leo", cref: "123-G/SP", documentoMascarado: "***.982.247-**" }, servico: { descricao: "Aula de personal trainer — Corrida", local: "Academia Y", data: dia(-2), horario: "08:00–09:00" }, valores: { valor: 6000, taxaFixa: 0, total: 6000 }, pagamento: { metodo: "pix", mpPaymentId: "999" }, emitidoEm: { toDate: () => new Date() } } };
  ({ page, erros } = await abrir("recibo.html", { user: ana, store: st2 }, "?id=r1"));
  ok(await page.locator("#recibo").isVisible(), "recibo.html renderiza");
  const rt = await page.locator("#recibo").textContent();
  ok(rt.includes("000001") && rt.includes("***.982.247-**") && rt.includes("60,00") && rt.includes("NFS-e"), "recibo com número, CPF mascarado, valor e aviso fiscal");
  ok(erros.length === 0, "sem erros de JS " + JSON.stringify(erros));
  await page.context().close();

  await browser.close(); srv.close();
  console.log(falhas ? `\n❌ ${falhas} verificação(ões) falharam` : "\n✅ e2e: todas as verificações passaram");
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
