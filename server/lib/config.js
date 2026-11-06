// Constantes de compliance e operação. Valores financeiros ficam em ../split.js.
// AMBIENTE, quando informado, manda: o Render define NODE_ENV=production por padrão, então AMBIENTE=homolog precisa vencer para o modo de teste funcionar.
const PRODUCAO = process.env.AMBIENTE ? process.env.AMBIENTE === "producao" : process.env.NODE_ENV === "production";
const inteiro = (v, padrao) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : padrao; };

module.exports = {
  PRODUCAO,

  // Emitente dos comprovantes. Espelho de EMPRESA em ../../config.js (test/split.test.js confere).
  EMPRESA: { razaoSocial: "PERSONOW INTERMEDIAÇÃO DE SERVIÇOS LTDA", cnpj: "00.000.000/0001-00", cidade: "Itapira / SP", email: "otaviooaugusto13@gmail.com" },

  // ---- Modalidades de aula (espelho de MODALIDADES em ../../core.js; test/split.test.js confere) ----
  MODALIDADES: ["Musculação", "Treino funcional", "Emagrecimento", "Corrida e endurance", "Pilates", "Yoga", "Lutas e artes marciais", "Dança e ritmos", "Reabilitação e pós-lesão", "Consultoria de treino online", "Avaliação física"],

  // ---- Habilitação por categoria (vídeo + questionário 100%) ----
  // Cada MODALIDADE de aula exige a habilitação da sua categoria. Espelho em ../../core.js (CATEGORIAS / MODALIDADE_CATEGORIA); test/split.test.js confere.
  CATEGORIAS: {
    musculacao:  { titulo: "Musculação",          ico: "🏋️" },
    funcional:   { titulo: "Funcional",           ico: "🔥" },
    endurance:   { titulo: "Corrida e endurance", ico: "🏃" },
    mentecorpo:  { titulo: "Mente e corpo",       ico: "🧘" },
    lutas:       { titulo: "Lutas",               ico: "🥊" },
    consultoria: { titulo: "Consultoria",         ico: "💻" }
  },
  MODALIDADE_CATEGORIA: {
    "Musculação": "musculacao", "Treino funcional": "funcional", "Corrida e endurance": "endurance", "Pilates": "mentecorpo", "Yoga": "mentecorpo",
    "Lutas e artes marciais": "lutas", "Consultoria de treino online": "consultoria",
    // modalidades sem categoria própria herdam a mais próxima: DECISÃO DE NEGÓCIO. Trocar aqui se preferir outro enquadramento.
    "Emagrecimento": "funcional", "Dança e ritmos": "funcional", "Reabilitação e pós-lesão": "mentecorpo", "Avaliação física": "consultoria"
  },
  HAB_MARGEM_SEG: 3,            // timer = duração do vídeo + 3 s
  HAB_FOLGA_SEG: 10,            // distância máxima entre a posição do vídeo e o trecho já validado para continuar creditando
  HAB_PING_EVENTO_MIN_MS: 1000, // pings de play/pause (âncora) podem vir mais rápido que os periódicos
  HAB_TOLERANCIA_FIM_SEG: 4,    // quanto falta para "chegou ao fim" (jitter dos pings)
  HAB_QUIZ_VALIDADE_MS: 20 * 60_000,   // depois de liberado, o questionário vale 20 min; vencido = refazer o treinamento
  HAB_PERGUNTAS_MIN: 3, HAB_PERGUNTAS_MAX: 4, HAB_OPCOES_MIN: 2, HAB_OPCOES_MAX: 5,

  // ---- Perfil inteligente (espelho de AREAS_EXPERIENCIA em ../../perfil-inteligente.js; test/perfil.test.js confere) ----
  AREAS_EXPERIENCIA: [
    "Musculação / Hipertrofia", "Emagrecimento", "Treino funcional", "Corrida e endurance", "Pilates", "Yoga",
    "Lutas e artes marciais", "Dança e ritmos", "Reabilitação e pós-lesão", "Gestantes e idosos", "Preparação esportiva", "Consultoria online"
  ],
  ENEAGRAMA_INSTINTOS: ["SP", "SX", "SO"],
  PERFIL_MAX_EXPERIENCIAS: 8,
  PERFIL_MAX_PALAVRAS: 12,

  // ---- Cursos (categorias do catálogo de capacitação; "habilitacao" = obrigatório para aceitar aulas) ----
  CURSO_CATEGORIAS: ["habilitacao", "tecnica", "saude", "atendimento", "seguranca", "carreira", "geral"],

  // Rótulo exibido no app para cada modalidade (espelho de MODALIDADES[].label em ../../core.js; test/split.test.js confere).
  MODALIDADES_ROTULO: { "Treino funcional": "Funcional", "Corrida e endurance": "Corrida", "Lutas e artes marciais": "Lutas", "Dança e ritmos": "Dança", "Reabilitação e pós-lesão": "Reabilitação", "Consultoria de treino online": "Consultoria online" },

  // ---- Idade e registro profissional ----
  // Personal trainer é profissão regulamentada (Lei 9.696/1998): o registro no CREF exige formação superior, então o cadastro é só para maiores de 18.
  IDADE_MINIMA: 18,
  IDADE_MAXIMA_PLAUSIVEL: 100, // trava contra datas absurdas (1900-01-01 etc.)
  CREF_REGEX: /^\d{4,6}-[GP]\/[A-Z]{2}$/,   // ex.: 012345-G/SP (G = graduado, P = provisionado). O admin confere no sistema do CONFEF antes de aprovar.
  UFS: ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"],

  // ---- Capacitação Personow ----
  TREINO_PCT_MINIMO: 90,       // % mínimo do vídeo efetivamente assistido (tempo real validado no servidor)
  TREINO_PING_MAX_SEG: 30,     // um ping nunca credita mais que isso, mesmo que o cliente demore
  TREINO_PING_MIN_INTERVALO_MS: 4000,

  // ---- Carteira ----
  LIBERACAO_DIAS: inteiro(process.env.LIBERACAO_DIAS, 2),          // carência até o saldo ficar sacável
  SAQUE_MINIMO_CENTAVOS: inteiro(process.env.SAQUE_MINIMO_CENTAVOS, 2000),
  SAQUE_MAXIMO_CENTAVOS: inteiro(process.env.SAQUE_MAXIMO_CENTAVOS, 500000),
  PLATAFORMA_UID: "PLATAFORMA",
  CONTAS_TESTE: ["teste-aluno", "teste-personal"],   // sandbox (MODO_TESTE): nunca sofrem multa/advertência nem geofence

  // ---- Check-in / check-out (geofencing + foto do local) ----
  GEO: {
    RAIO_METROS: 100,                 // o personal só inicia a aula a até 100 m do aluno
    PRECISAO_MAX_M: 100,              // leitura de GPS pior que isso (±m) é recusada: não prova presença
    FIX_IDADE_MAX_MS: 120_000,        // a leitura de GPS precisa ser recente (idade medida no próprio aparelho)
    CHECKIN_ANTES_MIN: 30,            // check-in abre 30 min antes do início da aula
    CHECKIN_ATE_MIN: 60,              // ...e fecha 60 min depois: sem check-in até aí = falta injustificada
    PERMANENCIA_MIN_PCT: 50,          // check-out só depois de 50% da duração da aula no local (anti "check-in/out relâmpago")
    PERMANENCIA_MIN_RELAMPAGO_MIN: 30,  // chamado relâmpago: 30 min no local
    FALTA_ALUNO_APOS_MIN: 20           // o personal só pode reportar "aluno ausente" depois de 20 min com check-in feito
  },
  FOTO: {
    MAX_BYTES: 560_000,               // JPEG do local da aula (o Firestore limita o documento a 1 MiB, e a imagem vai em base64)
    MIN_BYTES: 8_000, LADO_MIN: 480, LADO_MAX: 4096,
    MINIATURA_MAX_BYTES: 40_000
  },
  CONCLUSAO: ["completa", "parcial"],      // declarado pelo personal no check-out (o aluno pode contestar)

  // ---- Reputação: advertências, "vidas", multas e banimento ----
  VIDAS_MAX: 3,                       // 3ª advertência = banimento automático
  CANCELAMENTO_TARDIO_HORAS: 12,      // desistir/cancelar com menos de 12 h do início (ou depois dele) = "em cima da hora"
  MULTAS_CENTAVOS: { desistencia_tardia: 1500, falta_personal: 2500, cancelamento_tardio_aluno: 2000, falta_aluno: 2500 },
  INFRACAO_ROTULO: {
    desistencia_tardia: "Desistência de aula em cima da hora",
    falta_personal: "Falta injustificada em aula aceita",
    cancelamento_tardio_aluno: "Cancelamento de aula em cima da hora",
    falta_aluno: "Falta do aluno: o personal chegou ao local e o serviço não foi realizado"
  },
  INFRACAO_PAPEL: { desistencia_tardia: "personal", falta_personal: "personal", cancelamento_tardio_aluno: "aluno", falta_aluno: "aluno" },

  // ---- Níveis: inatividade ----
  INATIVIDADE_DIAS: 60,               // 2 meses sem concluir chamados
  INATIVIDADE_MODO: ["resetar", "rebaixar"].includes(process.env.INATIVIDADE_MODO) ? process.env.INATIVIDADE_MODO : "rebaixar",   // rebaixar = cai 1 nível por período inativo; resetar = volta ao Bronze

  // ---- Chamado relâmpago (relampago) ----
  RELAMPAGO: {
    BONUS_OPCOES_CENTAVOS: [1000, 1500, 2500],   // bônus de urgência pago pelo aluno e repassado 100% ao personal
    EXPIRA_MIN: 30,                              // sem aceite em 30 min o chamado expira (sem multa)
    RAIO_KM: 5,                                  // alcance do disparo
    POSICAO_VALIDADE_H: 24,                      // posição do personal mais antiga que isso não conta como "perto"
    DURACAO_MIN: 60,
    MAX_ABERTOS_POR_ALUNO: 3,
    MAX_PUSH: 200
  },

  // ---- Mapa de personais online (painel do aluno) ----
  // RAIO_KM espelha RAIO_KM_AULAS de ../../config.js (test/mapa.test.cjs confere). GRADE_M: a posição do personal é ARREDONDADA para o centro de
  // uma grade de ~300 m ASSIM QUE CHEGA ao servidor — a posição exata nunca é guardada nem devolvida a ninguém.
  MAPA: { RAIO_KM: 20, GRADE_M: 300, MAX_PONTOS: 40, PRECISAO_MAX_M: 2000 },

  // ---- Segurança ----
  AUTH_RECENTE_SEG: 300,       // operações sensíveis exigem login nos últimos 5 min
  ADMIN_EXIGE_MFA: ["1", "true"].includes(String(process.env.ADMIN_EXIGE_MFA || "").toLowerCase()),
  BODY_LIMITE: "20kb",
  BODY_FOTO_LIMITE: "1mb"             // só a rota /checkout (foto do local da aula)
};
