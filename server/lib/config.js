// Constantes de operação e segurança. Regras de negócio/dinheiro ficam em ../regras.js (não duplicar aqui).
const PRODUCAO = process.env.AMBIENTE === "producao" || process.env.NODE_ENV === "production";

module.exports = {
  PRODUCAO,

  // ---- Geolocalização (caixa do Brasil: rejeita coordenadas absurdas) ----
  GEO: { LAT_MIN: -34, LAT_MAX: 6, LNG_MIN: -74, LNG_MAX: -28 },

  // ---- Perfil do personal ----
  IDADE_MINIMA_PERSONAL: 18,          // CREF exige maioridade
  IDADE_MAXIMA_PLAUSIVEL: 100,
  PERFIL_MAX_EXPERIENCIAS: 6,         // uma por foco (config.js → FOCOS)
  PERFIL_MAX_PALAVRAS: 12,
  PERFIL_MAX_BIO: 300,
  PERFIL_ANOS_MAX: 50,

  // ---- Segurança ----
  AUTH_RECENTE_SEG: 300,              // operações sensíveis (admin) exigem login nos últimos 5 min
  ADMIN_EXIGE_MFA: ["1", "true"].includes(String(process.env.ADMIN_EXIGE_MFA || "").toLowerCase()),
  BODY_LIMITE: "20kb"
};
