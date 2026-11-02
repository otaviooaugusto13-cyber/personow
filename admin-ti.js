// Aba "Equipe de TI" do painel administrativo: o admin cadastra, remove e libera o acesso dos operadores do painel /painel-ti.
// A autorização é do SERVIDOR (rotas /admin/ti/*, papel admin + login recente). Esta tela só consome a API.
// Nada de innerHTML com dado cru: tudo passa por esc().
import { chamarFuncao, consultar } from "./firebase.js";
import { esc, fmtDataHora } from "./core.js";

const NIVEIS = [["tecnico", "Técnico — atende chamados"], ["gestor", "Gestor — também gerencia a equipe e vê toda a auditoria"]];
const NOME_NIVEL = { tecnico: "Técnico", gestor: "Gestor" };
const POLITICA = "Mínimo 12 caracteres, com 3 dos 4 tipos (minúscula, maiúscula, número, símbolo). Não use o nome nem o e-mail da pessoa.";
const $ = (id) => document.getElementById(id);
const enc = encodeURIComponent;

/** deps: { sensivel, toast, seguro, pedir } vindos de admin.js (login recente por Google, avisos, tratamento de erro, confirmação). */
export function iniciarEquipeTI({ sensivel, toast, seguro, pedir }) {
    const S = { status: "ativo", lista: [] };
    const urlPainel = () => `${location.origin}/painel-ti`;

    // ---------- diálogo de formulário (fica aberto se o servidor recusar; mostra o erro dentro dele) ----------
    function formulario({ titulo, texto = "", html = "", ok = "Salvar", perigo = false, aoMontar, aoEnviar }) {
        const d = $("ti-dlg");
        d.innerHTML = `<form method="dialog" novalidate><h2>${esc(titulo)}</h2>${texto ? `<p class="ax-sm ax-mut ax-mt">${esc(texto)}</p>` : ""}<div class="ax-mt">${html}</div>
            <p class="ax-erro ax-mt" id="ti-dlg-e" role="alert"></p>
            <div class="ax-row ax-mt" style="justify-content:flex-end"><button class="ax-btn" value="cancel" type="submit" formnovalidate>Cancelar</button><button class="ax-btn ${perigo ? "danger" : "pri"}" id="ti-dlg-ok" type="button">${esc(ok)}</button></div></form>`;
        const btn = $("ti-dlg-ok"), erro = $("ti-dlg-e"), f = d.querySelector("form");
        aoMontar?.(f);
        return new Promise((res) => {
            let resultado = null;
            btn.addEventListener("click", async () => {
                erro.textContent = ""; btn.disabled = true;
                try { resultado = await aoEnviar(f); d.close("ok"); }
                catch (e) { if (e.code !== "cancelado") erro.textContent = e.message || "Não foi possível concluir."; }
                finally { btn.disabled = false; }
            });
            d.addEventListener("close", () => res(d.returnValue === "ok" ? (resultado ?? true) : null), { once: true });
            d.returnValue = ""; d.showModal(); f.querySelector("input:not([type=radio]),select,textarea")?.focus();
        });
    }
    const campo = (id, rotulo, ctl) => `<div class="ax-mt"><label class="ax-lbl" for="${id}">${esc(rotulo)}</label>${ctl}</div>`;
    const val = (f, n) => f.elements[n]?.value ?? "";

    /** Mostra uma senha UMA vez (não fica guardada em lugar nenhum). */
    function mostrarSenha(nome, senha, titulo = "Senha temporária") {
        const d = $("ti-dlg");
        d.innerHTML = `<form method="dialog"><h2>${esc(titulo)}</h2>
            <p class="ax-sm ax-mut ax-mt">Entregue a <b>${esc(nome)}</b> por um canal seguro. Ela aparece <b>só agora</b>, não fica guardada e o primeiro acesso exige criar uma senha nova. Endereço do painel: <b>${esc(urlPainel())}</b></p>
            <div class="ax-mt" style="font:700 18px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em;padding:12px;border:1px dashed var(--ax-gold);border-radius:12px;text-align:center;user-select:all;word-break:break-all">${esc(senha)}</div>
            <div class="ax-row ax-mt" style="justify-content:flex-end"><button class="ax-btn sm" type="button" id="ti-cp">Copiar</button><button class="ax-btn pri" value="ok">Fechar</button></div></form>`;
        $("ti-cp").addEventListener("click", () => navigator.clipboard?.writeText(senha).then(() => toast("Copiada.", "ok", 2000)));
        return new Promise((r) => { d.addEventListener("close", r, { once: true }); d.returnValue = ""; d.showModal(); });
    }

    // ---------- listagem ----------
    const dt = (v) => (v ? fmtDataHora(v) || "—" : "—");
    const td = (l, h) => `<td data-l="${esc(l)}">${h}</td>`;
    function render() {
        const ativos = S.status === "ativo", corpo = $("ti-body");
        $("ti-nota").textContent = ativos
            ? "Estas pessoas entram em " + urlPainel() + " com e-mail e senha ou com o Google (o e-mail precisa ser o cadastrado aqui)."
            : "Contas removidas ficam sem acesso. \"Liberar acesso\" reativa a pessoa com uma nova senha temporária.";
        if (!S.lista.length) { corpo.innerHTML = `<tr><td colspan="6" class="ax-empty">${ativos ? "Nenhum operador de TI cadastrado ainda. Clique em “+ Novo operador de TI”." : "Nenhum operador removido."}</td></tr>`; return; }
        corpo.innerHTML = S.lista.map((o) => {
            const acesso = o.acesso === "google" ? '<span class="ax-badge b">Google</span>' : '<span class="ax-badge">E-mail e senha</span>';
            const sit = ativos ? (o.trocarSenha ? '<span class="ax-badge y">Troca de senha pendente</span>' : '<span class="ax-badge g">Ativo</span>')
                : `<span class="ax-badge r">Removido</span><div class="ax-xs ax-mut">${esc(dt(o.excluidoEm))} · ${esc(o.motivoExclusao || "")}</div>`;
            const acoes = ativos
                ? `<button class="ax-btn sm" data-ti="nivel" data-uid="${esc(o.uid)}">Nível</button> <button class="ax-btn sm" data-ti="senha" data-uid="${esc(o.uid)}">${o.acesso === "google" ? "Definir senha" : "Redefinir senha"}</button> <button class="ax-btn sm danger" data-ti="excluir" data-uid="${esc(o.uid)}">Remover</button>`
                : `<button class="ax-btn sm pri" data-ti="restaurar" data-uid="${esc(o.uid)}">Liberar acesso</button>`;
            return `<tr>${td("Nome", esc(o.nome))}${td("E-mail", esc(o.email))}${td("Nível", esc(NOME_NIVEL[o.nivel] || o.nivel))}${td("Acesso", acesso)}${td(ativos ? "Último acesso" : "Situação", ativos ? esc(dt(o.ultimoLoginEm)) + "<div>" + sit + "</div>" : sit)}${td("", acoes)}</tr>`;
        }).join("");
    }
    async function carregar() { S.lista = await consultar(`admin/ti/operadores?status=${S.status}`); render(); }
    const recarregar = () => seguro(carregar)();
    const achar = (uid) => S.lista.find((o) => o.uid === uid);

    // ---------- ações ----------
    async function novo() {
        const r = await formulario({
            titulo: "Novo operador de TI", ok: "Cadastrar", texto: "A pessoa passa a ter acesso ao painel de TI assim que você cadastrar.",
            html: campo("ti-nome", "Nome completo", '<input class="ax-in" id="ti-nome" name="nome" maxlength="100" autocomplete="off">')
                + campo("ti-email", "E-mail", '<input class="ax-in" id="ti-email" name="email" type="email" maxlength="120" autocomplete="off" placeholder="o mesmo e-mail Google da pessoa, se for entrar com Google">')
                + campo("ti-nivel", "Nível", `<select class="ax-sel" id="ti-nivel" name="nivel">${NIVEIS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select>`)
                + `<div class="ax-mt"><span class="ax-lbl">Como a pessoa vai entrar</span>
                    <label class="ax-chk"><input type="radio" name="acesso" value="senha" checked> E-mail e senha (também pode usar o Google com o mesmo e-mail)</label>
                    <label class="ax-chk"><input type="radio" name="acesso" value="google"> Só com o Google (sem senha)</label></div>
                   <div id="ti-bloco-senha">${campo("ti-senha", "Senha (opcional)", '<input class="ax-in" id="ti-senha" name="senha" type="text" maxlength="128" autocomplete="off" placeholder="deixe em branco para gerar uma senha temporária">')}
                    <p class="ax-xs ax-mut ax-mt">${esc(POLITICA)}</p>
                    <label class="ax-chk"><input type="checkbox" name="exigirTroca" checked> Exigir que a pessoa troque a senha no primeiro acesso</label></div>`,
            aoMontar: (f) => { const mostrar = () => { $("ti-bloco-senha").hidden = f.elements.acesso.value === "google"; }; f.addEventListener("change", mostrar); mostrar(); },
            aoEnviar: (f) => sensivel(() => chamarFuncao("admin/ti/operadores", {
                nome: val(f, "nome").trim(), email: val(f, "email").trim(), nivel: val(f, "nivel"), acesso: val(f, "acesso"),
                ...(val(f, "acesso") === "senha" && val(f, "senha") ? { senha: val(f, "senha") } : {}), exigirTroca: f.elements.exigirTroca.checked
            }))
        });
        if (!r || r === true) return;
        const op = r.operador;
        if (r.senhaTemporaria) await mostrarSenha(op.nome, r.senhaTemporaria);
        toast(op.acesso === "google" ? `${op.nome} cadastrado(a). Peça para entrar em ${urlPainel()} com o Google (${op.email}).` : `${op.nome} cadastrado(a) e liberado(a).`, "ok", 9000);
        await carregar();
    }
    async function nivel(uid) {
        const o = achar(uid); if (!o) return;
        const r = await formulario({
            titulo: `Nível de ${o.nome}`, ok: "Salvar", texto: "A mudança vale na hora; as sessões abertas da pessoa são encerradas.",
            html: campo("ti-nivel2", "Nível", `<select class="ax-sel" id="ti-nivel2" name="nivel">${NIVEIS.map(([v, l]) => `<option value="${v}"${v === o.nivel ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`),
            aoEnviar: (f) => { if (val(f, "nivel") === o.nivel) throw new Error("Nada foi alterado."); return sensivel(() => chamarFuncao(`admin/ti/operadores/${enc(uid)}/nivel`, { nivel: val(f, "nivel") }, "PUT")); }
        });
        if (r) { toast("Nível atualizado.", "ok"); await carregar(); }
    }
    async function senha(uid) {
        const o = achar(uid); if (!o) return;
        const r = await formulario({
            titulo: `${o.acesso === "google" ? "Definir senha de" : "Redefinir senha de"} ${o.nome}`, ok: "Salvar senha", texto: "Todas as sessões abertas da pessoa são encerradas.",
            html: campo("ti-senha2", "Nova senha (opcional)", '<input class="ax-in" id="ti-senha2" name="senha" type="text" maxlength="128" autocomplete="off" placeholder="deixe em branco para gerar uma senha temporária">')
                + `<p class="ax-xs ax-mut ax-mt">${esc(POLITICA)}</p><label class="ax-chk"><input type="checkbox" name="exigirTroca" checked> Exigir que a pessoa troque a senha no próximo acesso</label>`
                + campo("ti-motivo2", "Motivo (fica registrado na auditoria, com o seu usuário)", '<textarea class="ax-ta" id="ti-motivo2" name="motivo" maxlength="200" placeholder="Ex.: esqueceu a senha, suspeita de acesso indevido"></textarea>'),
            aoEnviar: (f) => { if (val(f, "motivo").trim().length < 5) throw new Error("Informe o motivo (mínimo 5 caracteres)."); return chamarFuncao(`admin/ti/operadores/${enc(uid)}/senha`, { ...(val(f, "senha") ? { senha: val(f, "senha") } : {}), exigirTroca: f.elements.exigirTroca.checked, motivo: val(f, "motivo").trim() }); }
        });
        if (!r) return;
        if (r.senhaTemporaria) await mostrarSenha(o.nome, r.senhaTemporaria);
        toast(`Senha de ${o.nome} atualizada.`, "ok"); await carregar();
    }
    async function excluir(uid) {
        const o = achar(uid); if (!o) return;
        const r = await formulario({
            titulo: `Remover ${o.nome}?`, ok: "Remover acesso", perigo: true, texto: "O login é desativado na hora, as sessões são encerradas e os chamados que ela atendia voltam para a fila. O histórico fica guardado e você pode liberar o acesso de volta depois.",
            html: campo("ti-motivo", "Motivo (fica registrado na auditoria)", '<textarea class="ax-ta" id="ti-motivo" name="motivo" maxlength="200" placeholder="Ex.: saiu da empresa, mudou de função"></textarea>'),
            aoEnviar: (f) => { if (val(f, "motivo").trim().length < 5) throw new Error("Informe o motivo (mínimo 5 caracteres)."); return chamarFuncao(`admin/ti/operadores/${enc(uid)}/excluir`, { motivo: val(f, "motivo").trim() }); }
        });
        if (r) { toast(`${o.nome} removido(a).`, "ok"); await carregar(); }
    }
    async function restaurar(uid) {
        const o = achar(uid); if (!o) return;
        if (!(await pedir({ titulo: `Liberar o acesso de ${o.nome}?`, texto: o.acesso === "google" ? "A pessoa volta a entrar com o Google." : "Será gerada uma nova senha temporária (a antiga fica descartada).", ok: "Liberar acesso" }))) return;
        const r = await sensivel(() => chamarFuncao(`admin/ti/operadores/${enc(uid)}/restaurar`, {}));
        if (r.senhaTemporaria) await mostrarSenha(o.nome, r.senhaTemporaria);
        toast(`${o.nome} liberado(a) novamente.`, "ok"); S.status = "ativo"; marcarAba(); await carregar();
    }

    const marcarAba = () => { for (const b of document.querySelectorAll("#ti-status .ax-pill")) b.classList.toggle("sel", b.dataset.s === S.status); };
    $("ti-novo").addEventListener("click", seguro(novo));
    $("ti-status").addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (!b) return; S.status = b.dataset.s; marcarAba(); recarregar(); });
    $("ti-body").addEventListener("click", (e) => {
        const b = e.target.closest("[data-ti]"); if (!b) return;
        const acao = { nivel, senha, excluir, restaurar }[b.dataset.ti]; if (acao) seguro(acao)(b.dataset.uid);
    });
    return { carregar };
}
