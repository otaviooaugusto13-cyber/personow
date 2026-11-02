#!/usr/bin/env node
// Cria (sem sobrescrever) as 6 categorias de habilitação com perguntas-modelo. Elas nascem INATIVAS e sem vídeo:
// abra Admin → Habilitações, informe o vídeo e a duração REAL, revise as perguntas com um profissional de Educação Física (CREF) e marque "ativa".
//   Uso:  FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/semear-categorias.js
const admin = require("firebase-admin");
const C = require("../server/lib/config");
const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!bruto) { console.error("Defina FIREBASE_SERVICE_ACCOUNT (JSON ou base64)."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8"))) });

const q = (texto, opcoes, correta) => ({ texto, opcoes, correta });
const MODELO = {
  musculacao: [
    q("Antes de iniciar o treino de um aluno novo, o que é essencial fazer?", ["Começar direto com cargas altas", "Fazer anamnese e avaliar histórico de lesões, doenças e limitações", "Copiar o treino de outro aluno", "Pular o aquecimento para ganhar tempo"], 1),
    q("O aluno sente dor aguda e localizada na articulação durante o exercício. O que fazer?", ["Pedir que continue até passar", "Aumentar a carga para compensar", "Interromper o exercício, avaliar e orientar a procurar atendimento se persistir", "Ignorar: dor faz parte"], 2),
    q("Qual é a prioridade ao ensinar um exercício com carga?", ["Carga máxima desde a primeira série", "Execução correta e controlada antes de progredir a carga", "Velocidade de execução", "Número de repetições a qualquer custo"], 1)
  ],
  funcional: [
    q("Em um circuito funcional, como organizar o espaço da aula?", ["Equipamentos espalhados pelo chão", "Área livre de obstáculos, com estações e distâncias seguras", "Treinar em local escorregadio", "Não importa o espaço"], 1),
    q("O aluno está muito ofegante e tonto no meio do circuito. O que fazer?", ["Pedir mais uma rodada", "Interromper, sentá-lo, oferecer água e reavaliar se deve continuar", "Dar um energético", "Ignorar e acelerar o ritmo"], 1),
    q("Como progredir a intensidade de forma segura?", ["Dobrar tudo de uma vez", "Aumentar gradualmente volume, carga ou complexidade", "Manter sempre igual", "Trocar todos os exercícios a cada aula"], 1)
  ],
  endurance: [
    q("Qual é o cuidado essencial antes de uma corrida em dia muito quente?", ["Não beber água para não pesar", "Hidratar-se, escolher horário mais ameno e adaptar o ritmo", "Usar várias camadas de roupa", "Aumentar a distância"], 1),
    q("Um aluno iniciante quer correr 10 km na primeira semana. Qual é a conduta?", ["Aceitar: motivação é tudo", "Montar progressão gradual de volume e intensidade", "Mandar correr até cansar", "Evitar qualquer aquecimento"], 1),
    q("Ao treinar na rua, qual medida de segurança é adequada?", ["Escolher locais com boa visibilidade e atenção ao trânsito", "Correr no meio da via", "Usar fones no volume máximo", "Treinar sempre à noite sem iluminação"], 0)
  ],
  mentecorpo: [
    q("Em uma aula de pilates ou yoga, o aluno relata gravidez. Qual é a conduta?", ["Seguir o treino normal", "Adaptar os exercícios e pedir liberação médica", "Encerrar o atendimento sem orientar", "Aumentar a intensidade"], 1),
    q("O que priorizar ao ensinar respiração e postura?", ["Pressa para completar a sequência", "Consciência corporal, respiração e alinhamento respeitando os limites do aluno", "Amplitude máxima sempre", "Comparação com outros alunos"], 1),
    q("O aluno tem dor lombar aguda. O que fazer?", ["Forçar a flexão da coluna", "Evitar movimentos que agravem, adaptar e recomendar avaliação profissional", "Ignorar", "Dobrar a carga"], 1)
  ],
  lutas: [
    q("Qual regra de segurança é fundamental em treinos de luta?", ["Contato máximo desde o início", "Proteções adequadas, contato progressivo e regras claras", "Sem aquecimento", "Treinar sem supervisão"], 1),
    q("O aluno bateu a cabeça e está confuso. O que fazer?", ["Voltar a lutar", "Interromper imediatamente e acionar atendimento de saúde", "Esperar passar sozinho", "Dar mais uma rodada"], 1),
    q("Como lidar com aluno iniciante e aluno avançado no mesmo treino?", ["Colocá-los em contato pleno", "Ajustar intensidade e emparelhar com critério para evitar lesões", "Ignorar o nível", "Evitar qualquer orientação"], 1)
  ],
  consultoria: [
    q("Ao montar uma consultoria de treino online, o que é indispensável?", ["Enviar planilha padrão a todos", "Coletar objetivos, histórico de saúde e disponibilidade do aluno", "Prometer resultados garantidos", "Dispensar acompanhamento"], 1),
    q("Qual cuidado ao receber dados e fotos do aluno?", ["Divulgar nas redes sem pedir", "Tratar como dados pessoais, com consentimento e sigilo (LGPD)", "Compartilhar com outros alunos", "Guardar sem proteção"], 1),
    q("O aluno relata sintoma preocupante (dor no peito, tontura). O que fazer?", ["Manter o treino enviado", "Suspender o treino e orientar procurar atendimento médico", "Aumentar a intensidade", "Ignorar"], 1)
  ]
};

(async () => {
  const db = admin.firestore();
  for (const id of Object.keys(C.CATEGORIAS)) {
    const ref = db.collection("habilitacao_categorias").doc(id);
    if ((await ref.get()).exists) { console.log(`= ${id}: já existe (mantido)`); continue; }
    await ref.set({ categoria: id, titulo: C.CATEGORIAS[id].titulo, descricao: "", provedor: "youtube", videoRef: "", duracaoSeg: 0, perguntas: MODELO[id].map((p, i) => ({ id: `q${i + 1}`, ...p })), ativo: false, versao: 1, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`+ ${id}: criada (inativa, sem vídeo)`);
  }
  console.log("Pronto. Agora: Admin → Habilitações → informe vídeo + duração e marque 'ativa'.");
})().catch((e) => { console.error(e.message); process.exit(1); });
