// Proxy de autenticação do Firebase (recomendado pela documentação para signInWithRedirect).
// Repassa /__/auth/* (handler, iframe, scripts) e /__/firebase/init.json ao domínio do Firebase, para que o login por redirecionamento
// aconteça no MESMO domínio do site. Sem isso, Chrome/Safari bloqueiam o armazenamento entre sites e getRedirectResult volta vazio.
// Requisitos: (1) no front, authDomain = host do site (config.js já faz isso em *.onrender.com);
//             (2) Google Cloud › Credenciais › cliente OAuth Web: adicionar https://SEU-SERVICO.onrender.com/__/auth/handler em "URIs de redirecionamento autorizados";
//             (3) Firebase › Authentication › Configurações › Domínios autorizados: incluir SEU-SERVICO.onrender.com.
// Deve ser montado ANTES do middleware de cabeçalhos de segurança: a página do handler traz o próprio CSP/COOP e não pode receber os nossos.
const PREFIXOS = ["/__/auth/", "/__/firebase/"];

function criarAuthProxy({ projectId, fetchImpl = globalThis.fetch }) {
  const destino = `https://${projectId}.firebaseapp.com`;
  return async function authProxy(req, res, next) {
    if (!PREFIXOS.some((p) => req.path.startsWith(p)) || !["GET", "HEAD"].includes(req.method)) return next();
    try {
      const r = await fetchImpl(destino + req.originalUrl, { method: req.method, headers: { "user-agent": req.get("user-agent") || "", "accept-language": req.get("accept-language") || "" }, redirect: "manual" });
      res.status(r.status);
      for (const h of ["content-type", "cache-control", "location", "content-security-policy", "cross-origin-opener-policy", "x-frame-options"]) {
        const v = r.headers.get(h); if (v) res.setHeader(h, h === "location" ? v.replace(destino, "") : v);
      }
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { console.error("auth-proxy:", e.message); res.status(502).type("text/plain").send("Falha ao falar com o serviço de autenticação."); }
  };
}
module.exports = { criarAuthProxy };
