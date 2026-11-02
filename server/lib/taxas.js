// Taxas e regras de aula DINÂMICAS: fonte única = documento Firestore `configuracoes/taxas`.
//
// Leitura  → obter(): cache em memória, atualizado na hora por um listener do Firestore (onSnapshot) e,
//            por garantia (várias instâncias / listener caído), expirado a cada TTL_MS.
// Escrita  → salvar(): transação com controle de versão (dois admins não sobrescrevem um ao outro).
//
// Segurança do dinheiro (fail-closed):
//   • documento NÃO existe  → usa o PADRÃO de split.js (primeira execução, nada foi configurado ainda);
//   • leitura falhou / documento corrompido → usa a última versão boa em cache; sem cache, responde 503.
//     Nunca cai silenciosamente em valores antigos hardcoded depois que o admin já configurou o banco.
const { Falha } = require("./erros");

const COLECAO = "configuracoes", DOC = "taxas";
const TTL_MS = 30_000;

function criarTaxas({ db, FieldValue, S, ttlMs = TTL_MS }) {
  const ref = () => db.collection(COLECAO).doc(DOC);
  let cache = null, expira = 0, emVoo = null, parar = null;

  const iso = (ts) => { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toISOString() : null; };
  const padrao = () => ({ ...S.PADRAO, atualizadoEm: null, atualizadoPor: "", origem: "padrao" });

  /** Documento do Firestore → objeto de taxas validado. Lança se estiver corrompido. */
  function doDocumento(d) {
    if (!d) return padrao();
    const { erro, cfg } = S.validarTaxas(d);
    if (erro) throw new Error(`documento ${COLECAO}/${DOC} inválido: ${erro}`);
    return { ...cfg, versao: Number.isInteger(d.versao) ? d.versao : 0, atualizadoEm: iso(d.atualizadoEm), atualizadoPor: String(d.atualizadoPor || ""), origem: "banco" };
  }
  const guardar = (t) => { cache = Object.freeze(t); expira = Date.now() + ttlMs; return cache; };

  async function ler() {
    try { return guardar(doDocumento((await ref().get()).data())); }
    catch (e) {
      console.error("taxas: falha ao ler configuração:", e.message);
      if (cache) { expira = Date.now() + 5_000; return cache; }   // mantém a última versão boa e tenta de novo em 5 s
      throw new Falha(503, "Configuração de taxas indisponível. Tente novamente em instantes.", "taxas-indisponiveis");
    }
  }

  /** Taxas vigentes (objeto imutável). Barato: quase sempre responde do cache. */
  async function obter() {
    if (cache && Date.now() < expira) return cache;
    emVoo ||= ler().finally(() => { emVoo = null; });            // várias requisições simultâneas → uma leitura só
    return emVoo;
  }

  /** Liga o listener em tempo real (chamado só no servidor de verdade). Mudança do admin vale em milissegundos. */
  function iniciar() {
    const r = ref();
    if (typeof r.onSnapshot !== "function" || parar) return;
    parar = r.onSnapshot(
      (snap) => { try { guardar(doDocumento(snap.exists ? snap.data() : null)); } catch (e) { console.error("taxas: snapshot ignorado:", e.message); } },
      (e) => { console.error("taxas: listener caiu (o TTL continua protegendo):", e.message); parar = null; setTimeout(iniciar, 10_000).unref?.(); }
    );
  }

  /**
   * Grava novas taxas (já validadas por S.validarTaxas). `versaoEsperada` = versão que o admin estava vendo:
   * se outra pessoa salvou antes, 409 — a tela recarrega e mostra o valor atual.
   */
  async function salvar(cfg, { ator, versaoEsperada } = {}) {
    const antes = await db.runTransaction(async (tx) => {
      const atual = (await tx.get(ref())).data();
      const versaoAtual = atual && Number.isInteger(atual.versao) ? atual.versao : 0;
      if (versaoEsperada !== undefined && versaoEsperada !== versaoAtual) throw new Falha(409, "Outro administrador alterou as taxas enquanto você editava. Recarregamos os valores atuais — confira e salve de novo.", "taxas-desatualizadas", { versaoAtual });
      tx.set(ref(), { ...cfg, versao: versaoAtual + 1, atualizadoEm: FieldValue.serverTimestamp(), atualizadoPor: String(ator || "") });
      return atual ? doDocumentoSeguro(atual) : padrao();
    });
    cache = null; expira = 0;
    return { antes, depois: await ler() };
  }
  const doDocumentoSeguro = (d) => { try { return doDocumento(d); } catch { return null; } };

  /** Subconjunto público: exatamente o que o app precisa para exibir valores e validar aulas no navegador. */
  const visaoPublica = (t) => ({
    precoCentavos: t.precoCentavos, comissaoCentavos: t.comissaoCentavos, repasseCentavos: t.repasseCentavos, taxaFixaCentavos: t.taxaFixaCentavos,
    horasMin: t.horasMin, horasMax: t.horasMax, maxSemana: t.maxSemana, versao: t.versao
  });

  return { obter, iniciar, salvar, visaoPublica, invalidar: () => { cache = null; expira = 0; }, _parar: () => { parar?.(); parar = null; } };
}

module.exports = { criarTaxas, COLECAO, DOC };
