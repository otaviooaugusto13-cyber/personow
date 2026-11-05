// Aba "Equipe de TI": cria/remove operadores (claim role "ti") e atende chamados de suporte. Rotas: /admin/ti/operadores, /ti/chamados.
export default {
    id: "ti", titulo: "Suporte e TI", icone: "🛠",
    async render(raiz, ctx) {
        const { chamarFuncao, esc, toast } = ctx, sens = ctx.sensivel || ((fn) => fn()), enc = encodeURIComponent;
        raiz.innerHTML = `<div class="ax-card ax-mb"><h2>Chamados de suporte</h2><div id="ti-ch" aria-live="polite"></div></div>
            <div class="ax-card"><h2>Operadores de TI</h2><p class="ax-mut ax-sm ax-mb">Conta nova (e-mail ainda não usado). A senha temporária aparece UMA vez.</p>
            <div class="ax-grid ax-g2"><div><label class="ax-lbl" for="ti-nome">Nome</label><input class="ax-in" id="ti-nome" maxlength="100"></div><div><label class="ax-lbl" for="ti-email">E-mail</label><input class="ax-in" id="ti-email" type="email" maxlength="120"></div></div>
            <p class="ax-erro" id="ti-erro" role="alert"></p><button class="ax-btn pri ax-mt" id="ti-criar">Criar operador</button><div id="ti-ops" class="ax-mt"></div></div>`;
        const ch = raiz.querySelector("#ti-ch"), ops = raiz.querySelector("#ti-ops");
        const falhar = (e) => { if (e?.code !== "cancelado") toast(e?.message || "Não foi possível concluir.", "err"); };
        async function chamados() {
            const l = await chamarFuncao("ti/chamados", null);
            ch.innerHTML = l.length ? l.map((c) => `<div class="ax-row ax-mb" data-id="${esc(c.id)}"><span class="ax-grow"><strong>${esc(c.assunto)}</strong> <span class="ax-mut ax-sm">· ${esc(c.nome)} (${esc(c.papel)})</span></span><span class="ax-badge">${esc(c.status)}</span><button class="ax-btn sm" data-abrir>Abrir</button></div>`).join("") : '<p class="ax-mut">Nenhum chamado.</p>';
            ch.querySelectorAll("[data-abrir]").forEach((b) => (b.onclick = () => conversa(b.closest("[data-id]").dataset.id)));
        }
        async function conversa(id) {
            const c = await chamarFuncao(`ti/chamados/${enc(id)}`, null);
            ch.innerHTML = `<p><strong>${esc(c.assunto)}</strong> <span class="ax-badge">${esc(c.status)}</span></p>${c.mensagens.map((m) => `<p class="ax-sm ax-mt"><strong>${esc(m.nome)}:</strong> ${esc(m.texto)}</p>`).join("")}
                <textarea class="ax-ta ax-mt" id="ti-resp" rows="3" maxlength="1000" aria-label="Resposta"></textarea><div class="ax-row ax-mt"><button class="ax-btn pri sm" data-enviar>Responder</button><button class="ax-btn sm" data-res>Marcar resolvido</button><button class="ax-btn sm" data-voltar>Voltar</button></div>`;
            ch.querySelector("[data-voltar]").onclick = () => chamados().catch(falhar);
            ch.querySelector("[data-enviar]").onclick = async () => { try { await chamarFuncao(`ti/chamados/${enc(id)}/mensagens`, { texto: ch.querySelector("#ti-resp").value }); conversa(id); } catch (e) { falhar(e); } };
            ch.querySelector("[data-res]").onclick = async () => { try { await chamarFuncao(`ti/chamados/${enc(id)}/status`, { status: "resolvido" }); chamados(); } catch (e) { falhar(e); } };
        }
        async function operadores() {
            const l = await chamarFuncao("admin/ti/operadores", null);
            ops.innerHTML = l.length ? l.map((o) => `<div class="ax-row ax-mb" data-uid="${esc(o.uid)}"><span class="ax-grow">${esc(o.nome)} <span class="ax-mut ax-sm">${esc(o.email)}</span></span>${o.ativo ? '<span class="ax-badge g">ativo</span><button class="ax-btn sm" data-rem>Remover</button>' : '<span class="ax-badge r">removido</span>'}</div>`).join("") : '<p class="ax-mut">Nenhum operador.</p>';
            ops.querySelectorAll("[data-rem]").forEach((b) => (b.onclick = async () => {
                const motivo = prompt("Motivo da remoção (mín. 5 caracteres):"); if (!motivo) return;
                try { await sens(() => chamarFuncao(`admin/ti/operadores/${enc(b.closest("[data-uid]").dataset.uid)}/remover`, { motivo })); toast("Operador removido.", "ok"); operadores(); } catch (e) { falhar(e); }
            }));
        }
        raiz.querySelector("#ti-criar").onclick = async () => {
            try { const r = await sens(() => chamarFuncao("admin/ti/operadores", { nome: raiz.querySelector("#ti-nome").value, email: raiz.querySelector("#ti-email").value })); raiz.querySelector("#ti-erro").textContent = ""; alert(`Operador criado.\n\nE-mail: ${r.email}\nSenha temporária: ${r.senhaTemporaria}\n\nGuarde agora: ela não será mostrada de novo.`); operadores(); }
            catch (e) { if (e?.code !== "cancelado") raiz.querySelector("#ti-erro").textContent = e?.message || "Não foi possível criar."; }
        };
        await Promise.all([chamados(), operadores()]).catch(falhar);
    }
};
