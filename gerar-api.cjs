const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.APP_URL = "https://app.exemplo.com"; process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "s"; process.env.CRON_SECRET = "c";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const E = require("/home/claude/personow-main/test/fake-env.cjs"); const { chamar, ctx } = E.carregarServidor();
(async () => {
  E.limpar(); Object.assign(E.tokens, { tP: { uid: "leo", email: "l@x.com", email_verified: true }, tA: { uid: "ana", email: "a@x.com", email_verified: true } });
  E.claimsStore.leo = { role: "personal", treinado: true }; E.claimsStore.ana = { role: "aluno" };
  await ctx.db.collection("personais").doc("leo").set({ uid: "leo", nome: "Leo Personal", status: "ativo", cref: "123-G/SP" });
  const out = {}; let n = 0;
  for (const [k, tk, m, p] of [["rep_p", "tP", "GET", "/reputacao"], ["rep_a", "tA", "GET", "/reputacao"], ["hab", "tP", "GET", "/habilitacao"], ["habs", "tP", "GET", "/habilitacoes"], ["cart", "tP", "GET", "/carteira"], ["taxas", null, "GET", "/config/taxas"], ["inteligente", "tP", "GET", "/perfil/personal/inteligente"], ["mapa", "tA", "GET", "/personais/online"]]) {
    const r = await chamar(m, p, { token: tk, ip: `1.1.1.${++n}` }); out[k] = { status: r.status, corpo: r.json };
  }
  require("fs").writeFileSync("api-real.json", JSON.stringify(out, null, 1)); console.log(Object.entries(out).map(([k, v]) => `${k}:${v.status}`).join("  "));
  process.exit(0);
})();
