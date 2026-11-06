// ============================================================
// CONFIGURAÇÃO ÚNICA DO PERSONOW
// Tudo que você pode querer ajustar sem mexer no resto do código.
// ============================================================

// ---- Regras de negócio (VALORES PADRÃO) ---------------------
// Estes números são só o PADRÃO: semente inicial e plano B offline do app. Quem manda de verdade é o painel admin
// (Configurações → Taxas da plataforma), que grava em configuracoes/taxas no Firestore; o app busca em GET /config/taxas
// (taxas.js) e o servidor lê do banco (server/lib/taxas.js). Mudar valores NÃO exige editar código nem reiniciar.
// Padrão atual (centavos): aluno paga R$ 100,00 = comissão R$ 25,00 + repasse R$ 75,00 (75% para o personal). Suposição de negócio: ajuste no painel admin.
// `npm test` ainda confere que este padrão é idêntico ao de server/split.js.
export const VALOR_AULA_CENTAVOS = 10000;
export const COMISSAO_PLATAFORMA_CENTAVOS = 2500;
export const REPASSE_PERSONAL_CENTAVOS = 7500;
export const TAXA_FIXA_CENTAVOS = 0;                 // sem taxa extra para o aluno
export const HORAS_MIN_AULA = 0.5;                  // duração mínima da aula, em horas (ajuste aqui e em server/split.js)
export const HORAS_MAX_AULA = 3;                    // duração máxima da aula, em horas
export const MAX_VEZES_SEMANA_ALUNO = 5;             // máx. de aulas do mesmo personal com o mesmo aluno por semana

// ---- Níveis de confiabilidade (espelho de server/split.js; `npm test` falha se divergirem) ----
// Bronze (início) 25% · Prata (30 chamados) 20% · Ouro (+60) 15% · Platina (+100) 10% de comissão da plataforma.
export const CHAMADOS_PARA_SUBIR = [30, 60, 100];
const NIVEIS_BASE = [
    { id: "bronze", nome: "Bronze", comissaoPct: 25 },
    { id: "prata", nome: "Prata", comissaoPct: 20 },
    { id: "ouro", nome: "Ouro", comissaoPct: 15 },
    { id: "platina", nome: "Platina", comissaoPct: 10 }
];
export const NIVEIS = NIVEIS_BASE.map((n, i) => ({ ...n, minConcluidos: CHAMADOS_PARA_SUBIR.slice(0, i).reduce((a, b) => a + b, 0) }));

// ---- Geofencing / reputação / relampago (o servidor decide; aqui só para exibir) ----
export const GEO_RAIO_METROS = 100;
export const CANCELAMENTO_TARDIO_HORAS = 12;                // espelho de server/lib/config.js
export const VIDAS_MAX = 3;
export const BONUS_RELAMPAGO_CENTAVOS = [1000, 1500, 2500];   // espelho de server/lib/config.js → RELAMPAGO.BONUS_OPCOES_CENTAVOS
export const FCM_VAPID_KEY = "";                            // Firebase Console → Configurações → Cloud Messaging → Certificados push da Web. Vazio = sem push com o app fechado.

// ---- Compliance profissional (o servidor valida de novo) --------
export const IDADE_MINIMA = 18;                      // personal trainer: profissão regulamentada (Lei 9.696/1998), cadastro só para maiores de 18
export const CREF_REGEX = /^\d{4,6}-[GP]\/[A-Z]{2}$/;   // ex.: 012345-G/SP (o admin confere no CONFEF antes de aprovar)
export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

// ---- Aulas por localização -------------------------------
// Google Maps (mapa da tela inicial do aluno). Chave da "Maps JavaScript API": no Google Cloud, restrinja por REFERRER HTTP ao(s) domínio(s) do app
// e só à API "Maps JavaScript API" (chave de navegador é pública por natureza — a restrição é a proteção). Vazia = usa o mapa gratuito OpenStreetMap.
export const GOOGLE_MAPS_KEY = "";
export const RAIO_KM_AULAS = 20;                   // "Perto de mim": só aulas até 20 km da posição do personal
export const LOCAL_MAX_IDADE_MS = 120_000;           // posição em cache aceita por até 2 min (economiza bateria)
export const LOCAL_MOVIMENTO_MIN_KM = 0.2;           // só recalcula o ranking se o personal andou mais que 200 m

// ---- Eneagrama (teste de perfil comportamental) ----------------------
// Se o teste estiver hospedado (ex.: GitHub Pages), informe a URL https para ele abrir DENTRO do app (modal com iframe).
// O servidor precisa liberar a origem: defina ENEAGRAMA_TESTE_ORIGEM no Render com a mesma origem. Vazio = só seleção manual/código.
export const ENEAGRAMA_TESTE_URL = "";
export const ENEAGRAMA_TESTE_ORIGEM = (() => { try { return ENEAGRAMA_TESTE_URL ? new URL(ENEAGRAMA_TESTE_URL).origin : ""; } catch (e) { return ""; } })();

// ---- Empresa emissora da nota ------------------------------
// Aparece no cabeçalho da Nota de Serviço. Preencha com os dados reais.
export const EMPRESA = {
    razaoSocial: "PERSONOW INTERMEDIAÇÃO DE SERVIÇOS LTDA",
    cnpj: "00.000.000/0001-00",
    cidade: "Itapira / SP",
    email: "otaviooaugusto13@gmail.com"
};

// ---- Contato / suporte -------------------------------------
export const WHATSAPP_SUPORTE = "551995350637"; // só dígitos, com 55 + DDD
export const NOME_SUPORTE = "Suporte TI";        // nome que o usuário vê nas mensagens da equipe

// ---- Firebase (chave pública por natureza; a segurança vem das regras do Firestore) ----
// PREENCHA com o app Web do SEU projeto Firebase do Personow (Console → Configurações do projeto → Seus apps → Config).
// Enquanto houver "COLE_AQUI", o app avisa na tela de login em vez de falhar sem explicação.
const PROJETO_FIREBASE = "app-diego-e0591";
const _hostApp = typeof location !== "undefined" && /^([\w-]+\.)*onrender\.com$/.test(location.hostname) ? location.host : null;
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA2PVDpo4X3G8ok_Mk5MU1WeRUaxwIhEpg",
    // signInWithRedirect: o domínio de autenticação precisa ser o MESMO do site (senão Chrome/Safari bloqueiam o armazenamento entre sites e o login "volta vazio").
    // No Render o servidor repassa /__/auth/* ao Firebase (server/lib/auth-proxy.js), então usamos o próprio host do site.
    authDomain: _hostApp || `${PROJETO_FIREBASE}.firebaseapp.com`,
    projectId: PROJETO_FIREBASE,
    storageBucket: `${PROJETO_FIREBASE}.firebasestorage.app`,
    messagingSenderId: "69109305372",
    appId: "1:69109305372:web:5139a52f1342671c520fd9"
};
export const FIREBASE_CONFIGURADO = ![FIREBASE_CONFIG.apiKey, FIREBASE_CONFIG.projectId, FIREBASE_CONFIG.appId].some((v) => String(v).startsWith("COLE_AQUI"));

// ---- Servidor (Render) ---------------------------------------
// O servidor (server/server.js) também serve o site. Se o app está aberto em *.onrender.com
// ou em localhost, a API é a MESMA origem — assim nunca dá "Not Found" por URL digitada errada.
// Em qualquer outro domínio (GitHub Pages etc.), usa a URL fixa abaixo: confira no painel do
// Render o endereço EXATO do serviço (render.yaml cria "personow").
const URL_RENDER = "https://personow.onrender.com";
const mesmaOrigem = typeof location !== "undefined" && /^(([\w-]+\.)*onrender\.com|localhost|127\.0\.0\.1)$/.test(location.hostname);
export const FUNCTIONS_BASE = mesmaOrigem ? location.origin : URL_RENDER;

// ---- Cadastro de cartão (produção) ---------------------------
// Chave PÚBLICA da aplicação no Mercado Pago (Credenciais de produção → Public Key). Pode ficar no código.
// Sem ela, só o cartão de teste (modo sandbox) funciona. No servidor também é preciso MP_ACCESS_TOKEN.
export const MP_PUBLIC_KEY = "";

// ---- Emuladores locais do Firebase (só para testes; ver DEPLOY-RENDER.md) ----
// Abra o app com ?emulador=1 em localhost para usar Auth/Firestore locais.
export const USAR_EMULADOR = typeof location !== "undefined" && location.hostname === "localhost" && new URLSearchParams(location.search).has("emulador");

// ---- Rotas dos painéis ---------------------------------------
// URLs públicas: /painel-aluno e /painel-personal (o servidor Render e o Firebase Hosting as mapeiam para index.html / personal.html).
// Hospedou o front SEM servidor/rewrites (GitHub Pages etc.)? Troque para false: usa os arquivos .html diretamente.
export const ROTAS_LIMPAS = true;
export const ROTAS = ROTAS_LIMPAS
    ? { aluno: "/painel-aluno", personal: "/painel-personal", admin: "/admin.html", ti: "/painel-ti" }
    : { aluno: "index.html", personal: "personal.html", admin: "admin.html", ti: "ti.html" };
