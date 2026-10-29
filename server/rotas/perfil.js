// Perfil do personal que NÃO pode ficar no navegador: dados sensíveis cifrados, perfil inteligente, recado do suporte.
//   GET  /perfil/personal/privado      devolve (decifrado) o que o PRÓPRIO personal cadastrou
//   PUT  /perfil/personal/privado      valida, cifra (AES-256-GCM) e grava CPF/telefone/nascimento/banco/Pix; CPF único
//   PUT  /perfil/personal/inteligente  experiências por foco, palavras-chave e bio (validadas aqui)
//   POST /perfil/recado/lido           "Entendi" no aviso do suporte (aluno ou personal)
// Contexto de cifragem (AAD) = "personais_privado/<campo>/<uid>": copiar o valor de outro uid/campo falha.
module.exports = (app, x) => {
  const { db, FieldValue, auth, V, C, R, Cripto, Falha, envelope, limitar } = x;
  const LOGADO = [limitar({ janelaMs: 60_000, max: 60, nome: "perfil", porUsuario: false }), auth.exigirLogin];
  const cx = (campo, uid) => `personais_privado/${campo}/${uid}`;
  const tentar = (fn) => { try { return fn(); } catch { return null; } };

  async function exigirPersonal(uid) {
    const s = await db.collection("personais").doc(uid).get();
    if (!s.exists) throw new Falha(403, "Cadastro de personal não encontrado.", "sem-cadastro");
    return s.data();
  }

  /** Lê os dados privados do próprio personal. Aceita o formato antigo (texto puro) até a migração terminar. */
  async function lerPrivado(uid) {
    const p = (await db.collection("personais_privado").doc(uid).get()).data() || {};
    const dec = (campo) => (p[`${campo}Enc`] ? tentar(() => Cripto.decifrar(p[`${campo}Enc`], cx(campo, uid))) : null);
    return {
      cpf: dec("cpf") ?? p.cpf ?? "", telefone: dec("telefone") ?? p.telefone ?? "", nascimento: dec("nascimento") ?? p.nascimento ?? "",
      banco: dec("banco") ?? p.banco ?? null, pix: dec("pix") ?? p.pix ?? null, email: p.email || ""
    };
  }

  app.get("/perfil/personal/privado", ...LOGADO, envelope(async (req, res) => {
    const uid = req.usuario.uid;
    await exigirPersonal(uid);
    res.json(await lerPrivado(uid));
  }));

  app.put("/perfil/personal/privado", limitar({ janelaMs: 60_000, max: 20, nome: "perfil-salvar" }), auth.exigirLogin, envelope(async (req, res) => {
    const uid = req.usuario.uid, b = req.body || {};
    await exigirPersonal(uid);
    const ref = db.collection("personais_privado").doc(uid);
    const grava = { uid, atualizadoEm: FieldValue.serverTimestamp() };
    if (req.usuario.email) grava.email = String(req.usuario.email).slice(0, 120);

    if (b.cpf) {
      const cpf = V.cpf(b.cpf), idx = Cripto.indiceCego(cpf);
      const dono = await db.collection("personais_privado").where("cpfIdx", "==", idx).limit(2).get();
      if (dono.docs.some((d) => d.id !== uid)) throw new Falha(409, "Este CPF já está cadastrado em outra conta. Fale com o suporte se acha que isso é um engano.", "cpf-duplicado");
      Object.assign(grava, { cpfEnc: Cripto.cifrar(cpf, cx("cpf", uid)), cpfIdx: idx, cpf: FieldValue.delete() });
    }
    if (b.telefone) Object.assign(grava, { telefoneEnc: Cripto.cifrar(V.telefone(b.telefone), cx("telefone", uid)), telefone: FieldValue.delete() });
    if (b.nascimento) Object.assign(grava, { nascimentoEnc: Cripto.cifrar(V.validarNascimento(String(b.nascimento)).nascimento, cx("nascimento", uid)), nascimento: FieldValue.delete() });
    if (b.pix && b.pix.chave) {
      const pix = V.chavePix(String(b.pix.tipo || ""), String(b.pix.chave));
      Object.assign(grava, { pixEnc: Cripto.cifrar(pix, cx("pix", uid)), pixTipo: pix.tipo, pix: FieldValue.delete() });
    }
    if (b.banco && typeof b.banco === "object" && (b.banco.agencia || b.banco.conta)) {
      const bco = { banco: V.texto(b.banco.banco, "banco", { max: 60 }), tipo: V.texto(b.banco.tipo, "tipo de conta", { max: 30 }),
        agencia: V.texto(b.banco.agencia, "agência", { min: 1, max: 10, re: /^[\d-]+$/ }), conta: V.texto(b.banco.conta, "conta", { min: 1, max: 20, re: /^[\dA-Za-z-]+$/ }), digito: V.texto(b.banco.digito, "dígito", { max: 3 }) };
      Object.assign(grava, { bancoEnc: Cripto.cifrar(bco, cx("banco", uid)), banco: FieldValue.delete() });
    }
    await ref.set(grava, { merge: true });
    await auth.auditar(req, "personal.privado.salvar", uid, { campos: Object.keys(grava).filter((k) => /Enc$/.test(k)) });
    res.json({ ok: true });
  }));

  /** Experiência por foco (só os focos oficiais), palavras-chave e bio. A bio/keywords são geradas no app, mas validadas aqui. */
  app.put("/perfil/personal/inteligente", limitar({ janelaMs: 60_000, max: 20, nome: "perfil-inteligente" }), auth.exigirLogin, envelope(async (req, res) => {
    const uid = req.usuario.uid, b = req.body || {};
    await exigirPersonal(uid);
    if (!Array.isArray(b.experiencias) || b.experiencias.length > C.PERFIL_MAX_EXPERIENCIAS) throw new Falha(400, "Lista de experiências inválida.", "dados-invalidos");
    const vistos = new Set(), experiencias = [];
    for (const e of b.experiencias) {
      const foco = V.opcao(e?.foco, R.FOCOS, "foco"), anos = V.inteiro(e?.anos, "anos de experiência", { min: 0, max: C.PERFIL_ANOS_MAX });
      if (vistos.has(foco)) continue;
      vistos.add(foco); experiencias.push({ foco, anos });
    }
    const bio = V.texto(b.bio, "bio", { max: C.PERFIL_MAX_BIO });
    const palavras = Array.isArray(b.palavrasChave) ? b.palavrasChave.slice(0, C.PERFIL_MAX_PALAVRAS).map((k) => V.texto(k, "palavra-chave", { max: 40 })).filter(Boolean) : [];
    await db.collection("personais").doc(uid).set({ experiencias, palavrasChave: palavras, ...(bio ? { bio } : {}), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true, experiencias, palavrasChave: palavras });
  }));

  /** "Entendi": apaga o recado do suporte. O navegador nunca escreve nele (só o admin e esta rota). */
  app.post("/perfil/recado/lido", ...LOGADO, envelope(async (req, res) => {
    const tipo = V.opcao(req.body?.tipo, ["aluno", "personal"], "tipo");
    const ref = db.collection(tipo === "aluno" ? "alunos" : "personais").doc(req.usuario.uid);
    if (!(await ref.get()).exists) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado");
    await ref.set({ recado: FieldValue.delete() }, { merge: true });
    res.json({ ok: true });
  }));
};
