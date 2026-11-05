// Aba "Academias" do painel admin: cadastra academia parceira (apelidos de local para casar com as aulas) e vincula contas por e-mail.
// A academia só enxerga números agregados em /academia.html. Rotas: /admin/academias (server/rotas/academias.js).
// Ações de vínculo exigem login recente: usa ctx.sensivel quando existir (reautentica por senha/Google e repete).
export default {
    id: "academias", titulo: "Academias", icone: "▦",
    async render(raiz, ctx) {
        const { chamarFuncao, esc, toast } = ctx, enc = encodeURIComponent;
        const sens = ctx.sensivel || ((fn) => fn());
        const falhar = (e) => { if (e?.code !== "cancelado") toast(e?.message || "Não foi possível concluir.", "err"); };
        raiz.innerHTML = `
            <div class="ax-card ax-mb"><h2>Nova academia parceira</h2>
                <p class="ax-mut ax-sm ax-mb">Apelidos de local: como os alunos costumam escrever o endereço/nome da academia no pedido (mínimo 4 letras, um por linha). É assim que as aulas são ligadas à academia.</p>
                <form id="ac-nova" novalidate><div class="ax-grid ax-g2">
                    <div><label class="ax-lbl" for="ac-nome">Nome</label><input class="ax-in" id="ac-nome" maxlength="80" required></div>
                    <div><label class="ax-lbl" for="ac-cidade">Cidade</label><input class="ax-in" id="ac-cidade" maxlength="80"></div>
                </div><label class="ax-lbl ax-mt" for="ac-apelidos">Apelidos de local (um por linha)</label><textarea class="ax-ta" id="ac-apelidos" rows="3" maxlength="800"></textarea>
                <p class="ax-erro" id="ac-erro" role="alert"></p><button class="ax-btn pri" type="submit">Cadastrar academia</button></form></div>
            <div id="ac-lista" class="ax-grid ax-g2" aria-live="polite"></div>`;
        const lista = raiz.querySelector("#ac-lista");
        const linhasDe = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);

        async function carregar() {
            const l = await chamarFuncao("admin/academias", null);
            lista.innerHTML = l.length ? l.map((a) => `<div class="ax-card" data-id="${esc(a.id)}">
                <h3>${esc(a.nome)} ${a.ativo ? '<span class="ax-badge g">ativa</span>' : '<span class="ax-badge r">desativada</span>'}</h3>
                <p class="ax-mut ax-sm">${esc(a.cidade || "—")} · ${a.acessos} acesso(s)${a.convites ? ` · ${a.convites} convite(s) pendente(s)` : ""}</p>
                <p class="ax-xs ax-mut ax-mt">Apelidos: ${a.aliases.length ? a.aliases.map((x) => `<span class="ax-badge">${esc(x)}</span>`).join(" ") : "nenhum (vale só o nome)"}</p>
                <div class="ax-row ax-mt"><input class="ax-in ax-grow" type="email" maxlength="120" placeholder="e-mail da academia" aria-label="E-mail para vincular" data-email>
                    <button class="ax-btn sm pri" data-vinc>Vincular</button><button class="ax-btn sm" data-desv>Remover</button></div>
                <div class="ax-row ax-mt"><button class="ax-btn sm" data-edit>Editar apelidos</button><button class="ax-btn sm" data-ativo="${a.ativo ? "0" : "1"}">${a.ativo ? "Desativar" : "Reativar"}</button></div></div>`).join("") : '<p class="ax-mut">Nenhuma academia cadastrada.</p>';
        }
        raiz.querySelector("#ac-nova").addEventListener("submit", async (ev) => {
            ev.preventDefault(); const erro = raiz.querySelector("#ac-erro"); erro.textContent = "";
            try {
                await chamarFuncao("admin/academias", { nome: raiz.querySelector("#ac-nome").value.trim(), cidade: raiz.querySelector("#ac-cidade").value.trim(), aliases: linhasDe(raiz.querySelector("#ac-apelidos").value) });
                ev.target.reset(); toast("Academia cadastrada.", "ok"); await carregar();
            } catch (e) { erro.textContent = e?.message || "Não foi possível cadastrar."; }
        });
        lista.addEventListener("click", async (ev) => {
            const card = ev.target.closest("[data-id]"); if (!card) return; const id = card.dataset.id, email = card.querySelector("[data-email]").value.trim();
            try {
                if (ev.target.closest("[data-vinc],[data-desv]")) {
                    const remover = !!ev.target.closest("[data-desv]");
                    if (!email) return toast("Digite o e-mail da conta.", "err");
                    const r = await sens(() => chamarFuncao(`admin/academias/${enc(id)}/acesso`, { email, remover }));
                    toast(remover ? "Acesso removido." : r.pendente ? "Convite criado: o acesso liga no primeiro login com esse e-mail." : "Acesso liberado.", "ok");
                } else if (ev.target.closest("[data-ativo]")) await chamarFuncao(`admin/academias/${enc(id)}`, { ativo: ev.target.closest("[data-ativo]").dataset.ativo === "1" }, "PUT");
                else if (ev.target.closest("[data-edit]")) {
                    const atual = (await chamarFuncao("admin/academias", null)).find((a) => a.id === id);
                    const texto = ctx.pedir ? await ctx.pedir({ titulo: "Apelidos de local", texto: "Um por linha (mínimo 4 letras).", rotulo: "Apelidos", min: 0, ok: "Salvar" }) : null;
                    if (texto === null || !atual) return;
                    await chamarFuncao(`admin/academias/${enc(id)}`, { aliases: linhasDe(texto) }, "PUT"); toast("Apelidos salvos.", "ok");
                } else return;
                await carregar();
            } catch (e) { falhar(e); }
        });
        await carregar();
    }
};
