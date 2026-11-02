// Contas de ADMINISTRADOR criadas pelo painel de TI (gestor). Alternativa ao ADMIN_BOOTSTRAP_EMAIL / scripts/definir-admin.js, sem terminal e sem Google:
// cria o usuário (e-mail + senha, e-mail já verificado), concede a claim `admin` e registra em `usuarios`. Tudo é auditado pela rota.
// Regras: nunca converte conta de TI ou de parceiro; não mexe na própria conta; sempre sobra ao menos um admin; senha segue a política do módulo.
const { Falha } = require("../erros");
const K = require("./constantes");

function criarAdmins({ db, admin, FieldValue, V, definirPapel }) {
  const validarNome = (n) => V.texto(n, "nome", { min: 3, max: 100 });
  const validarEmail = (e) => { const t = V.texto(e, "e-mail", { min: 6, max: 120 }).toLowerCase(); if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(t)) throw new Falha(400, "E-mail inválido.", "dados-invalidos", { campo: "e-mail" }); return t; };
  const visao = (d) => ({ uid: d.uid, nome: d.nome || "", email: d.email || "", criadoEm: d.criadoEm?.toDate ? d.criadoEm.toDate().toISOString() : null, criadoPorNome: d.criadoPorNome || "", origem: d.criadoPorNome ? "painel de TI" : "bootstrap/script" });

  /** Conta que o painel pode gerir: precisa ser admin de fato (claim) e nunca TI/parceiro. */
  async function alvo(uid) {
    let u; try { u = await admin.auth().getUser(uid); } catch { throw new Falha(404, "Administrador não encontrado.", "nao-encontrado"); }
    const c = u.customClaims || {};
    if (c.role === "ti" || c.role === "parceiro" || c.admin !== true) throw new Falha(404, "Administrador não encontrado.", "nao-encontrado");
    return u;
  }
  async function listar() {
    const s = await db.collection("usuarios").where("admin", "==", true).limit(200).get();
    return s.docs.map((d) => visao({ uid: d.id, ...d.data() })).sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, "pt-BR"));
  }
  async function criar({ nome, email, senha }, por) {
    nome = validarNome(nome); email = validarEmail(email);
    const temporaria = senha === undefined || senha === null || senha === "";
    const pw = temporaria ? K.senhaTemporaria() : K.validarSenha(senha, { email, nome });
    let uid;
    try { uid = (await admin.auth().createUser({ email, password: pw, displayName: nome, emailVerified: true, disabled: false })).uid; }
    catch (e) {
      if (/email-already-exists/.test(e.code || "")) throw new Falha(409, "Já existe uma conta com este e-mail. Para torná-la administradora use o ADMIN_BOOTSTRAP_EMAIL.", "email-em-uso");
      if (/invalid-email|invalid-password/.test(e.code || "")) throw new Falha(400, "E-mail ou senha rejeitados pelo provedor de login.", "dados-invalidos");
      throw e;
    }
    try {
      await definirPapel(uid, "admin", { admin: true });
      await db.collection("usuarios").doc(uid).set({ uid, nome, email, admin: true, criadoEm: FieldValue.serverTimestamp(), criadoPor: por.uid, criadoPorNome: por.nome || por.email || "", atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) { await admin.auth().deleteUser(uid).catch(() => {}); throw e; }     // compensação: sem conta órfã no Auth
    return { administrador: visao({ uid, nome, email, criadoEm: null, criadoPorNome: por.nome || por.email || "" }), ...(temporaria ? { senhaTemporaria: pw } : {}) };
  }
  /** Define a senha (informada, pela política, ou temporária) e encerra as sessões abertas dessa conta. */
  async function redefinirSenha(uid, { senha } = {}) {
    const u = await alvo(uid), temporaria = senha === undefined || senha === null || senha === "";
    const pw = temporaria ? K.senhaTemporaria() : K.validarSenha(senha, { email: u.email || "", nome: u.displayName || "" });
    await admin.auth().updateUser(uid, { password: pw }); await admin.auth().revokeRefreshTokens(uid);
    return { email: u.email || "", ...(temporaria ? { senhaTemporaria: pw } : {}) };
  }
  /** Tira o acesso de administrador (a conta continua existindo, sem papel). Exige que sobre outro admin e proíbe a si mesmo. */
  async function revogar(uid, por) {
    if (uid === por.uid) throw new Falha(409, "Você não pode remover o seu próprio acesso.", "proprio-usuario");
    const u = await alvo(uid);
    if ((await listar()).filter((a) => a.uid !== uid).length < 1) throw new Falha(409, "Precisa sobrar pelo menos um administrador.", "ultimo-admin");
    const { admin: _a, role: _r, perfis, ...resto } = u.customClaims || {};
    const ficam = (Array.isArray(perfis) ? perfis : []).filter((p) => p !== "admin");
    await admin.auth().setCustomUserClaims(uid, { ...resto, ...(ficam.length ? { role: ficam[0], perfis: ficam } : {}) });
    await db.collection("usuarios").doc(uid).set({ admin: false, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await admin.auth().revokeRefreshTokens(uid);
    return { email: u.email || "" };
  }
  return { listar, criar, redefinirSenha, revogar };
}
module.exports = { criarAdmins };
