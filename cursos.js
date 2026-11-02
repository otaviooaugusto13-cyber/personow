// Cursos do personal: categorias e agrupamento (puro, testável). Os vídeos vêm de GET /treinamento (servidor).
// "habilitacao" = obrigatório (libera as aulas). As demais categorias são opcionais e sempre abertas.
export const CATEGORIAS = [
    { id: "habilitacao", ico: "🎓", titulo: "Habilitação Personow", desc: "Obrigatório para aceitar aulas. Assista na ordem." },
    { id: "tecnica", ico: "🏋️", titulo: "Técnica de treino", desc: "Execução de exercícios, periodização e progressão de carga." },
    { id: "saude", ico: "🛡️", titulo: "Saúde e prevenção de lesões", desc: "Anamnese, limites do aluno e prevenção de lesões." },
    { id: "atendimento", ico: "🤝", titulo: "Atendimento e postura", desc: "Relacionamento e comunicação com o aluno." },
    { id: "seguranca", ico: "🦺", titulo: "Segurança e saúde", desc: "Primeiros socorros, ergonomia e cuidados na aula." },
    { id: "carreira", ico: "🚀", titulo: "Carreira e finanças", desc: "Organização, metas e renda." },
    { id: "geral", ico: "📚", titulo: "Outros cursos", desc: "Conteúdos extras da equipe." }
];
export const CATEGORIA = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]));

/** Agrupa módulos por categoria (na ordem de CATEGORIAS; categorias vazias somem). */
export function agruparCursos(modulos = []) {
    const g = new Map(CATEGORIAS.map((c) => [c.id, []]));
    for (const m of modulos) (g.get(CATEGORIA[m.categoria] ? m.categoria : (m.obrigatorio === false ? "geral" : "habilitacao")) || g.get("geral")).push(m);
    return CATEGORIAS.map((c) => {
        const itens = (g.get(c.id) || []).sort((a, b) => a.ordem - b.ordem);
        return { ...c, itens, concluidos: itens.filter((m) => m.concluido).length, total: itens.length };
    }).filter((c) => c.total);
}
export const statusCurso = (m) => (m.concluido ? { t: m.temProva && m.nota != null ? `Concluído ✓ ${m.nota}%` : "Concluído ✓", cor: "green" }
    : m.videoOk && m.temProva && !m.provaOk ? { t: "Falta a prova", cor: "blue" }
    : m.bloqueado ? { t: "Bloqueado 🔒", cor: "" } : m.validoSeg ? { t: "Em andamento", cor: "blue" } : { t: "Não iniciado", cor: "" });
