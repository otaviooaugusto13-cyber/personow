// ============================================================
// CONFIGURAÇÃO ÚNICA DO PERSONOW
// Tudo que você pode querer ajustar sem mexer no resto do código.
// ============================================================

// ---- Regras de negócio (espelho de server/regras.js; `npm test` falha se divergirem) ----
export const COMISSAO_PCT = 15;               // % da aula que fica com a plataforma
export const TAXA_FIXA_CENTAVOS = 0;          // taxa fixa por aula paga pelo aluno (0 = desligada)
export const DURACAO_MIN_MINUTOS = 30;
export const DURACAO_MAX_MINUTOS = 180;
export const VALOR_MINIMO_CENTAVOS = 3000;    // R$ 30,00
export const VALOR_MAXIMO_CENTAVOS = 100000;  // R$ 1.000,00
export const EXCLUSIVIDADE_MINUTOS = 5;
export const MAX_AULAS_ABERTAS_ALUNO = 5;
export const FOCOS = [
    { v: "Musculação", ico: "💪" },
    { v: "Hipertrofia", ico: "🔥" },
    { v: "Emagrecimento", ico: "⚡" },
    { v: "Corrida", ico: "🏃‍♂️" },
    { v: "Funcional", ico: "🤸‍♂️" },
    { v: "Avaliação Física", ico: "📋" }
];

// ---- Empresa que aparece no recibo da aula ----
export const EMPRESA = {
    razaoSocial: "PERSONOW INTERMEDIAÇÃO DE AULAS LTDA",   // ← preencha com os dados reais
    cnpj: "00.000.000/0001-00",
    cidade: "Itapira / SP",
    email: "contato@personow.com.br"
};

// ---- Contato / suporte (só dígitos, com 55 + DDD) ----
export const WHATSAPP_SUPORTE = "5519999999999";

// ---- Firebase (chave pública por natureza; a segurança vem do firestore.rules) ----
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA2PVDpo4X3G8ok_Mk5MU1WeRUaxwIhEpg",
    authDomain: "app-diego-e0591.firebaseapp.com",
    projectId: "app-diego-e0591",
    storageBucket: "app-diego-e0591.firebasestorage.app",
    messagingSenderId: "69109305372",
    appId: "1:69109305372:web:5139a52f1342671c520fd9",
    measurementId: "G-P2J3HHKK2R"
};

// ---- Servidor de pagamentos (Render) ----
// O servidor (server/server.js) também serve o site. Aberto em *.onrender.com ou localhost,
// a API é a MESMA origem. Em outro domínio (GitHub Pages…), usa a URL fixa abaixo.
const URL_RENDER = "https://personow.onrender.com";   // ← confira o endereço exato no painel do Render
const mesmaOrigem = typeof location !== "undefined" && /^(.+\.onrender\.com|localhost|127\.0\.0\.1)$/.test(location.hostname);
export const FUNCTIONS_BASE = mesmaOrigem ? location.origin : URL_RENDER;

// Emuladores locais (só testes): abra o app com ?emulador=1 em localhost.
export const USAR_EMULADOR = typeof location !== "undefined" && location.hostname === "localhost" && new URLSearchParams(location.search).has("emulador");

// ---- Localização e ranking (adaptado do Abastece Já) ----
export const RAIO_KM_AULAS = 20;                   // "Perto de mim": pedidos até 20 km da posição do personal
export const LOCAL_MAX_IDADE_MS = 120_000;         // posição em cache aceita por até 2 min (economiza bateria)
export const ANOS_EXPERIENCIA_MAX = 50;            // espelho de PERFIL_ANOS_MAX no servidor
