// Concede o papel de ADMIN a contas Google listadas em ADMIN_BOOTSTRAP_EMAIL (uma ou várias, separadas por vírgula), SEM terminal.
// Faz exatamente o que scripts/definir-admin.js faz (custom claim `admin: true` + `role`), só que no start do servidor.
//   • A conta precisa JÁ existir no Firebase Auth (entrar uma vez no app com o Google) e ter e-mail verificado.
//   • Nunca converte conta de operador de TI nem de parceiro (B2B): elas têm acesso próprio e o papel seria sobrescrito.
//   • Idempotente: quem já é admin é ignorado. Depois do 1º sucesso a variável pode (e deve) ser removida do Render.
//   • A pessoa precisa SAIR e ENTRAR de novo no painel para o token receber a claim nova.
function criarBootstrapAdmin({ admin, db, FieldValue, auth }) {
  const lista = (env) => [...new Set(String(env.ADMIN_BOOTSTRAP_EMAIL || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];

  async function conceder(email) {
    let u;
    try { u = await admin.auth().getUserByEmail(email); }
    catch (e) { return { email, feito: false, motivo: "conta-inexistente" }; }
    if (u.emailVerified === false) return { email, feito: false, motivo: "email-nao-verificado" };
    const c = u.customClaims || {};
    if (c.role === "ti" || c.role === "parceiro") return { email, feito: false, motivo: `conta-${c.role}` };
    if (c.admin === true && Array.isArray(c.perfis) && c.perfis.includes("admin")) return { email, feito: false, motivo: "ja-e-admin" };
    await auth.definirPapel(u.uid, "admin", { admin: true });
    await db.collection("usuarios").doc(u.uid).set({ uid: u.uid, email, admin: true, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    return { email, feito: true, uid: u.uid };
  }

  /** Roda no start. Nunca lança: falha aqui não pode impedir o servidor de subir. */
  async function rodar(env = process.env) {
    const emails = lista(env), resultados = [];
    for (const email of emails) {
      try {
        const r = await conceder(email); resultados.push(r);
        if (r.feito) console.log(`✅ Admin: ${email} agora é administrador. Peça para sair e entrar de novo no painel; depois REMOVA ADMIN_BOOTSTRAP_EMAIL do ambiente.`);
        else if (r.motivo === "conta-inexistente") console.warn(`⚠️  Admin: ${email} ainda não existe no Firebase Auth. Entre uma vez com essa conta Google no app (qualquer portal) e reinicie o serviço.`);
        else if (r.motivo === "email-nao-verificado") console.warn(`⚠️  Admin: ${email} tem e-mail não verificado; não foi promovido.`);
        else if (r.motivo === "conta-ti" || r.motivo === "conta-parceiro") console.warn(`⚠️  Admin: ${email} é conta de ${r.motivo.slice(6)}; use outra conta Google para ser administrador.`);
      } catch (e) { resultados.push({ email, feito: false, motivo: "erro" }); console.error(`⚠️  Admin: falha ao promover ${email}: ${e.code || e.message}`); }
    }
    return resultados;
  }
  return { rodar, conceder };
}
module.exports = { criarBootstrapAdmin };
