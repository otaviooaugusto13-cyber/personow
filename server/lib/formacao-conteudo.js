// Conteúdo da FORMAÇÃO do personal (opcional). O gabarito (`certa`) mora SÓ aqui, no servidor: o cliente nunca o recebe.
const MODULOS = [
  { id: "etica", titulo: "Ética, CREF e responsabilidade", minutos: 6,
    resumo: "O que o CREF garante, os limites do seu escopo e como se comportar com o aluno.",
    conteudo: ["O CREF é o registro que autoriza o profissional de Educação Física a prescrever e orientar exercícios. Mantenha-o ativo e informe o número real no cadastro.",
      "Prescreva apenas dentro do seu escopo: você não diagnostica doenças nem indica medicamentos ou suplementos como tratamento. Em caso de dor, tontura ou dúvida clínica, oriente a procurar um médico.",
      "Trate todos com respeito, sem assédio ou comentários sobre o corpo do aluno. Dados do aluno (saúde, endereço, fotos) são confidenciais."],
    perguntas: [
      { p: "Um aluno relata dor no peito durante o treino. O que fazer?", o: ["Aumentar a carga para ‘passar’", "Interromper, acalmar o aluno e orientar atendimento médico", "Continuar com exercícios leves", "Indicar um remédio"], certa: 1 },
      { p: "Sobre o número do CREF no cadastro:", o: ["Pode ser inventado no início", "Deve ser o seu registro real e ativo", "Só importa para pessoa jurídica", "Não é necessário"], certa: 1 },
      { p: "Os dados de saúde do aluno devem ser:", o: ["Compartilhados com outros alunos", "Publicados nas redes", "Tratados como confidenciais", "Vendidos a academias"], certa: 2 }] },
  { id: "anamnese", titulo: "Anamnese e PAR-Q", minutos: 7,
    resumo: "Como conhecer o aluno antes do primeiro treino e quando pedir liberação médica.",
    conteudo: ["Antes de começar, aplique uma anamnese: objetivos, histórico de lesões, cirurgias, medicamentos, rotina e nível de atividade.",
      "O PAR-Q é um questionário curto de prontidão para atividade física. Qualquer resposta ‘sim’ sinaliza a necessidade de conversar com um médico antes de treinos intensos.",
      "Registre o que foi combinado e reavalie periodicamente: objetivos e condições mudam."],
    perguntas: [
      { p: "Para que serve o PAR-Q?", o: ["Calcular o valor da aula", "Triagem de prontidão para atividade física", "Medir força máxima", "Escolher a academia"], certa: 1 },
      { p: "Aluno marcou ‘sim’ para problema cardíaco no PAR-Q. O ideal é:", o: ["Ignorar", "Pedir liberação médica antes de treinos intensos", "Treinar no limite", "Trocar de aluno"], certa: 1 },
      { p: "A anamnese deve ser feita:", o: ["Só ao final", "Antes de iniciar e reavaliada com o tempo", "Nunca", "Só se o aluno pedir"], certa: 1 }] },
  { id: "seguranca", titulo: "Segurança e primeiros socorros", minutos: 8,
    resumo: "Prevenção de lesões e o que fazer nos primeiros minutos de uma emergência.",
    conteudo: ["Aquecimento, técnica correta e progressão gradual de carga previnem a maioria das lesões. Cheque o ambiente: piso, equipamentos e hidratação.",
      "Em desmaio ou parada cardiorrespiratória: chame o SAMU (192), peça um desfibrilador (DEA) e inicie compressões torácicas fortes e rápidas no centro do peito até a ajuda chegar.",
      "Em entorse: repouso, gelo envolto em pano por até 20 minutos e avaliação médica se houver inchaço ou dor intensa."],
    perguntas: [
      { p: "Telefone do SAMU no Brasil:", o: ["190", "192", "193", "100"], certa: 1 },
      { p: "Em parada cardiorrespiratória, o essencial é:", o: ["Dar água", "Compressões torácicas e chamar ajuda", "Deitar de lado e esperar", "Massagear as pernas"], certa: 1 },
      { p: "O que ajuda a prevenir lesões?", o: ["Pular o aquecimento", "Progressão gradual de carga e boa técnica", "Treinar sempre até a falha", "Ignorar dor"], certa: 1 }] },
  { id: "app", titulo: "Atendimento e regras do Personow", minutos: 6,
    resumo: "Como usar o app, receber pelo Mercado Pago e por que manter tudo dentro da plataforma.",
    conteudo: ["Aceite apenas aulas que consegue cumprir. Cancelar em cima da hora gera advertência; três advertências bloqueiam a conta.",
      "Chat, pagamento e avaliação acontecem no app. Combinar pagamento por fora, trocar telefone, e-mail, Pix ou links é proibido e perde a proteção da plataforma.",
      "Chegue com antecedência, apresente-se e confirme o foco do treino. Após a aula, o aluno paga e o repasse cai direto na sua conta Mercado Pago."],
    perguntas: [
      { p: "Combinar pagamento por Pix fora do app:", o: ["É permitido", "É proibido e pode gerar bloqueio", "É recomendado", "Só em aulas longas"], certa: 1 },
      { p: "Quantas advertências bloqueiam a conta?", o: ["1", "2", "3", "10"], certa: 2 },
      { p: "O repasse da aula é feito:", o: ["Em dinheiro", "Direto na sua conta Mercado Pago após o pagamento", "Só no fim do ano", "Pelo aluno por Pix"], certa: 1 }] }
];
const NOTA_MINIMA = 70;
module.exports = { MODULOS, NOTA_MINIMA };
