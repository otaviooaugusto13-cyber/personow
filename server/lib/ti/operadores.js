// Operadores de TI: contas de e-mail/senha no Firebase Auth + perfil em `ti_operadores/{uid}`.
//   Papel = custom claim { role: "ti", tiNivel } escrita só pelo servidor. A fonte da verdade do status/nível é o documento
//   (consultado a cada requisição, com cache de poucos segundos): excluir/rebaixar vale na hora, mesmo com o token antigo.
//   Exclusão LÓGICA: o documento fica (status "excluido") para a auditoria continuar apontando para alguém; a conta é desativada e as sessões revogadas.
const { Falha } = require("../erros");
const K = require("./constantes");

function criarOperadores({ db, admin, FieldValue, V }) {
  const COL = "ti_operadores", TTL_MS = 10_000;
  const cache = new Map();
  const invalidar = (uid) => cache.delete(uid);
  const ref = (uid) => db.collection(COL).doc(uid);
  const ms = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : typeof t === "number" ? t : null);
  const iso = (t) => { const m = ms(t); return m ? new Date(m).toISOString() : null; };

  /** Documento do operador (com cache curto). */
  async function obter(uid) {
    const c = cache.get(uid); if (c && Date.now() - c.t < TTL_MS) return c.d;
    const d = (await ref(uid).get()).data() || null; cache.set(uid, { t: Date.now(), d }); return d;
  }
  /** O que a tela pode ver (nada de dados internos). */
  const visao = (d) => ({ uid: d.uid, nome: d.nome, email: d.email, nivel: d.nivel, status: d.status, acesso: d.acesso || "senha", trocarSenha: !!d.trocarSenha, criadoEm: iso(d.criadoEm), criadoPor: d.criadoPorNome || "", ultimoLoginEm: iso(d.ultimoLoginEm),
    senhaAlteradaEm: iso(d.senhaAlteradaEm), excluidoEm: iso(d.excluidoEm), excluidoPor: d.excluidoPorNome || "", motivoExclusao: d.motivoExclusao || "" });
  /** Perfil mínimo para a equipe (nome/nível/status): usado em listas de atribuição de chamados. */
  const basico = (d) => ({ uid: d.uid, nome: d.nome, nivel: d.nivel, status: d.status });

  const validarNome = (n) => V.texto(n, "nome", { min: 3, max: 100 });
  const validarEmail = (e) => { const t = V.texto(e, "e-mail", { min: 6, max: 120 }).toLowerCase(); if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(t)) throw new Falha(400, "E-mail inválido.", "dados-invalidos", { campo: "e-mail" }); return t; };
  const validarNivel = (n) => V.opcao(n, K.NIVEIS, "nível");
  const naoAchou = () => new Falha(404, "Operador não encontrado.", "nao-encontrado");

  /**
   * Cria a conta. Três jeitos de dar acesso:
   *   • sem `senha`            → senha temporária aleatória (devolvida UMA vez em `senhaTemporaria`), troca obrigatória no 1º acesso;
   *   • com `senha`            → senha definida por quem cadastra (política de senha valida); `exigirTroca` obriga trocar no 1º acesso;
   *   • `acesso: "google"`     → só login com Google: a conta nasce com senha aleatória DESCARTADA (ninguém a conhece) e o e-mail
   *                              precisa ser o da conta Google da pessoa (o Firebase junta os dois logins pelo e-mail verificado).
   */
  async function criar({ nome, email, nivel, senha, acesso = "senha", exigirTroca = false }, por) {
    nome = validarNome(nome); email = validarEmail(email); nivel = validarNivel(nivel);
    acesso = V.opcao(acesso, ["senha", "google"], "acesso");
    const google = acesso === "google", temporaria = !google && (senha === undefined || senha === null || senha === "");
    const pw = google || temporaria ? K.senhaTemporaria() : K.validarSenha(senha, { email, nome });
    const trocar = temporaria || (!google && !!exigirTroca);
    let uid;
    try { uid = (await admin.auth().createUser({ email, password: pw, displayName: nome, emailVerified: true, disabled: false })).uid; }
    catch (e) {
      if (/email-already-exists/.test(e.code || "")) throw new Falha(409, "Já existe uma conta com este e-mail. Use outro e-mail corporativo.", "email-em-uso");
      if (/invalid-email|invalid-password/.test(e.code || "")) throw new Falha(400, "E-mail ou senha rejeitados pelo provedor de login.", "dados-invalidos");
      throw e;
    }
    try {
      await admin.auth().setCustomUserClaims(uid, { role: "ti", perfis: ["ti"], tiNivel: nivel });
      await ref(uid).set({ uid, nome, email, nivel, status: "ativo", acesso, trocarSenha: trocar, criadoEm: FieldValue.serverTimestamp(), criadoPor: por.uid, criadoPorNome: por.nome || "", senhaAlteradaEm: FieldValue.serverTimestamp() });
    } catch (e) {   // compensação: não deixa uma conta de login sem perfil (e sem rastro) no Auth
      await admin.auth().deleteUser(uid).catch(() => {}); throw e;
    }
    invalidar(uid);
    return { operador: visao((await ref(uid).get()).data()), ...(temporaria ? { senhaTemporaria: pw } : {}) };
  }

  async function listar({ status = "ativo" } = {}) {
    V.opcao(status, ["ativo", "excluido"], "status");
    const s = await db.collection(COL).where("status", "==", status).limit(300).get();
    return s.docs.map((d) => visao(d.data())).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }
  /** Equipe ativa em forma básica (para o técnico escolher a quem encaminhar). */
  async function listarBasico() { return (await db.collection(COL).where("status", "==", "ativo").limit(300).get()).docs.map((d) => basico(d.data())).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")); }

  /**
   * Garante que depois da mudança ainda sobre ao menos um gestor ativo (transação: dois gestores não se removem ao mesmo tempo).
   * `mudar(op)` devolve o patch do alvo; roda dentro da transação.
   */
  async function mutarProtegendoUltimoGestor(uid, mudar, { semTrava = false } = {}) {
    return db.runTransaction(async (tx) => {
      const alvo = (await tx.get(ref(uid))).data(); if (!alvo) throw naoAchou();
      const patch = mudar(alvo);
      const gestoresAtivos = (await tx.get(db.collection(COL).where("status", "==", "ativo").where("nivel", "==", "gestor").limit(5))).docs.map((d) => d.id);
      const continua = gestoresAtivos.filter((id) => id !== uid).length + ((patch.status ?? alvo.status) === "ativo" && (patch.nivel ?? alvo.nivel) === "gestor" ? 1 : 0);
      if (!semTrava && continua < 1) throw new Falha(409, "Precisa existir ao menos um gestor ativo. Promova outro gestor antes.", "ultimo-gestor");
      tx.update(ref(uid), patch); return { antes: alvo, depois: { ...alvo, ...patch } };
    });
  }

  async function alterarNivel(uid, nivel, por) {
    nivel = validarNivel(nivel);
    if (uid === por.uid) throw new Falha(409, "Você não pode alterar o próprio nível.", "proprio-usuario");
    const r = await mutarProtegendoUltimoGestor(uid, (a) => { if (a.status !== "ativo") throw new Falha(409, "Operador excluído: restaure antes de alterar.", "operador-excluido"); return { nivel, atualizadoEm: FieldValue.serverTimestamp() }; }, { semTrava: por.tipo === "admin" });
    await admin.auth().setCustomUserClaims(uid, { role: "ti", perfis: ["ti"], tiNivel: nivel }); await admin.auth().revokeRefreshTokens(uid); invalidar(uid);
    return { antes: { nivel: r.antes.nivel }, depois: { nivel }, operador: visao({ ...r.depois, nivel }) };
  }

  /** Define uma senha. `temporaria: true` (reset por gestor) obriga a troca no próximo acesso. Revoga todas as sessões do operador. */
  async function definirSenha(uid, { senha, temporaria = false, forcarTroca = false }) {
    const d = await obter(uid); if (!d) throw naoAchou(); if (d.status !== "ativo") throw new Falha(409, "Operador excluído.", "operador-excluido");
    const pw = temporaria ? K.senhaTemporaria() : K.validarSenha(senha, { email: d.email, nome: d.nome });
    await admin.auth().updateUser(uid, { password: pw }); await admin.auth().revokeRefreshTokens(uid);
    await ref(uid).update({ trocarSenha: !!temporaria || !!forcarTroca, acesso: "senha", senhaAlteradaEm: FieldValue.serverTimestamp() }); invalidar(uid);
    return temporaria ? { senhaTemporaria: pw } : {};
  }

  /** Exclusão lógica: marca, desativa o login e revoga as sessões. O documento permanece para a trilha de auditoria. */
  async function excluir(uid, motivo, por) {
    if (uid === por.uid) throw new Falha(409, "Você não pode excluir a própria conta.", "proprio-usuario");
    motivo = V.texto(motivo, "motivo", { min: 5, max: 200 });
    const r = await mutarProtegendoUltimoGestor(uid, (a) => { if (a.status === "excluido") throw new Falha(409, "Operador já excluído.", "operador-excluido"); return { status: "excluido", excluidoEm: FieldValue.serverTimestamp(), excluidoPor: por.uid, excluidoPorNome: por.nome || "", motivoExclusao: motivo }; }, { semTrava: por.tipo === "admin" });
    try { await admin.auth().updateUser(uid, { disabled: true }); }
    catch (e) {   // compensação: sem desativar o login, o operador não pode ficar "excluído" só no papel (e a tela mostraria algo que não é verdade)
      await ref(uid).update({ status: "ativo", excluidoEm: FieldValue.delete(), excluidoPor: FieldValue.delete(), excluidoPorNome: FieldValue.delete(), motivoExclusao: FieldValue.delete() }).catch(() => {}); invalidar(uid); throw e;
    }
    await admin.auth().revokeRefreshTokens(uid).catch(() => {}); invalidar(uid);   // o login já está desativado; a revogação é reforço
    return { antes: { status: "ativo", nivel: r.antes.nivel }, depois: { status: "excluido" }, operador: visao({ ...r.antes, status: "excluido" }) };
  }

  /** Desfaz a exclusão lógica: reativa o login e gera nova senha temporária (a antiga fica descartada). */
  async function restaurar(uid) {
    const d = (await ref(uid).get()).data(); if (!d) throw naoAchou(); if (d.status !== "excluido") throw new Falha(409, "Este operador não está excluído.", "nao-excluido");
    const google = d.acesso === "google", pw = K.senhaTemporaria();   // só-Google: a senha aleatória segue descartada e não há troca a fazer
    await admin.auth().updateUser(uid, { disabled: false, password: pw }); await admin.auth().setCustomUserClaims(uid, { role: "ti", perfis: ["ti"], tiNivel: d.nivel }); await admin.auth().revokeRefreshTokens(uid);
    await ref(uid).update({ status: "ativo", trocarSenha: !google, restauradoEm: FieldValue.serverTimestamp(), senhaAlteradaEm: FieldValue.serverTimestamp() }); invalidar(uid);
    return { ...(google ? {} : { senhaTemporaria: pw }), operador: visao({ ...d, status: "ativo", trocarSenha: !google }) };
  }

  async function registrarLogin(uid, { ip, authTime }) {
    const d = await obter(uid); if (!d) return false;
    if (d.ultimoAuthTime === authTime) return false;            // mesmo login (o front chama /ti/sessao em cada carga de página): conta uma vez só
    await ref(uid).update({ ultimoLoginEm: FieldValue.serverTimestamp(), ultimoLoginIp: String(ip || "").slice(0, 64), ultimoAuthTime: authTime || 0 }); invalidar(uid); return true;
  }

  return { _cache: cache, obter, invalidar, visao, basico, criar, listar, listarBasico, alterarNivel, definirSenha, excluir, restaurar, registrarLogin };
}
module.exports = { criarOperadores };
