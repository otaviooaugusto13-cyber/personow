// Cadastro e dados da conta. Dados sensíveis só passam por aqui (validados, cifrados) — o navegador nunca grava
// nem lê CPF, nascimento, telefone ou Pix diretamente no Firestore.
const crypto = require("crypto");
const Enea = require("../lib/eneagrama");           // Eneagrama automático (resultado do teste vinculado sem digitação)

module.exports = (app, x) => {
  const { db, FieldValue, auth, V, C, Cripto, Falha, envelope, limitar, habilitacao, perfisDasClaims, PERFIS } = x;
  const TERMOS_VERSAO = "2026-10";
  const lim = limitar({ janelaMs: 60_000, max: 12, nome: "conta" });
  const ctxCampo = (campo, uid) => `personais_privado/${campo}/${uid}`;
  const nomeSeguro = (n) => { try { return V.texto(n || "", "nome", { max: 100, obrigatorio: false }); } catch { return ""; } };
  const novoCodigo = () => Array.from(crypto.randomBytes(6), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

  const DESTINO = { aluno: "/painel-aluno", personal: "/painel-personal", admin: "/admin.html" };   // rota de cada painel (espelho de ROTAS em config.js)
  /** Conta de operador de TI não vira aluno/personal: um cadastro aqui trocaria a claim `role` e tiraria o acesso ao painel de TI. */
  const contaTI = () => new Falha(403, "Esta é uma conta de operador de TI. Use o painel de TI (/painel-ti).", "conta-ti");
  const NOME_PERFIL = { aluno: "aluno", personal: "personal", admin: "administrador" };
  /** 409 amigável: a conta já tem o outro perfil. `detalhe.sugerido` diz ao front para onde levar o usuário. */
  /** Conta de parceiro (B2B) é um acesso só de leitura ao painel parceiro.html: nunca vira aluno/personal (o cadastro sobrescreveria o papel e cortaria o acesso). */
  const contaDeParceiro = (u) => u.role === "parceiro";
  const erroParceiro = () => new Falha(409, "Esta conta Google é de acesso de parceiro (painel B2B). Use outra conta Google para ser aluno ou personal.", "papel-conflito", { tem: "parceiro" });
  const conflito = (tem, quer) => new Falha(409, `Esta conta Google já é de ${NOME_PERFIL[tem]}. Você pode abrir o painel de ${NOME_PERFIL[tem]} ou entrar com outra conta Google para ser ${NOME_PERFIL[quer]}.`, "papel-conflito", { tem, quer, sugerido: tem });

  /** CPF já usado por OUTRA conta ativa → 409 com dica (e-mail mascarado) de qual conta Google usar para entrar. */
  async function conflitoDeCpf(cpfDigitos, uid) {
    const dono = await habilitacao.cpfEmUso(cpfDigitos, uid);
    if (dono) throw new Falha(409, "Este CPF já possui uma conta. Entre com ela ou fale com o suporte.", "cpf-duplicado", { emailMascarado: V.mascararEmail(dono.email) });
  }

  /** CREF já usado por OUTRA conta → 409 (um registro profissional = uma conta). */
  async function conflitoDeCref(cref, uid) {
    const s = await db.collection("personais").where("cref", "==", cref).limit(2).get();
    if (s.docs.some((d) => d.id !== uid)) throw new Falha(409, "Este CREF já está cadastrado em outra conta. Entre com ela ou fale com o suporte.", "cref-duplicado");
  }

  /**
   * Monta os campos privados (cifrados) a partir do corpo, respeitando travas:
   * CPF e nascimento, depois de gravados, só mudam pela equipe (impede "rejuvenescer" a conta).
   */
  async function montarPrivado(uid, atual, b) {
    const novo = {}, info = {};
    if (b.cpf !== undefined) {
      const cpf = V.cpf(b.cpf);
      if (atual.cpfEnc) { if (Cripto.decifrar(atual.cpfEnc, ctxCampo("cpf", uid)) !== cpf) throw new Falha(409, "O CPF já cadastrado só pode ser alterado pelo suporte.", "dado-travado"); }
      else { await conflitoDeCpf(cpf, uid); novo.cpfEnc = Cripto.cifrar(cpf, ctxCampo("cpf", uid)); novo.cpfIdx = Cripto.indiceCego(cpf); }
    }
    if (b.nascimento !== undefined) {
      const n = V.validarNascimento(b.nascimento);                                   // ≥ 18 anos, data real, não futura
      if (atual.nascimentoEnc) { if (Cripto.decifrar(atual.nascimentoEnc, ctxCampo("nascimento", uid)) !== n.nascimento) throw new Falha(409, "A data de nascimento só pode ser alterada pelo suporte.", "dado-travado"); }
      else { novo.nascimentoEnc = Cripto.cifrar(n.nascimento, ctxCampo("nascimento", uid)); novo.nascimentoTravadoEm = FieldValue.serverTimestamp(); }
    }
    if (b.telefone !== undefined) novo.telefoneEnc = Cripto.cifrar(V.telefone(b.telefone), ctxCampo("telefone", uid));
    // idade efetiva (do dado novo ou do já gravado)
    const nasc = b.nascimento !== undefined ? V.validarNascimento(b.nascimento).nascimento : atual.nascimentoEnc ? Cripto.decifrar(atual.nascimentoEnc, ctxCampo("nascimento", uid)) : null;
    if (nasc) info.idade = V.calcularIdade(nasc);
    return { novo, info };
  }

  // ---------- Aluno ----------
  app.post("/cadastro/aluno", lim, envelope(async (req, res) => {
    const u = await auth.autenticar(req); if (u.role === "ti") throw contaTI();
    if (contaDeParceiro(u)) throw erroParceiro();
    // Conflito = a conta já TEM o perfil oposto (claims ou documento). Ser admin não é conflito.
    if (perfisDasClaims(u).includes("personal") || (await db.collection("personais").doc(u.uid).get()).exists) throw conflito("personal", "aluno");
    if (req.body?.termos !== true) throw new Falha(400, "É preciso aceitar os Termos de Uso.", "termos-obrigatorios");
    const ref = db.collection("alunos").doc(u.uid);
    if (!(await ref.get()).exists) await ref.set({ uid: u.uid, email: u.email || "", nome: nomeSeguro(u.name), termosEm: FieldValue.serverTimestamp(), termosVersao: TERMOS_VERSAO, criadoEm: FieldValue.serverTimestamp() });
    await db.collection("usuarios").doc(u.uid).set({ uid: u.uid, role: "aluno", criadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await auth.definirPapel(u.uid, "aluno");
    res.json({ ok: true, role: "aluno" });
  }));

  // ---------- Personal trainer (18+, com registro no CREF) ----------
  app.post("/cadastro/personal", lim, envelope(async (req, res) => {
    const u = await auth.autenticar(req), b = req.body || {}; if (u.role === "ti") throw contaTI();
    if (contaDeParceiro(u)) throw erroParceiro();
    if (perfisDasClaims(u).includes("aluno") || (await db.collection("alunos").doc(u.uid).get()).exists) throw conflito("aluno", "personal");
    if (b.termos !== true) throw new Falha(400, "É preciso aceitar os Termos de Uso.", "termos-obrigatorios");
    const ref = db.collection("personais").doc(u.uid), existente = await ref.get();
    if (existente.exists) { await auth.definirPapel(u.uid, "personal", { treinado: !!existente.data().treinamentoOk }); return res.json({ ok: true, role: "personal", jaCadastrado: true }); }
    const privAtual = (await db.collection("personais_privado").doc(u.uid).get()).data() || {};
    // CPF e nascimento são obrigatórios, a menos que já estejam gravados (cadastro interrompido antes): nesse caso o servidor reaproveita o que existe.
    if ((b.nascimento === undefined && !privAtual.nascimentoEnc) || (b.cpf === undefined && !privAtual.cpfEnc)) throw new Falha(400, "Informe CPF e data de nascimento.", "dados-invalidos");
    const { novo, info } = await montarPrivado(u.uid, privAtual, { cpf: b.cpf, nascimento: b.nascimento, telefone: b.telefone });
    const cref = V.cref(b.cref); await conflitoDeCref(cref, u.uid);
    const indicado = typeof b.indicadoPor === "string" && /^[\w-]{1,40}$/.test(b.indicadoPor) ? b.indicadoPor : "";
    const lote = db.batch();
    lote.set(ref, {
      uid: u.uid, nome: nomeSeguro(b.nome) || nomeSeguro(u.name), cref, status: "pendente", fotoGoogle: typeof u.picture === "string" && u.picture.startsWith("https://") ? u.picture.slice(0, 300) : "",
      indicadoPor: indicado, refCode: novoCodigo(), treinamentoOk: false, termosEm: FieldValue.serverTimestamp(), termosVersao: TERMOS_VERSAO, criadoEm: FieldValue.serverTimestamp()
    });
    lote.set(db.collection("personais_privado").doc(u.uid), { uid: u.uid, ...novo, criadoEm: FieldValue.serverTimestamp() }, { merge: true });
    lote.set(db.collection("usuarios").doc(u.uid), { uid: u.uid, role: "personal", email: u.email || "", criadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await lote.commit();
    await auth.definirPapel(u.uid, "personal", { treinado: false });
    // Eneagrama automático: resultado importado (pelo e-mail verificado) ou link assinado (?et=). Falha aqui NUNCA derruba o cadastro.
    let enea = null;
    try { enea = await Enea.vincularNoCadastro({ db, FieldValue, Cripto, uid: u.uid, email: u.email, emailVerificado: u.email_verified, token: typeof b.eneagramaToken === "string" ? b.eneagramaToken : "", auditar: (a, alvo, det) => auth.auditar(req, a, alvo, det) }); }
    catch (e) { console.error("eneagrama: não vinculou no cadastro:", e.message); }
    res.json({ ok: true, role: "personal", idade: info.idade, status: "pendente", eneagrama: enea ? { ...enea.eneagrama, codigo: enea.codigo, origem: enea.origem } : null });
  }));

  /** Completa dados que faltam (contas antigas sem nascimento/CPF). Dados já gravados ficam travados. */
  app.put("/perfil/personal/privado", lim, auth.exigir("personal"), envelope(async (req, res) => {
    const uid = req.usuario.uid, b = V.somente(req.body, ["cpf", "nascimento", "telefone"]);
    const ref = db.collection("personais_privado").doc(uid), atual = (await ref.get()).data() || {};
    const { novo, info } = await montarPrivado(uid, atual, b);
    if (Object.keys(novo).length) await ref.set({ uid, ...novo, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await auth.auditar(req, "perfil.privado.atualizar", uid, { campos: Object.keys(b) });
    res.json({ ok: true, idade: info.idade ?? null });
  }));

  /** Informa/corrige o CREF enquanto o cadastro não foi aprovado; depois de "ativo" só a equipe altera (o admin confere o registro no CONFEF). */
  app.put("/perfil/personal/cref", lim, auth.exigir("personal"), envelope(async (req, res) => {
    const uid = req.usuario.uid, ref = db.collection("personais").doc(uid), pub = (await ref.get()).data() || {};
    const cref = V.cref(req.body?.cref);
    if (pub.status === "ativo" && pub.cref && pub.cref !== cref) throw new Falha(409, "O CREF de um cadastro aprovado só pode ser alterado pelo suporte.", "dado-travado");
    await conflitoDeCref(cref, uid);
    await ref.set({ cref, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await auth.auditar(req, "perfil.cref.atualizar", uid, { cref });
    res.json({ ok: true, cref });
  }));

  app.put("/perfil/personal/pix", lim, auth.exigir("personal"), envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);                                                    // sensível: login recente
    const uid = req.usuario.uid, pix = V.chavePix(req.body?.tipo, req.body?.chave);
    await db.collection("personais_privado").doc(uid).set({ uid, pixEnc: Cripto.cifrar(pix, ctxCampo("pix", uid)), pixTipo: pix.tipo, pixAlteradoEm: FieldValue.serverTimestamp() }, { merge: true });
    await auth.auditar(req, "perfil.pix.alterar", uid, { tipo: pix.tipo });
    res.json({ ok: true, pix: { tipo: pix.tipo, chaveMascarada: V.mascararChave(pix.chave) } });
  }));

  /** Dados do próprio personal, decifrados e mascarados quando possível. */
  app.get("/perfil/privado", auth.exigir("personal"), envelope(async (req, res) => {
    const uid = req.usuario.uid, [priv, pub] = await Promise.all([db.collection("personais_privado").doc(uid).get(), db.collection("personais").doc(uid).get()]), p = priv.data() || {};
    const dec = (campo) => { try { return p[`${campo}Enc`] ? Cripto.decifrar(p[`${campo}Enc`], ctxCampo(campo, uid)) : null; } catch { return null; } };
    const cpf = dec("cpf"), nasc = dec("nascimento"), tel = dec("telefone"), pix = dec("pix");
    const idade = nasc ? V.calcularIdade(nasc) : null;
    res.json({
      temCpf: !!cpf, cpfMascarado: cpf ? V.mascararCPF(cpf) : "", nascimento: nasc || "", nascimentoTravado: !!nasc, telefone: tel || "",
      idade, cref: pub.data()?.cref || "",
      pix: pix ? { tipo: pix.tipo, chaveMascarada: V.mascararChave(pix.chave) } : null
    });
  }));

  // ---------- Perfil inteligente: experiência personal + Eneagrama → palavras-chave e bio ----------
  // Não é dado sensível (sem CPF/Pix), mas o Eneagrama é pessoal: fica em coleção só do servidor e NÃO vai para o perfil público.
  // Público (alunos veem): bio, palavrasChave e áreas de experiência. Texto gerado no navegador é revalidado/sanitizado aqui.
  const RE_PALAVRA = /^[\p{L}\p{N}][\p{L}\p{N} +\-\/&.()]{1,29}$/u;
  function validarPerfilInteligente(b) {
    const exps = Array.isArray(b.experiencias) ? b.experiencias : [];
    if (exps.length > C.PERFIL_MAX_EXPERIENCIAS) throw new Falha(400, `Informe no máximo ${C.PERFIL_MAX_EXPERIENCIAS} experiências.`, "dados-invalidos");
    const vistas = new Set();
    const experiencias = exps.map((e) => {
      if (!e || typeof e !== "object" || Array.isArray(e)) throw new Falha(400, "Experiência inválida.", "dados-invalidos");
      const area = V.opcao(e.area, C.AREAS_EXPERIENCIA, "área de experiência");
      if (vistas.has(area)) throw new Falha(400, "Área de experiência repetida.", "dados-invalidos");
      vistas.add(area);
      return { area, anos: V.inteiro(e.anos, "anos de experiência", { min: 0, max: 40 }), detalhe: V.texto(e.detalhe || "", "detalhe", { max: 80, obrigatorio: false }) };
    });
    let eneagrama = null;
    if (b.eneagrama !== null && b.eneagrama !== undefined) {
      const en = b.eneagrama;
      if (typeof en !== "object" || Array.isArray(en)) throw new Falha(400, "Eneagrama inválido.", "dados-invalidos");
      const tipo = V.inteiro(en.tipo, "tipo do Eneagrama", { min: 1, max: 9 });
      const asa = en.asa === null || en.asa === undefined || en.asa === 0 ? 0 : V.inteiro(en.asa, "asa do Eneagrama", { min: 1, max: 9 });
      const vizinhos = [tipo === 1 ? 9 : tipo - 1, tipo === 9 ? 1 : tipo + 1];
      if (asa && !vizinhos.includes(asa)) throw new Falha(400, "A asa precisa ser um tipo vizinho ao tipo principal.", "dados-invalidos");
      const instinto = en.instinto ? V.opcao(en.instinto, C.ENEAGRAMA_INSTINTOS, "instinto") : "";
      eneagrama = { tipo, asa, instinto };
    }
    const palavrasBrutas = Array.isArray(b.palavrasChave) ? b.palavrasChave : [];
    if (palavrasBrutas.length > C.PERFIL_MAX_PALAVRAS) throw new Falha(400, "Palavras-chave demais.", "dados-invalidos");
    const palavrasChave = [...new Set(palavrasBrutas.map((p) => V.texto(p, "palavra-chave", { min: 2, max: 30, re: RE_PALAVRA })))];
    const bio = V.texto(b.bio || "", "bio", { max: 300, obrigatorio: false });
    return { experiencias, eneagrama, palavrasChave, bio, bioAuto: b.bioAuto === undefined ? true : V.booleano(b.bioAuto, "bioAuto") };
  }
  app.put("/perfil/personal/inteligente", lim, auth.exigir("personal"), envelope(async (req, res) => {
    const uid = req.usuario.uid, b = V.somente(req.body, ["experiencias", "eneagrama", "palavrasChave", "bio", "bioAuto"]);
    const p = validarPerfilInteligente(b);
    const atual = (await db.collection("personais_perfil").doc(uid).get()).data() || {};
    const travado = !!(atual.eneagramaMeta && atual.eneagramaMeta.travado && atual.eneagrama);
    if (travado) p.eneagrama = atual.eneagrama;                      // veio do teste: o usuário não digita nem altera
    const lote = db.batch();
    lote.set(db.collection("personais_perfil").doc(uid), { uid, experiencias: p.experiencias, eneagrama: p.eneagrama, palavrasChave: p.palavrasChave, bioAuto: p.bioAuto, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    lote.set(db.collection("personais").doc(uid), { bio: p.bio, palavrasChave: p.palavrasChave, areasExperiencia: p.experiencias.map((e) => e.area), bioAuto: p.bioAuto }, { merge: true });
    await lote.commit();
    await auth.auditar(req, "perfil.inteligente.atualizar", uid, { experiencias: p.experiencias.length, eneagrama: !!p.eneagrama });
    res.json({ ok: true, ...p, eneagramaTravado: travado });
  }));
  app.get("/perfil/personal/inteligente", auth.exigir("personal"), envelope(async (req, res) => {
    const ref = db.collection("personais_perfil").doc(req.usuario.uid);
    let d = (await ref.get()).data() || {};
    if (!d.eneagrama) {                                                 // resultado importado depois do cadastro: vincula agora (e-mail verificado)
      try { if (await Enea.vincularNoCadastro({ db, FieldValue, Cripto, uid: req.usuario.uid, email: req.usuario.email, emailVerificado: req.usuario.email_verified, auditar: (a, alvo, det) => auth.auditar(req, a, alvo, det) })) d = (await ref.get()).data() || {}; }
      catch (e) { console.error("eneagrama: não vinculou ao abrir o perfil:", e.message); }
    }
    const meta = d.eneagramaMeta || {};
    res.json({ experiencias: d.experiencias || [], eneagrama: d.eneagrama || null, eneagramaOrigem: d.eneagrama ? (meta.origem || "manual") : "", eneagramaTravado: !!(meta.travado && d.eneagrama), palavrasChave: d.palavrasChave || [], bioAuto: d.bioAuto !== false });
  }));

  /** "Entendi": a pessoa dispensa o recado do suporte (só o próprio, pelo papel ativo). */
  app.post("/perfil/recado/lido", lim, auth.exigir("aluno", "personal"), envelope(async (req, res) => {
    const ref = db.collection(req.usuario.role === "aluno" ? "alunos" : "personais").doc(req.usuario.uid);
    if ((await ref.get()).exists) await ref.set({ recado: FieldValue.delete() }, { merge: true });
    res.json({ ok: true });
  }));

  app.get("/habilitacao", auth.exigir("personal"), envelope(async (req, res) => res.json(await habilitacao.situacao(req.usuario.uid))));

  /**
   * Resolve o perfil ATIVO da sessão para o portal que o usuário abriu (`portal`: aluno | personal | admin).
   * Nunca devolve erro por "conta ambígua" nem por "perfil errado": responde sempre 200 com um `estado` que o front sabe tratar.
   *   estado "ok"           → perfil ativado (claim `role` = portal; se mudou, `atualizarToken: true`)
   *   estado "cadastro"     → conta sem nenhum perfil: o front abre o cadastro do portal
   *   estado "outro-perfil" → a conta tem perfis, mas não o deste portal: o front oferece ir ao painel certo / trocar de conta
   *   estado "escolher"     → (cliente antigo, sem `portal`) a conta tem vários perfis e nenhum ativo: o front deixa escolher
   * A lista de perfis vem do SERVIDOR (claims + documentos), nunca do cliente: `portal` só escolhe entre perfis que a conta já possui.
   */
  app.post("/sessao", lim, envelope(async (req, res) => {
    const u = await auth.autenticar(req), portal = req.body?.portal;
    if (u.role === "ti") throw contaTI();
    if (portal !== undefined && !PERFIS.includes(portal)) throw new Falha(400, "Portal inválido.", "dados-invalidos");
    if (contaDeParceiro(u)) return res.json({ estado: "outro-perfil", role: "parceiro", perfis: [], sugerido: null, destino: "/parceiro.html", atualizarToken: false });
    const [claims, l, p] = await Promise.all([auth.claimsDe(u.uid), db.collection("alunos").doc(u.uid).get(), db.collection("personais").doc(u.uid).get()]);
    const tem = new Set(perfisDasClaims(claims)); if (l.exists) tem.add("aluno"); if (p.exists) tem.add("personal");
    const perfis = PERFIS.filter((x) => tem.has(x));
    const alvo = portal ?? (perfis.includes(claims.role) ? claims.role : perfis.length === 1 ? perfis[0] : null);
    const comerciais = perfis.filter((x) => x !== "admin");          // admin é privilégio, não "tipo de conta": não impede criar aluno/personal
    if (alvo !== "admin" && !comerciais.length) return res.json({ estado: "cadastro", role: null, perfis, destino: null, atualizarToken: false });
    if (!alvo) return res.json({ estado: "escolher", role: null, perfis, destino: null, atualizarToken: false });
    // `destino`: para onde o front deve levar a pessoa (o servidor decide pelo que a conta TEM, nunca pelo que o navegador pede)
    if (!perfis.includes(alvo)) return res.json({ estado: "outro-perfil", role: null, perfis, sugerido: comerciais[0] || null, destino: DESTINO[comerciais[0]] || null, atualizarToken: false });
    const igual = claims.role === alvo && PERFIS.every((x) => perfis.includes(x) === perfisDasClaims(claims).includes(x)) && (alvo !== "personal" || claims.treinado === !!p.data()?.treinamentoOk);
    if (!igual) {
      await auth.definirPapel(u.uid, alvo, { perfis, ...(alvo === "personal" ? { treinado: !!p.data()?.treinamentoOk } : {}) });
      await db.collection("usuarios").doc(u.uid).set({ uid: u.uid, role: alvo, perfis, migradoEm: FieldValue.serverTimestamp() }, { merge: true });
      if (claims.role !== alvo) { req.usuario = u; await auth.auditar(req, "sessao.trocar-perfil", u.uid, { de: claims.role || null, para: alvo }); }
    }
    res.json({ estado: "ok", role: alvo, perfis, destino: DESTINO[alvo], atualizarToken: !igual });
  }));
};
