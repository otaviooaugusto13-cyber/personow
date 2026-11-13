// Sonda de UAT: matriz rota × papel + fuzz de entrada. Não altera o projeto.
const crypto = require("node:crypto"), fs = require("node:fs"), path = require("node:path");
const ROOT = "/home/claude/personow-main";
process.env.AMBIENTE = "teste"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const E = require(ROOT + "/test/fake-env.cjs");
const { chamar } = E.carregarServidor();

// rotas montadas = as do loop do server.js (sem "teste": MODO_TESTE desligado)
const srv = fs.readFileSync(ROOT + "/server/server.js", "utf8");
const montadas = [...srv.match(/for \(const rota of \[([^\]]+)\]/)[1].matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]).filter((r) => r !== "teste");
const rotas = [];
for (const r of montadas) {
  const src = fs.readFileSync(`${ROOT}/server/rotas/${r}.js`, "utf8");
  for (const m of src.matchAll(/app\.(get|post|put|delete)\(\s*["'`]([^"'`]+)["'`]/g)) rotas.push({ arq: r, metodo: m[1].toUpperCase(), rota: m[2] });
}
rotas.push({ arq: "server", metodo: "GET", rota: "/saude" });

const U = { anon: null, aluno: "tAluno", personal: "tPersonal", admin: "tAdmin", ti: "tTi" };
E.limpar();
Object.assign(E.tokens, { tAluno: { uid: "uA", email: "a@x.com", email_verified: true }, tPersonal: { uid: "uP", email: "p@x.com", email_verified: true }, tAdmin: { uid: "uAdm", email: "adm@x.com", email_verified: true }, tTi: { uid: "uTi", email: "ti@x.com", email_verified: true } });
E.claimsStore.uA = { role: "aluno" }; E.claimsStore.uP = { role: "personal", treinado: true }; E.claimsStore.uAdm = { role: "admin" }; E.claimsStore.uTi = { role: "ti" };
const caminho = (r) => r.replace(/:[A-Za-z]+/g, "x1");

(async () => {
  const linhas = [], achados = [];
  for (const r of rotas) {
    const res = {};
    for (const [papel, tk] of Object.entries(U)) {
      const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1`;
      let s; try { s = (await chamar(r.metodo, caminho(r.rota), { token: tk, body: {}, ip, headers: { "x-cron-secret": "errado" } })).status; } catch (e) { s = "EXC"; }
      res[papel] = s;
    }
    linhas.push({ ...r, ...res });
    if (Object.values(res).some((s) => s === 500 || s === "EXC")) achados.push({ tipo: "5xx", ...r, res });
    if (res.anon >= 200 && res.anon < 300) achados.push({ tipo: "anon-2xx", ...r, res });
  }
  fs.writeFileSync("/home/claude/probe/matriz.json", JSON.stringify({ linhas, achados }, null, 1));
  console.log("rotas sondadas:", rotas.length);
  console.log("\nROTAS QUE RESPONDEM 2xx SEM LOGIN:"); for (const a of achados.filter((x) => x.tipo === "anon-2xx")) console.log(" ", a.metodo, a.rota, JSON.stringify(a.res));
  console.log("\nROTAS COM 5xx / EXCEÇÃO (corpo vazio):"); for (const a of achados.filter((x) => x.tipo === "5xx")) console.log(" ", a.metodo, a.rota, JSON.stringify(a.res));

  // Fuzz: corpo com tipos errados, para cada papel que NÃO foi barrado (401/403/404)
  const lixos = [{ valor: "abc", id: {}, uid: [], texto: 123, email: null, motivo: {}, respostas: "x", lat: "a", lng: [] }, { __proto__: null, a: 1 }, { texto: "x".repeat(200000) }, [], "string-solta"];
  const f5 = new Map();
  for (const r of rotas) for (const [papel, tk] of Object.entries(U)) {
    if (!tk) continue;
    for (const [i, b] of lixos.entries()) {
      const ip = `11.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1`;
      let s, j; try { const x = await chamar(r.metodo, caminho(r.rota), { token: tk, body: b, query: { mes: {}, q: [] }, ip }); s = x.status; j = x.json; } catch (e) { s = "EXC"; j = { erro: String(e.message).slice(0, 80) }; }
      if (s === 500 || s === "EXC") { const k = `${r.metodo} ${r.rota}`; if (!f5.has(k)) f5.set(k, { papel, corpo: i, resp: JSON.stringify(j).slice(0, 110) }); }
    }
  }
  console.log("\nFUZZ — rotas que devolvem 500/exceção com entrada malformada:", f5.size);
  for (const [k, v] of f5) console.log(" ", k, "→", JSON.stringify(v));
  process.exit(0);
})();
